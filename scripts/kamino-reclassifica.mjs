/**
 * Reclassifica "pagamento parcial" e "duplicidade" usando a coluna
 * Desconto (R$) e o padrão de quitação antecipada. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-reclassifica.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

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
  const aReceber = normalizeNumber(out['Valor a Receber (R$)']) ?? 0;
  const desconto = normalizeNumber(out['Desconto (R$)']) ?? 0;
  const juros = normalizeNumber(out['Juros (R$)']) ?? 0;
  const multa = normalizeNumber(out['Multa (%)']) ?? 0;
  const taxas = normalizeNumber(out['Taxas (R$)']) ?? 0;
  return {
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa),
    produto: normalizeString(out.Classificação),
    chave: `${norm(out.Pessoa)}||${norm(out.Classificação)}`,
    forma: normalizeString(out['Forma de Recebimento']),
    venc: normalizeDate(out.Vencimento, XLSX),
    receb,
    aReceber,
    recebido,
    desconto,
    juros,
    multa,
    taxas,
    pago: !!receb || recebido > 0,
  };
});

// ── 1. Pagamento parcial x desconto concedido ─────────────────────────────
const menores = linhas.filter((l) => l.pago && l.recebido > 0 && l.recebido < l.aReceber - 0.01);
const comDescontoRegistrado = menores.filter((l) => l.desconto > 0.01);
const semDesconto = menores.filter((l) => l.desconto <= 0.01);

// Sobra depois de abater o desconto formalizado na planilha
const comSobra = comDescontoRegistrado.filter(
  (l) => l.aReceber - l.recebido - l.desconto > 1,
);

// Sem desconto registrado: separa tarifa pequena de diferença relevante
const semDescontoRelevante = semDesconto.filter(
  (l) => l.aReceber - l.recebido > 50 && (l.aReceber - l.recebido) / l.aReceber > 0.05,
);
const semDescontoTarifa = semDesconto.filter((l) => !semDescontoRelevante.includes(l));

// Quitação antecipada: várias parcelas do contrato baixadas no mesmo dia
const porChaveData = new Map();
for (const l of linhas) {
  if (!l.receb) continue;
  const k = `${l.chave}|${l.receb}`;
  if (!porChaveData.has(k)) porChaveData.set(k, []);
  porChaveData.get(k).push(l);
}
const ehQuitacaoEmLote = (l) => (porChaveData.get(`${l.chave}|${l.receb}`) ?? []).length > 1;

const semDescontoLote = semDescontoRelevante.filter(ehQuitacaoEmLote);
const semDescontoIsolado = semDescontoRelevante.filter((l) => !ehQuitacaoEmLote(l));

const soma = (arr, f) => R(arr.reduce((s, x) => s + f(x), 0));
const falta = (l) => l.aReceber - l.recebido - l.desconto;

console.log('=== LINHAS RECEBIDAS ABAIXO DO VALOR DEVIDO ===');
console.log(`total: ${menores.length} linhas`);
console.log(
  `  desconto formalizado na coluna Desconto: ${comDescontoRegistrado.length} linhas | ` +
    `desconto ${brl(soma(comDescontoRegistrado, (l) => l.desconto))}`,
);
console.log(`    dessas, ainda com sobra inexplicada: ${comSobra.length} | ${brl(soma(comSobra, falta))}`);
console.log(
  `  sem desconto registrado, diferença relevante: ${semDescontoRelevante.length} linhas | ` +
    `${brl(soma(semDescontoRelevante, (l) => l.aReceber - l.recebido))}`,
);
console.log(`    em quitação de várias parcelas no mesmo dia: ${semDescontoLote.length} | ${brl(soma(semDescontoLote, (l) => l.aReceber - l.recebido))}`);
console.log(`    parcela isolada (checar): ${semDescontoIsolado.length} | ${brl(soma(semDescontoIsolado, (l) => l.aReceber - l.recebido))}`);
console.log(
  `  tarifa/arredondamento: ${semDescontoTarifa.length} linhas | ` +
    `${brl(soma(semDescontoTarifa, (l) => l.aReceber - l.recebido))}`,
);

console.log('\nparcelas isoladas recebidas a menos, sem desconto registrado:');
for (const l of semDescontoIsolado.sort((a, b) => b.aReceber - b.recebido - (a.aReceber - a.recebido)).slice(0, 20))
  console.log(
    `  ${l.pessoa} | ${l.produto} | venc=${l.venc} receb=${l.receb} devido=${brl(l.aReceber)} ` +
      `recebido=${brl(l.recebido)} falta=${brl(l.aReceber - l.recebido)}`,
  );

// ── 2. Duplicidade x quitação com vencimento reescrito ────────────────────
const dup = new Map();
for (const l of linhas) {
  const k = [l.chave, l.venc, R(l.aReceber)].join('|');
  if (!dup.has(k)) dup.set(k, []);
  dup.get(k).push(l);
}
const grupos = [...dup.values()].filter((ls) => ls.length > 1);

const cat = { quitacaoLote: [], reemissao: [], comAberta: [] };
for (const ls of grupos) {
  const abertas = ls.filter((l) => !l.pago);
  const datas = new Set(ls.filter((l) => l.receb).map((l) => l.receb));
  if (abertas.length > 0) cat.comAberta.push(ls);
  else if (datas.size === 1) cat.quitacaoLote.push(ls);
  else cat.reemissao.push(ls);
}

console.log('\n=== GRUPOS COM MESMO ALUNO, PRODUTO, VENCIMENTO E VALOR ===');
console.log(`grupos: ${grupos.length} | linhas: ${grupos.reduce((s, g) => s + g.length, 0)}`);
console.log(
  `  quitação em lote no mesmo dia (esperado): ${cat.quitacaoLote.length} grupos | ` +
    `${cat.quitacaoLote.reduce((s, g) => s + g.length, 0)} linhas`,
);
console.log(
  `  baixas em datas diferentes (possível boleto reemitido): ${cat.reemissao.length} grupos | ` +
    `${cat.reemissao.reduce((s, g) => s + g.length, 0)} linhas | ` +
    `${brl(soma(cat.reemissao.flat(), (l) => l.recebido))} recebidos`,
);
console.log(
  `  grupo com linha ainda aberta (checar): ${cat.comAberta.length} grupos | ` +
    `${brl(soma(cat.comAberta.flatMap((g) => g.filter((l) => !l.pago)), (l) => l.aReceber))} em aberto`,
);

console.log('\ngrupos com baixa em datas diferentes:');
for (const g of cat.reemissao.slice(0, 20))
  console.log(
    `  ${g[0].pessoa} | ${g[0].produto} | venc=${g[0].venc} valor=${brl(g[0].aReceber)} | ` +
      `n=${g.length} datas=[${[...new Set(g.map((l) => l.receb))].join(', ')}] ids=[${g.map((l) => l.id).join(',')}]`,
  );

console.log('\ngrupos com linha aberta:');
for (const g of cat.comAberta)
  console.log(
    `  ${g[0].pessoa} | ${g[0].produto} | venc=${g[0].venc} valor=${brl(g[0].aReceber)} | ` +
      `n=${g.length} abertas=${g.filter((l) => !l.pago).length} ids=[${g.map((l) => l.id).join(',')}]`,
  );

// ── 3. Quitações antecipadas em lote (visão geral) ────────────────────────
const lotes = [...porChaveData.entries()]
  .filter(([, ls]) => ls.length >= 3)
  .map(([k, ls]) => {
    const [chave, data] = k.split('|');
    const antecipadas = ls.filter((l) => l.venc && l.receb && l.receb < l.venc).length;
    return {
      pessoa: ls[0].pessoa,
      produto: ls[0].produto,
      data,
      linhas: ls.length,
      antecipadas,
      devido: R(ls.reduce((s, l) => s + l.aReceber, 0)),
      recebido: R(ls.reduce((s, l) => s + l.recebido, 0)),
      desconto: R(ls.reduce((s, l) => s + l.desconto, 0)),
    };
  })
  .sort((a, b) => b.recebido - a.recebido);

console.log(`\n=== QUITAÇÕES EM LOTE (3+ parcelas baixadas no mesmo dia) ===`);
console.log(`eventos: ${lotes.length} | recebido ${brl(soma(lotes, (l) => l.recebido))} | desconto ${brl(soma(lotes, (l) => l.desconto))}`);
console.log('\nmaiores:');
for (const l of lotes.slice(0, 20))
  console.log(
    `  ${l.pessoa} | ${l.produto} | ${l.data} | ${l.linhas} parcelas (${l.antecipadas} antecipadas) | ` +
      `devido ${brl(l.devido)} recebido ${brl(l.recebido)} desconto ${brl(l.desconto)}`,
  );

fs.writeFileSync(
  'scripts/kamino-reclassifica.json',
  JSON.stringify(
    {
      recebidoAMenos: {
        total: menores.length,
        descontoFormalizado: { linhas: comDescontoRegistrado.length, valor: soma(comDescontoRegistrado, (l) => l.desconto) },
        descontoComSobra: { linhas: comSobra.length, valor: soma(comSobra, falta) },
        semDescontoLote: { linhas: semDescontoLote.length, valor: soma(semDescontoLote, (l) => l.aReceber - l.recebido) },
        semDescontoIsolado: {
          linhas: semDescontoIsolado.length,
          valor: soma(semDescontoIsolado, (l) => l.aReceber - l.recebido),
          casos: semDescontoIsolado
            .sort((a, b) => b.aReceber - b.recebido - (a.aReceber - a.recebido))
            .map((l) => ({ pessoa: l.pessoa, produto: l.produto, venc: l.venc, receb: l.receb, devido: l.aReceber, recebido: R(l.recebido), falta: R(l.aReceber - l.recebido) })),
        },
        tarifa: { linhas: semDescontoTarifa.length, valor: soma(semDescontoTarifa, (l) => l.aReceber - l.recebido) },
      },
      duplicidade: {
        grupos: grupos.length,
        quitacaoLote: cat.quitacaoLote.length,
        reemissao: {
          grupos: cat.reemissao.length,
          valor: soma(cat.reemissao.flat(), (l) => l.recebido),
          casos: cat.reemissao.map((g) => ({
            pessoa: g[0].pessoa, produto: g[0].produto, venc: g[0].venc, valor: g[0].aReceber,
            n: g.length, datas: [...new Set(g.map((l) => l.receb))], ids: g.map((l) => l.id),
          })),
        },
        comAberta: {
          grupos: cat.comAberta.length,
          valor: soma(cat.comAberta.flatMap((g) => g.filter((l) => !l.pago)), (l) => l.aReceber),
          casos: cat.comAberta.map((g) => ({
            pessoa: g[0].pessoa, produto: g[0].produto, venc: g[0].venc, valor: g[0].aReceber,
            n: g.length, abertas: g.filter((l) => !l.pago).length, ids: g.map((l) => l.id),
          })),
        },
      },
      quitacoesEmLote: { eventos: lotes.length, recebido: soma(lotes, (l) => l.recebido), desconto: soma(lotes, (l) => l.desconto), maiores: lotes.slice(0, 40) },
    },
    null,
    1,
  ),
);
console.log('\nrelatório: scripts/kamino-reclassifica.json');
