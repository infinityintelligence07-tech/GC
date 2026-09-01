/**
 * Exporta para Excel os contratos em que a planilha Kamino não traz a parcela
 * de entrada (lacunaReal do refino2) — SOMENTE LEITURA.
 *
 * O GC calcula o valor de venda somando as linhas do arquivo, então nesses
 * contratos ele grava um valor menor que o contratado. A planilha gerada aqui
 * é a lista de conferência: contrato a contrato, qual parcela falta, o
 * vencimento provável dela e quanto o valor de venda fica defasado.
 *
 * Pré-requisito: kamino-auditoria.mjs e kamino-refino.mjs/refino2.mjs já rodados.
 * Uso: node scripts/kamino-export-lacunas.mjs
 * Saída: KAMINO_GC_Parcelas_Faltantes.xlsx
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'KAMINO GC (1).xlsx';
const SAIDA = 'KAMINO_GC_Parcelas_Faltantes.xlsx';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const round = (n) => Number((n ?? 0).toFixed(2));

/** Desloca uma data ISO em n meses, ancorando no último dia quando o mês é curto. */
const shiftMeses = (iso, n) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimoDia));
  return alvo.toISOString().slice(0, 10);
};

const auditoria = JSON.parse(fs.readFileSync('scripts/kamino-auditoria.json', 'utf8'));
const refino2 = JSON.parse(fs.readFileSync('scripts/kamino-refino2.json', 'utf8'));
const alvos = refino2.parcelasFaltando.lacunaReal.todos;
const resumoPorChave = new Map(auditoria.contratosResumo.map((c) => [c.chave, c]));

