/**
 * SOMENTE LEITURA: reconstrói os possíveis totais de "baixados" a partir do
 * payload dos itens de conciliação, para identificar de onde sai cada número.
 *
 * Uso: node scripts/gc-baixas-valores.mjs [YYYY-MM-DD]
 */
import fs from 'node:fs';
import pg from 'pg';

const CORTE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-21';
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

const client = await conectar();

const { rows: itens } = await client.query(
  `SELECT id, tipo, status, student_name, resumo, antes, depois, created_at, conciliado_at
     FROM public.conciliacao_items ORDER BY created_at`,
);
await client.end();

const valorDe = (o) => {
  if (!o || typeof o !== 'object') return 0;
  for (const k of ['valor', 'paidValue', 'value', 'valorPago']) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v !== 0) return v;
  }
  return 0;
};

const grupos = new Map();
for (const it of itens) {
  const k = `${it.tipo}|${it.status}`;
  if (!grupos.has(k)) grupos.set(k, { n: 0, depois: 0, antes: 0 });
  const g = grupos.get(k);
  g.n += 1;
  g.depois += valorDe(it.depois);
  g.antes += valorDe(it.antes);
}

console.log('=== TODOS OS ITENS (valor extraído de depois/antes) ===');
for (const [k, g] of [...grupos].sort((a, b) => b[1].depois - a[1].depois)) {
  const [tipo, status] = k.split('|');
  console.log(
    `${tipo.padEnd(22)} | ${status.padEnd(11)} | ${String(g.n).padStart(4)} | depois R$ ${brl(g.depois).padStart(13)} | antes R$ ${brl(g.antes).padStart(13)}`,
  );
}

const cortes = [
  ['todos', () => true],
  [`created_at >= ${CORTE}`, (it) => String(it.created_at) >= CORTE || new Date(it.created_at) >= new Date(CORTE)],
];

console.log('\n=== CANDIDATOS A TOTAL DE "BAIXADOS" ===');
for (const [rotulo, filtro] of cortes) {
  for (const [tipoRotulo, tipoFiltro] of [
    ['baixa_kamino', (it) => it.tipo === 'baixa_kamino'],
    ['baixa_kamino + pagamento_parcela', (it) => it.tipo === 'baixa_kamino' || it.tipo === 'pagamento_parcela'],
    ['todos os tipos', () => true],
  ]) {
    const sel = itens.filter((it) => filtro(it) && tipoFiltro(it) && it.status === 'conciliado');
    const total = sel.reduce((a, it) => a + valorDe(it.depois), 0);
    const marca = Math.abs(R(total) - ALVO) < 0.05 ? '  <<< BATE COM 49.061,04' : '';
    console.log(`${rotulo.padEnd(26)} | ${tipoRotulo.padEnd(32)} | ${String(sel.length).padStart(4)} itens | R$ ${brl(total).padStart(13)}${marca}`);
  }
}

const baixas = itens.filter((it) => it.tipo === 'baixa_kamino' && it.status === 'conciliado');
console.log(`\n=== DETALHE DAS ${baixas.length} BAIXAS KAMINO ===`);
let acc = 0;
for (const it of baixas) {
  const v = valorDe(it.depois);
  acc += v;
  console.log(
    `${String(it.created_at).slice(0, 10)} | R$ ${brl(v).padStart(10)} | ${String(it.student_name).slice(0, 34).padEnd(34)} | ${String(it.resumo).slice(0, 70)}`,
  );
}
console.log(`TOTAL baixa_kamino conciliadas: ${baixas.length} itens | R$ ${brl(acc)}`);
