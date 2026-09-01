/**
 * SOMENTE LEITURA: verifica se os objetos auxiliares usados pelas proteções da
 * versão de 26/08 ainda existem e estão populados, antes de restaurá-las.
 *
 * Uso: node scripts/gc-checa-dependencias.mjs
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

const FUNCOES = [
  'product_excluded_from_gc',
  'current_company_id',
  'resolve_gc_company_id',
  'iam_status_is_pendente',
  'iam_treinamento_financeiro',
  'gc_student_key',
  'next_ac_from_esteira',
];
const { rows: fns } = await client.query(
  `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
  [FUNCOES],
);
const existentes = new Set(fns.map((f) => f.proname));
console.log('=== FUNÇÕES AUXILIARES ===');
for (const f of FUNCOES) console.log(`  ${existentes.has(f) ? 'existe    ' : 'NÃO EXISTE'} | ${f}`);

const { rows: tabs } = await client.query(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('_kamino_sync_staging')`,
);
console.log('\n=== TABELAS AUXILIARES ===');
console.log(`  ${tabs.length ? 'existe' : 'NÃO EXISTE'} | _kamino_sync_staging`);
if (tabs.length) {
  const { rows: n } = await client.query(`SELECT count(*)::int AS n FROM public._kamino_sync_staging`);
  console.log(`  linhas na staging: ${n[0].n}`);
}

// Quantos contratos IAM estão em cada status, para dimensionar o efeito do guard NOVO
const { rows: st } = await client.query(
  `SELECT coalesce(iam_control_contrato_status, '(nulo)') AS status, count(*)::int AS n,
          count(*) FILTER (WHERE jsonb_array_length(installments) = 1)::int AS com_1_parcela
     FROM public.students
    WHERE iam_control_aluno_id IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC`,
);
console.log('\n=== FICHAS COM iam_control_aluno_id, POR STATUS ===');
for (const r of st) {
  console.log(`  ${String(r.status).padEnd(16)} | ${String(r.n).padStart(4)} fichas | ${String(r.com_1_parcela).padStart(3)} com 1 parcela só`);
}

await client.end();
