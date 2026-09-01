/**
 * Fecha a ponte entre o saldo em aberto da planilha e o do GC, e detalha as
 * fichas que existem só no GC. Lê scripts/kamino-concilia-carteiras.json.
 */
import fs from 'node:fs';

const j = JSON.parse(fs.readFileSync('scripts/kamino-concilia-carteiras.json', 'utf8'));
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const val = (n, w = 15) => brl(n).padStart(w);
const soma = (arr, f) => R(arr.reduce((s, x) => s + f(x), 0));
const d = j.diagnostico;

const kam = j.totais.kaminoSaldo;
const gc = j.totais.gcSaldo;
const soGc = soma(d.ausenteNaPlanilha, (x) => x.saldo);
const soKam = soma(d.ausenteNoGc, (x) => x.saldo);
const difSaldo = soma(d.saldoDivergente, (x) => x.dif);

console.log('=== PONTE: SALDO EM ABERTO PLANILHA -> GC ===');
console.log(`  planilha Kamino                            ${val(kam)}`);
console.log(`  + fichas com saldo que só existem no GC     ${val(soGc)}  (${d.ausenteNaPlanilha.length} fichas)`);
console.log(`  - contratos com saldo ausentes no GC        ${val(-soKam)}  (${d.ausenteNoGc.length} contratos)`);
console.log(`  +/- divergência nos contratos comuns        ${val(difSaldo)}  (${d.saldoDivergente.length} contratos)`);
console.log(`  = GC                                       ${val(R(kam + soGc - soKam + difSaldo))}`);
console.log(`  GC medido                                  ${val(gc)}`);
console.log(`  residuo                                    ${val(R(gc - (kam + soGc - soKam + difSaldo)))}`);

// ── Fichas só no GC: produto existe na planilha? ──────────────────────────
const produtosNaPlanilha = new Set(
  [...d.ausenteNoGc.map((x) => x.product), ...d.saldoDivergente.map((x) => x.produto), ...d.acDivergente.map((x) => x.produto)]
    .map((p) => p.toUpperCase()),
);
const grupos = new Map();
for (const x of d.ausenteNaPlanilha) {
  const caixaAlta = x.name === x.name.toUpperCase();
  const k = `${x.ac || '(sem AC)'} | ${caixaAlta ? 'nome em CAIXA ALTA' : 'nome normal'}`;
  if (!grupos.has(k)) grupos.set(k, { fichas: 0, saldo: 0, produtos: new Set() });
  const v = grupos.get(k);
  v.fichas++;
  v.saldo = R(v.saldo + x.saldo);
  v.produtos.add(x.product);
}
console.log('\n=== AS 96 FICHAS SO NO GC: POR AC E ORIGEM DO CADASTRO ===');
for (const [k, v] of [...grupos].sort((a, b) => b[1].saldo - a[1].saldo))
  console.log(`  ${pad(k, 44)} ${String(v.fichas).padStart(3)} fichas ${val(v.saldo)} | ${[...v.produtos].slice(0, 4).join(', ')}`);

const caixaAlta = d.ausenteNaPlanilha.filter((x) => x.name === x.name.toUpperCase());
console.log(
  `\nnomes em CAIXA ALTA (padrao de cadastro anterior a importacao Kamino): ${caixaAlta.length} fichas | ${brl(soma(caixaAlta, (x) => x.saldo))}`,
);
const semAcGc = d.ausenteNaPlanilha.filter((x) => !x.ac);
console.log(`sem AC atribuido: ${semAcGc.length} fichas | ${brl(soma(semAcGc, (x) => x.saldo))}`);

// ── Carteira da Bianca Alarcon: de onde vem ──────────────────────────────
const paulaParaBianca = d.acDivergente.filter((x) => /bianca alarcon/i.test(x.acGc));
console.log('\n=== CARTEIRA "BIANCA ALARCON" NO GC ===');
console.log(
  `contratos da planilha atribuidos a Paula Passini que no GC estao com Bianca: ${paulaParaBianca.length} | ` +
    `saldo planilha ${brl(soma(paulaParaBianca, (x) => x.saldo))} | saldo GC ${brl(soma(paulaParaBianca, (x) => x.saldoGc))}`,
);
const biancaSoGc = d.ausenteNaPlanilha.filter((x) => /bianca alarcon/i.test(x.ac));
console.log(`fichas dela que nao existem na planilha: ${biancaSoGc.length} | ${brl(soma(biancaSoGc, (x) => x.saldo))}`);

// ── Contratos quitados no GC mas abertos na planilha ─────────────────────
const gcQuitado = d.saldoDivergente.filter((x) => x.saldoGc === 0 && x.saldoKamino > 0);
const gcMaior = d.saldoDivergente.filter((x) => x.dif > 0);
const gcMenor = d.saldoDivergente.filter((x) => x.dif < 0 && x.saldoGc > 0);
console.log('\n=== DIVERGENCIA DE SALDO NOS CONTRATOS COMUNS ===');
console.log(`GC zerado com saldo na planilha: ${gcQuitado.length} | ${brl(soma(gcQuitado, (x) => x.saldoKamino))}`);
console.log(`GC com saldo menor (parcial):    ${gcMenor.length} | ${brl(soma(gcMenor, (x) => -x.dif))}`);
console.log(`GC com saldo maior:              ${gcMaior.length} | ${brl(soma(gcMaior, (x) => x.dif))}`);

// ── Duplicidade ─────────────────────────────────────────────────────────
const dupComSaldo = d.duplicadoNoGc.filter((x) => x.saldoGc > 0);
console.log('\n=== DUPLICIDADE DE FICHAS NO GC ===');
console.log(`chaves duplicadas: ${d.duplicadoNoGc.length} | fichas: ${d.duplicadoNoGc.reduce((s, x) => s + x.n, 0)}`);
console.log(`  totalmente quitadas (sem efeito em carteira): ${d.duplicadoNoGc.length - dupComSaldo.length}`);
console.log(`  com saldo aberto: ${dupComSaldo.length} | saldo GC ${brl(soma(dupComSaldo, (x) => x.saldoGc))} contra ${brl(soma(dupComSaldo, (x) => x.saldoKamino))} na planilha`);
