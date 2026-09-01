/**
 * Lista os grupos de lançamentos duplicados com número da linha na planilha,
 * para conferência manual na planilha e no GC. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-dup-exemplos.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
const headerRow = XLSX.utils.decode_range(sheet['!ref']).s.r + 1;

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
    linhaExcel: headerRow + 1 + i,
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa),
    produto: normalizeString(out.Classificação),
    chave: `${norm(out.Pessoa)}||${norm(out.Classificação)}`,
    forma: normalizeString(out['Forma de Recebimento']),
    detalhe: normalizeString(out.Detalhe),
    centroCusto: normalizeString(out['Centro de Custo']),
    comp: normalizeDate(out.Competência, XLSX),
    venc: normalizeDate(out.Vencimento, XLSX),
    receb,
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
  };
});

const dup = new Map();
for (const l of linhas) {
  const k = [l.chave, l.venc, R(l.aReceber)].join('|');
  if (!dup.has(k)) dup.set(k, []);
  dup.get(k).push(l);
}
const grupos = [...dup.values()].filter((ls) => ls.length > 1);

const abertasDo = (g) => g.filter((l) => !l.pago);
const classifica = (g) => {
  if (abertasDo(g).length > 0) return 'COM PARCELA ABERTA';
  const datas = new Set(g.filter((l) => l.receb).map((l) => l.receb));
  return datas.size === 1 ? 'quitado no mesmo dia' : 'baixas em datas diferentes';
};

const log = (s = '') => console.log(s);
const imprime = (titulo, lista) => {
  log();
  log();
  log(`########## ${titulo} (${lista.length} grupos) ##########`);
  for (const g of lista) {
    const a = abertasDo(g);
    log();
    log(
      `${g[0].pessoa} | ${g[0].produto} | venc ${g[0].venc} | valor ${brl(g[0].aReceber)} | ` +
        `${g.length} cópias | ${a.length} aberta(s) | aberto ${brl(a.reduce((s, l) => s + l.aReceber, 0))}`,
    );
    for (const l of g.sort((x, y) => x.linhaExcel - y.linhaExcel)) {
      log(
        `   linha ${l.linhaExcel} | id ${l.id} | comp ${l.comp ?? '-'} | ` +
          `${l.pago ? `PAGO ${l.receb ?? '?'} ${brl(l.recebido)}` : 'ABERTO'} | forma ${l.forma || '-'}`,
      );
      log(`      detalhe: ${l.detalhe || '-'}`);
    }
  }
};

// Dentro do grupo, "Detalhe" igual = mesma parcela repetida. Detalhe diferente
// (ex.: 7/11 e 8/11) = parcelas distintas antecipadas para o mesmo vencimento.
const detalheIgual = (g) => new Set(g.map((l) => norm(l.detalhe).replace(/ - C[OÓ]PIA.*$/, ''))).size === 1;
const marcadaCopia = (g) => g.some((l) => /c[oó]pia/i.test(l.detalhe));
const mesmaParcela = grupos.filter((g) => detalheIgual(g) || marcadaCopia(g));
const parcelasDistintas = grupos.filter((g) => !(detalheIgual(g) || marcadaCopia(g)));

const comAberta = grupos.filter((g) => abertasDo(g).length > 0)
  .sort((x, y) => abertasDo(y).reduce((s, l) => s + l.aReceber, 0) - abertasDo(x).reduce((s, l) => s + l.aReceber, 0));
const abertoDe = (lista) => brl(lista.flatMap(abertasDo).reduce((s, l) => s + l.aReceber, 0));

log(`total: ${grupos.length} grupos | ${grupos.reduce((s, g) => s + g.length, 0)} lançamentos | ` +
  `${grupos.filter((g) => g.length >= 3).length} grupos com 3+ cópias | ` +
  `${comAberta.length} grupos com parcela aberta | aberto ${abertoDe(comAberta)}`);
log(`A) mesma parcela repetida (Detalhe idêntico ou marcado "Cópia"): ${mesmaParcela.length} grupos | ` +
  `${mesmaParcela.reduce((s, g) => s + g.length, 0)} lançamentos | aberto ${abertoDe(mesmaParcela)}`);
log(`B) parcelas distintas com mesmo venc/valor: ${parcelasDistintas.length} grupos | ` +
  `${parcelasDistintas.reduce((s, g) => s + g.length, 0)} lançamentos | aberto ${abertoDe(parcelasDistintas)}`);

imprime('A) MESMA PARCELA REPETIDA — duplicata provável', mesmaParcela.sort((x, y) => y.length - x.length));
imprime('B) MESMO VENC E VALOR, PARCELAS DIFERENTES — conferir caso a caso', parcelasDistintas);
imprime('C) GRUPOS COM PARCELA AINDA ABERTA — impacto no saldo do GC', comAberta);

fs.writeFileSync(
  'scripts/kamino-dup-exemplos.json',
  JSON.stringify(
    grupos.map((g) => ({
      pessoa: g[0].pessoa,
      produto: g[0].produto,
      venc: g[0].venc,
      valor: g[0].aReceber,
      copias: g.length,
      tipo: classifica(g),
      mesmaParcela: detalheIgual(g) || marcadaCopia(g),
      abertoTotal: R(abertasDo(g).reduce((s, l) => s + l.aReceber, 0)),
      linhas: g.map((l) => ({
        linhaExcel: l.linhaExcel, id: l.id, comp: l.comp, receb: l.receb,
        pago: l.pago, recebido: R(l.recebido), forma: l.forma, detalhe: l.detalhe,
      })),
    })),
    null,
    1,
  ),
);
console.log('\nrelatório: scripts/kamino-dup-exemplos.json');
