/**
 * Aplica a migração que devolve a coluna financial_rules.em_dia_novos_meta
 * (meta em R$ da fita "Em Dia + Novos" do Dashboard). Só ADD COLUMN IF NOT
 * EXISTS — não altera dados.
 *
 * Sem --apply: roda numa transação e REVERTE, só validando a sintaxe.
 * Com --apply: aplica de verdade.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-meta-fita-dashboard.mjs
 *   node scripts/gc-aplica-migracao-meta-fita-dashboard.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260904180000_financial_rules_em_dia_novos_meta_volta.sql';
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

const COLUNA_SQL = `
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'financial_rules' AND column_name = 'em_dia_novos_meta'`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');
  const { rows: antes } = await client.query(COLUNA_SQL);
  console.log(`coluna em_dia_novos_meta antes: ${antes.length ? 'PRESENTE' : 'ausente'}`);
  await client.query(sql);
  const { rows: depois } = await client.query(COLUNA_SQL);
  console.log(`coluna em_dia_novos_meta depois: ${depois.length ? `PRESENTE (${depois[0].data_type})` : 'AUSENTE (!)'}`);

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
