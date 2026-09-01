/**
 * Concilia a carteira de cada AC entre a planilha Kamino e o GC.
 * Compara quantidade de contratos e saldo em aberto, e explica as diferenças.
 * SOMENTE LEITURA (apenas SELECT no banco).
 *
 * Uso: node scripts/kamino-concilia-carteiras.mjs ["KAMINO GC (1).xlsx"]
 * Saída: scripts/kamino-concilia-carteiras.json
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import pg from 'pg';
import { parseKaminoFile } from './lib/kamino-parse.mjs';

const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'KAMINO GC (1).xlsx';
const EMPRESA = 'IAM - GC';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const num = (n, w = 6) => String(n).padStart(w);
const val = (n, w = 15) => brl(n).padStart(w);

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const m = fs.readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

// ── 1. Lado GC (banco) ─────────────────────────────────────────────────────
// sslmode na URL passa a valer verify-full no pg 8.16+, o que quebra contra o
// certificado do pooler do Supabase; o modo é definido aqui explicitamente.
const client = new pg.Client({
  connectionString: readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// public.acs é global: o vínculo com empresa fica em user_company_acs.
const acsDb = (await client.query('select id, name, active from public.acs order by name')).rows;

const gcRows = (
  await client.query(
    `select s.id, s.name, s.product, s.ac, s.status, s.status_mode,
            coalesce(s.sale_value, 0)::numeric as sale_value,
            coalesce(jsonb_array_length(s.installments), 0) as n_inst,
            (select count(*) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as n_abertas,
            (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as saldo
       from public.students s
       join public.companies c on c.id = s.company_id
      where c.name = $1`,
    [EMPRESA],
  )
).rows.map((r) => ({
  id: r.id,
  name: r.name,
  product: r.product ?? '',
  ac: (r.ac ?? '').trim(),
  status: r.status,
  statusMode: r.status_mode,
  saleValue: R(Number(r.sale_value)),
  nInst: Number(r.n_inst),
  nAbertas: Number(r.n_abertas),
  saldo: R(Number(r.saldo)),
  chave: `${norm(r.name)}||${norm(r.product)}`,
}));

await client.end();

// ── 2. Lado planilha (parser oficial) ──────────────────────────────────────
const abs = path.resolve(XLSX_PATH);
const acNames = acsDb.map((a) => a.name);
const kaminoAll = parseKaminoFile(abs, acNames).map((k) => {
  const abertas = k.installments.filter((i) => !i.paid);
  return {
    name: k.name,
    product: k.product,
    ac: (k.ac ?? '').trim(),
    saleValue: R(k.saleValue),
    nInst: k.installments.length,
    nAbertas: abertas.length,
    saldo: R(abertas.reduce((s, i) => s + i.value, 0)),
    chave: `${norm(k.name)}||${norm(k.product)}`,
  };
});

const kaminoAberto = kaminoAll.filter((k) => k.saldo > 0);
const gcAberto = gcRows.filter((g) => g.saldo > 0);

// ── 3. Carteira por AC nos dois lados ──────────────────────────────────────
const agrupa = (arr) => {
  const m = new Map();
  for (const x of arr) {
    const k = x.ac || '(sem AC)';
    if (!m.has(k)) m.set(k, { contratos: 0, saldo: 0, contratado: 0 });
    const v = m.get(k);
    v.contratos++;
    v.saldo = R(v.saldo + x.saldo);
    v.contratado = R(v.contratado + x.saleValue);
  }
  return m;
};

const kPorAc = agrupa(kaminoAberto);
const gPorAc = agrupa(gcAberto);
const todosAcs = [...new Set([...kPorAc.keys(), ...gPorAc.keys()])].sort();

console.log('=== ACs CADASTRADOS NO GC ===');
for (const a of acsDb) console.log(`  ${a.active ? 'ativo  ' : 'inativo'} ${a.name}`);

console.log('\n=== CARTEIRA EM ABERTO POR AC: PLANILHA x GC ===');
console.log(
  `${pad('AC', 24)} ${'kam#'.padStart(6)} ${'kam saldo'.padStart(15)} | ${'gc#'.padStart(6)} ${'gc saldo'.padStart(15)} | ` +
    `${'dif#'.padStart(6)} ${'dif saldo'.padStart(15)}`,
);
const porAc = [];
for (const ac of todosAcs) {
  const k = kPorAc.get(ac) ?? { contratos: 0, saldo: 0, contratado: 0 };
  const g = gPorAc.get(ac) ?? { contratos: 0, saldo: 0, contratado: 0 };
  const linha = {
    ac,
    kamContratos: k.contratos,
    kamSaldo: k.saldo,
    gcContratos: g.contratos,
    gcSaldo: g.saldo,
    difContratos: g.contratos - k.contratos,
    difSaldo: R(g.saldo - k.saldo),
  };
  porAc.push(linha);
  console.log(
    `${pad(ac.slice(0, 24), 24)} ${num(k.contratos)} ${val(k.saldo)} | ${num(g.contratos)} ${val(g.saldo)} | ` +
      `${num(linha.difContratos)} ${val(linha.difSaldo)}`,
  );
}
const tot = (f) => R(porAc.reduce((s, x) => s + x[f], 0));
console.log(
  `${pad('TOTAL', 24)} ${num(porAc.reduce((s, x) => s + x.kamContratos, 0))} ${val(tot('kamSaldo'))} | ` +
    `${num(porAc.reduce((s, x) => s + x.gcContratos, 0))} ${val(tot('gcSaldo'))} | ` +
    `${num(porAc.reduce((s, x) => s + x.difContratos, 0))} ${val(tot('difSaldo'))}`,
);

// ── 4. Origem das diferenças, contrato a contrato ──────────────────────────
const kByChave = new Map(kaminoAll.map((k) => [k.chave, k]));
const gByChave = new Map();
for (const g of gcRows) {
  if (!gByChave.has(g.chave)) gByChave.set(g.chave, []);
  gByChave.get(g.chave).push(g);
}

const diag = {
  ausenteNoGc: [],
  ausenteNaPlanilha: [],
  acDivergente: [],
  saldoDivergente: [],
  parcelasDivergentes: [],
  duplicadoNoGc: [],
  ok: 0,
};

for (const k of kaminoAll) {
  const gs = gByChave.get(k.chave) ?? [];
  if (gs.length === 0) {
    if (k.saldo > 0) diag.ausenteNoGc.push(k);
    continue;
  }
  // Uma chave da planilha pode ter várias fichas no GC: compara o agregado.
  const saldoGc = R(gs.reduce((s, g) => s + g.saldo, 0));
  const instGc = gs.reduce((s, g) => s + g.nInst, 0);
  const acsGc = [...new Set(gs.map((g) => g.ac).filter(Boolean))];
  if (gs.length > 1)
    diag.duplicadoNoGc.push({
      pessoa: k.name,
      produto: k.product,
      n: gs.length,
      acKamino: k.ac,
      acsGc,
      saldoKamino: k.saldo,
      saldoGc,
      saldoPorFicha: gs.map((g) => ({ id: g.id, ac: g.ac, status: g.status, nInst: g.nInst, saldo: g.saldo })),
    });
  if (!acsGc.some((a) => norm(a) === norm(k.ac)))
    diag.acDivergente.push({ pessoa: k.name, produto: k.product, acKamino: k.ac, acGc: acsGc.join(' + ') || '(sem AC)', saldo: k.saldo, saldoGc });
  if (Math.abs(saldoGc - k.saldo) > 0.05)
    diag.saldoDivergente.push({ pessoa: k.name, produto: k.product, ac: k.ac, fichasGc: gs.length, saldoKamino: k.saldo, saldoGc, dif: R(saldoGc - k.saldo), status: gs.map((g) => `${g.status}/${g.statusMode}`).join(' + ') });
  else if (instGc !== k.nInst)
    diag.parcelasDivergentes.push({ pessoa: k.name, produto: k.product, ac: k.ac, fichasGc: gs.length, parcelasKamino: k.nInst, parcelasGc: instGc });
  else diag.ok++;
}
for (const g of gcAberto) {
  if (!kByChave.has(g.chave)) diag.ausenteNaPlanilha.push(g);
}

const somaS = (arr, f) => R(arr.reduce((s, x) => s + (x[f] ?? 0), 0));

console.log('\n=== ORIGEM DAS DIFERENCAS ===');
console.log(`contratos conferidos (planilha): ${kaminoAll.length} | fichas no GC: ${gcRows.length}`);
console.log(`  identicos: ${diag.ok}`);
console.log(`  com saldo na planilha e ausentes no GC: ${diag.ausenteNoGc.length} | ${brl(somaS(diag.ausenteNoGc, 'saldo'))}`);
console.log(`  com saldo no GC e ausentes na planilha: ${diag.ausenteNaPlanilha.length} | ${brl(somaS(diag.ausenteNaPlanilha, 'saldo'))}`);
console.log(`  AC divergente: ${diag.acDivergente.length} | saldo planilha ${brl(somaS(diag.acDivergente, 'saldo'))}`);
console.log(`  saldo divergente: ${diag.saldoDivergente.length} | efeito liquido ${brl(somaS(diag.saldoDivergente, 'dif'))}`);
console.log(`  parcelas divergentes com saldo igual: ${diag.parcelasDivergentes.length}`);
console.log(`  chave duplicada no GC: ${diag.duplicadoNoGc.length}`);

const top = (arr, n, f) => arr.slice().sort((a, b) => Math.abs(b[f] ?? 0) - Math.abs(a[f] ?? 0)).slice(0, n);

console.log('\nmaiores ausentes no GC (planilha tem saldo, GC nao tem a ficha):');
for (const x of top(diag.ausenteNoGc, 15, 'saldo'))
  console.log(`  ${pad(x.name.slice(0, 38), 38)} ${pad(x.product.slice(0, 28), 28)} ${pad(x.ac.slice(0, 18), 18)} ${val(x.saldo)}`);

console.log('\nmaiores ausentes na planilha (GC tem saldo, planilha nao tem o contrato):');
for (const x of top(diag.ausenteNaPlanilha, 15, 'saldo'))
  console.log(`  ${pad(x.name.slice(0, 38), 38)} ${pad(x.product.slice(0, 28), 28)} ${pad(x.ac.slice(0, 18), 18)} ${val(x.saldo)}`);

console.log('\nmaiores divergencias de saldo:');
for (const x of top(diag.saldoDivergente, 20, 'dif'))
  console.log(
    `  ${pad(x.pessoa.slice(0, 34), 34)} ${pad(x.produto.slice(0, 24), 24)} ${pad(x.ac.slice(0, 16), 16)} ` +
      `kam ${val(x.saldoKamino, 13)} gc ${val(x.saldoGc, 13)} dif ${val(x.dif, 13)} ${x.status}`,
  );

// ── Matriz de troca de AC ─────────────────────────────────────────────────
const matriz = new Map();
for (const x of diag.acDivergente) {
  const k = `${x.acKamino || '(sem AC)'} -> ${x.acGc}`;
  if (!matriz.has(k)) matriz.set(k, { fichas: 0, saldoKamino: 0, saldoGc: 0 });
  const v = matriz.get(k);
  v.fichas++;
  v.saldoKamino = R(v.saldoKamino + x.saldo);
  v.saldoGc = R(v.saldoGc + x.saldoGc);
}
console.log('\n=== TROCA DE AC: planilha -> GC ===');
for (const [k, v] of [...matriz].sort((a, b) => b[1].saldoKamino - a[1].saldoKamino))
  console.log(`  ${pad(k, 46)} ${String(v.fichas).padStart(4)} fichas | kam ${val(v.saldoKamino)} | gc ${val(v.saldoGc)}`);

// ── Fichas duplicadas ────────────────────────────────────────────────────
const dupSaldoExtra = R(
  diag.duplicadoNoGc.reduce((s, x) => s + Math.max(0, x.saldoGc - x.saldoKamino), 0),
);
console.log('\n=== CHAVES COM MAIS DE UMA FICHA NO GC ===');
console.log(`chaves: ${diag.duplicadoNoGc.length} | fichas envolvidas: ${diag.duplicadoNoGc.reduce((s, x) => s + x.n, 0)}`);
console.log(`saldo a mais no GC por causa da duplicidade: ${brl(dupSaldoExtra)}`);
for (const x of diag.duplicadoNoGc.sort((a, b) => b.saldoGc - b.saldoKamino - (a.saldoGc - a.saldoKamino)).slice(0, 12))
  console.log(
    `  ${pad(x.pessoa.slice(0, 32), 32)} ${pad(x.produto.slice(0, 22), 22)} ${x.n} fichas | ` +
      `kam ${val(x.saldoKamino, 13)} gc ${val(x.saldoGc, 13)} | ${x.saldoPorFicha.map((f) => `${f.status} ${brl(f.saldo)}`).join(' | ')}`,
  );

// ── Fichas só no GC, por produto ─────────────────────────────────────────
const porProduto = new Map();
for (const x of diag.ausenteNaPlanilha) {
  const k = x.product || '(sem produto)';
  if (!porProduto.has(k)) porProduto.set(k, { fichas: 0, saldo: 0 });
  const v = porProduto.get(k);
  v.fichas++;
  v.saldo = R(v.saldo + x.saldo);
}
console.log('\n=== FICHAS COM SALDO SO NO GC, POR PRODUTO ===');
for (const [k, v] of [...porProduto].sort((a, b) => b[1].saldo - a[1].saldo))
  console.log(`  ${pad(k.slice(0, 34), 34)} ${String(v.fichas).padStart(4)} fichas | ${val(v.saldo)}`);

console.log('\nAC divergente (amostra):');
for (const x of top(diag.acDivergente, 12, 'saldo'))
  console.log(`  ${pad(x.pessoa.slice(0, 34), 34)} ${pad(x.produto.slice(0, 24), 24)} kamino="${x.acKamino}" gc="${x.acGc}" saldo ${val(x.saldo, 13)}`);

fs.writeFileSync(
  'scripts/kamino-concilia-carteiras.json',
  JSON.stringify(
    {
      geradoEm: new Date().toISOString(),
      planilha: path.basename(abs),
      acsCadastrados: acsDb,
      porAc,
      totais: {
        kaminoContratosComSaldo: kaminoAberto.length,
        kaminoSaldo: somaS(kaminoAberto, 'saldo'),
        gcFichas: gcRows.length,
        gcFichasComSaldo: gcAberto.length,
        gcSaldo: somaS(gcAberto, 'saldo'),
      },
      diagnostico: {
        ok: diag.ok,
        ausenteNoGc: diag.ausenteNoGc,
        ausenteNaPlanilha: diag.ausenteNaPlanilha,
        acDivergente: diag.acDivergente,
        saldoDivergente: diag.saldoDivergente,
        parcelasDivergentes: diag.parcelasDivergentes,
        duplicadoNoGc: diag.duplicadoNoGc,
      },
    },
    null,
    1,
  ),
);
console.log('\nrelatorio: scripts/kamino-concilia-carteiras.json');
