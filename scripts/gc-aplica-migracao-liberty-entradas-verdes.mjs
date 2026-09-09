/**
 * Aplica 20260909230000_liberty_entradas_verdes_pago.sql:
 *   Liberty - GC — Gladys (parcela 2 de junho com baixa), Jose Renato Otávio
 *   (entrada R$ 10.900 → parcela 1 paga em 28/06) e Daiane Cardoso Leão
 *   (entrada R$ 6.000 → parcela 1 paga em 15/07), para constarem no card Pago.
 *
 * Sem --apply: roda numa transação e REVERTE, mostrando o antes/depois.
 * Com --apply: aplica de verdade.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260909230000_liberty_entradas_verdes_pago.sql';
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

const FICHAS_SQL = `
  SELECT s.name, s.sale_value, s.down_payment, s.total_installments, s.paid_installments, s.status,
         (SELECT string_agg(format('#%s %s@%s%s%s', i->>'number', i->>'value', i->>'dueDate',
                   CASE WHEN (i->>'paid')::boolean THEN ' ✔' || coalesce(i->>'paidDate', '?') ELSE '' END,
                   CASE WHEN i->>'paidMarkedAt' IS NOT NULL THEN ' M' ELSE '' END), ' | '
                 ORDER BY (i->>'number')::int)
            FROM jsonb_array_elements(s.installments) i) parcelas,
         (SELECT sum((i->>'value')::numeric) FILTER (WHERE NOT (i->>'paid')::boolean) FROM jsonb_array_elements(s.installments) i) em_aberto
    FROM public.students s JOIN public.companies co ON co.id = s.company_id
   WHERE co.name = 'Liberty - GC'
     AND (s.name ILIKE 'GLADYS RODRIGO%' OR s.name ILIKE 'JOSE RENATO OT%VIO%' OR s.name ILIKE 'Daiane Cardoso Le%o%')
   ORDER BY s.name`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');
  const { rows: antes } = await client.query(FICHAS_SQL);
  console.log('ANTES :');
  for (const r of antes) console.log(' ', r);

  await client.query(sql);

  const { rows: depois } = await client.query(FICHAS_SQL);
  console.log('\nDEPOIS:');
  for (const r of depois) console.log(' ', r);

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
