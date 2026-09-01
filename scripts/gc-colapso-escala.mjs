/**
 * SOMENTE LEITURA: dimensiona quantas fichas do IAM Control estão com o
 * cronograma colapsado numa parcela única e quanto valor está envolvido.
 *
 * Uso: node scripts/gc-colapso-escala.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

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
  throw new Error('sem conexao com o banco');
}

const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const client = await conectar();

const FILTRO = `
  s.iam_control_aluno_id IS NOT NULL
  AND jsonb_array_length(s.installments) = 1
  AND abs(coalesce(s.sale_value,0) - coalesce(s.down_payment,0)
          - coalesce((s.installments->0->>'value')::numeric, 0)) < 0.02
`;

const { rows: resumo } = await client.query(
  `SELECT coalesce(s.iam_control_contrato_status, '(nulo)') AS status,
          coalesce((s.installments->0->>'paid')::boolean, false) AS parcela_paga,
          count(*)::int AS fichas,
          sum((s.installments->0->>'value')::numeric) AS saldo_na_parcela_unica
     FROM public.students s
    WHERE ${FILTRO}
    GROUP BY 1, 2
    ORDER BY 4 DESC NULLS LAST`,
);

console.log('=== FICHAS COLAPSADAS, POR STATUS E SITUACAO DA PARCELA ===');
console.log('status         | parcela | fichas |     saldo na parcela unica');
let totalFichas = 0;
let totalValor = 0;
let pagasFichas = 0;
let pagasValor = 0;
for (const r of resumo) {
  console.log(
    `${String(r.status).padEnd(14)} | ${r.parcela_paga ? 'PAGA   ' : 'aberta '} | ${String(r.fichas).padStart(6)} | R$ ${brl(r.saldo_na_parcela_unica).padStart(14)}`,
  );
  totalFichas += r.fichas;
  totalValor += Number(r.saldo_na_parcela_unica ?? 0);
  if (r.parcela_paga) {
    pagasFichas += r.fichas;
    pagasValor += Number(r.saldo_na_parcela_unica ?? 0);
  }
}
console.log(`${'TOTAL'.padEnd(14)} | ${''.padEnd(7)} | ${String(totalFichas).padStart(6)} | R$ ${brl(totalValor).padStart(14)}`);
console.log(
  `\ndas quais marcadas como PAGAS (somem do card e do a vencer): ${pagasFichas} fichas | R$ ${brl(pagasValor)}`,
);

const { rows: empresas } = await client.query(
  `SELECT c.name AS empresa, count(*)::int AS fichas,
          sum((s.installments->0->>'value')::numeric) AS valor
     FROM public.students s JOIN public.companies c ON c.id = s.company_id
    WHERE ${FILTRO}
    GROUP BY 1 ORDER BY 3 DESC`,
);
console.log('\n=== POR EMPRESA ===');
for (const r of empresas) {
  console.log(`${String(r.empresa).padEnd(18)} | ${String(r.fichas).padStart(3)} fichas | R$ ${brl(r.valor)}`);
}

const { rows: maiores } = await client.query(
  `SELECT s.name, s.product, s.status,
          coalesce(s.iam_control_contrato_status, '(nulo)') AS iam_status,
          s.sale_value, s.down_payment,
          (s.installments->0->>'value')::numeric AS parcela_unica,
          coalesce((s.installments->0->>'paid')::boolean, false) AS paga
     FROM public.students s
    WHERE ${FILTRO}
    ORDER BY (s.installments->0->>'value')::numeric DESC
    LIMIT 15`,
);
console.log('\n=== AS 15 MAIORES ===');
for (const r of maiores) {
  console.log(
    `R$ ${brl(r.parcela_unica).padStart(12)} | ${r.paga ? 'PAGA  ' : 'aberta'} | ${String(r.iam_status).padEnd(14)} | ` +
      `${String(r.name).slice(0, 34).padEnd(34)} | ${String(r.product).slice(0, 20)}`,
  );
}

await client.end();
