/**
 * SOMENTE LEITURA: valida se as fichas que o pull ainda toca estão com o
 * financeiro preservado, e se o número de fichas colapsadas parou de crescer.
 *
 * Uso: node scripts/gc-valida-protecao.mjs
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

const client = await conectar();

// Fichas tocadas pelo pull nos ultimos 15 minutos (ja depois da migracao).
const { rows: tocadas } = await client.query(
  `SELECT name, product, coalesce(iam_control_contrato_status, '(nulo)') AS status,
          jsonb_array_length(installments) AS n_inst,
          sale_value, down_payment, total_installments,
          substr(iam_control_synced_at::text, 1, 19) AS sync
     FROM public.students
    WHERE iam_control_aluno_id IS NOT NULL
      AND iam_control_synced_at > now() - interval '15 minutes'
    ORDER BY iam_control_synced_at DESC`,
);
console.log(`=== FICHAS TOCADAS PELO PULL NOS ULTIMOS 15 MIN (${tocadas.length}) ===`);
console.log('sync                | status         | parc | aluno');
for (const r of tocadas) {
  console.log(
    `${r.sync} | ${String(r.status).padEnd(14)} | ${String(r.n_inst).padStart(4)} | ${String(r.name).slice(0, 40)} | ${String(r.product).slice(0, 22)}`,
  );
}

// A parcela unica igual a sale - down e a assinatura do colapso.
const { rows: colapso } = await client.query(
  `SELECT count(*)::int AS total_1_parcela,
          count(*) FILTER (
            WHERE abs(coalesce(sale_value,0) - coalesce(down_payment,0)
                      - coalesce((installments->0->>'value')::numeric, 0)) < 0.02
          )::int AS assinatura_colapso,
          count(*) FILTER (
            WHERE abs(coalesce(sale_value,0) - coalesce(down_payment,0)
                      - coalesce((installments->0->>'value')::numeric, 0)) < 0.02
              AND iam_control_synced_at > now() - interval '15 minutes'
          )::int AS colapsadas_recentemente
     FROM public.students
    WHERE iam_control_aluno_id IS NOT NULL
      AND jsonb_array_length(installments) = 1`,
);
console.log('\n=== FICHAS IAM COM UMA PARCELA SO ===');
console.log(`com 1 parcela:                        ${colapso[0].total_1_parcela}`);
console.log(`com a assinatura do colapso:          ${colapso[0].assinatura_colapso}`);
console.log(`tocadas pelo pull nos ultimos 15 min: ${colapso[0].colapsadas_recentemente}`);

await client.end();
