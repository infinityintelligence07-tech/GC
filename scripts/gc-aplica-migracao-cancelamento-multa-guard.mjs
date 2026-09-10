/**
 * Aplica 20260910190000_cancelamento_multa_coberta_guard.sql:
 *   trigger em students que impede a parcela de multa PAGA de dobrar o valor
 *   pago em ficha cancelada (+ backfill de todas as fichas nessa situação).
 * Sem --apply: dry-run com rollback. Com --apply: confirma.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260910190000_cancelamento_multa_coberta_guard.sql';
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
  SELECT s.name, s.product, co.name empresa, s.down_payment::numeric entrada, s.total_installments ti, s.paid_installments pi,
         (SELECT string_agg(format('P%s %s%s%s', i->>'number', i->>'value', CASE WHEN (i->>'paid')::boolean THEN ' PAGA' ELSE '' END,
                 CASE WHEN coalesce(i->'tags','[]') ? 'multa-cancelamento' THEN '[multa]' ELSE '' END), ' | ' ORDER BY (i->>'number')::int)
            FROM jsonb_array_elements(s.installments) i) parcelas,
         s.down_payment::numeric + (SELECT coalesce(sum(coalesce(nullif(i->>'paidValue','')::numeric,(i->>'value')::numeric)),0)
            FROM jsonb_array_elements(s.installments) i WHERE (i->>'paid')::boolean) pago_ficha
    FROM public.students s JOIN public.companies co ON co.id = s.company_id
   WHERE s.id = ANY($1::uuid[]) ORDER BY co.name, s.name`;

const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
try {
  await client.query('BEGIN');
  const { rows: alvo } = await client.query(`
    SELECT s.id FROM public.students s
     WHERE (coalesce(s.status_cancelamento,'nenhum') = 'cancelado' OR s.status = 'Cancelado')
       AND jsonb_typeof(s.installments) = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.installments) i WHERE (i->>'paid')::boolean AND coalesce(i->'tags','[]') ? 'multa-cancelamento')`);
  const ids = alvo.map((r) => r.id);
  console.log(`Fichas canceladas com parcela de multa paga: ${ids.length}`);
  console.log('ANTES:'); console.table((await client.query(SQL_FICHAS, [ids])).rows);
  await client.query(fs.readFileSync(MIGRACAO, 'utf8'));
  console.log('\nDEPOIS:'); console.table((await client.query(SQL_FICHAS, [ids])).rows);
  const { rows: hist } = await client.query(
    `SELECT name, history->-1->>'text' ultimo FROM public.students WHERE id = ANY($1::uuid[]) AND history->-1->>'text' ILIKE 'Multa de cancelamento (R$%'`, [ids]);
  for (const h of hist) console.log(' ', h.name, '→', h.ultimo);
  if (APLICAR) { await client.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await client.query('ROLLBACK'); console.log('\nDRY-RUN: nada gravado. Rode com --apply para confirmar.'); }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
