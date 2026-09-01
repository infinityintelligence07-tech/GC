/**
 * SOMENTE LEITURA: lista os snapshots diários do card e os lançamentos manuais
 * do extrato do card, com as variações dia a dia.
 *
 * Uso: node scripts/gc-extrato-card-snapshots.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const ALVO = 49061.04;

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

const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const marca = (v) => (Math.abs(Math.abs(R(v)) - ALVO) < 1 ? '   <<<< 49.061,04' : '');

const client = await conectar();

const { rows: tabelas } = await client.query(
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND (table_name LIKE '%card%' OR table_name LIKE '%extrato%' OR table_name LIKE '%snapshot%')
    ORDER BY table_name`,
);
console.log('tabelas candidatas:', tabelas.map((t) => t.table_name).join(', ') || '(nenhuma)');

for (const { table_name: t } of tabelas) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t],
  );
  console.log(`\n=== ${t} ===`);
  console.log('colunas:', cols.map((c) => c.column_name).join(', '));
  const { rows } = await client.query(`SELECT * FROM public.${t} ORDER BY 1 LIMIT 200`);
  console.log(`${rows.length} linha(s)`);
  const numericas = cols
    .map((c) => c.column_name)
    .filter((c) => rows.some((r) => typeof r[c] === 'number' || (r[c] !== null && !Number.isNaN(Number(r[c])) && typeof r[c] !== 'object' && typeof r[c] !== 'boolean')));
  for (const r of rows) {
    const partes = [];
    for (const c of cols.map((x) => x.column_name)) {
      const v = r[c];
      if (v === null || typeof v === 'object') continue;
      const n = Number(v);
      partes.push(Number.isFinite(n) && !/id$/i.test(c) && String(v).length < 16 ? `${c}=${brl(n)}` : `${c}=${String(v).slice(0, 22)}`);
    }
    const linha = partes.join(' | ');
    const bate = numericas.some((c) => Math.abs(Math.abs(R(Number(r[c]))) - ALVO) < 1);
    console.log(`  ${linha}${bate ? '   <<<< 49.061,04' : ''}`);
  }

  const campoTotal = cols.map((c) => c.column_name).find((c) => /total|valor|a_vencer|vencido/i.test(c));
  const campoData = cols.map((c) => c.column_name).find((c) => /data|dia|ref/i.test(c));
  if (campoTotal && campoData && rows.length > 1) {
    const ord = [...rows].sort((a, b) => String(a[campoData]).localeCompare(String(b[campoData])));
    console.log(`  variação dia a dia de ${campoTotal}:`);
    for (let i = 1; i < ord.length; i++) {
      const d = Number(ord[i][campoTotal]) - Number(ord[i - 1][campoTotal]);
      console.log(
        `    ${String(ord[i - 1][campoData]).slice(0, 10)} -> ${String(ord[i][campoData]).slice(0, 10)} | ${d >= 0 ? '+' : '-'}R$ ${brl(Math.abs(d))}${marca(d)}`,
      );
    }
  }
}

await client.end();
