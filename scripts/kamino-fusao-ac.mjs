/**
 * Verifica se a fusão de Recompra muda o AC resolvido pela ficha e lista
 * casos de contraste (aluno com 2+ treinamentos, onde a Recompra sobrevive).
 * SOMENTE LEITURA.
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ehRecompra = (p) => /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(p);

// mesma lista de kamino-parse.mjs
const KEYWORDS = [
  'gestão de contas', 'gestao de contas', 'antecipação', 'antecipacao',
  'cancelamento', 'negativação', 'negativacao', 'tmf', 'academy',
];
function candidatos(cc) {
  const out = [];
  const seen = new Set();
  for (const bruto of cc.match(/\(([^()]+)\)/g) || []) {
    const inner = bruto.slice(1, -1).trim();
    const low = inner.toLowerCase();
    if (KEYWORDS.some((k) => low.includes(k))) continue;
    const words = inner.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'-]+$/.test(w));
    if (words.length < 2) continue;
    const n = inner.replace(/\s+/g, ' ').trim();
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}
/** Reproduz a escolha do parser com acNames vazio: candidato mais frequente. */
function resolveAc(ls) {
  const m = new Map();
  for (const l of ls) {
    if (!l.cc) continue;
    for (const c of candidatos(l.cc)) m.set(c, (m.get(c) ?? 0) + 1);
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return { ac: top?.[0] ?? '', contagem: [...m.entries()].sort((a, b) => b[1] - a[1]) };
}

const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const linhas = raw.map((row) => {
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
    pessoa: normalizeString(out.Pessoa) || 'Sem Nome',
    produto: normalizeString(out.Classificação) || 'Sem Treinamento',
    cc: normalizeString(out['Centro de Custo']),
    venc: normalizeDate(out.Vencimento, XLSX),
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    pago: !!receb || recebido > 0,
  };
});

const porPessoa = new Map();
for (const l of linhas) {
  const k = norm(l.pessoa);
  if (!porPessoa.has(k)) porPessoa.set(k, []);
  porPessoa.get(k).push(l);
}

const mudouAc = [];
const contraste = [];
for (const [, ls] of porPessoa) {
  const principaisPorProduto = new Map();
  const recompra = [];
  for (const l of ls) {
    if (ehRecompra(l.produto)) recompra.push(l);
    else {
      const k = norm(l.produto);
      if (!principaisPorProduto.has(k)) principaisPorProduto.set(k, []);
      principaisPorProduto.get(k).push(l);
    }
  }
  if (recompra.length === 0) continue;
  const nProdutos = principaisPorProduto.size;
  if (nProdutos === 1) {
    const principais = [...principaisPorProduto.values()][0];
    const antes = resolveAc(principais);
    const depois = resolveAc([...principais, ...recompra]);
    if (antes.ac !== depois.ac) {
      mudouAc.push({
        pessoa: ls[0].pessoa,
        produto: principais[0].produto,
        acPrincipal: antes.ac,
        acFundido: depois.ac,
        contagemPrincipal: antes.contagem,
        contagemFundida: depois.contagem,
        abertoRecompra: R(recompra.filter((l) => !l.pago).reduce((s, l) => s + l.aReceber, 0)),
      });
    }
  } else if (nProdutos >= 2) {
    const abertoRec = R(recompra.filter((l) => !l.pago).reduce((s, l) => s + l.aReceber, 0));
    if (abertoRec > 0)
      contraste.push({
        pessoa: ls[0].pessoa,
        treinamentos: [...principaisPorProduto.values()].map((v) => v[0].produto),
        parcelasRecompra: recompra.length,
        abertoRecompra: abertoRec,
      });
  }
}

console.log('=== A FUSAO TROCA O AC DA FICHA? ===');
console.log(`fichas fundidas em que o AC resolvido muda: ${mudouAc.length}`);
for (const m of mudouAc)
  console.log(
    `  ${m.pessoa} | ${m.produto} | AC pelo principal: "${m.acPrincipal}" -> AC da ficha fundida: "${m.acFundido}"` +
      `\n    contagem principal: ${JSON.stringify(m.contagemPrincipal)}` +
      `\n    contagem fundida:   ${JSON.stringify(m.contagemFundida)}` +
      `\n    saldo de recompra: ${brl(m.abertoRecompra)}`,
  );

console.log('\n=== CONTRASTE: aluno com 2+ treinamentos (recompra sobrevive como ficha propria) ===');
console.log(`casos com saldo: ${contraste.length} | saldo ${brl(contraste.reduce((s, c) => s + c.abertoRecompra, 0))}`);
for (const c of contraste.sort((a, b) => b.abertoRecompra - a.abertoRecompra).slice(0, 8))
  console.log(
    `  ${c.pessoa} | treinamentos: ${c.treinamentos.join(' + ')} | recompra ${c.parcelasRecompra} parcelas | aberto ${brl(c.abertoRecompra)}`,
  );
