/**
 * Auditoria da planilha Kamino (Recebimentos) — SOMENTE LEITURA.
 *
 * Verifica a consistência interna dos lançamentos e aponta os casos que geram
 * erro no GC na importação. Não acessa banco de dados.
 *
 * Uso: node scripts/kamino-auditoria.mjs "KAMINO GC (1).xlsx"
 * Saída: scripts/kamino-auditoria.json + resumo no console.
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'KAMINO GC (1).xlsx';
const HOJE = new Date().toISOString().slice(0, 10);

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const round = (n) => Number((n ?? 0).toFixed(2));
const diasAtraso = (venc) => Math.floor((Date.parse(HOJE) - Date.parse(venc)) / 86400000);

const abs = path.resolve(XLSX_PATH);
const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

// Kamino repete a identidade só na primeira linha do grupo: replica para baixo.
const FILL = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const last = {};
const rows = raw.map((r) => {
  const out = { ...r };
  if (FILL.every((c) => !normalizeString(out[c]))) return out;
  for (const c of FILL) {
    if (normalizeString(out[c])) last[c] = out[c];
    else if (last[c] != null) out[c] = last[c];
  }
  return out;
});

const linhas = rows.map((r, i) => {
  const forma = normalizeString(r['Forma de Recebimento']);
  const detalhe = normalizeString(r.Detalhe);
  const label = detalhe.match(/\((\d+)\/(\d+)\)/g) ?? [];
  const receb = normalizeDate(r.Recebimento, XLSX);
  const recebido = normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  const aReceber = normalizeNumber(r['Valor a Receber (R$)']) ?? 0;
  const metodos = [];
  if (/cart[aã]o/i.test(detalhe)) metodos.push('Cartão');
  if (/\bpix\b/i.test(detalhe)) metodos.push('Pix');
  if (/qr_?code/i.test(detalhe)) metodos.push('QrCode');
  if (/\blink\b/i.test(detalhe)) metodos.push('Link');
  if (/\bboleto\b/i.test(detalhe)) metodos.push('Boleto');
  return {
    linha: i + 2,
    id: normalizeString(r['0']),
    pessoa: normalizeString(r.Pessoa),
    produto: normalizeString(r.Classificação),
    centroCusto: normalizeString(r['Centro de Custo']),
    contaRecebimento: normalizeString(r['Conta de Recebimento']),
    tituloContrato: normalizeString(r['Título do Contrato']),
    forma,
    // A conta "Boletos - Liberty - Sicoob" é do Sicoob da própria IAM — o nome
    // na Kamino está errado. Nada aqui indica contrato da empresa Liberty.
    isBoletoBancario: /boleto/i.test(forma),
    detalhe,
    metodos,
    labels: label,
    parcelaN: label.length === 1 ? Number(label[0].match(/\((\d+)\//)[1]) : null,
    parcelaTotal: label.length === 1 ? Number(label[0].match(/\/(\d+)\)/)[1]) : null,
    venc: normalizeDate(r.Vencimento, XLSX),
    receb,
    aReceber,
    recebido,
    total: normalizeNumber(r['Valor Total (R$)']) ?? 0,
    pago: !!receb || recebido > 0,
    renegociado: /renegoci/i.test(detalhe),
    temCancelamento: /cancelamento/i.test(normalizeString(r['Centro de Custo'])),
    temNegativacao: /negativa[cç][aã]o/i.test(normalizeString(r['Centro de Custo'])),
    temAntecipacao: /antecipa[cç][aã]o/i.test(normalizeString(r['Centro de Custo'])),
  };
});

// ── Contratos ──────────────────────────────────────────────────────────────
const contratos = new Map();
for (const l of linhas) {
  const k = `${norm(l.pessoa)}||${norm(l.produto)}`;
  if (!contratos.has(k)) contratos.set(k, { pessoa: l.pessoa, produto: l.produto, linhas: [] });
  contratos.get(k).linhas.push(l);
}

const problemas = {
  semVencimento: [],
  recebimentoSemValor: [],
  valorRecebidoParcial: [],
  centavosResiduais: [],
  labelDuplicado: [],
  parcelasFaltando: [],
  duplicidadeExata: [],
  contratoSemAc: [],
  negativacao: [],
  cancelamento: [],
  recebimentoAntesDoVencimentoMuito: [],
};

for (const l of linhas) {
  if (!l.venc) problemas.semVencimento.push(l);
  if (l.receb && l.recebido === 0) problemas.recebimentoSemValor.push(l);
  if (l.pago && l.recebido > 0 && l.aReceber > 0 && l.recebido < l.aReceber - 0.01)
    problemas.valorRecebidoParcial.push(l);
  if (l.aReceber > 0 && l.aReceber <= 0.1) problemas.centavosResiduais.push(l);
  if (l.labels.length > 1) problemas.labelDuplicado.push(l);
  if (l.temNegativacao) problemas.negativacao.push(l);
  if (l.temCancelamento) problemas.cancelamento.push(l);
}

const vistos = new Map();
for (const l of linhas) {
  const k = [norm(l.pessoa), norm(l.produto), l.venc, l.total].join('|');
  if (vistos.has(k)) problemas.duplicidadeExata.push({ atual: l, anterior: vistos.get(k) });
  else vistos.set(k, l);
}

const contratosResumo = [];
for (const [k, c] of contratos) {
  const abertas = c.linhas.filter((l) => !l.pago);
  const pagas = c.linhas.filter((l) => l.pago);
  const somaAberta = round(abertas.reduce((a, l) => a + l.aReceber, 0));
  const somaPaga = round(pagas.reduce((a, l) => a + (l.recebido || l.aReceber), 0));
  const totais = [...new Set(c.linhas.map((l) => l.parcelaTotal).filter(Boolean))];
  const numeros = c.linhas.map((l) => l.parcelaN).filter(Boolean);
  const maxTotal = totais.length ? Math.max(...totais) : null;
  const faltando = [];
  if (maxTotal && c.linhas.length < maxTotal) {
    for (let n = 1; n <= maxTotal; n++) if (!numeros.includes(n)) faltando.push(n);
  }
  const acMatch = c.linhas
    .map((l) => l.centroCusto.match(/\(([^()]*(?:Elaine|Paula|Luana|Bianca|Kelen|Michelle)[^()]*)\)/i)?.[1])
    .find(Boolean);
  const resumo = {
    chave: k,
    pessoa: c.pessoa,
    produto: c.produto,
    lancamentos: c.linhas.length,
    abertas: abertas.length,
    pagas: pagas.length,
    somaAberta,
    somaPaga,
    contrato: round(c.linhas.reduce((a, l) => a + l.aReceber, 0)),
    parcelaTotalDeclarado: maxTotal,
    totaisDivergentes: totais.length > 1 ? totais : undefined,
    parcelasFaltando: faltando.length ? faltando : undefined,
    semVencimento: c.linhas.filter((l) => !l.venc).length,
    primeiroVencAberto: abertas.map((l) => l.venc).filter(Boolean).sort()[0] ?? null,
    ultimoVencAberto: abertas.map((l) => l.venc).filter(Boolean).sort().slice(-1)[0] ?? null,
    ultimoRecebimento: pagas.map((l) => l.receb).filter(Boolean).sort().slice(-1)[0] ?? null,
    metodos: [...new Set(c.linhas.flatMap((l) => l.metodos))],
    formas: [...new Set(c.linhas.map((l) => l.forma))],
    temBoletoBancario: c.linhas.some((l) => l.isBoletoBancario),
    negativacao: c.linhas.some((l) => l.temNegativacao),
    cancelamento: c.linhas.some((l) => l.temCancelamento),
    renegociado: c.linhas.some((l) => l.renegociado),
    ac: acMatch ?? '',
  };
  if (faltando.length) problemas.parcelasFaltando.push(resumo);
  if (!acMatch) problemas.contratoSemAc.push(resumo);
  contratosResumo.push(resumo);
}

// Contratos que o parser do GC descarta (não têm nenhum vencimento válido)
const contratosDescartados = contratosResumo.filter((c) => c.semVencimento === c.lancamentos);

// ── Em aberto: aging ───────────────────────────────────────────────────────
const abertas = linhas.filter((l) => !l.pago);
const bucket = (l) => {
  if (!l.venc) return 'sem vencimento';
  const d = diasAtraso(l.venc);
  if (d < 0) return 'a vencer';
  if (d <= 30) return 'vencido 1-30d';
  if (d <= 60) return 'vencido 31-60d';
  if (d <= 90) return 'vencido 61-90d';
  return 'vencido +90d';
};
const aging = {};
for (const l of abertas) {
  const b = bucket(l);
  aging[b] ??= { linhas: 0, valor: 0 };
  aging[b].linhas++;
  aging[b].valor = round(aging[b].valor + l.aReceber);
}

const porAc = {};
for (const c of contratosResumo) {
  if (c.somaAberta <= 0) continue;
  const k = c.ac || '(sem AC identificado)';
  porAc[k] ??= { contratos: 0, saldo: 0 };
  porAc[k].contratos++;
  porAc[k].saldo = round(porAc[k].saldo + c.somaAberta);
}

const porProduto = {};
for (const c of contratosResumo) {
  if (c.somaAberta <= 0) continue;
  porProduto[c.produto] ??= { contratos: 0, saldo: 0 };
  porProduto[c.produto].contratos++;
  porProduto[c.produto].saldo = round(porProduto[c.produto].saldo + c.somaAberta);
}

// ── Pagos: separação por forma ─────────────────────────────────────────────
const pagos = linhas.filter((l) => l.pago);
const porForma = {};
for (const l of pagos) {
  const chave = l.isBoletoBancario
    ? 'Boleto bancário'
    : l.metodos.find((m) => m !== 'Boleto') ?? (l.metodos.length ? l.metodos[0] : 'Não identificado');
  porForma[chave] ??= { linhas: 0, valor: 0 };
  porForma[chave].linhas++;
  porForma[chave].valor = round(porForma[chave].valor + (l.recebido || l.aReceber));
}

const quitados = contratosResumo.filter((c) => c.abertas === 0);
const tipoQuitado = (c) => {
  if (!c.temBoletoBancario && c.lancamentos === 1) return 'À vista';
  if (!c.temBoletoBancario) return 'Cartão/Pix/Link parcelado';
  return 'Boleto quitado';
};
const quitadosPorTipo = {};
for (const c of quitados) {
  const t = tipoQuitado(c);
  quitadosPorTipo[t] ??= { contratos: 0, valor: 0 };
  quitadosPorTipo[t].contratos++;
  quitadosPorTipo[t].valor = round(quitadosPorTipo[t].valor + c.contrato);
}

const out = {
  geradoEm: new Date().toISOString(),
  hoje: HOJE,
  planilha: path.basename(abs),
  totais: {
    lancamentos: linhas.length,
    pessoas: new Set(linhas.map((l) => norm(l.pessoa))).size,
    contratos: contratosResumo.length,
    contratosComAberto: contratosResumo.filter((c) => c.abertas > 0).length,
    contratosQuitados: quitados.length,
    lancamentosPagos: pagos.length,
    lancamentosAbertos: abertas.length,
    valorRecebido: round(pagos.reduce((a, l) => a + (l.recebido || l.aReceber), 0)),
    valorAberto: round(abertas.reduce((a, l) => a + l.aReceber, 0)),
  },
  aging,
  porAc,
  porProduto,
  porForma,
  quitadosPorTipo,
  problemasContagem: Object.fromEntries(
    Object.entries(problemas).map(([k, v]) => [k, v.length]),
  ),
  contratosDescartados,
  problemas,
  contratosResumo,
  quitados: quitados.map((c) => ({ ...c, tipoPagamento: tipoQuitado(c) })),
};

fs.writeFileSync('scripts/kamino-auditoria.json', JSON.stringify(out, null, 1));

console.log('=== TOTAIS ===');
console.log(out.totais);
console.log('\n=== AGING DOS ABERTOS ===');
console.log(aging);
console.log('\n=== SALDO ABERTO POR AC ===');
console.log(porAc);
console.log('\n=== SALDO ABERTO POR PRODUTO (top) ===');
console.log(Object.fromEntries(Object.entries(porProduto).sort((a, b) => b[1].saldo - a[1].saldo).slice(0, 12)));
console.log('\n=== RECEBIDO POR FORMA ===');
console.log(porForma);
console.log('\n=== QUITADOS POR TIPO ===');
console.log(quitadosPorTipo);
console.log('\n=== PROBLEMAS ===');
console.log(out.problemasContagem);
console.log('contratos descartados pelo parser (sem vencimento):', contratosDescartados.length);
console.log('\nAmostra parcelas faltando:');
for (const c of problemas.parcelasFaltando.slice(0, 12))
  console.log(` - ${c.pessoa} | ${c.produto} | lançamentos=${c.lancamentos} declarado=${c.parcelaTotalDeclarado} faltando=[${c.parcelasFaltando}] aberto=${c.somaAberta}`);
console.log('\nAmostra recebimento sem valor:');
for (const l of problemas.recebimentoSemValor.slice(0, 10))
  console.log(` - ${l.pessoa} | ${l.produto} | venc=${l.venc} receb=${l.receb} aReceber=${l.aReceber} recebido=${l.recebido}`);
console.log('\nAmostra pagamento parcial:');
for (const l of problemas.valorRecebidoParcial.slice(0, 10))
  console.log(` - ${l.pessoa} | ${l.produto} | venc=${l.venc} aReceber=${l.aReceber} recebido=${l.recebido}`);
console.log('\nrelatório: scripts/kamino-auditoria.json');
