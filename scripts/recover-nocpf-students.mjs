/**
 * Verifica se alunos do backup sem CPF já existem no GC por nome+produto (ou nome).
 * E tenta inserir os que ainda faltam (add-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EXTRACT = path.resolve('.tmp_backup_extract');

function readEnvDatabaseUrl() {
  const text = fs.readFileSync(path.resolve('.env'), 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL não encontrado');
  return m[1].replaceAll('"', '');
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function normName(n) {
  return String(n || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function abertoFromInstallments(installments) {
  if (!Array.isArray(installments)) return 0;
  return installments.reduce((s, i) => s + (!i?.paid ? Number(i?.value || 0) : 0), 0);
}

function elegivel(s) {
  if (s.statusCancelamento === 'cancelado') return false;
  if (s.status === 'Pago') return false;
  if (s.isRendaExtra && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
  return true;
}

function parseStudentsCopy(sqlFile) {
  const text = fs.readFileSync(sqlFile, 'utf8');
  const marker = 'COPY public.students (';
  const start = text.indexOf(marker);
  const header = text.slice(start, text.indexOf(') FROM stdin;', start));
  const columns = header.slice(marker.length).split(',').map((c) => c.trim());
  const bodyStart = text.indexOf('FROM stdin;', start) + 'FROM stdin;'.length;
  const bodyEnd = text.indexOf('\n\\.\n', bodyStart);
  const body = bodyEnd >= 0 ? text.slice(bodyStart, bodyEnd) : text.slice(bodyStart);
  const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
  const uuidStart = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\t/i;
  const rows = [];
  let current = '';
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    if (uuidStart.test(line)) {
      if (current) rows.push(current);
      current = line;
    } else if (current) current += '\n' + line;
  }
  if (current) rows.push(current);

  return {
    columns,
    rowsRaw: rows,
    students: rows.map((row) => {
      const p = row.split('\t');
      const get = (k) => (p[idx[k]] === '\\N' ? null : p[idx[k]]);
      let installments = [];
      try {
        const raw = get('installments');
        if (raw) installments = JSON.parse(raw);
      } catch {
        installments = [];
      }
      const cpf = String(get('cpf') || '').replace(/\D/g, '');
      return {
        id: get('id'),
        name: get('name'),
        ac: get('ac') || '(sem AC)',
        status: get('status'),
        statusCancelamento: get('status_cancelamento'),
        isRendaExtra: get('is_renda_extra') === 't',
        rendaExtraStatus: get('renda_extra_status'),
        product: (get('product') || '').trim(),
        cpf,
        aberto: abertoFromInstallments(installments),
        raw: row,
      };
    }),
  };
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const doInsert = process.argv.includes('--insert');
  const parsed = parseStudentsCopy(path.join(EXTRACT, 'students.sql'));
  const backup = parsed.students.filter(elegivel);

  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();
  const { rows } = await client.query(`
    SELECT id::text, name, product, ac, status, status_cancelamento, is_renda_extra, renda_extra_status, installments,
           regexp_replace(coalesce(cpf,''), '[^0-9]', '', 'g') AS cpf
    FROM public.students
  `);

  const currentIds = new Set(rows.map((r) => r.id));
  const byNameProd = new Map();
  for (const r of rows) {
    const k = `${normName(r.name)}|${(r.product || '').toLowerCase()}`;
    if (!byNameProd.has(k)) byNameProd.set(k, []);
    byNameProd.get(k).push(r);
  }

  const missingNoCpf = backup.filter((b) => !currentIds.has(b.id) && b.cpf.length < 11);
  let matchedName = 0;
  let matchedNameAbertoBackup = 0;
  let matchedNameAbertoGc = 0;
  let unmatched = [];
  let unmatchedAberto = 0;

  for (const b of missingNoCpf) {
    const k = `${normName(b.name)}|${b.product.toLowerCase()}`;
    const hits = byNameProd.get(k) || [];
    if (hits.length) {
      matchedName += 1;
      matchedNameAbertoBackup += b.aberto;
      const g = hits[0];
      const gAberto = abertoFromInstallments(g.installments);
      const gEleg =
        g.status_cancelamento !== 'cancelado' &&
        g.status !== 'Pago' &&
        !(g.is_renda_extra && g.renda_extra_status && g.renda_extra_status !== 'Conciliar Exclusão');
      matchedNameAbertoGc += gEleg ? gAberto : 0;
    } else {
      unmatched.push(b);
      unmatchedAberto += b.aberto;
    }
  }

  console.log('Backup sem CPF e ID ausente no GC:', missingNoCpf.length, money(missingNoCpf.reduce((s, x) => s + x.aberto, 0)));
  console.log('Já existem no GC por nome+produto:', matchedName, 'backup aberto', money(matchedNameAbertoBackup), 'GC aberto', money(matchedNameAbertoGc));
  console.log('Ainda sem match (candidatos a inserir):', unmatched.length, money(unmatchedAberto));
  console.log('Amostra sem match:', unmatched.slice(0, 8).map((u) => `${u.name} | ${u.product} | ${u.ac} | ${money(u.aberto)}`));

  if (!doInsert) {
    console.log('\nRode com --insert para adicionar os sem match (ON CONFLICT DO NOTHING).');
    await client.end();
    return;
  }

  if (unmatched.length === 0) {
    console.log('Nada a inserir.');
    await client.end();
    return;
  }

  const unmatchedIds = new Set(unmatched.map((u) => u.id));
  const filteredRows = parsed.rowsRaw.filter((row) => unmatchedIds.has(row.slice(0, 36)));
  const staging = '_merge_students_nocpf';
  await client.query(`DROP TABLE IF EXISTS public.${staging}`);
  await client.query(`CREATE TABLE public.${staging} (LIKE public.students INCLUDING DEFAULTS)`);

  // drop generated cols if copy fails - check
  const cols = parsed.columns;
  const copySql = `COPY public.${staging} (${cols.join(', ')}) FROM STDIN`;
  const stream = client.query(copyFrom(copySql));
  await pipeline(Readable.from(filteredRows.map((r) => r + '\n')), stream);

  // Avoid unique collisions on empty cpf_digits: only insert when no existing
  // row with same company + empty/null cpf_digits + product + ciclo AND same name.
  // Safer: insert by id conflict only; if unique cpf fails, skip via WHERE NOT EXISTS
  // on (company_id, cpf_digits, product, ciclo) OR matching normalized name+product.
  const colList = cols.join(', ');
  const res = await client.query(`
    INSERT INTO public.students (${colList})
    SELECT ${cols.map((c) => `s.${c}`).join(', ')}
    FROM public.${staging} s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.students t
      WHERE t.company_id = s.company_id
        AND t.cpf_digits = s.cpf_digits
        AND lower(btrim(coalesce(t.product,''))) = lower(btrim(coalesce(s.product,'')))
        AND lower(btrim(coalesce(t.ciclo,''))) = lower(btrim(coalesce(s.ciclo,'')))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.students t2
      WHERE lower(regexp_replace(unaccent(coalesce(t2.name,'')), '[^a-z0-9 ]', '', 'g'))
          = lower(regexp_replace(unaccent(coalesce(s.name,'')), '[^a-z0-9 ]', '', 'g'))
        AND lower(btrim(coalesce(t2.product,''))) = lower(btrim(coalesce(s.product,'')))
    )
    ON CONFLICT (id) DO NOTHING
  `);

  await client.query(`DROP TABLE IF EXISTS public.${staging}`);
  console.log('Inseridos:', res.rowCount);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
