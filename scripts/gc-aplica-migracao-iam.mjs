/**
 * Aplica a migração que restaura as proteções do pull IAM Control.
 *
 * Sem --apply: valida a migração numa transação revertida (não altera nada) e
 * mostra o comportamento esperado para as fichas afetadas.
 * Com --apply: aplica de verdade, guardando backup da função anterior.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-iam.mjs
 *   node scripts/gc-aplica-migracao-iam.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260901210000_iam_pull_restaura_protecoes.sql';
const BACKUP = 'scripts/.iam_upsert_backup_antes_da_correcao.sql';
const APLICAR = process.argv.includes('--apply');

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

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();

// Backup da versão atual antes de qualquer coisa.
const { rows: atual } = await client.query(
  `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'iam_control_upsert_one_contract' LIMIT 1`,
);
if (atual.length) {
  fs.writeFileSync(BACKUP, atual[0].src, 'utf8');
  console.log(`backup da função atual salvo em ${BACKUP} (${atual[0].src.length} chars)`);
}

console.log(`\nmodo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}`);

try {
  await client.query('BEGIN');
  await client.query(sql);
  console.log('sintaxe da migração: OK');

  const { rows: nova } = await client.query(
    `SELECT length(pg_get_functiondef(p.oid)) AS tamanho,
            position('NOVO' in pg_get_functiondef(p.oid)) > 0 AS tem_guard_novo,
            position('v_kamino' in pg_get_functiondef(p.oid)) > 0 AS tem_kamino,
            position('v_sem_parcelas' in pg_get_functiondef(p.oid)) > 0 AS tem_sem_parcelas,
            position('paidMarkedAt' in pg_get_functiondef(p.oid)) > 0 AS preserva_rastro
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'iam_control_upsert_one_contract' LIMIT 1`,
  );
  const f = nova[0];
  console.log(`função resultante: ${f.tamanho} chars`);
  console.log(`  guard de status NOVO      : ${f.tem_guard_novo ? 'SIM' : 'NÃO'}`);
  console.log(`  proteção Kamino           : ${f.tem_kamino ? 'SIM' : 'NÃO'}`);
  console.log(`  proteção já tem cronograma: ${f.tem_sem_parcelas ? 'SIM' : 'NÃO'}`);
  console.log(`  preserva paidMarkedAt     : ${f.preserva_rastro ? 'SIM' : 'NÃO'}`);

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
