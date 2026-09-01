/**
 * SOMENTE LEITURA: compara valor nominal e valor efetivamente recebido nas
 * parcelas baixadas no GC, para testar se a diferença contra a planilha de
 * conferência do banco é juros/encargo.
 *
 * Uso: node scripts/gc-baixas-juros.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const IAM_COMPANY_NAME = 'IAM - GC';
const ALVO = 49061.04;

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL');
  for (const cs of [base, base.replace('aws-0-', 'aws-1-')]) {
    const c = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('sem conexão com o banco');
}

const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const marca = (v) => (Math.abs(R(v) - ALVO) < 1 ? '   <<<< 49.061,04' : '');

const client = await conectar();
const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const companyId = empresa[0].id;

const { rows } = await client.query(
  `WITH s AS (SELECT id, name, product, installments FROM public.students WHERE company_id = $1)
   SELECT s.name, s.product,
          (i->>'number') AS parcela,
          (i->>'dueDate') AS venc,
          (i->>'paidDate') AS pago_em,
          substr(i->>'paidMarkedAt', 1, 10) AS marcado_em,
          (i->>'value')::numeric AS nominal,
          nullif(i->>'paidValue','')::numeric AS recebido,
          coalesce(nullif(i->>'encargo','')::numeric, 0) AS encargo
     FROM s, jsonb_array_elements(s.installments) i
    WHERE coalesce((i->>'paid')::boolean, false) = true
      AND (i->>'paidMarkedAt') IS NOT NULL
    ORDER BY substr(i->>'paidMarkedAt', 1, 10)`,
  [companyId],
);
await client.end();

const porDia = new Map();
for (const r of rows) {
  const d = r.marcado_em;
  if (!porDia.has(d)) porDia.set(d, { n: 0, nominal: 0, recebido: 0 });
  const g = porDia.get(d);
  g.n += 1;
  g.nominal += Number(r.nominal ?? 0);
  g.recebido += Number(r.recebido ?? r.nominal ?? 0);
}

console.log('=== PARCELAS BAIXADAS NO GC, POR DIA DA BAIXA (paidMarkedAt) ===');
console.log('dia        | parc |        nominal |       recebido |     diferença');
for (const [d, g] of [...porDia].sort()) {
  const dif = g.recebido - g.nominal;
  console.log(
    `${d} | ${String(g.n).padStart(4)} | R$ ${brl(g.nominal).padStart(11)} | R$ ${brl(g.recebido).padStart(11)} | ` +
      `R$ ${brl(dif).padStart(10)}${marca(g.nominal)}${marca(g.recebido)}`,
  );
}

// Recorte no dia da grande conciliação
for (const dia of ['2026-08-27', '2026-08-28']) {
  const sel = rows.filter((r) => r.marcado_em === dia);
  if (!sel.length) continue;
  const nominal = sel.reduce((a, r) => a + Number(r.nominal ?? 0), 0);
  const recebido = sel.reduce((a, r) => a + Number(r.recebido ?? r.nominal ?? 0), 0);
  console.log(`\n=== ${dia}: ${sel.length} parcelas ===`);
  console.log(`nominal  R$ ${brl(nominal)}${marca(nominal)}`);
  console.log(`recebido R$ ${brl(recebido)}${marca(recebido)}`);
  console.log(`juros/encargo implícito R$ ${brl(recebido - nominal)}`);
  const comJuros = sel.filter((r) => Number(r.recebido ?? 0) > Number(r.nominal ?? 0) + 0.005);
  console.log(`parcelas recebidas acima do nominal: ${comJuros.length}`);
  for (const r of comJuros) {
    console.log(
      `  ${String(r.name).slice(0, 32).padEnd(32)} | parc ${String(r.parcela).padStart(2)} | nominal R$ ${brl(r.nominal).padStart(9)} | recebido R$ ${brl(r.recebido).padStart(9)} | +R$ ${brl(Number(r.recebido) - Number(r.nominal))}`,
    );
  }
}

// Combinação dos dois dias
const dois = rows.filter((r) => r.marcado_em === '2026-08-27' || r.marcado_em === '2026-08-28');
if (dois.length) {
  const nominal = dois.reduce((a, r) => a + Number(r.nominal ?? 0), 0);
  const recebido = dois.reduce((a, r) => a + Number(r.recebido ?? r.nominal ?? 0), 0);
  console.log(`\n=== 27/08 + 28/08 juntos: ${dois.length} parcelas ===`);
  console.log(`nominal  R$ ${brl(nominal)}${marca(nominal)}`);
  console.log(`recebido R$ ${brl(recebido)}${marca(recebido)}`);
}
