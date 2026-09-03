/**
 * Valida/aplica a migração iam_treinamento_financeiro (cartão cobrado +
 * pendência explícita). Sem --apply: roda na transação, compara a saída da
 * função ANTES x DEPOIS para payloads de referência e REVERTE.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-cartao-pendencia.mjs
 *   node scripts/gc-aplica-migracao-cartao-pendencia.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260903180000_iam_cartao_com_pendencia_explicita.sql';
const APLICAR = process.argv.includes('--apply');

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try { await c.connect(); return c; } catch { await c.end().catch(() => {}); }
  }
  throw new Error('sem conexão com o banco');
}

const base = {
  valor_total: 12922, valor_pago: 0, valor_pendente: 12922, data_venda: '2026-08-28T12:00:00.000Z',
  parcelas: 2, valor_entrada: 0, valor_parcela: 4000, parcelas_pagas: 0, parcelas_detalhe: [4000, 8922],
};
const CASOS = [
  ['Ronaldo — payload ANTIGO (sem flag), PENDENTE_LINK', {
    ...base, status_conciliacao: 'PENDENTE_LINK', valor_pendencia_financeira: 0,
    formas_pagamento: [{ forma: 'CARTAO_CREDITO', valor: 12922 }],
  }],
  ['Ronaldo — payload NOVO (pendência marcada), PENDENTE_LINK', {
    ...base, status_conciliacao: 'PENDENTE_LINK', valor_pendencia_financeira: 8922,
    formas_pagamento: [
      { forma: 'CARTAO_CREDITO', valor: 4000, parcelas: 12 },
      { forma: 'CARTAO_CREDITO', valor: 8922, parcelas: 12, pendencia: true },
    ],
  }],
  ['Ronaldo — payload NOVO depois de CONCILIADO', {
    ...base, status_conciliacao: 'CONCILIADO', valor_pendencia_financeira: 8922,
    formas_pagamento: [
      { forma: 'CARTAO_CREDITO', valor: 4000, parcelas: 12 },
      { forma: 'CARTAO_CREDITO', valor: 8922, parcelas: 12, pendencia: true },
    ],
  }],
  ['Regressão — cartão 12x integral CONCILIADO', {
    valor_total: 6000, valor_pago: 0, valor_pendente: 6000, data_venda: '2026-08-01T12:00:00.000Z',
    status_conciliacao: 'CONCILIADO', parcelas: 12, valor_entrada: 0, valor_parcela: 500, parcelas_pagas: 0,
    valor_pendencia_financeira: 0, parcelas_detalhe: Array(12).fill(500),
    formas_pagamento: [{ forma: 'CARTAO_CREDITO', valor: 6000, parcelas: 12 }],
  }],
  ['Regressão — PIX 500 + boleto 10x, CONCILIADO, 2 pagas', {
    valor_total: 5500, valor_pago: 1500, valor_pendente: 4000, data_venda: '2026-06-10T12:00:00.000Z',
    status_conciliacao: 'CONCILIADO', parcelas: 10, valor_entrada: 500, valor_parcela: 500, parcelas_pagas: 2,
    valor_pendencia_financeira: 0, parcelas_detalhe: Array(10).fill(500),
    formas_pagamento: [{ forma: 'PIX', valor: 500 }, { forma: 'BOLETO', valor: 5000, parcelas: 10 }],
  }],
  ['Regressão — pendência PIX antiga sem flag, PENDENTE_PIX (entrada 500 não paga + boleto 10x)', {
    valor_total: 5500, valor_pago: 0, valor_pendente: 5500, data_venda: '2026-08-20T12:00:00.000Z',
    status_conciliacao: 'PENDENTE_PIX', parcelas: 10, valor_entrada: 500, valor_parcela: 500, parcelas_pagas: 0,
    valor_pendencia_financeira: 0, parcelas_detalhe: Array(10).fill(500),
    formas_pagamento: [{ forma: 'PIX', valor: 500 }, { forma: 'BOLETO', valor: 5000, parcelas: 10 }],
  }],
  ['Novo — pendência PIX 500 marcada, PENDENTE_PIX (+ boleto 10x)', {
    valor_total: 5500, valor_pago: 0, valor_pendente: 5500, data_venda: '2026-08-20T12:00:00.000Z',
    status_conciliacao: 'PENDENTE_PIX', parcelas: 10, valor_entrada: 0, valor_parcela: 500, parcelas_pagas: 0,
    valor_pendencia_financeira: 500, parcelas_detalhe: Array(10).fill(500),
    formas_pagamento: [{ forma: 'BOLETO', valor: 5000, parcelas: 10 }, { forma: 'PIX', valor: 500, pendencia: true }],
  }],
  ['Novo — JUNIA: cartão 4000 + boleto 5831,25 (5x) + cartão 1831,25 pend, CONCILIADO', {
    valor_total: 11662.5, valor_pago: 0, valor_pendente: 11662.5, data_venda: '2026-07-15T12:00:00.000Z',
    status_conciliacao: 'CONCILIADO', parcelas: 3, valor_entrada: 0, valor_parcela: 4000, parcelas_pagas: 0,
    valor_pendencia_financeira: 1831.25, parcelas_detalhe: [4000, 5831.25, 1831.25],
    formas_pagamento: [
      { forma: 'CARTAO_CREDITO', valor: 4000, parcelas: 10 },
      { forma: 'BOLETO', valor: 5831.25, parcelas: 5 },
      { forma: 'CARTAO_CREDITO', valor: 1831.25, parcelas: 3, pendencia: true },
    ],
  }],
  ['Novo — JENNIFER: PIX 7000 + PIX 7000 pend, PENDENTE', {
    valor_total: 14000, valor_pago: 0, valor_pendente: 14000, data_venda: '2026-08-25T12:00:00.000Z',
    status_conciliacao: 'PENDENTE', parcelas: null, valor_entrada: 7000, valor_parcela: null, parcelas_pagas: 0,
    valor_pendencia_financeira: 7000, parcelas_detalhe: [],
    formas_pagamento: [{ forma: 'PIX', valor: 7000 }, { forma: 'PIX', valor: 7000, pendencia: true }],
  }],
  ['Novo — DAVE: débito 197 + cartão 2364 pend (1x), PENDENTE_LINK', {
    valor_total: 2561, valor_pago: 0, valor_pendente: 2561, data_venda: '2026-08-30T12:00:00.000Z',
    status_conciliacao: 'PENDENTE_LINK', parcelas: null, valor_entrada: 197, valor_parcela: null, parcelas_pagas: 0,
    valor_pendencia_financeira: 2364, parcelas_detalhe: [],
    formas_pagamento: [{ forma: 'CARTAO_DEBITO', valor: 197 }, { forma: 'CARTAO_CREDITO', valor: 2364, parcelas: 1, pendencia: true }],
  }],
  ['Novo — ALEX LB: PIX 2500 + boleto 19000 (10x) + PIX 3500 pend, PENDENTE_PIX', {
    valor_total: 25000, valor_pago: 0, valor_pendente: 25000, data_venda: '2026-08-10T12:00:00.000Z',
    status_conciliacao: 'PENDENTE_PIX', parcelas: 10, valor_entrada: 2500, valor_parcela: 1900, parcelas_pagas: 0,
    valor_pendencia_financeira: 3500, parcelas_detalhe: Array(10).fill(1900),
    formas_pagamento: [{ forma: 'PIX', valor: 2500 }, { forma: 'BOLETO', valor: 19000, parcelas: 10 }, { forma: 'PIX', valor: 3500, pendencia: true }],
  }],
  ['Novo — pendência PIX 500 marcada, já CONCILIADO (+ boleto 10x)', {
    valor_total: 5500, valor_pago: 500, valor_pendente: 5000, data_venda: '2026-08-20T12:00:00.000Z',
    status_conciliacao: 'CONCILIADO', parcelas: 10, valor_entrada: 0, valor_parcela: 500, parcelas_pagas: 0,
    valor_pendencia_financeira: 500, parcelas_detalhe: Array(10).fill(500),
    formas_pagamento: [{ forma: 'BOLETO', valor: 5000, parcelas: 10 }, { forma: 'PIX', valor: 500, pendencia: true }],
  }],
];

function resumo(r) {
  const inst = r.installments ?? [];
  const lista = inst.map((i) => `${i.number}:${Number(i.value).toFixed(2)}${i.paid ? '✓' : ''}${(i.tags ?? []).includes('entrada-pendente') ? '(pend)' : ''}`).join(' ');
  return `venda ${Number(r.sale_value).toFixed(2)} | entrada ${Number(r.down_payment).toFixed(2)} | ${r.total_installments} parc (${r.paid_installments} pagas) | ${lista || '—'}`;
}

async function rodar(client) {
  const out = [];
  for (const [nome, payload] of CASOS) {
    const { rows } = await client.query('SELECT * FROM public.iam_treinamento_financeiro($1::jsonb)', [JSON.stringify(payload)]);
    out.push([nome, resumo(rows[0])]);
  }
  return out;
}

const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);
try {
  await client.query('BEGIN');
  const antes = await rodar(client);
  await client.query(fs.readFileSync(MIGRACAO, 'utf8'));
  console.log('sintaxe da migração: OK\n');
  const depois = await rodar(client);
  for (let i = 0; i < CASOS.length; i++) {
    const mudou = antes[i][1] !== depois[i][1];
    console.log(`${mudou ? 'MUDOU ' : 'igual '} ${antes[i][0]}`);
    if (mudou) console.log(`   antes : ${antes[i][1]}`);
    console.log(`   ${mudou ? 'depois' : '      '}: ${depois[i][1]}`);
  }
  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nMIGRAÇÃO APLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nrevertido — nada foi alterado. Rode com --apply para aplicar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU, nada foi alterado:', e.message);
  process.exitCode = 1;
}
await client.end();
