/**
 * Inspeciona contratos específicos e reavalia os grupos de "duplicidade" e
 * "pagamento parcial" à luz do padrão de quitação à vista com desconto.
 * SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-casos-desconto.mjs
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
  const detalhe = normalizeString(out.Detalhe);
  const receb = normalizeDate(out.Recebimento, XLSX);
  const recebido = normalizeNumber(out['Valor Recebido (R$)']) ?? 0;
  const aReceber = normalizeNumber(out['Valor a Receber (R$)']) ?? 0;
  return {
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa),
    produto: normalizeString(out.Classificação),
    chave: `${norm(out.Pessoa)}||${norm(out.Classificação)}`,
    forma: normalizeString(out['Forma de Recebimento']),
    detalhe,
    label: detalhe.match(/\(\d+\/\d+\)/)?.[0] ?? '',
    venc: normalizeDate(out.Vencimento, XLSX),
    receb,
    aReceber,
    recebido,
    pago: !!receb || recebido > 0,
    desconto: normalizeNumber(out['Desconto (R$)']) ?? 0,
  };
});

const ALVOS = ['DANIELA DOS SANTOS BORBA', 'ALINE KRUGER', 'FLAVIA PALMA GONCALVES'];

for (const alvo of ALVOS) {
  const doAluno = linhas.filter((l) => norm(l.pessoa) === alvo);
  console.log(`\n${'='.repeat(90)}\n${alvo} — ${doAluno.length} lançamentos`);
  for (const p of [...new Set(doAluno.map((l) => l.produto))]) {
    const ls = doAluno.filter((l) => l.produto === p).sort((a, b) => String(a.venc).localeCompare(String(b.venc)));
    const aRec = R(ls.reduce((s, l) => s + l.aReceber, 0));
    const rec = R(ls.reduce((s, l) => s + l.recebido, 0));
    console.log(`\n  ## ${p} — ${ls.length} linhas | a receber ${brl(aRec)} | recebido ${brl(rec)} | diferença ${brl(aRec - rec)}`);
    for (const l of ls) {
      console.log(
        `   id=${l.id} ${l.label.padEnd(8)} venc=${l.venc ?? '-'} receb=${l.receb ?? '-'} ` +
          `aReceber=${String(brl(l.aReceber)).padStart(10)} recebido=${String(brl(l.recebido)).padStart(10)} ` +
          `desc=${brl(l.desconto)} | ${l.forma}`,
      );
    }
    // agrupa por data de recebimento
    const porData = {};
    for (const l of ls.filter((x) => x.receb)) {
      porData[l.receb] ??= { n: 0, recebido: 0, aReceber: 0 };
      porData[l.receb].n++;
      porData[l.receb].recebido = R(porData[l.receb].recebido + l.recebido);
      porData[l.receb].aReceber = R(porData[l.receb].aReceber + l.aReceber);
    }
    console.log('   recebimentos por data:', JSON.stringify(porData));
  }
}

// ── Reavaliação: quantos "pagamentos parciais" são quitação com desconto? ──
console.log(`\n${'='.repeat(90)}\nREAVALIAÇÃO DOS 81 "PAGAMENTOS PARCIAIS"`);

const parciais = linhas.filter(
  (l) => l.pago && l.recebido > 0 && l.aReceber > 0 && l.recebido < l.aReceber - 0.01,
);
const parcialReal = parciais.filter((l) => l.aReceber - l.recebido > 50 && (l.aReceber - l.recebido) / l.aReceber > 0.05);

// Uma linha é "quitação antecipada com desconto" se várias parcelas do mesmo
// contrato foram baixadas no mesmo dia, antes do vencimento.
const porChaveData = new Map();
for (const l of linhas) {
  if (!l.receb) continue;
  const k = `${l.chave}|${l.receb}`;
  if (!porChaveData.has(k)) porChaveData.set(k, []);
  porChaveData.get(k).push(l);
}

const classificado = { quitacaoComDesconto: [], parcialDeVerdade: [] };
for (const l of parcialReal) {
  const grupo = porChaveData.get(`${l.chave}|${l.receb}`) ?? [];
  const antecipada = l.venc && l.receb && l.receb <= l.venc;
  if (grupo.length > 1 && antecipada) classificado.quitacaoComDesconto.push(l);
  else classificado.parcialDeVerdade.push(l);
}

const soma = (arr) => R(arr.reduce((s, l) => s + (l.aReceber - l.recebido), 0));
console.log(`quitação antecipada com desconto: ${classificado.quitacaoComDesconto.length} linhas | desconto ${brl(soma(classificado.quitacaoComDesconto))}`);
console.log(`parcial de verdade: ${classificado.parcialDeVerdade.length} linhas | falta ${brl(soma(classificado.parcialDeVerdade))}`);
console.log('\nainda suspeitos de parcial real:');
for (const l of classificado.parcialDeVerdade.sort((a, b) => (b.aReceber - b.recebido) - (a.aReceber - a.recebido)).slice(0, 20))
  console.log(`  ${l.pessoa} | ${l.produto} | venc=${l.venc} receb=${l.receb} aReceber=${brl(l.aReceber)} recebido=${brl(l.recebido)} falta=${brl(l.aReceber - l.recebido)}`);

// ── Reavaliação dos 45 grupos de duplicidade ──────────────────────────────
console.log(`\n${'='.repeat(90)}\nREAVALIAÇÃO DOS GRUPOS DE "DUPLICIDADE"`);
const dup = new Map();
for (const l of linhas) {
  const k = [l.chave, l.venc, R(l.aReceber)].join('|');
  if (!dup.has(k)) dup.set(k, []);
  dup.get(k).push(l);
}
const grupos = [...dup.values()].filter((ls) => ls.length > 1);
let quitacao = 0;
let suspeitos = [];
for (const ls of grupos) {
  const datas = new Set(ls.map((l) => l.receb).filter(Boolean));
  const todasPagas = ls.every((l) => l.pago);
  const mesmaData = datas.size === 1;
  const comDesconto = ls.some((l) => l.recebido < l.aReceber - 0.01);
  if (todasPagas && mesmaData && comDesconto) quitacao++;
  else suspeitos.push(ls);
}
console.log(`grupos totais: ${grupos.length}`);
console.log(`explicados por quitação à vista com desconto: ${quitacao}`);
console.log(`ainda suspeitos: ${suspeitos.length}`);
for (const ls of suspeitos.slice(0, 15))
  console.log(
    `  ${ls[0].pessoa} | ${ls[0].produto} | venc=${ls[0].venc} valor=${brl(ls[0].aReceber)} | n=${ls.length} ` +
      `pagas=${ls.filter((l) => l.pago).length} datas=[${[...new Set(ls.map((l) => l.receb ?? 'aberto'))].join(', ')}]`,
  );
