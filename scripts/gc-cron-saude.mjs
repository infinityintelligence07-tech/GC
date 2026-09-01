/**
 * SOMENTE LEITURA: confere a saúde do cron do IAM Control depois da mudança na
 * função de upsert, e quantas fichas o pull ainda atualiza normalmente.
 *
 * Uso: node scripts/gc-cron-saude.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

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

const { rows: runs } = await client.query(
  `SELECT status, start_time, return_message
     FROM cron.job_run_details
    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'gc-iam-control-pull-incremental')
    ORDER BY start_time DESC LIMIT 12`,
);
console.log('=== EXECUCOES RECENTES DO CRON ===');
for (const r of runs) {
  console.log(
    `${String(r.start_time).slice(4, 24)} | ${r.status}${r.return_message ? ' | ' + String(r.return_message).slice(0, 80) : ''}`,
  );
}
const falhas = runs.filter((r) => r.status !== 'succeeded').length;
console.log(`falhas nas ultimas ${runs.length} execucoes: ${falhas}`);

// O pull continua atualizando fichas nao-NOVO?
const { rows: sync } = await client.query(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE iam_control_synced_at > now() - interval '20 minutes')::int AS ultimos_20min,
          count(*) FILTER (WHERE iam_control_synced_at > now() - interval '2 hours')::int AS ultimas_2h
     FROM public.students WHERE iam_control_aluno_id IS NOT NULL`,
);
console.log('\n=== FICHAS IAM SINCRONIZADAS ===');
console.log(`total com iam_control_aluno_id: ${sync[0].total}`);
console.log(`sincronizadas nos ultimos 20 min: ${sync[0].ultimos_20min}`);
console.log(`sincronizadas nas ultimas 2 h:    ${sync[0].ultimas_2h}`);

const { rows: novo } = await client.query(
  `SELECT count(*)::int AS n,
          count(*) FILTER (WHERE iam_control_synced_at > now() - interval '20 minutes')::int AS tocadas
     FROM public.students
    WHERE iam_control_aluno_id IS NOT NULL AND iam_control_contrato_status = 'NOVO'`,
);
console.log(`\nfichas NOVO: ${novo[0].n} | tocadas nos ultimos 20 min: ${novo[0].tocadas} (esperado: 0)`);

await client.end();
