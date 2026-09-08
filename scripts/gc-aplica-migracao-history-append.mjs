/**
 * Aplica a migração que cria public.student_history_append(uuid, text, text) —
 * append atômico no histórico da ficha, usado pela edge function
 * iam-control-push-conciliacao. Só CREATE OR REPLACE FUNCTION; não altera dados.
 *
 * Sem --apply: roda numa transação e REVERTE, só validando.
 * Com --apply: aplica de verdade.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-history-append.mjs
 *   node scripts/gc-aplica-migracao-history-append.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260908150000_student_history_append.sql';
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

const FN_SQL = `
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'student_history_append'`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');
  const { rows: antes } = await client.query(FN_SQL);
  console.log(`função antes: ${antes.length ? 'PRESENTE' : 'ausente'}`);
  await client.query(sql);
  const { rows: depois } = await client.query(FN_SQL);
  console.log(`função depois: ${depois.length ? `PRESENTE (${depois[0].args})` : 'AUSENTE (!)'}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nMIGRAÇÃO APLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nrevertido — nada foi alterado. Rode com --apply para aplicar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU, nada foi alterado:', e.message);
  process.exitCode = 1;
}

await client.end();
