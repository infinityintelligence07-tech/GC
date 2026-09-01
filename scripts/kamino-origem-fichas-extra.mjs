/**
 * Investiga a origem das fichas com saldo que existem no GC e não na planilha
 * Kamino: quando foram criadas, se a pessoa aparece na planilha em algum
 * produto, e o que dizem os campos de rastreio. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-origem-fichas-extra.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import pg from 'pg';
import { normalizeString } from './lib/kamino-parse.mjs';

const EMPRESA = 'IAM - GC';
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const soma = (arr, f) => R(arr.reduce((s, x) => s + f(x), 0));

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  return (fs.readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1] ?? '').replaceAll('"', '');
}

// ── Planilha: chaves e nomes ──────────────────────────────────────────────
const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const chaves = new Set();
const nomes = new Set();
for (const row of raw) {
  const out = { ...row };
  if (!FILL.every((c) => !normalizeString(out[c]))) {
    for (const c of FILL) {
      if (normalizeString(out[c])) last[c] = out[c];
      else if (last[c] != null) out[c] = last[c];
    }
  }
  const p = norm(out.Pessoa || 'Sem Nome');
  nomes.add(p);
  chaves.add(`${p}||${norm(out.Classificação || 'Sem Treinamento')}`);
}

// ── GC ────────────────────────────────────────────────────────────────────
const client = new pg.Client({
  connectionString: readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const rows = (
  await client.query(
    `select s.id, s.name, s.product, coalesce(nullif(trim(s.ac), ''), '') as ac, s.status, s.status_mode,
            s.enrollment_date, s.data_treinamento_origem, s.detalhes, s.tags,
            to_char(s.created_at, 'YYYY-MM-DD') as criada_em,
            to_char(s.updated_at, 'YYYY-MM-DD') as atualizada_em,
            coalesce(jsonb_array_length(s.installments), 0) as n_inst,
            (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as saldo
       from public.students s
       join public.companies c on c.id = s.company_id
      where c.name = $1`,
    [EMPRESA],
  )
).rows;
await client.end();

const extras = rows
  .map((r) => ({
    ...r,
    saldo: R(Number(r.saldo)),
    chave: `${norm(r.name)}||${norm(r.product)}`,
    nomeNorm: norm(r.name),
  }))
  .filter((r) => r.saldo > 0 && !chaves.has(r.chave));

console.log(`fichas com saldo no GC e ausentes da planilha: ${extras.length} | ${brl(soma(extras, (x) => x.saldo))}`);

// ── A pessoa existe na planilha em algum outro produto? ──────────────────
const pessoaExiste = extras.filter((x) => nomes.has(x.nomeNorm));
const pessoaNaoExiste = extras.filter((x) => !nomes.has(x.nomeNorm));
console.log(`\n=== A PESSOA APARECE NA PLANILHA (em outro produto)? ===`);
console.log(`  sim, so falta este contrato: ${pessoaExiste.length} | ${brl(soma(pessoaExiste, (x) => x.saldo))}`);
console.log(`  nao, a pessoa nao esta na planilha: ${pessoaNaoExiste.length} | ${brl(soma(pessoaNaoExiste, (x) => x.saldo))}`);

// ── Data de criacao da ficha ─────────────────────────────────────────────
const porMes = new Map();
for (const x of extras) {
  const k = (x.criada_em ?? '?').slice(0, 7);
  if (!porMes.has(k)) porMes.set(k, { n: 0, saldo: 0 });
  const v = porMes.get(k);
  v.n++;
  v.saldo = R(v.saldo + x.saldo);
}
console.log('\n=== QUANDO A FICHA FOI CRIADA NO GC ===');
for (const [k, v] of [...porMes].sort())
  console.log(`  ${k}  ${String(v.n).padStart(3)} fichas  ${brl(v.saldo).padStart(14)}`);

// Comparativo: distribuicao de criacao de TODAS as fichas com saldo
const todasComSaldo = rows.filter((r) => Number(r.saldo) > 0);
const porMesTodas = new Map();
for (const x of todasComSaldo) {
  const k = (x.criada_em ?? '?').slice(0, 7);
  porMesTodas.set(k, (porMesTodas.get(k) ?? 0) + 1);
}
console.log('\n  para comparar, todas as fichas com saldo por mes de criacao:');
for (const [k, n] of [...porMesTodas].sort()) console.log(`  ${k}  ${String(n).padStart(4)} fichas`);

// ── Status x modo ────────────────────────────────────────────────────────
const porStatus = new Map();
for (const x of extras) {
  const k = `${x.status} / ${x.status_mode}`;
  if (!porStatus.has(k)) porStatus.set(k, { n: 0, saldo: 0 });
  const v = porStatus.get(k);
  v.n++;
  v.saldo = R(v.saldo + x.saldo);
}
console.log('\n=== STATUS E MODO ===');
for (const [k, v] of [...porStatus].sort((a, b) => b[1].saldo - a[1].saldo))
  console.log(`  ${pad(k, 38)} ${String(v.n).padStart(3)} fichas ${brl(v.saldo).padStart(14)}`);

// ── Campo detalhes / tags: rastro de importacao ──────────────────────────
const comDetalhe = extras.filter((x) => x.detalhes && String(x.detalhes).trim());
console.log(`\n=== RASTRO DE ORIGEM ===`);
console.log(`  com campo detalhes preenchido: ${comDetalhe.length} de ${extras.length}`);
const amostraDet = [...new Set(comDetalhe.map((x) => String(x.detalhes).slice(0, 90)))].slice(0, 8);
for (const d of amostraDet) console.log(`    ${d}`);
const comTags = extras.filter((x) => Array.isArray(x.tags) && x.tags.length > 0);
console.log(`  com tags: ${comTags.length}`);
const tagCount = new Map();
for (const x of comTags) for (const t of x.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
for (const [t, n] of [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${t}: ${n}`);

// ── Matricula: dentro ou fora da janela da planilha? ─────────────────────
const datas = extras.map((x) => x.enrollment_date).filter(Boolean).sort();
console.log(`\n=== DATA DE MATRICULA DAS FICHAS EXTRA ===`);
console.log(`  da mais antiga a mais recente: ${datas[0]} -> ${datas[datas.length - 1]}`);
const porAno = new Map();
for (const x of extras) {
  const k = (x.enrollment_date ?? '?').slice(0, 4);
  if (!porAno.has(k)) porAno.set(k, { n: 0, saldo: 0 });
  const v = porAno.get(k);
  v.n++;
  v.saldo = R(v.saldo + x.saldo);
}
for (const [k, v] of [...porAno].sort()) console.log(`  ${k}  ${String(v.n).padStart(3)} fichas ${brl(v.saldo).padStart(14)}`);

console.log('\n=== MAIORES, COM RASTRO ===');
for (const x of extras.sort((a, b) => b.saldo - a.saldo).slice(0, 20))
  console.log(
    `  ${pad(x.name.slice(0, 36), 36)} ${pad(x.product.slice(0, 18), 18)} ${pad(x.ac.slice(0, 16), 16)} ` +
      `${pad(x.status, 26)} ${brl(x.saldo).padStart(13)} | ${x.n_inst}p | criada ${x.criada_em} | matricula ${x.enrollment_date ?? '-'} | ` +
      `pessoa na planilha: ${nomes.has(x.nomeNorm) ? 'sim' : 'nao'}`,
  );

fs.writeFileSync(
  'scripts/kamino-origem-fichas-extra.json',
  JSON.stringify({ total: extras.length, saldo: soma(extras, (x) => x.saldo), fichas: extras }, null, 1),
);
console.log('\nrelatorio: scripts/kamino-origem-fichas-extra.json');
