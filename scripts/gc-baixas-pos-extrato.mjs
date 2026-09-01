/**
 * SOMENTE LEITURA: mede quanto das conciliações/baixas feitas no GC APÓS a data
 * de corte do extrato Kamino explica a diferença entre o card e o extrato.
 *
 * O extrato "KAMINO GC (1).xlsx" tem recebimento mais recente em 21/08/2026,
 * então tudo que foi conciliado no GC depois disso não aparece nele.
 *
 * Uso: node scripts/gc-baixas-pos-extrato.mjs [YYYY-MM-DD]
 */
import fs from 'node:fs';
import pg from 'pg';

const CORTE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-21';
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
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
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

const client = await conectar();

const { rows: cols } = await client.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conciliacao_items' ORDER BY ordinal_position`,
);
console.log('colunas de conciliacao_items:');
console.log(cols.map((c) => `${c.column_name}:${c.data_type}`).join(' | '));

const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const companyId = empresa[0].id;

// Conciliações efetivadas depois do corte do extrato
const { rows: porTipo } = await client.query(
  `SELECT tipo, status, count(*) AS itens,
          min(conciliado_at) AS primeiro, max(conciliado_at) AS ultimo
     FROM public.conciliacao_items
    WHERE company_id = $1 AND status = 'conciliado' AND conciliado_at >= $2
    GROUP BY tipo, status
    ORDER BY itens DESC`,
  [companyId, `${CORTE}T03:00:00Z`],
);

console.log(`\n=== CONCILIAÇÕES EFETIVADAS NO GC DESDE ${CORTE} (empresa ${IAM_COMPANY_NAME}) ===`);
let totalItens = 0;
for (const r of porTipo) {
  totalItens += Number(r.itens);
  console.log(
    `${String(r.itens).padStart(4)} itens | ${String(r.tipo).padEnd(24)} | de ${String(r.primeiro).slice(0, 10)} a ${String(r.ultimo).slice(0, 10)}`,
  );
}
console.log(`${String(totalItens).padStart(4)} itens no total`);

// Parcelas que constam pagas no GC com baixa registrada depois do corte —
// são exatamente as que o extrato Kamino ainda mostraria em aberto.
const { rows: baixas } = await client.query(
  `WITH s AS (
     SELECT id, name, product, ac, status, installments
       FROM public.students WHERE company_id = $1
   )
   SELECT s.name, s.product, s.ac, s.status,
          (i->>'number') AS parcela,
          (i->>'dueDate') AS venc,
          (i->>'value')::numeric AS valor,
          (i->>'paidDate') AS pago_em,
          (i->>'paidMarkedAt') AS marcado_em
     FROM s, jsonb_array_elements(s.installments) i
    WHERE coalesce((i->>'paid')::boolean, false) = true
      AND (i->>'paidMarkedAt') IS NOT NULL
      AND (i->>'paidMarkedAt') >= $2
    ORDER BY (i->>'paidMarkedAt')`,
  [companyId, `${CORTE}T00:00:00`],
);

const totalBaixado = R(baixas.reduce((a, b) => a + Number(b.valor ?? 0), 0));
console.log(`\n=== PARCELAS BAIXADAS NO GC DESDE ${CORTE} (por paidMarkedAt) ===`);
console.log(`${baixas.length} parcelas | R$ ${brl(totalBaixado)}`);

const porAluno = new Map();
for (const b of baixas) {
  const k = `${b.name}|${b.product}`;
  const cur = porAluno.get(k) ?? { name: b.name, product: b.product, ac: b.ac, parcelas: 0, valor: 0 };
  cur.parcelas += 1;
  cur.valor = R(cur.valor + Number(b.valor ?? 0));
  porAluno.set(k, cur);
}
console.log(`\nconcentrado em ${porAluno.size} contratos. Os 20 maiores:`);
for (const a of [...porAluno.values()].sort((x, y) => y.valor - x.valor).slice(0, 20)) {
  console.log(`R$ ${brl(a.valor).padStart(12)} | ${a.parcelas} parc. | ${a.name} | ${a.product} | ${a.ac ?? '-'}`);
}

// Parcelas pagas SEM paidMarkedAt (baixas antigas/importadas) mas com paidDate
// recente — captura baixas que não passaram pelo fluxo de conciliação.
const { rows: semMarca } = await client.query(
  `WITH s AS (SELECT id, name, product, installments FROM public.students WHERE company_id = $1)
   SELECT count(*) AS parcelas, coalesce(sum((i->>'value')::numeric), 0) AS valor
     FROM s, jsonb_array_elements(s.installments) i
    WHERE coalesce((i->>'paid')::boolean, false) = true
      AND (i->>'paidMarkedAt') IS NULL
      AND (i->>'paidDate') >= $2`,
  [companyId, CORTE],
);
console.log(
  `\nparcelas pagas desde ${CORTE} sem registro de conciliação (paidMarkedAt nulo): ` +
    `${semMarca[0].parcelas} | R$ ${brl(semMarca[0].valor)}`,
);

await client.end();
