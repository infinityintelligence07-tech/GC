/**
 * SOMENTE LEITURA: dado um total alvo da planilha de conferência, encontra por
 * busca exata qual subconjunto das baixas/pagamentos do GC soma esse valor,
 * testando tanto o valor nominal quanto o valor efetivamente recebido.
 *
 * Uso: node scripts/gc-casa-total.mjs [alvo]
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
const cents = (n) => Math.round(Number(n ?? 0) * 100);

const client = await conectar();
const { rows: empresa } = await client.query(`SELECT id FROM public.companies WHERE name = $1`, [IAM_COMPANY_NAME]);
const { rows: itens } = await client.query(
  `SELECT tipo, student_name, antes, depois
     FROM public.conciliacao_items
    WHERE company_id = $1 AND status = 'conciliado'
      AND tipo IN ('baixa_kamino', 'pagamento_parcela', 'quitacao')
    ORDER BY created_at`,
  [empresa[0].id],
);
await client.end();

const num = (o, k) => {
  const n = Number(o?.[k]);
  return Number.isFinite(n) ? n : 0;
};

const registros = itens.map((it) => {
  const nominal = num(it.depois, 'valor') || num(it.antes, 'valor');
  const recebidoRaw = num(it.depois, 'paidValue');
  return {
    tipo: it.tipo,
    aluno: it.student_name,
    parcela: num(it.depois, 'numero') || num(it.depois, 'parcela'),
    nominal,
    recebido: recebidoRaw || nominal,
  };
});

const somaNominal = registros.reduce((a, r) => a + r.nominal, 0);
const somaRecebido = registros.reduce((a, r) => a + r.recebido, 0);
const baixas = registros.filter((r) => r.tipo === 'baixa_kamino');

console.log(`itens: ${registros.length} (${baixas.length} baixa_kamino)`);
console.log(`soma nominal de tudo:   R$ ${brl(somaNominal)}`);
console.log(`soma recebida de tudo:  R$ ${brl(somaRecebido)}`);
console.log(`soma nominal das baixas:  R$ ${brl(baixas.reduce((a, r) => a + r.nominal, 0))}`);
console.log(`soma recebida das baixas: R$ ${brl(baixas.reduce((a, r) => a + r.recebido, 0))}`);
console.log(`juros implícito no total: R$ ${brl(somaRecebido - somaNominal)}`);
console.log(`\nalvo: R$ ${brl(ALVO)}`);

function acharSubconjunto(valores, alvoCents) {
  const masks = [1n];
  let mask = 1n;
  for (const v of valores) {
    mask |= mask << BigInt(v);
    masks.push(mask);
  }
  if (!((mask >> BigInt(alvoCents)) & 1n)) return null;
  const escolha = [];
  let resto = alvoCents;
  for (let i = valores.length - 1; i >= 0; i--) {
    const anterior = masks[i];
    if ((anterior >> BigInt(resto)) & 1n) continue; // não precisou do item i
    escolha.push(i);
    resto -= valores[i];
  }
  return escolha.reverse();
}

for (const [rotulo, campo] of [['VALOR RECEBIDO (com juros)', 'recebido'], ['VALOR NOMINAL', 'nominal']]) {
  const valores = registros.map((r) => cents(r[campo])).filter((v) => v > 0);
  const usados = registros.filter((r) => cents(r[campo]) > 0);
  const idx = acharSubconjunto(valores, cents(ALVO));
  console.log(`\n=== ${rotulo} ===`);
  if (!idx) {
    console.log('nenhum subconjunto soma exatamente o alvo');
    continue;
  }
  console.log(`combinação exata encontrada com ${idx.length} de ${usados.length} itens:`);
  let t = 0;
  for (const i of idx) {
    const r = usados[i];
    t += r[campo];
    console.log(`  R$ ${brl(r[campo]).padStart(10)} | ${r.tipo.padEnd(17)} | parc ${String(r.parcela).padStart(2)} | ${r.aluno}`);
  }
  console.log(`  soma R$ ${brl(t)}`);
  const fora = usados.filter((_, i) => !idx.includes(i));
  console.log(`\n  ${fora.length} itens fora da combinação (R$ ${brl(fora.reduce((a, r) => a + r[campo], 0))}):`);
  for (const r of fora) {
    console.log(`  R$ ${brl(r[campo]).padStart(10)} | ${r.tipo.padEnd(17)} | parc ${String(r.parcela).padStart(2)} | ${r.aluno}`);
  }
}
