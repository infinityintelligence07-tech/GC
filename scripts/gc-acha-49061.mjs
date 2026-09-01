/**
 * SOMENTE LEITURA: calcula os candidatos de "total baixado" com filtros de
 * data corretos, para identificar qual métrica corresponde a R$ 49.061,04.
 *
 * Uso: node scripts/gc-acha-49061.mjs
 */
import fs from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = 'KAMINO GC (1).xlsx';
const IAM_COMPANY_NAME = 'IAM - GC';
const CORTE = '2026-08-21';
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
const dia = (d) => new Date(d).toISOString().slice(0, 10);
const marca = (v) => (Math.abs(R(v) - ALVO) < 0.5 ? '   <<<< 49.061,04' : '');

const client = await conectar();
const { rows: itens } = await client.query(
  `SELECT tipo, status, student_name, resumo, antes, depois, created_at, conciliado_at
     FROM public.conciliacao_items ORDER BY created_at`,
);
const { rows: alunos } = await client.query(
  `SELECT s.id, s.name, s.product, s.status, s.installments
     FROM public.students s JOIN public.companies c ON c.id = s.company_id
    WHERE c.name = $1`,
  [IAM_COMPANY_NAME],
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

// ─── 1. baixa_kamino por dia de criação ───
const porDia = new Map();
for (const it of itens) {
  if (it.tipo !== 'baixa_kamino' || it.status !== 'conciliado') continue;
  const d = dia(it.created_at);
  if (!porDia.has(d)) porDia.set(d, { n: 0, total: 0 });
  const g = porDia.get(d);
  g.n += 1;
  g.total += valorDe(it.depois);
}
console.log('=== baixa_kamino CONCILIADAS, POR DIA DE CRIAÇÃO ===');
for (const [d, g] of [...porDia].sort()) {
  console.log(`${d} | ${String(g.n).padStart(4)} itens | R$ ${brl(g.total).padStart(13)}${marca(g.total)}`);
}

// ─── 2. janelas a partir do corte, por tipo ───
console.log(`\n=== ITENS CONCILIADOS CRIADOS APÓS ${CORTE} ===`);
const pos = itens.filter((it) => it.status === 'conciliado' && dia(it.created_at) > CORTE);
const porTipo = new Map();
for (const it of pos) {
  if (!porTipo.has(it.tipo)) porTipo.set(it.tipo, { n: 0, total: 0 });
  const g = porTipo.get(it.tipo);
  g.n += 1;
  g.total += valorDe(it.depois);
}
let somaPos = 0;
for (const [t, g] of [...porTipo].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${t.padEnd(22)} | ${String(g.n).padStart(4)} itens | R$ ${brl(g.total).padStart(13)}${marca(g.total)}`);
  somaPos += g.total;
}
console.log(`${'TOTAL'.padEnd(22)} | ${String(pos.length).padStart(4)} itens | R$ ${brl(somaPos).padStart(13)}${marca(somaPos)}`);

const baixasPos = pos.filter((it) => it.tipo === 'baixa_kamino');
const pagPos = pos.filter((it) => it.tipo === 'pagamento_parcela');
const somaBaixasPos = baixasPos.reduce((a, it) => a + valorDe(it.depois), 0);
const somaPagPos = pagPos.reduce((a, it) => a + valorDe(it.depois), 0);
console.log(`\nbaixa_kamino após corte: ${baixasPos.length} | R$ ${brl(somaBaixasPos)}${marca(somaBaixasPos)}`);
console.log(`+ pagamento_parcela:     ${baixasPos.length + pagPos.length} | R$ ${brl(somaBaixasPos + somaPagPos)}${marca(somaBaixasPos + somaPagPos)}`);

// ─── 3. parcelas do GC pagas após o corte ───
const extrato = new Set();
const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
for (const r of rawRows) {
  const receb = normalizeDate(r.Recebimento, XLSX);
  const recebido = normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  if (receb || recebido > 0) continue; // só as em aberto no extrato
  extrato.add(`${norm(normalizeString(r.Pessoa))}|${normalizeDate(r.Vencimento, XLSX)}|${R(normalizeNumber(r['Valor a Receber (R$)']) ?? 0)}`);
}

let pagasPosTotal = 0;
let pagasPosN = 0;
let pagasPosAbertasKamino = 0;
let pagasPosAbertasN = 0;
for (const a of alunos) {
  for (const i of a.installments ?? []) {
    if (!i.paid || !i.paidDate || i.paidDate <= CORTE) continue;
    const v = R(i.paidValue ?? i.value);
    pagasPosTotal += v;
    pagasPosN += 1;
    if (extrato.has(`${norm(a.name)}|${i.dueDate}|${R(i.value)}`)) {
      pagasPosAbertasKamino += v;
      pagasPosAbertasN += 1;
    }
  }
}
console.log(`\n=== PARCELAS DO GC COM paidDate > ${CORTE} ===`);
console.log(`todas:                          ${String(pagasPosN).padStart(4)} | R$ ${brl(pagasPosTotal)}${marca(pagasPosTotal)}`);
console.log(`e ainda ABERTAS no extrato:     ${String(pagasPosAbertasN).padStart(4)} | R$ ${brl(pagasPosAbertasKamino)}${marca(pagasPosAbertasKamino)}`);

// ─── 4. extrato Kamino: recebimentos a partir do corte ───
let recebPos = 0;
let recebPosN = 0;
for (const r of rawRows) {
  const receb = normalizeDate(r.Recebimento, XLSX);
  if (!receb || receb <= CORTE) continue;
  recebPos += normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  recebPosN += 1;
}
console.log(`\n=== EXTRATO KAMINO: RECEBIMENTOS APÓS ${CORTE} ===`);
console.log(`${String(recebPosN).padStart(4)} linhas | R$ ${brl(recebPos)}${marca(recebPos)}`);
