/**
 * Detalha os itens de conciliação de um aluno e o histórico da ficha —
 * SOMENTE LEITURA. Complementa gc-conciliacao-aluno.mjs quando é preciso
 * saber se dois itens são de fato a mesma proposta repetida.
 *
 * Uso: node scripts/gc-conciliacao-aluno-detalhe.mjs "Alex%Bortolassi"
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const ALVO = process.argv[2] ?? 'Alex%Bortolassi';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  if (!m) throw new Error(`${key} não encontrado em .env`);
  return m[1].replaceAll('"', '');
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('não foi possível conectar ao banco');
}

const dt = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o ?? null)).digest('hex').slice(0, 12);

const client = await conectar();
const q = async (sql, p = []) => (await client.query(sql, p)).rows;

const itens = await q(
  `SELECT id, tipo, status, created_at, antes, depois
   FROM public.conciliacao_items
   WHERE student_name ILIKE $1 AND tipo = 'renegociacao'
   ORDER BY created_at`,
  [ALVO],
);

console.log('=== PAYLOAD DAS RENEGOCIAÇÕES ===');
for (const i of itens) {
  const d = i.depois ?? {};
  console.log(
    ` ${dt(i.created_at)} · ${i.status} · id=${i.id}\n` +
      `   hash(depois)=${hash(d)}  hash(antes)=${hash(i.antes)}\n` +
      `   totalParcelas=${d.totalParcelas} valorParcela=${d.valorParcela} entrada=${d.entrada} juros=${d.juros} multa=${d.multa} saleValue=${d.saleValue}\n` +
      `   parcelasSelecionadas=${JSON.stringify(d.parcelasSelecionadas)}\n` +
      `   novasParcelas=${Array.isArray(d.novasParcelas) ? d.novasParcelas.length + ' item(ns)' : '—'}`,
  );
}

if (itens.length === 2) {
  const [a, b] = itens;
  console.log(
    `\n Os dois payloads "depois" são ${hash(a.depois) === hash(b.depois) ? 'IDÊNTICOS' : 'DIFERENTES'}.`,
  );
}

const [aluno] = await q(
  `SELECT id, name, history FROM public.students WHERE name ILIKE $1 LIMIT 1`,
  [ALVO],
);

console.log('\n=== HISTÓRICO DA FICHA ===');
const hist = Array.isArray(aluno?.history) ? aluno.history : [];
for (const h of hist) {
  console.log(` ${dt(h.date)} · ${h.type ?? '—'} · ${String(h.text ?? '').slice(0, 160)}`);
}

console.log('\n=== MENÇÕES A CONCILIAÇÃO NO HISTÓRICO ===');
const mencoes = hist.filter((h) => /concilia/i.test(String(h.text ?? '')));
console.log(mencoes.length ? mencoes.map((h) => ` ${dt(h.date)} · ${h.text}`).join('\n') : ' nenhuma');

await client.end();
