/**
 * Verifica quais colunas de controle IAM/Kamino existem de fato no banco.
 * SOMENTE LEITURA.
 */
import fs from 'node:fs';
import pg from 'pg';

const url = (fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1] ?? '')
  .replaceAll('"', '')
  .replace(/[?&]sslmode=[^&]*/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = (
  await c.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'students' order by 1`,
  )
).rows.map((r) => r.column_name);

const esperadas = [
  'iam_control_aluno_id',
  'iam_control_contrato_status',
  'iam_control_pendente_tipo',
  'iam_control_synced_at',
  'iam_gc_conciliado_at',
  'kamino_synced_at',
];
console.log('=== COLUNAS DE CONTROLE ESPERADAS PELO CODIGO ===');
for (const e of esperadas) console.log(`  ${e.padEnd(32)} ${cols.includes(e) ? 'existe' : 'NAO EXISTE'}`);

console.log('\n=== COLUNAS iam_/kamino_ PRESENTES ===');
for (const c2 of cols.filter((x) => /^(iam|kamino)/.test(x))) console.log(`  ${c2}`);

const migs = (
  await c.query(`select version, name from supabase_migrations.schema_migrations order by version desc limit 12`)
).rows;
console.log('\n=== ULTIMAS MIGRACOES APLICADAS ===');
for (const m of migs) console.log(`  ${m.version}  ${m.name ?? ''}`);

await c.end();
