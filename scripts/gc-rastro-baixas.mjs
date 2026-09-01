/**
 * SOMENTE LEITURA: mede quantas parcelas pagas ainda preservam o rastro de
 * conciliação (paidMarkedAt) contra o número de baixas registradas na
 * Conciliação, para dimensionar perda de auditoria por reimportação.
 *
 * Uso: node scripts/gc-rastro-baixas.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const IAM_COMPANY_NAME = 'IAM - GC';

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

const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const client = await conectar();
const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const companyId = empresa[0].id;

const { rows: p } = await client.query(
  `WITH s AS (SELECT id, installments FROM public.students WHERE company_id = $1)
   SELECT count(*) FILTER (WHERE coalesce((i->>'paid')::boolean,false)) AS pagas,
          count(*) FILTER (WHERE coalesce((i->>'paid')::boolean,false) AND (i->>'paidMarkedAt') IS NOT NULL) AS com_rastro,
          coalesce(sum((i->>'value')::numeric) FILTER (WHERE coalesce((i->>'paid')::boolean,false)), 0) AS valor_pago
     FROM s, jsonb_array_elements(s.installments) i`,
  [companyId],
);

const { rows: c } = await client.query(
  `SELECT count(*) AS baixas FROM public.conciliacao_items
    WHERE company_id = $1 AND tipo = 'baixa_kamino' AND status = 'conciliado'`,
  [companyId],
);

console.log(`parcelas pagas na empresa ${IAM_COMPANY_NAME}: ${p[0].pagas} | R$ ${brl(p[0].valor_pago)}`);
console.log(`dessas, com rastro de conciliação (paidMarkedAt): ${p[0].com_rastro}`);
console.log(`baixas registradas na Conciliação (baixa_kamino conciliado): ${c[0].baixas}`);
console.log(
  `\nbaixas sem rastro correspondente na parcela: ${Number(c[0].baixas) - Number(p[0].com_rastro)}`,
);

await client.end();
