/**
 * Classifica a natureza das linhas "Fundo - Receita (Recompra)":
 * renegociação, antecipação/fundo, ou receita nova. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-recompra-natureza.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ehRecompra = (p) => /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(p);

const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
console.log('colunas:', Object.keys(raw[0]).join(' | '));

const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const linhas = raw.map((row, i) => {
  const out = { ...row };
  if (!FILL.every((c) => !normalizeString(out[c]))) {
    for (const c of FILL) {
      if (normalizeString(out[c])) last[c] = out[c];
      else if (last[c] != null) out[c] = last[c];
    }
  }
  const receb = normalizeDate(out.Recebimento, XLSX);
  const recebido = normalizeNumber(out['Valor Recebido (R$)']) ?? 0;
  return {
    excel: i + 2,
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa) || 'Sem Nome',
    produto: normalizeString(out.Classificação) || 'Sem Treinamento',
    unidade: normalizeString(out['Unidade de Negócio']),
    cc: normalizeString(out['Centro de Custo']),
    conta: normalizeString(out['Conta de Recebimento']),
    titulo: normalizeString(out['Título do Contrato']),
    forma: normalizeString(out['Forma de Recebimento']),
    detalhe: normalizeString(out.Detalhe),
    venc: normalizeDate(out.Vencimento, XLSX),
    comp: normalizeDate(out.Competência, XLSX),
    receb,
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
  };
});

const rec = linhas.filter((l) => ehRecompra(l.produto));
console.log(`\nlinhas de recompra/fundo: ${rec.length}`);

const dist = (campo, arr = rec) => {
  const m = new Map();
  for (const l of arr) {
    const v = l[campo] || '(vazio)';
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

for (const campo of ['forma', 'conta', 'unidade', 'titulo']) {
  console.log(`\n--- ${campo} (recompra) ---`);
  for (const [v, n] of dist(campo).slice(0, 15)) console.log(`  ${n.toString().padStart(4)}  ${v.slice(0, 110)}`);
}

console.log('\n--- Detalhe: padroes ---');
const pad = {
  renegociacao: /renegoci/i,
  antecipacao: /antecipa/i,
  fundo: /fundo/i,
  recompra: /recompra/i,
  acordo: /acordo/i,
  parcelaLabel: /\(\d+\/\d+\)/,
  cartao: /cart[aã]o/i,
  pix: /\bpix\b|qr_?code/i,
  boleto: /boleto/i,
  link: /\blink\b/i,
};
for (const [k, re] of Object.entries(pad))
  console.log(`  ${k.padEnd(14)} ${rec.filter((l) => re.test(l.detalhe)).length}`);
console.log(`  detalhe vazio  ${rec.filter((l) => !l.detalhe).length}`);

console.log('\n--- amostra de Detalhe (20 distintos) ---');
for (const [v, n] of dist('detalhe').slice(0, 20)) console.log(`  ${n.toString().padStart(4)}  ${v.slice(0, 130)}`);

// ── Espelhamento: a parcela de recompra repete uma parcela ja recebida? ───
const porPessoa = new Map();
for (const l of linhas) {
  const k = norm(l.pessoa);
  if (!porPessoa.has(k)) porPessoa.set(k, []);
  porPessoa.get(k).push(l);
}

let espelhoN = 0;
let espelhoValor = 0;
let recN = 0;
let recValor = 0;
const casos = [];
for (const [, ls] of porPessoa) {
  const r = ls.filter((l) => ehRecompra(l.produto));
  if (r.length === 0) continue;
  const p = ls.filter((l) => !ehRecompra(l.produto));
  const pagasPrincipal = p.filter((l) => l.pago);
  let cN = 0;
  let cV = 0;
  for (const l of r) {
    recN++;
    recValor = R(recValor + l.aReceber);
    const igual = pagasPrincipal.some((x) => Math.abs(x.aReceber - l.aReceber) < 0.02);
    if (igual) {
      espelhoN++;
      espelhoValor = R(espelhoValor + l.aReceber);
      cN++;
      cV = R(cV + l.aReceber);
    }
  }
  if (cN > 0)
    casos.push({
      pessoa: r[0].pessoa,
      produtoPrincipal: [...new Set(p.map((x) => x.produto))].join(' + '),
      recompraLinhas: r.length,
      espelhadas: cN,
      valorEspelhado: cV,
      contratoPrincipal: R(p.reduce((s, x) => s + x.aReceber, 0)),
      contratoRecompra: R(r.reduce((s, x) => s + x.aReceber, 0)),
      recebidoPrincipal: R(pagasPrincipal.reduce((s, x) => s + x.aReceber, 0)),
    });
}

console.log('\n=== A PARCELA DE RECOMPRA ESPELHA UMA PARCELA JA RECEBIDA DO PRINCIPAL? ===');
console.log(
  `linhas de recompra com valor identico a alguma parcela paga do principal: ${espelhoN}/${recN} | ` +
    `${brl(espelhoValor)} de ${brl(recValor)}`,
);
console.log('\nmaiores casos (possivel dupla contagem de receita contratada):');
for (const c of casos.sort((a, b) => b.valorEspelhado - a.valorEspelhado).slice(0, 12))
  console.log(
    `  ${c.pessoa} | ${c.produtoPrincipal}\n    principal contratado ${brl(c.contratoPrincipal)} (recebido ${brl(c.recebidoPrincipal)}) | ` +
      `recompra ${brl(c.contratoRecompra)} | ${c.espelhadas}/${c.recompraLinhas} linhas espelhadas = ${brl(c.valorEspelhado)}`,
  );
