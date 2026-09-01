/**
 * SOMENTE LEITURA: inspeciona as funções do IAM Control realmente deployadas no
 * banco, os agendamentos do cron e o momento da última escrita nas 6 fichas
 * colapsadas, para confirmar a causa do colapso do cronograma.
 *
 * Uso: node scripts/gc-iam-funcoes-deploy.mjs
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

// 1. Funções IAM deployadas
const { rows: fns } = await client.query(
  `SELECT p.proname, length(pg_get_functiondef(p.oid)) AS tamanho
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'iam%'
    ORDER BY p.proname`,
);
console.log('=== FUNÇÕES IAM DEPLOYADAS ===');
for (const f of fns) console.log(`${f.proname.padEnd(42)} | ${f.tamanho} chars`);

// 2. Fallback de 1 parcela em iam_treinamento_financeiro
const { rows: fin } = await client.query(
  `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'iam_treinamento_financeiro' LIMIT 1`,
);
if (fin.length) {
  const src = fin[0].src;
  console.log('\n=== iam_treinamento_financeiro: trechos decisivos ===');
  for (const linha of src.split('\n')) {
    if (/v_parcelas\s*:=\s*1|v_parcelas IS NULL|v_parcelas < 1|paid.*true|parcelas_pagas|v_parcelas_pagas >=/.test(linha)) {
      console.log('  ' + linha.trim());
    }
  }
}

// 3. Proteções no upsert de contrato
const { rows: up } = await client.query(
  `SELECT pg_get_functiondef(p.oid) AS src
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'iam_control_upsert_one_contract' LIMIT 1`,
);
if (up.length) {
  const src = up[0].src;
  console.log('\n=== iam_control_upsert_one_contract: proteções presentes? ===');
  const checagens = [
    ["ignora status NOVO", /'NOVO'/],
    ["guard de retorno 'ignorado'", /ignorado/],
    ["proteção Kamino (v_kamino)", /v_kamino/],
    ["proteção 'sem parcelas' (v_sem_parcelas)", /v_sem_parcelas/],
    ["merge de paid por número de parcela", /fin\.i->>'number'/],
    ["preserva paidValue", /paidValue/],
    ["preserva paidMarkedAt", /paidMarkedAt/],
    ["sobrescreve installments direto", /installments\s*=\s*v_fin\.installments/],
  ];
  for (const [rotulo, re] of checagens) {
    console.log(`  ${re.test(src) ? 'SIM' : 'NÃO'} — ${rotulo}`);
  }
  fs.writeFileSync('scripts/.iam_upsert_deployed.sql', src, 'utf8');
  console.log('  (fonte completa salva em scripts/.iam_upsert_deployed.sql)');
}

// 4. Cron
try {
  const { rows: jobs } = await client.query(
    `SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname`,
  );
  console.log('\n=== CRON JOBS ===');
  for (const j of jobs) {
    console.log(`${j.active ? 'ATIVO ' : 'inativo'} | ${j.schedule.padEnd(14)} | ${j.jobname} | ${String(j.command).slice(0, 90)}`);
  }
} catch (e) {
  console.log('\n=== CRON JOBS ===\nsem acesso a cron.job:', e.message);
}

// 5. Quando as 6 fichas foram tocadas
const { rows: fichas } = await client.query(
  `SELECT name, total_installments, jsonb_array_length(installments) AS n_inst,
          iam_control_contrato_status AS iam_status,
          created_at, updated_at
     FROM public.students WHERE id = ANY($1::uuid[]) ORDER BY updated_at DESC`,
  [IDS],
);
console.log('\n=== AS 6 FICHAS: ÚLTIMA ESCRITA ===');
for (const f of fichas) {
  console.log(
    `${String(f.name).slice(0, 36).padEnd(36)} | parcelas ${f.n_inst} | ${f.iam_status} | ` +
      `criada ${String(f.created_at).slice(0, 24)} | atualizada ${String(f.updated_at).slice(0, 24)}`,
  );
}

// 6. Colunas de sincronismo disponíveis
const { rows: cols } = await client.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='students' AND column_name LIKE '%sync%'`,
);
console.log('\ncolunas de sincronismo em students:', cols.map((c) => c.column_name).join(', ') || '(nenhuma)');

await client.end();
