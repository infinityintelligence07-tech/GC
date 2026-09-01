/**
 * SOMENTE LEITURA: soma os itens de conciliação efetivados por tipo, para
 * separar o total de "baixas" do total de parcelas quitadas no GC após o
 * corte do extrato Kamino.
 *
 * Uso: node scripts/gc-baixas-por-tipo.mjs [YYYY-MM-DD]
 */
import fs from 'node:fs';
import pg from 'pg';

const CORTE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-21';

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

const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const client = await conectar();

const { rows: cols } = await client.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conciliacao_items' ORDER BY ordinal_position`,
);
console.log('colunas de conciliacao_items:', cols.map((c) => c.column_name).join(', '));

const campoValor = cols.find((c) => /valor|value|amount/i.test(c.column_name))?.column_name;
console.log('campo de valor usado:', campoValor ?? '(nenhum)');

if (campoValor) {
  const { rows } = await client.query(
    `SELECT tipo, status, count(*) AS n, sum(coalesce(${campoValor},0)) AS total
       FROM public.conciliacao_items
      GROUP BY tipo, status ORDER BY sum(coalesce(${campoValor},0)) DESC`,
  );
  console.log(`\n=== TODOS OS ITENS DE CONCILIAÇÃO, POR TIPO E STATUS ===`);
  let geral = 0;
  for (const r of rows) {
    console.log(`${String(r.tipo).padEnd(22)} | ${String(r.status).padEnd(11)} | ${String(r.n).padStart(4)} itens | R$ ${brl(r.total).padStart(14)}`);
    geral += Number(r.total);
  }
  console.log(`${''.padEnd(22)} | ${''.padEnd(11)} | ${String(rows.reduce((a, r) => a + Number(r.n), 0)).padStart(4)} itens | R$ ${brl(geral).padStart(14)}`);

  const { rows: pos } = await client.query(
    `SELECT tipo, count(*) AS n, sum(coalesce(${campoValor},0)) AS total
       FROM public.conciliacao_items
      WHERE created_at >= $1::date
      GROUP BY tipo ORDER BY sum(coalesce(${campoValor},0)) DESC`,
    [CORTE],
  );
  console.log(`\n=== ITENS CRIADOS A PARTIR DE ${CORTE} ===`);
  let t = 0;
  let n = 0;
  for (const r of pos) {
    console.log(`${String(r.tipo).padEnd(22)} | ${String(r.n).padStart(4)} itens | R$ ${brl(r.total).padStart(14)}`);
    t += Number(r.total);
    n += Number(r.n);
  }
  console.log(`${'TOTAL'.padEnd(22)} | ${String(n).padStart(4)} itens | R$ ${brl(t).padStart(14)}`);

  const baixas = pos.find((r) => r.tipo === 'baixa_kamino');
  if (baixas) console.log(`\nsomente baixa_kamino: ${baixas.n} itens | R$ ${brl(baixas.total)}`);
}

await client.end();
