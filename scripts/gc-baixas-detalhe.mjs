/**
 * SOMENTE LEITURA: lista em detalhe as baixas Kamino registradas na empresa
 * IAM - GC e testa vários critérios de soma contra um valor alvo, para amarrar
 * o total da planilha de conferência do banco.
 *
 * Uso: node scripts/gc-baixas-detalhe.mjs [alvo]
 */
import fs from 'node:fs';
import pg from 'pg';

const IAM_COMPANY_NAME = 'IAM - GC';
const ALVO = Number(process.argv[2] ?? 51672.35);

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
const marca = (v) => (Math.abs(R(v) - ALVO) < 1 ? `   <<<< ${brl(ALVO)}` : '');

const client = await conectar();
const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const companyId = empresa[0].id;

const { rows: itens } = await client.query(
  `SELECT tipo, status, student_name, ac, resumo, antes, depois,
          substr(created_at::text, 1, 10) AS criado
     FROM public.conciliacao_items
    WHERE company_id = $1 AND status = 'conciliado'
      AND tipo IN ('baixa_kamino', 'pagamento_parcela', 'quitacao')
    ORDER BY created_at`,
  [companyId],
);
await client.end();

const v = (o, k) => {
  const n = Number(o?.[k]);
  return Number.isFinite(n) ? n : 0;
};

console.log(`=== ITENS DE BAIXA/PAGAMENTO EM ${IAM_COMPANY_NAME} (${itens.length}) ===`);
console.log('criado     | tipo              |   nominal |  recebido | aluno');
let nominal = 0;
let recebido = 0;
for (const it of itens) {
  const nom = v(it.depois, 'valor') || v(it.antes, 'valor');
  const rec = v(it.depois, 'paidValue') || v(it.depois, 'valorPago') || nom;
  nominal += nom;
  recebido += rec;
  console.log(
    `${it.criado} | ${String(it.tipo).padEnd(17)} | ${brl(nom).padStart(9)} | ${brl(rec).padStart(9)} | ${String(it.student_name).slice(0, 40)}`,
  );
}
console.log(`\nnominal total  R$ ${brl(nominal)}${marca(nominal)}`);
console.log(`recebido total R$ ${brl(recebido)}${marca(recebido)}`);

console.log('\n=== SOMAS POR TIPO E DIA ===');
const grupos = new Map();
for (const it of itens) {
  const nom = v(it.depois, 'valor') || v(it.antes, 'valor');
  for (const k of [`${it.criado} | ${it.tipo}`, `${it.criado} | TODOS`, `TODOS | ${it.tipo}`]) {
    if (!grupos.has(k)) grupos.set(k, { n: 0, total: 0 });
    const g = grupos.get(k);
    g.n += 1;
    g.total += nom;
  }
}
for (const [k, g] of [...grupos].sort()) {
  console.log(`${k.padEnd(40)} | ${String(g.n).padStart(3)} itens | R$ ${brl(g.total).padStart(12)}${marca(g.total)}`);
}

// Chaves do payload, para saber se há campo de juros em algum item.
const chaves = new Set();
for (const it of itens) {
  for (const o of [it.antes, it.depois]) {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) chaves.add(k);
  }
}
console.log('\ncampos presentes nos payloads:', [...chaves].sort().join(', '));
