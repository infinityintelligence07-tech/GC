/**
 * Aplica 20260909180000_cancellation_cases_abatimento.sql:
 *   - coluna cancellation_cases.abatimento + backfill a partir dos itens de
 *     conciliação (depois.abatimento*);
 *   - reaplica o crédito de R$ 397 (e o vencimento 22/10) na ficha ativa do
 *     Missão Governar da Ana Cecília.
 *
 * Sem --apply: roda numa transação e REVERTE, mostrando o antes/depois.
 * Com --apply: aplica de verdade.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260909180000_cancellation_cases_abatimento.sql';
const APLICAR = process.argv.includes('--apply');
const ANA_ID = '23ccf197-e57f-4dae-991b-5f5f92d9d142';

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

const ANA_SQL = `SELECT name, product, status, status_mode, installments FROM public.students WHERE id = $1`;
const CASOS_SQL = `
  SELECT cc.student_name, cc.abatimento
    FROM public.cancellation_cases cc
   WHERE EXISTS (SELECT 1 FROM public.conciliacao_items ci
                  WHERE ci.related_case_id = cc.id AND ci.tipo = 'cancelamento'
                    AND coalesce((ci.depois->>'abatimentoValor')::numeric, 0) > 0.0049)
   ORDER BY cc.student_name`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');
  const { rows: [anaAntes] } = await client.query(ANA_SQL, [ANA_ID]);
  console.log('ANA ANTES :', anaAntes.status, anaAntes.status_mode, JSON.stringify(anaAntes.installments));

  await client.query(sql);

  const { rows: [anaDepois] } = await client.query(ANA_SQL, [ANA_ID]);
  console.log('ANA DEPOIS:', anaDepois.status, anaDepois.status_mode, JSON.stringify(anaDepois.installments));

  const { rows: casos } = await client.query(CASOS_SQL);
  console.log(`\nCASOS com abatimento no item de conciliação: ${casos.length}`);
  for (const c of casos) console.log(' -', c.student_name, '→', JSON.stringify(c.abatimento));

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
