/**
 * Verifica a carteira em aberto por AC na planilha Kamino por dois caminhos
 * independentes e mostra onde eles discordam. SOMENTE LEITURA.
 *
 *  Método A (contrato): o AC é resolvido para o contrato inteiro, como faz o
 *                       parser do GC, e todo o saldo do contrato vai para ele.
 *  Método B (parcela):  cada parcela em aberto é atribuída ao assessor do seu
 *                       próprio Centro de Custo.
 *
 * Uso: node scripts/kamino-carteira-ac.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const val = (n, w = 15) => brl(n).padStart(w);

const KEYWORDS = [
  'gestão de contas', 'gestao de contas', 'antecipação', 'antecipacao',
  'cancelamento', 'negativação', 'negativacao', 'tmf', 'academy',
];
function candidatos(cc) {
  const out = [];
  const seen = new Set();
  for (const bruto of cc.match(/\(([^()]+)\)/g) || []) {
    const inner = bruto.slice(1, -1).trim();
    if (KEYWORDS.some((k) => inner.toLowerCase().includes(k))) continue;
    if (inner.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'-]+$/.test(w)).length < 2) continue;
    const n = inner.replace(/\s+/g, ' ').trim();
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}
const ALIAS = new Map([['luana santos', 'Luana dos Santos']]);
const canon = (n) => ALIAS.get(String(n).toLowerCase()) ?? n;

const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const linhas = raw.map((row, i) => {
  const out = { ...row };
  if (!FILL.every((c) => !normalizeString(out[c]))) {
    for (const c of FILL) {
      if (normalizeString(out[c])) last[c] = out[c];
      else if (last[c] != null) out[c] = last[c];
    }
  }
  const receb = normalizeDate(out.Recebimento, XLSX);
  const recebido = normalizeNumber(out['Valor Recebido (R$)']) ?? 0;
  const cc = normalizeString(out['Centro de Custo']);
  return {
    excel: i + 2,
    pessoa: normalizeString(out.Pessoa) || 'Sem Nome',
    produto: normalizeString(out.Classificação) || 'Sem Treinamento',
    cc,
    cands: candidatos(cc).map(canon),
    venc: normalizeDate(out.Vencimento, XLSX),
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    pago: !!receb || recebido > 0,
  };
});

// ── Contratos ──────────────────────────────────────────────────────────────
const contratos = new Map();
for (const l of linhas) {
  const k = `${norm(l.pessoa)}||${norm(l.produto)}`;
  if (!contratos.has(k)) contratos.set(k, { pessoa: l.pessoa, produto: l.produto, ls: [] });
  contratos.get(k).ls.push(l);
}

const acContrato = (ls) => {
  const m = new Map();
  for (const l of ls) for (const c of l.cands) m.set(c, (m.get(c) ?? 0) + 1);
  const ord = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { ac: ord[0]?.[0] ?? '(sem AC)', todos: ord };
};

const A = new Map();
const B = new Map();
const semAc = [];
const multiAc = [];
const divergentes = [];

const add = (m, ac, contratoConta, saldo) => {
  if (!m.has(ac)) m.set(ac, { contratos: 0, saldo: 0 });
  const v = m.get(ac);
  if (contratoConta) v.contratos++;
  v.saldo = R(v.saldo + saldo);
};

for (const [, c] of contratos) {
  const abertas = c.ls.filter((l) => !l.pago);
  const saldo = R(abertas.reduce((s, l) => s + l.aReceber, 0));
  const { ac, todos } = acContrato(c.ls);
  if (ac === '(sem AC)') semAc.push({ pessoa: c.pessoa, produto: c.produto, saldo, ccs: [...new Set(c.ls.map((l) => l.cc))] });
  if (todos.length > 1) multiAc.push({ pessoa: c.pessoa, produto: c.produto, saldo, candidatos: todos });

  if (saldo > 0) add(A, ac, true, saldo);

  // Método B: cada parcela aberta para o assessor do seu proprio centro de custo
  const porAcParcela = new Map();
  for (const l of abertas) {
    const dono = l.cands[0] ?? ac;
    porAcParcela.set(dono, R((porAcParcela.get(dono) ?? 0) + l.aReceber));
  }
  for (const [dono, v] of porAcParcela) add(B, dono, true, v);
  if (porAcParcela.size > 1)
    divergentes.push({
      pessoa: c.pessoa,
      produto: c.produto,
      acContrato: ac,
      saldo,
      quebra: [...porAcParcela.entries()].map(([k, v]) => ({ ac: k, saldo: v })),
    });
}

const acs = [...new Set([...A.keys(), ...B.keys()])].sort();
console.log('=== CARTEIRA EM ABERTO POR AC (planilha Kamino) ===');
console.log(`${pad('AC', 22)} ${pad('A: por contrato', 24)} ${pad('B: por parcela', 24)} diferenca`);
for (const ac of acs) {
  const a = A.get(ac) ?? { contratos: 0, saldo: 0 };
  const b = B.get(ac) ?? { contratos: 0, saldo: 0 };
  console.log(
    `${pad(ac.slice(0, 22), 22)} ${String(a.contratos).padStart(4)} ${val(a.saldo, 18)}  ` +
      `${String(b.contratos).padStart(4)} ${val(b.saldo, 18)}  ${val(R(b.saldo - a.saldo), 14)}`,
  );
}
const somaA = R([...A.values()].reduce((s, v) => s + v.saldo, 0));
const somaB = R([...B.values()].reduce((s, v) => s + v.saldo, 0));
const nA = [...A.values()].reduce((s, v) => s + v.contratos, 0);
console.log(`${pad('TOTAL', 22)} ${String(nA).padStart(4)} ${val(somaA, 18)}  ${pad('', 4)} ${val(somaB, 18)}`);

const saldoTotalPlanilha = R(linhas.filter((l) => !l.pago).reduce((s, l) => s + l.aReceber, 0));
console.log(`\nsaldo em aberto somando as 5.321 linhas abertas da planilha: ${brl(saldoTotalPlanilha)}`);
console.log(`fecha com o metodo A? ${Math.abs(saldoTotalPlanilha - somaA) < 0.05 ? 'sim' : 'NAO'}`);
console.log(`fecha com o metodo B? ${Math.abs(saldoTotalPlanilha - somaB) < 0.05 ? 'sim' : 'NAO'}`);

console.log('\n=== QUALIDADE DA ATRIBUICAO ===');
console.log(`contratos sem nenhum assessor identificavel no Centro de Custo: ${semAc.length} | saldo ${brl(semAc.reduce((s, x) => s + x.saldo, 0))}`);
console.log(`contratos com mais de um assessor no Centro de Custo: ${multiAc.length} | saldo ${brl(multiAc.reduce((s, x) => s + x.saldo, 0))}`);
console.log(`contratos cujas parcelas abertas pertencem a ACs diferentes: ${divergentes.length} | saldo ${brl(divergentes.reduce((s, x) => s + x.saldo, 0))}`);

if (semAc.length) {
  console.log('\nmaiores sem AC:');
  for (const x of semAc.sort((a, b) => b.saldo - a.saldo).slice(0, 10))
    console.log(`  ${pad(x.pessoa.slice(0, 34), 34)} ${pad(x.produto.slice(0, 24), 24)} ${val(x.saldo, 13)} | cc: ${x.ccs[0]?.slice(0, 60)}`);
}
if (divergentes.length) {
  console.log('\ncontratos partidos entre ACs (saldo dividido no metodo B):');
  for (const x of divergentes.sort((a, b) => b.saldo - a.saldo).slice(0, 15))
    console.log(
      `  ${pad(x.pessoa.slice(0, 32), 32)} ${pad(x.produto.slice(0, 22), 22)} contrato->${pad(x.acContrato.slice(0, 16), 16)} ` +
        `| ${x.quebra.map((q) => `${q.ac}: ${brl(q.saldo)}`).join(' + ')}`,
    );
}
if (multiAc.length) {
  console.log('\ncontratos com 2+ assessores no historico (amostra):');
  for (const x of multiAc.sort((a, b) => b.saldo - a.saldo).slice(0, 12))
    console.log(
      `  ${pad(x.pessoa.slice(0, 32), 32)} ${pad(x.produto.slice(0, 22), 22)} ${val(x.saldo, 13)} | ` +
        x.candidatos.map(([n, c]) => `${n} (${c} linhas)`).join(' vs '),
    );
}

fs.writeFileSync(
  'scripts/kamino-carteira-ac.json',
  JSON.stringify(
    {
      porContrato: Object.fromEntries(A),
      porParcela: Object.fromEntries(B),
      saldoTotalPlanilha,
      semAc,
      multiAc,
      contratosPartidos: divergentes,
    },
    null,
    1,
  ),
);
console.log('\nrelatorio: scripts/kamino-carteira-ac.json');

// ── SQL de conciliação contra o GC ────────────────────────────────────────
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const semAcento =
  "translate(trim(%s), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')";
const upperNorm = (col) => `upper(${semAcento.replace('%s', col)})`;
// "Luana Santos" no GC x "Luana dos Santos" na planilha: o join por AC ignora
// as partículas do nome para não acusar divergência onde é a mesma pessoa.
const acKey = (col) =>
  `btrim(regexp_replace(regexp_replace(${upperNorm(col)}, '\\s+(DOS|DAS|DO|DA|DE|E)\\s+', ' ', 'g'), '\\s+', ' ', 'g'))`;

const kamAc = acs
  .filter((ac) => (A.get(ac)?.contratos ?? 0) > 0)
  .map((ac) => `(${sqlStr(ac)},${A.get(ac).contratos},${A.get(ac).saldo})`)
  .join(',\n  ');

const kamContratos = [...contratos.values()]
  .map((c) => `(${sqlStr(norm(c.pessoa))},${sqlStr(norm(c.produto))})`)
  .join(',\n  ');

fs.writeFileSync(
  'scripts/kamino-carteira-ac.sql',
  `-- Conciliação da carteira dos ACs: planilha Kamino x GC.
-- Gerado por scripts/kamino-carteira-ac.mjs em ${new Date().toISOString()}.
-- Rodar no SQL editor do Supabase. Somente leitura.

-- ── 1. Saldo em aberto por AC: planilha x GC ──────────────────────────────
with kam(ac, contratos, saldo) as (values
  ${kamAc}
),
gc_fichas as (
  select s.id, s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac,
         (select count(*) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as abertas,
         (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as saldo
    from public.students s
    join public.companies c on c.id = s.company_id
   where c.name = 'IAM - GC'
),
gc as (
  select ac, count(*) as contratos, sum(saldo) as saldo
    from gc_fichas
   where abertas > 0
   group by ac
)
select coalesce(k.ac, g.ac) as ac,
       k.contratos as kam_contratos, k.saldo as kam_saldo,
       g.contratos as gc_contratos, round(g.saldo, 2) as gc_saldo,
       coalesce(g.contratos, 0) - coalesce(k.contratos, 0) as dif_contratos,
       round(coalesce(g.saldo, 0) - coalesce(k.saldo, 0), 2) as dif_saldo
  from kam k
  full outer join gc g on ${acKey('g.ac')} = ${acKey('k.ac')}
 order by 1;

-- ── 2. Fichas com saldo no GC que não existem na planilha, por AC ─────────
with kam(nome, produto) as (values
  ${kamContratos}
),
gc_fichas as (
  select s.id, s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac,
         ${upperNorm('s.name')} as nome, ${upperNorm('s.product')} as produto,
         (select count(*) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as abertas,
         (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as saldo
    from public.students s
    join public.companies c on c.id = s.company_id
   where c.name = 'IAM - GC'
)
select g.ac, count(*) as fichas_so_no_gc, round(sum(g.saldo), 2) as saldo
  from gc_fichas g
 where g.abertas > 0
   and not exists (select 1 from kam k where k.nome = g.nome and k.produto = g.produto)
 group by g.ac
 order by 3 desc nulls last;

-- ── 3. As 40 maiores fichas só no GC (para inspeção) ──────────────────────
with kam(nome, produto) as (values
  ${kamContratos}
),
gc_fichas as (
  select s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac, s.status, s.status_mode,
         ${upperNorm('s.name')} as nome, ${upperNorm('s.product')} as produto,
         (select count(*) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as abertas,
         (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
           where coalesce((i->>'paid')::boolean, false) = false) as saldo
    from public.students s
    join public.companies c on c.id = s.company_id
   where c.name = 'IAM - GC'
)
select g.name, g.product, g.ac, g.status, g.status_mode, g.abertas, round(g.saldo, 2) as saldo
  from gc_fichas g
 where g.abertas > 0
   and not exists (select 1 from kam k where k.nome = g.nome and k.produto = g.produto)
 order by g.saldo desc
 limit 40;
`,
);
console.log('SQL de conciliacao: scripts/kamino-carteira-ac.sql');
