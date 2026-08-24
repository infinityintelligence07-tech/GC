/**
 * Explica gap de carteira: backup vs GC.
 * 1) IDs só no backup (bloqueados por unique cpf+produto)
 * 2) Mesmo CPF+produto: compara aberto (não pago)
 * 3) Mesmo ID: compara aberto
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

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

function cpfDigits(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function abertoFromInstallments(installments) {
  if (!Array.isArray(installments)) return 0;
  return installments.reduce((s, i) => s + (!i?.paid ? Number(i?.value || 0) : 0), 0);
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

  const out = [];
  for (const row of rows) {
    const p = row.split('\t');
    const get = (k) => (p[idx[k]] === '\\N' ? null : p[idx[k]]);
    let installments = [];
    try {
      const raw = get('installments');
      if (raw) installments = JSON.parse(raw);
    } catch {
      installments = [];
    }
    out.push({
      id: get('id'),
      name: get('name'),
      ac: get('ac') || '(sem AC)',
      status: get('status'),
      statusCancelamento: get('status_cancelamento'),
      isRendaExtra: get('is_renda_extra') === 't',
      rendaExtraStatus: get('renda_extra_status'),
      product: (get('product') || '').trim(),
      ciclo: (get('ciclo') || '').trim(),
      cpf: cpfDigits(get('cpf')),
      companyId: get('company_id'),
      saleValue: Number(get('sale_value') || 0),
      aberto: abertoFromInstallments(installments),
      qtdParcelas: installments.length,
      qtdAbertas: installments.filter((i) => !i?.paid).length,
    });
  }
  return out;
}

function elegivel(s) {
  if (s.statusCancelamento === 'cancelado') return false;
  if (s.status === 'Pago') return false;
  if (s.isRendaExtra && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
  return true;
}

function keyOf(s) {
  return `${s.companyId || ''}|${s.cpf}|${(s.product || '').toLowerCase()}|${(s.ciclo || '').toLowerCase()}`;
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const backupAll = parseStudentsCopy(path.join(EXTRACT, 'students.sql'));
  const backup = backupAll.filter(elegivel);

  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();
  const { rows: currentRows } = await client.query(`
    SELECT id::text, name, ac, status, status_cancelamento, is_renda_extra, renda_extra_status,
           product, ciclo, cpf, company_id::text, sale_value, installments
    FROM public.students
  `);
  await client.end();

  const currentAll = currentRows.map((r) => ({
    id: r.id,
    name: r.name,
    ac: r.ac || '(sem AC)',
    status: r.status,
    statusCancelamento: r.status_cancelamento,
    isRendaExtra: !!r.is_renda_extra,
    rendaExtraStatus: r.renda_extra_status,
    product: (r.product || '').trim(),
    ciclo: (r.ciclo || '').trim(),
    cpf: cpfDigits(r.cpf),
    companyId: r.company_id,
    saleValue: Number(r.sale_value || 0),
    aberto: abertoFromInstallments(r.installments),
    qtdParcelas: Array.isArray(r.installments) ? r.installments.length : 0,
    qtdAbertas: Array.isArray(r.installments) ? r.installments.filter((i) => !i?.paid).length : 0,
  }));
  const current = currentAll.filter(elegivel);
  const currentById = new Map(currentAll.map((s) => [s.id, s]));
  const currentByKey = new Map();
  for (const s of currentAll) {
    if (!s.cpf || s.cpf.length < 11) continue;
    const k = keyOf(s);
    if (!currentByKey.has(k)) currentByKey.set(k, s);
  }

  let onlyBackup = 0;
  let onlyBackupAberto = 0;
  let sameIdLowerInGc = 0;
  let sameIdLowerAberto = 0;
  let dupKeyBlocked = 0;
  let dupKeyBlockedAberto = 0;
  let dupKeyGcHigher = 0;
  const byAc = new Map();

  const bump = (ac, field, value) => {
    const cur = byAc.get(ac) || {
      onlyBackup: 0,
      onlyBackupAberto: 0,
      sameIdGap: 0,
      dupGap: 0,
    };
    cur[field] += value;
    byAc.set(ac, cur);
  };

  for (const b of backup) {
    const gcSameId = currentById.get(b.id);
    if (gcSameId) {
      if (elegivel(gcSameId)) {
        const gap = b.aberto - gcSameId.aberto;
        if (gap > 1) {
          sameIdLowerInGc += 1;
          sameIdLowerAberto += gap;
          bump(b.ac, 'sameIdGap', gap);
        }
      } else {
        // no GC existe mas saiu da carteira (pago/cancelado/RE)
        onlyBackup += 1;
        onlyBackupAberto += b.aberto;
        bump(b.ac, 'onlyBackupAberto', b.aberto);
        bump(b.ac, 'onlyBackup', 1);
      }
      continue;
    }

    const k = keyOf(b);
    const gcDup = b.cpf.length >= 11 ? currentByKey.get(k) : null;
    if (gcDup) {
      dupKeyBlocked += 1;
      const gap = b.aberto - (elegivel(gcDup) ? gcDup.aberto : 0);
      if (gap > 1) {
        dupKeyBlockedAberto += gap;
        bump(b.ac, 'dupGap', gap);
      } else if (gap < -1) {
        dupKeyGcHigher += 1;
      }
    } else {
      onlyBackup += 1;
      onlyBackupAberto += b.aberto;
      bump(b.ac, 'onlyBackupAberto', b.aberto);
      bump(b.ac, 'onlyBackup', 1);
    }
  }

  console.log('Backup elegíveis:', backup.length, money(backup.reduce((s, x) => s + x.aberto, 0)));
  console.log('GC elegíveis:', current.length, money(current.reduce((s, x) => s + x.aberto, 0)));
  console.log('');
  console.log('Mesmo ID, GC com menos aberto:', sameIdLowerInGc, money(sameIdLowerAberto));
  console.log('Só no backup (sem match cpf+produto):', onlyBackup, money(onlyBackupAberto));
  console.log('Bloqueados por cpf+produto (ID diferente):', dupKeyBlocked, 'gap aberto:', money(dupKeyBlockedAberto));
  console.log('Desses, GC já tem mais aberto:', dupKeyGcHigher);
  console.log('');
  console.log('Por assessor (gap backup → GC):');
  for (const [ac, v] of [...byAc.entries()].sort()) {
    const totalGap = v.sameIdGap + v.dupGap + v.onlyBackupAberto;
    console.log(
      `${ac}: total gap ${money(totalGap)} | mesmo ID ${money(v.sameIdGap)} | dup cpf+prod ${money(v.dupGap)} | só backup ${money(v.onlyBackupAberto)} (${v.onlyBackup} alunos)`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
