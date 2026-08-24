import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchesDir = path.join(__dirname, 'kamino-live-batches');

function loadDatabaseUrl() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const match = env.match(/^DATABASE_URL="([^"]+)"/m);
  if (!match) throw new Error('DATABASE_URL not found in .env');
  return match[1];
}

function listBatchFiles() {
  return fs
    .readdirSync(batchesDir)
    .filter((f) => /^batch-\d+\.sql$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/batch-(\d+)\.sql/)[1]);
      const nb = Number(b.match(/batch-(\d+)\.sql/)[1]);
      return na - nb;
    });
}

async function main() {
  const startFrom = Number(process.env.START_FROM || '1');
  const batches = listBatchFiles();
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();

  let executed = 0;
  const results = { batchesExecuted: 0, failedBatch: null, error: null };

  try {
    for (const file of batches) {
      const num = Number(file.match(/batch-(\d+)\.sql/)[1]);
      if (num < startFrom) continue;

      const sql = fs.readFileSync(path.join(batchesDir, file), 'utf8');
      process.stdout.write(`Executing ${file}... `);
      try {
        await client.query(sql);
        executed++;
        results.batchesExecuted = executed;
        console.log('OK');
      } catch (err) {
        results.failedBatch = file;
        results.error = err.message;
        console.log('FAIL');
        console.error(err.message);
        await client.end();
        console.log(JSON.stringify(results, null, 2));
        process.exit(1);
      }
    }

    console.log('Executing 99-run-sync.sql...');
    const syncSql = fs.readFileSync(path.join(batchesDir, '99-run-sync.sql'), 'utf8');
    const syncResult = await client.query(syncSql);
    results.syncResult = syncResult.rows?.[0] ?? syncResult.rows;

    const staging = await client.query('SELECT COUNT(*)::int AS staging_count FROM public._kamino_sync_staging');
    results.stagingCount = staging.rows[0].staging_count;

    const recentStudents = await client.query(`
      SELECT COUNT(*)::int AS updated_recently
      FROM public.students
      WHERE updated_at >= NOW() - INTERVAL '1 hour'
    `);
    results.studentsUpdatedRecently = recentStudents.rows[0].updated_recently;

    results.batchesExecuted = executed;
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
