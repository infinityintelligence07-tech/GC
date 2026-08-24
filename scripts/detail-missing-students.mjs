/**
 * Detalha os 266 alunos só no backup (elegíveis) que não casam por company+cpf+produto+ciclo.
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

  return rows.map((row) => {
    const p = row.split('\t');
    const get = (k) => (p[idx[k]] === '\\N' ? null : p[idx[k]]);
    let installments = [];
    try {
      const raw = get('installments');
      if (raw) installments = JSON.parse(raw);
    } catch {
      installments = [];
    }
    return {
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
      aberto: abertoFromInstallments(installments),
    };
  });
}

function elegivel(s) {
  if (s.statusCancelamento === 'cancelado') return false;
  if (s.status === 'Pago') return false;
  if (s.isRendaExtra && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
  return true;
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const backup = parseStudentsCopy(path.join(EXTRACT, 'students.sql')).filter(elegivel);

  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();
  const { rows } = await client.query(`
    SELECT id::text, name, ac, status, status_cancelamento, is_renda_extra, renda_extra_status,
           product, ciclo, regexp_replace(coalesce(cpf,''), '[^0-9]', '', 'g') AS cpf,
           company_id::text, installments, cpf_digits
    FROM public.students
  `);
  await client.end();

  const currentAll = rows.map((r) => ({
    id: r.id,
    name: r.name,
    ac: r.ac || '(sem AC)',
    status: r.status,
    statusCancelamento: r.status_cancelamento,
    isRendaExtra: !!r.is_renda_extra,
    rendaExtraStatus: r.renda_extra_status,
    product: (r.product || '').trim(),
    ciclo: (r.ciclo || '').trim(),
    cpf: r.cpf_digits || r.cpf || '',
    companyId: r.company_id,
    aberto: abertoFromInstallments(r.installments),
  }));
  const currentIds = new Set(currentAll.map((s) => s.id));
  const byFull = new Map();
  const byCpfProd = new Map();
  const byCpf = new Map();
  for (const s of currentAll) {
    byFull.set(`${s.companyId}|${s.cpf}|${s.product.toLowerCase()}|${s.ciclo.toLowerCase()}`, s);
    if (s.cpf.length >= 11) {
      const kp = `${s.cpf}|${s.product.toLowerCase()}|${s.ciclo.toLowerCase()}`;
      if (!byCpfProd.has(kp)) byCpfProd.set(kp, []);
      byCpfProd.get(kp).push(s);
      if (!byCpf.has(s.cpf)) byCpf.set(s.cpf, []);
      byCpf.get(s.cpf).push(s);
    }
  }

  const missing = backup.filter((b) => !currentIds.has(b.id));
  let noCpf = 0;
  let noCpfAberto = 0;
  let matchIgnoreCompany = 0;
  let matchIgnoreCompanyAbertoGap = 0;
  let matchCpfOtherProduct = 0;
  let trulyMissing = 0;
  let trulyMissingAberto = 0;
  const samples = [];

  for (const b of missing) {
    if (!elegivel(b)) continue;
    if (b.cpf.length < 11) {
      noCpf += 1;
      noCpfAberto += b.aberto;
      if (samples.length < 8) samples.push({ tipo: 'sem CPF', ...b });
      continue;
    }
    const full = byFull.get(`${b.companyId}|${b.cpf}|${b.product.toLowerCase()}|${b.ciclo.toLowerCase()}`);
    if (full) continue; // should have been counted as dup

    const kp = `${b.cpf}|${b.product.toLowerCase()}|${b.ciclo.toLowerCase()}`;
    const sameProd = byCpfProd.get(kp);
    if (sameProd?.length) {
      matchIgnoreCompany += 1;
      const best = sameProd.find(elegivel) || sameProd[0];
      matchIgnoreCompanyAbertoGap += Math.max(0, b.aberto - (elegivel(best) ? best.aberto : 0));
      if (samples.length < 12) {
        samples.push({
          tipo: 'mesmo cpf+prod outra company',
          backup: { id: b.id, ac: b.ac, aberto: b.aberto, company: b.companyId, product: b.product, name: b.name },
          gc: { id: best.id, ac: best.ac, aberto: best.aberto, company: best.companyId, status: best.status, cancel: best.statusCancelamento },
        });
      }
      continue;
    }

    const sameCpf = byCpf.get(b.cpf);
    if (sameCpf?.length) {
      matchCpfOtherProduct += 1;
      if (samples.length < 15) {
        samples.push({
          tipo: 'mesmo cpf outro produto',
          backup: { id: b.id, ac: b.ac, aberto: b.aberto, product: b.product, name: b.name },
          gcProducts: sameCpf.map((s) => `${s.product} (${s.status}/${s.statusCancelamento}) aberto=${money(s.aberto)}`),
        });
      }
      continue;
    }

    trulyMissing += 1;
    trulyMissingAberto += b.aberto;
    if (samples.length < 20) {
      samples.push({
        tipo: 'ausente de verdade',
        id: b.id,
        name: b.name,
        ac: b.ac,
        product: b.product,
        aberto: b.aberto,
        cpf: b.cpf,
        company: b.companyId,
      });
    }
  }

  console.log('Missing IDs elegíveis no backup:', missing.filter(elegivel).length);
  console.log('Sem CPF válido:', noCpf, money(noCpfAberto));
  console.log('Mesmo CPF+produto em OUTRA company:', matchIgnoreCompany, 'gap:', money(matchIgnoreCompanyAbertoGap));
  console.log('Mesmo CPF outro produto:', matchCpfOtherProduct);
  console.log('Realmente ausentes (sem nenhum match CPF):', trulyMissing, money(trulyMissingAberto));
  console.log('\nAmostras:');
  for (const s of samples.slice(0, 12)) console.log(JSON.stringify(s));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
