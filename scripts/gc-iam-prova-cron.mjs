/**
 * SOMENTE LEITURA: prova que o cron do IAM Control está reescrevendo as fichas
 * colapsadas, medindo iam_control_synced_at e observando updated_at ao longo de
 * alguns minutos.
 *
 * Uso: node scripts/gc-iam-prova-cron.mjs [minutos]
 */
import fs from 'node:fs';
import pg from 'pg';

const IDS = [
  '04737335-93c5-47d5-8e91-667e3699224e',
  'eec8a575-e969-4f2c-afb7-685b0409e3cb',
  'b52f90a2-d605-46a2-9d5b-976cd02d9faa',
  'a7008f23-5fbd-4566-aa59-9063b09397ff',
  'd9cd0166-5a91-4b33-b67a-32450a5891fa',
  'ba858f7c-68eb-4dfa-8596-4fb34a817bc7',
];
const MINUTOS = Number(process.argv[2] ?? 6);

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

const client = await conectar();

const ler = async () => {
  const { rows } = await client.query(
    `SELECT id, name, jsonb_array_length(installments) AS n_inst,
            iam_control_synced_at, updated_at,
            now() - iam_control_synced_at AS desde_sync
       FROM public.students WHERE id = ANY($1::uuid[]) ORDER BY name`,
    [IDS],
  );
  return rows;
};

const antes = await ler();
console.log('=== LEITURA 1 ===');
for (const r of antes) {
  console.log(
    `${String(r.name).slice(0, 36).padEnd(36)} | parcelas ${r.n_inst} | sync ${String(r.iam_control_synced_at).slice(4, 24)} | há ${String(r.desde_sync).split('.')[0]}`,
  );
}

// Histórico de execuções do cron
try {
  const { rows: runs } = await client.query(
    `SELECT status, start_time, end_time FROM cron.job_run_details
      WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'gc-iam-control-pull-incremental')
      ORDER BY start_time DESC LIMIT 8`,
  );
  console.log('\n=== ÚLTIMAS EXECUÇÕES DO CRON gc-iam-control-pull-incremental ===');
  for (const r of runs) console.log(`${String(r.start_time).slice(4, 24)} | ${r.status}`);
} catch (e) {
  console.log('\nsem acesso a cron.job_run_details:', e.message);
}

console.log(`\naguardando ${MINUTOS} minutos para ver se o cron toca as fichas de novo...`);
await new Promise((r) => setTimeout(r, MINUTOS * 60_000));

const depois = await ler();
console.log('\n=== LEITURA 2 ===');
let mexeu = 0;
for (const r of depois) {
  const a = antes.find((x) => x.id === r.id);
  const mudouSync = String(a.iam_control_synced_at) !== String(r.iam_control_synced_at);
  const mudouUpd = String(a.updated_at) !== String(r.updated_at);
  if (mudouSync || mudouUpd) mexeu += 1;
  console.log(
    `${String(r.name).slice(0, 36).padEnd(36)} | parcelas ${r.n_inst} | ` +
      `sync ${mudouSync ? 'REESCRITO' : 'igual'} | updated_at ${mudouUpd ? 'REESCRITO' : 'igual'}`,
  );
}
console.log(`\n${mexeu} de ${depois.length} fichas foram tocadas pelo cron em ${MINUTOS} minutos.`);

await client.end();
