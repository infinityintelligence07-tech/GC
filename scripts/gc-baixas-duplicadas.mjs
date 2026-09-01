/**
 * SOMENTE LEITURA: examina a sequência completa de itens de conciliação dos
 * alunos que aparecem com baixa e pagamento de parcela para a mesma parcela,
 * distinguindo dupla contagem de fluxo legítimo de correção.
 *
 * Uso: node scripts/gc-baixas-duplicadas.mjs
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

const ALVOS = [
  'Victor Guedes Waiandt',
  'Isis Kauani de Oliveira Pires Minchão',
  'Daniela Nobrega Timbo dos Santos',
  'Ismael Joaquim Lima',
];

const client = await conectar();
const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const companyId = empresa[0].id;

const { rows: itens } = await client.query(
  `SELECT tipo, status, student_name, resumo, antes, depois, created_at
     FROM public.conciliacao_items
    WHERE company_id = $1 AND student_name = ANY($2::text[])
    ORDER BY student_name, created_at`,
  [companyId, ALVOS],
);

const { rows: fichas } = await client.query(
  `SELECT name, product, jsonb_array_length(installments) AS n_inst, installments
     FROM public.students WHERE company_id = $1 AND name = ANY($2::text[])`,
  [companyId, ALVOS],
);
await client.end();

for (const nome of ALVOS) {
  console.log('\n' + '='.repeat(100));
  console.log(nome);
  const f = fichas.filter((x) => x.name === nome);
  for (const x of f) {
    console.log(`  ficha: ${x.product} | ${x.n_inst} parcelas | pagas ${(x.installments ?? []).filter((i) => i.paid).length}`);
  }
  const seq = itens.filter((i) => i.student_name === nome);
  for (const i of seq) {
    const parc = i.depois?.numero ?? i.depois?.parcela ?? i.antes?.numero ?? '?';
    const val = i.depois?.valor ?? i.antes?.valor ?? 0;
    const pv = i.depois?.paidValue;
    console.log(
      `  ${String(i.created_at).slice(4, 10)} ${String(i.created_at).slice(11, 15)} | ${String(i.tipo).padEnd(17)} | ${String(i.status).padEnd(10)} | ` +
        `parc ${String(parc).padStart(2)} | valor R$ ${brl(val).padStart(9)}${pv !== undefined ? ` | pago R$ ${brl(pv)}` : ''}`,
    );
    console.log(`      ${String(i.resumo).slice(0, 120)}`);
  }
}
