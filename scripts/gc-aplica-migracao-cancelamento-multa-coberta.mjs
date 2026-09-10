/**
 * Aplica 20260910170000_cancelamento_multa_coberta_nao_dobra_pago.sql:
 *   remove a parcela de multa "paga" que dobrava o pago em cancelamentos cuja
 *   multa foi coberta pela entrada/parcelas já pagas (Damares, José Alexandre,
 *   Victoria). Sem --apply: dry-run com rollback. Com --apply: confirma.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260910170000_cancelamento_multa_coberta_nao_dobra_pago.sql';
const APLICAR = process.argv.includes('--apply');

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try { await c.connect(); return c; } catch { await c.end().catch(() => {}); }
  }
  throw new Error('sem conexão com o banco');
}

const SQL_FICHAS = `
  SELECT s.name, s.product, s.down_payment::numeric entrada, s.total_installments ti, s.paid_installments pi,
         (SELECT string_agg(format('P%s %s%s%s', i->>'number', i->>'value', CASE WHEN (i->>'paid')::boolean THEN ' PAGA' ELSE '' END,
                 CASE WHEN coalesce(i->'tags','[]') ? 'multa-cancelamento' THEN ' [multa]' ELSE '' END), ' | ' ORDER BY (i->>'number')::int)
            FROM jsonb_array_elements(s.installments) i) parcelas,
         (SELECT count(*) FROM jsonb_array_elements(cc.cancellation_reviewed_installments) i WHERE coalesce(i->'tags','[]') ? 'multa-cancelamento') multa_no_caso
    FROM public.students s LEFT JOIN public.cancellation_cases cc ON cc.id = s.cancellation_case_id
   WHERE s.name IN ('Damares Barbosa da Costa', 'José Alexandre B. Junqueira', 'Victoria Miranda Haupenthal')
     AND s.status_cancelamento = 'cancelado'
   ORDER BY s.name`;

const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
try {
  await client.query('BEGIN');
  console.log('ANTES:'); console.table((await client.query(SQL_FICHAS)).rows);
  await client.query(fs.readFileSync(MIGRACAO, 'utf8'));
  console.log('\nDEPOIS:'); console.table((await client.query(SQL_FICHAS)).rows);
  if (APLICAR) { await client.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await client.query('ROLLBACK'); console.log('\nDRY-RUN: nada gravado. Rode com --apply para confirmar.'); }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
