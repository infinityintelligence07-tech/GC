/**
 * Confere o valor "Recebido" da auditoria contra a coluna bruta da planilha
 * — SOMENTE LEITURA. Não altera nada; só recalcula por caminhos independentes
 * e mostra onde os números divergem.
 *
 * Uso: node scripts/kamino-verifica-pago.mjs "KAMINO GC (1).xlsx"
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'KAMINO GC (1).xlsx';
const round = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => round(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const wb = XLSX.read(fs.readFileSync(path.resolve(XLSX_PATH)), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const linhas = raw.map((r, i) => {
  const receb = normalizeDate(r.Recebimento, XLSX);
  const recebido = normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  const aReceber = normalizeNumber(r['Valor a Receber (R$)']) ?? 0;
  return {
    linha: i + 2,
    pessoa: normalizeString(r.Pessoa),
    produto: normalizeString(r.Classificação),
    venc: normalizeDate(r.Vencimento, XLSX),
    receb,
    recebido,
    aReceber,
    // Mesma definição da auditoria: data de recebimento OU valor recebido > 0.
    pago: !!receb || recebido > 0,
  };
});

const pagos = linhas.filter((l) => l.pago);
const abertos = linhas.filter((l) => !l.pago);

// ── Caminhos independentes de cálculo ──────────────────────────────────────
const somaRecebidoPagos = round(pagos.reduce((a, l) => a + l.recebido, 0));
const somaRecebidoTodas = round(linhas.reduce((a, l) => a + l.recebido, 0));
const somaOriginalPagos = round(pagos.reduce((a, l) => a + l.aReceber, 0));
const formulaAuditoria = round(pagos.reduce((a, l) => a + (l.recebido || l.aReceber), 0));

// ── Casos de borda que explicariam divergência ─────────────────────────────
const pagoSemValorRecebido = pagos.filter((l) => l.recebido === 0);
const recebidoSemDataReceb = linhas.filter((l) => l.recebido > 0 && !l.receb);
const recebidoEmLinhaAberta = abertos.filter((l) => l.recebido > 0);
const recebidoMaior = pagos.filter((l) => l.recebido > l.aReceber + 0.01);
const recebidoMenor = pagos.filter((l) => l.recebido > 0 && l.recebido < l.aReceber - 0.01);
const recebidoNegativo = linhas.filter((l) => l.recebido < 0);

const dif = (arr, f) => round(arr.reduce((a, l) => a + f(l), 0));

console.log('=== VALOR RECEBIDO — CAMINHOS DE CÁLCULO ===');
console.log(`Lançamentos na planilha:            ${linhas.length}`);
console.log(`Lançamentos pagos:                  ${pagos.length}`);
console.log(`Fórmula da auditoria (recebido||aReceber): ${brl(formulaAuditoria)}`);
console.log(`Soma pura de Valor Recebido (pagos):       ${brl(somaRecebidoPagos)}`);
console.log(`Soma de Valor Recebido (planilha inteira): ${brl(somaRecebidoTodas)}`);
console.log(`Soma de Valor a Receber (pagos) [original]: ${brl(somaOriginalPagos)}`);
console.log(`Recebido − Original:                ${brl(somaRecebidoPagos - somaOriginalPagos)}`);

console.log('\n=== CASOS DE BORDA ===');
console.log(`Linha paga sem Valor Recebido (usaria fallback): ${pagoSemValorRecebido.length} · ${brl(dif(pagoSemValorRecebido, (l) => l.aReceber))}`);
console.log(`Valor Recebido > 0 sem data de Recebimento:      ${recebidoSemDataReceb.length} · ${brl(dif(recebidoSemDataReceb, (l) => l.recebido))}`);
console.log(`Valor Recebido > 0 em linha classificada aberta: ${recebidoEmLinhaAberta.length}`);
console.log(`Recebeu MAIS que o devido (juros/multa):         ${recebidoMaior.length} · +${brl(dif(recebidoMaior, (l) => l.recebido - l.aReceber))}`);
console.log(`Recebeu MENOS que o devido (taxa/parcial):       ${recebidoMenor.length} · −${brl(dif(recebidoMenor, (l) => l.aReceber - l.recebido))}`);
console.log(`Valor Recebido negativo (estorno):               ${recebidoNegativo.length}`);

if (recebidoMaior.length) {
  console.log('\nMaiores acréscimos:');
  for (const l of [...recebidoMaior].sort((x, y) => (y.recebido - y.aReceber) - (x.recebido - x.aReceber)).slice(0, 5))
    console.log(` - ${l.pessoa} | ${l.produto} | venc=${l.venc} | devido=${brl(l.aReceber)} recebido=${brl(l.recebido)}`);
}

console.log('\n=== CONFERÊNCIA ===');
const bate = (rotulo, a, b) =>
  console.log(`${Math.abs(a - b) < 0.01 ? 'OK  ' : 'DIVERGE'} ${rotulo}: ${brl(a)} vs ${brl(b)}`);
bate('fórmula da auditoria == soma pura de recebido', formulaAuditoria, somaRecebidoPagos);
bate('recebido nas pagas == recebido na planilha toda', somaRecebidoPagos, somaRecebidoTodas);