// ── Linhas da planilha, só dos contratos alvo ──────────────────────────────
const wb = XLSX.read(fs.readFileSync(path.resolve(XLSX_PATH)), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const chavesAlvo = new Set(alvos.map((c) => c.chave));
const linhasPorChave = new Map();

raw.forEach((r, i) => {
  const row = { ...r };
  if (!FILL.every((c) => !normalizeString(row[c]))) {
    for (const c of FILL) {
      if (normalizeString(row[c])) last[c] = row[c];
      else if (last[c] != null) row[c] = last[c];
    }
  }
  const chave = `${norm(row.Pessoa)}||${norm(row.Classificação)}`;
  if (!chavesAlvo.has(chave)) return;

  const detalhe = normalizeString(row.Detalhe);
  const label = detalhe.match(/\((\d+)\/(\d+)\)/);
  const receb = normalizeDate(row.Recebimento, XLSX);
  const recebido = normalizeNumber(row['Valor Recebido (R$)']) ?? 0;
  if (!linhasPorChave.has(chave)) linhasPorChave.set(chave, []);
  linhasPorChave.get(chave).push({
    linha: i + 2,
    id: normalizeString(row['0']),
    parcelaN: label ? Number(label[1]) : null,
    parcelaTotal: label ? Number(label[2]) : null,
    venc: normalizeDate(row.Vencimento, XLSX),
    receb,
    aReceber: normalizeNumber(row['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
    forma: normalizeString(row['Forma de Recebimento']),
    conta: normalizeString(row['Conta de Recebimento']),
    centroCusto: normalizeString(row['Centro de Custo']),
    detalhe,
  });
});

/** Valor de parcela que mais se repete no contrato (mais estável que a média). */
const valorPredominante = (ls) => {
  const contagem = new Map();
  for (const l of ls) {
    const v = round(l.aReceber);
    if (v <= 0) continue;
    contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }
  const top = [...contagem.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return top ? top[0] : 0;
};

/**
 * Vencimento provável da parcela ausente: parte de uma linha etiquetada e
 * recua/avança um mês por número de parcela. Sem etiqueta não há como inferir.
 */
const vencProvavel = (ls, numeroFaltante) => {
  const ancora = ls
    .filter((l) => l.parcelaN != null && l.venc)
    .sort((a, b) => a.parcelaN - b.parcelaN)[0];
  if (!ancora) return '';
  return shiftMeses(ancora.venc, numeroFaltante - ancora.parcelaN);
};

// ── Aba 1: um contrato por linha ───────────────────────────────────────────
const contratos = alvos.map((c) => {
  const ls = linhasPorChave.get(c.chave) ?? [];
  const resumo = resumoPorChave.get(c.chave) ?? {};
  const faltando = c.faltando ?? [];
  const parcela = valorPredominante(ls);
  const faltanteEstimado = round(parcela * faltando.length);
  const naPlanilha = round(resumo.contrato ?? ls.reduce((s, l) => s + l.aReceber, 0));
  const vencs = ls.map((l) => l.venc).filter(Boolean).sort();

  return {
    'Pessoa': c.pessoa,
    'Treinamento': c.produto,
    'AC': c.ac || '(sem AC)',
    'Parcela(s) faltando': faltando.join(', '),
    'Qtd faltando': faltando.length,
    'Vencimento provável da 1ª faltante': vencProvavel(ls, faltando[0]),
    'Parcelas na planilha': c.lancamentos,
    'Parcelas declaradas no contrato': c.declarado ?? '',
    'Valor da parcela (predominante)': parcela,
    'Valor faltante estimado': faltanteEstimado,
    'Valor de venda que o GC grava hoje': naPlanilha,
    'Valor de venda estimado correto': round(naPlanilha + faltanteEstimado),
    'Parcelas pagas': resumo.pagas ?? '',
    'Parcelas abertas': resumo.abertas ?? '',
    'Saldo em aberto': round(c.aberto),
    '1º vencimento na planilha': vencs[0] ?? '',
    'Último vencimento na planilha': vencs[vencs.length - 1] ?? '',
    'Negativação': resumo.negativacao ? 'Sim' : 'Não',
    'Renegociado': resumo.renegociado ? 'Sim' : 'Não',
    'Formas de recebimento': (resumo.formas ?? []).join(' | '),
  };
});

// ── Aba 2: lançamentos dos mesmos contratos, para conferência ──────────────
const lancamentos = [];
for (const c of alvos) {
  const ls = (linhasPorChave.get(c.chave) ?? []).sort((a, b) =>
    (a.venc ?? '').localeCompare(b.venc ?? ''));
  for (const l of ls) {
    lancamentos.push({
      'Pessoa': c.pessoa,
      'Treinamento': c.produto,
      'AC': c.ac || '(sem AC)',
      'Linha na planilha': l.linha,
      'ID Kamino': l.id,
      'Parcela': l.parcelaN != null ? `${l.parcelaN}/${l.parcelaTotal}` : '(sem etiqueta)',
      'Vencimento': l.venc ?? '',
      'Recebimento': l.receb ?? '',
      'Valor a Receber': round(l.aReceber),
      'Valor Recebido': round(l.recebido),
      'Situação': l.pago ? 'Pago' : 'Em aberto',
      'Forma de Recebimento': l.forma,
      'Conta de Recebimento': l.conta,
      'Centro de Custo': l.centroCusto,
      'Detalhe': l.detalhe,
    });
  }
}

// ── Aba 3: contexto para quem receber o arquivo ────────────────────────────
const totalFaltante = round(contratos.reduce((s, c) => s + c['Valor faltante estimado'], 0));
const leiaMe = [
  { Campo: 'Planilha de origem', Valor: path.basename(path.resolve(XLSX_PATH)) },
  { Campo: 'Gerado em', Valor: new Date().toISOString().slice(0, 19).replace('T', ' ') },
  { Campo: 'Contratos afetados', Valor: contratos.length },
  { Campo: 'Saldo em aberto envolvido', Valor: round(contratos.reduce((s, c) => s + c['Saldo em aberto'], 0)) },
  { Campo: 'Valor faltante estimado (total)', Valor: totalFaltante },
  { Campo: '', Valor: '' },
  { Campo: 'O que é isto', Valor: 'Contratos em que a planilha Kamino traz menos parcelas do que o próprio contrato declara, e a que falta está no começo da sequência (quase sempre a entrada).' },
  { Campo: 'Impacto no GC', Valor: 'O GC calcula o valor de venda somando as linhas do arquivo. Nesses contratos ele grava um valor de venda menor que o real e o aluno entra com o fluxo de pagamento incompleto.' },
  { Campo: 'Como conferir', Valor: 'Use a aba Lançamentos: ela lista todas as parcelas que a planilha traz para cada contrato. A parcela ausente é a que não aparece na coluna Parcela.' },
  { Campo: 'Cuidado com o estimado', Valor: 'O valor faltante estimado usa o valor de parcela que mais se repete no contrato. A entrada costuma ter valor diferente das demais, então confira no contrato antes de corrigir.' },
  { Campo: 'Vencimento provável', Valor: 'Calculado recuando um mês por parcela a partir da primeira parcela etiquetada. É uma estimativa, não o vencimento oficial.' },
];

// ── Montagem do arquivo ────────────────────────────────────────────────────
const larguras = (linhas, cabecalhos) =>
  cabecalhos.map((h) => ({
    wch: Math.min(52, Math.max(12, ...[h, ...linhas.map((l) => String(l[h] ?? ''))].map((v) => v.length + 2))),
  }));

const moeda = '#,##0.00';
const aplicarFormatoMoeda = (ws, cabecalhos, colunasMoeda) => {
  const range = XLSX.utils.decode_range(ws['!ref']);
  cabecalhos.forEach((h, col) => {
    if (!colunasMoeda.includes(h)) return;
    for (let linha = 1; linha <= range.e.r; linha++) {
      const cel = ws[XLSX.utils.encode_cell({ r: linha, c: col })];
      if (cel && cel.t === 'n') cel.z = moeda;
    }
  });
};

const out = XLSX.utils.book_new();

const cabContratos = Object.keys(contratos[0]);
const wsContratos = XLSX.utils.json_to_sheet(contratos, { header: cabContratos });
wsContratos['!cols'] = larguras(contratos, cabContratos);
wsContratos['!autofilter'] = { ref: wsContratos['!ref'] };
wsContratos['!freeze'] = { xSplit: 0, ySplit: 1 };
aplicarFormatoMoeda(wsContratos, cabContratos, [
  'Valor da parcela (predominante)', 'Valor faltante estimado',
  'Valor de venda que o GC grava hoje', 'Valor de venda estimado correto', 'Saldo em aberto',
]);
XLSX.utils.book_append_sheet(out, wsContratos, 'Contratos');

const cabLanc = Object.keys(lancamentos[0]);
const wsLanc = XLSX.utils.json_to_sheet(lancamentos, { header: cabLanc });
wsLanc['!cols'] = larguras(lancamentos, cabLanc);
wsLanc['!autofilter'] = { ref: wsLanc['!ref'] };
aplicarFormatoMoeda(wsLanc, cabLanc, ['Valor a Receber', 'Valor Recebido']);
XLSX.utils.book_append_sheet(out, wsLanc, 'Lançamentos');

const wsLeiaMe = XLSX.utils.json_to_sheet(leiaMe, { header: ['Campo', 'Valor'] });
wsLeiaMe['!cols'] = [{ wch: 34 }, { wch: 110 }];
XLSX.utils.book_append_sheet(out, wsLeiaMe, 'Leia-me');

// O build ESM do xlsx não enxerga o fs sozinho: grava a partir do buffer.
fs.writeFileSync(SAIDA, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }));

console.log(`Contratos afetados: ${contratos.length}`);
console.log(`Lançamentos listados: ${lancamentos.length}`);
console.log(`Saldo em aberto envolvido: ${round(contratos.reduce((s, c) => s + c['Saldo em aberto'], 0))}`);
console.log(`Valor faltante estimado: ${totalFaltante}`);
console.log(`\narquivo: ${SAIDA}`);
