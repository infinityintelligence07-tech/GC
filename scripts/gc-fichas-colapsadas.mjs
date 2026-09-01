/**
 * SOMENTE LEITURA: fichas IAM Control cujo cronograma colapsou numa única
 * parcela (a entrada), deixando o contrato marcado como "Pago" enquanto o
 * Kamino segue cobrando os boletos restantes.
 *
 * Uso: node scripts/gc-fichas-colapsadas.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const IDS = [
  '04737335-93c5-47d5-8e91-667e3699224e', // Angelica Lea
  'eec8a575-e969-4f2c-afb7-685b0409e3cb', // Victor Guedes Waiandt
  'b52f90a2-d605-46a2-9d5b-976cd02d9faa', // Jaqueline Tais Alves Pereira
  'a7008f23-5fbd-4566-aa59-9063b09397ff', // Valdirene Tamos das Merces
  'd9cd0166-5a91-4b33-b67a-32450a5891fa', // Tainara Alves
  'ba858f7c-68eb-4dfa-8596-4fb34a817bc7', // Ronaldo Beda da Silva
];

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

const { rows: fichas } = await client.query(
  `SELECT id, name, product, status, sale_value, down_payment,
          total_installments, paid_installments,
          jsonb_array_length(installments) AS n_inst,
          iam_control_aluno_id, iam_control_contrato_status, iam_gc_conciliado_at
     FROM public.students WHERE id = ANY($1::uuid[]) ORDER BY sale_value DESC`,
  [IDS],
);

console.log('=== FICHAS ===');
for (const r of fichas) {
  console.log(
    `${r.name} | ${r.product} | status ${r.status}\n` +
      `   contrato R$ ${brl(r.sale_value)} | entrada R$ ${brl(r.down_payment)} | ` +
      `total_installments=${r.total_installments} | pagas=${r.paid_installments} | parcelas no jsonb=${r.n_inst}\n` +
      `   iam_aluno_id=${r.iam_control_aluno_id ?? '-'} | iam_status=${r.iam_control_contrato_status ?? '-'} | ` +
      `aprovado_gc=${r.iam_gc_conciliado_at ? String(r.iam_gc_conciliado_at).slice(0, 10) : 'NAO'}`,
  );
}

const { rows: itens } = await client.query(
  `SELECT student_name, tipo, status, created_at, conciliado_at, left(resumo, 130) AS resumo
     FROM public.conciliacao_items
    WHERE student_id = ANY($1::uuid[])
    ORDER BY created_at`,
  [IDS],
);

console.log(`\n=== ITENS DE CONCILIAÇÃO DESSAS FICHAS (${itens.length}) ===`);
for (const r of itens) {
  console.log(
    `${String(r.created_at).slice(0, 10)} | ${String(r.status).padEnd(10)} | ${String(r.tipo).padEnd(20)} | ` +
      `${r.student_name} | ${r.resumo}`,
  );
}

const pendentes = itens.filter((i) => i.status === 'pendente' || i.status === 'aprovado');
console.log(`\nitens ainda não efetivados: ${pendentes.length}`);

await client.end();
