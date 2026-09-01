/**
 * Segunda passada: separa "parcela faltando" real da entrada sem etiqueta e
 * detalha os casos de duplicidade/pagamento parcial suspeitos.
 * Uso: node scripts/kamino-refino2.mjs
 */
import fs from 'node:fs';

const a = JSON.parse(fs.readFileSync('scripts/kamino-auditoria.json', 'utf8'));
const r = JSON.parse(fs.readFileSync('scripts/kamino-refino.json', 'utf8'));
const round = (n) => Number((n ?? 0).toFixed(2));
const soma = (arr, f) => round(arr.reduce((s, x) => s + f(x), 0));

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// Reconstrói o índice de contratos com as linhas originais
const porChave = new Map(a.contratosResumo.map((c) => [c.chave, c]));

// Precisamos das linhas: re-agrupa a partir dos arrays de problemas não serve.
// Recarrega a planilha só para as verificações pontuais.
const XLSX = (await import('xlsx')).default;
const { normalizeDate, normalizeNumber, normalizeString } = await import('./lib/kamino-parse.mjs');
const wb = XLSX.read(fs.readFileSync('KAMINO GC (1).xlsx'), { type: 'buffer' });
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
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
  const detalhe = normalizeString(out.Detalhe);
  const receb = normalizeDate(out.Recebimento, XLSX);
  const recebido = normalizeNumber(out['Valor Recebido (R$)']) ?? 0;
  return {
    linha: i + 2,
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa),
    produto: normalizeString(out.Classificação),
    chave: `${norm(out.Pessoa)}||${norm(out.Classificação)}`,
    forma: normalizeString(out['Forma de Recebimento']),
    detalhe,
    temLabel: /\(\d+\/\d+\)/.test(detalhe),
    venc: normalizeDate(out.Vencimento, XLSX),
    receb,
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
  };
});

const linhasPorChave = new Map();
for (const l of linhas) {
  if (!linhasPorChave.has(l.chave)) linhasPorChave.set(l.chave, []);
  linhasPorChave.get(l.chave).push(l);
}

// ── 1. "Parcela faltando" é entrada sem etiqueta? ─────────────────────────
const faltando = a.problemas.parcelasFaltando.filter((c) => c.somaAberta > 0);
const classificado = { entradaSemEtiqueta: [], lacunaReal: [], exportacaoParcial: [] };
for (const c of faltando) {
  const ls = linhasPorChave.get(c.chave) ?? [];
  const semLabel = ls.filter((l) => !l.temLabel);
  const faltam = c.parcelasFaltando ?? [];
  const soFaltaInicio = faltam.every((n) => n <= semLabel.length + 1);
  if (faltam.length <= semLabel.length && soFaltaInicio) {
    classificado.entradaSemEtiqueta.push({ ...c, semLabel: semLabel.length, valoresSemLabel: semLabel.map((l) => l.aReceber) });
  } else if (faltam.length > c.lancamentos) {
    classificado.exportacaoParcial.push({ ...c, semLabel: semLabel.length });
  } else {
    classificado.lacunaReal.push({ ...c, semLabel: semLabel.length, valoresSemLabel: semLabel.map((l) => l.aReceber) });
  }
}

// ── 2. Caso Daniela dos Santos Borba (linhas idênticas) ───────────────────
const daniela = linhas.filter((l) => norm(l.pessoa).includes('DANIELA DOS SANTOS BORBA'));

// ── 3. Duplicidade por (pessoa, produto, vencimento, valor a receber) ─────
const dupMap = new Map();
for (const l of linhas) {
  const k = [l.chave, l.venc, round(l.aReceber)].join('|');
  if (!dupMap.has(k)) dupMap.set(k, []);
  dupMap.get(k).push(l);
}
const grupoDup = [...dupMap.entries()]
  .filter(([, ls]) => ls.length > 1)
  .map(([k, ls]) => ({
    chave: k,
    pessoa: ls[0].pessoa,
    produto: ls[0].produto,
    venc: ls[0].venc,
    valor: round(ls[0].aReceber),
    n: ls.length,
    abertas: ls.filter((l) => !l.pago).length,
    pagas: ls.filter((l) => l.pago).length,
    ids: ls.map((l) => l.id),
  }))
  .sort((x, y) => y.n - x.n);

const dupSuspeitas = grupoDup.filter((g) => g.n >= 3);

const out = {
  parcelasFaltando: {
    totalComSaldo: faltando.length,
    entradaSemEtiqueta: {
      n: classificado.entradaSemEtiqueta.length,
      saldo: soma(classificado.entradaSemEtiqueta, (c) => c.somaAberta),
    },
    lacunaReal: {
      n: classificado.lacunaReal.length,
      saldo: soma(classificado.lacunaReal, (c) => c.somaAberta),
      // Lista completa: é a entrada do export para Excel (kamino-export-lacunas.mjs).
      todos: classificado.lacunaReal.sort((x, y) => y.somaAberta - x.somaAberta)
        .map((c) => ({ chave: c.chave, pessoa: c.pessoa, produto: c.produto, lancamentos: c.lancamentos, declarado: c.parcelaTotalDeclarado, faltando: c.parcelasFaltando, semLabel: c.semLabel, aberto: c.somaAberta, ac: c.ac })),
      top: classificado.lacunaReal.slice(0, 15)
        .map((c) => ({ pessoa: c.pessoa, produto: c.produto, lancamentos: c.lancamentos, declarado: c.parcelaTotalDeclarado, faltando: c.parcelasFaltando, semLabel: c.semLabel, aberto: c.somaAberta, ac: c.ac })),
    },
    exportacaoParcial: {
      n: classificado.exportacaoParcial.length,
      saldo: soma(classificado.exportacaoParcial, (c) => c.somaAberta),
      top: classificado.exportacaoParcial.sort((x, y) => y.somaAberta - x.somaAberta).slice(0, 10)
        .map((c) => ({ pessoa: c.pessoa, produto: c.produto, lancamentos: c.lancamentos, declarado: c.parcelaTotalDeclarado, aberto: c.somaAberta, ac: c.ac })),
    },
  },
  daniela: {
    linhas: daniela.length,
    detalhe: daniela.map((l) => ({ id: l.id, produto: l.produto, forma: l.forma, venc: l.venc, receb: l.receb, aReceber: l.aReceber, recebido: round(l.recebido), label: l.temLabel })),
  },
  duplicidade: {
    grupos: grupoDup.length,
    gruposCom3Mais: dupSuspeitas.length,
    linhasEnvolvidas: grupoDup.reduce((s, g) => s + g.n, 0),
    valorAbertoEnvolvido: soma(grupoDup.flatMap((g) => Array(g.abertas).fill(g.valor)), (v) => v),
    top: grupoDup.slice(0, 20),
  },
  negativacao: r.negativacao,
  recompra: r.recompra,
  abandonados: { total: r.abandonados.total, saldo: r.abandonados.saldo, top: r.abandonados.top.slice(0, 12) },
  nuncaPagou: { total: r.nuncaPagou.total, saldo: r.nuncaPagou.saldo, top: r.nuncaPagou.top.slice(0, 12) },
};

fs.writeFileSync('scripts/kamino-refino2.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  parcelasFaltando: {
    totalComSaldo: out.parcelasFaltando.totalComSaldo,
    entradaSemEtiqueta: out.parcelasFaltando.entradaSemEtiqueta,
    lacunaReal: { n: out.parcelasFaltando.lacunaReal.n, saldo: out.parcelasFaltando.lacunaReal.saldo },
    exportacaoParcial: out.parcelasFaltando.exportacaoParcial,
  },
  daniela: out.daniela,
  duplicidade: {
    grupos: out.duplicidade.grupos,
    gruposCom3Mais: out.duplicidade.gruposCom3Mais,
    linhasEnvolvidas: out.duplicidade.linhasEnvolvidas,
    valorAbertoEnvolvido: out.duplicidade.valorAbertoEnvolvido,
    top: out.duplicidade.top.slice(0, 12),
  },
  negativacao: { contratos: out.negativacao.contratos, comSaldo: out.negativacao.comSaldo, saldo: out.negativacao.saldo },
  recompra: { contratos: out.recompra.contratos, comSaldo: out.recompra.comSaldo, saldo: out.recompra.saldo },
  abandonados: { total: out.abandonados.total, saldo: out.abandonados.saldo },
  nuncaPagou: { total: out.nuncaPagou.total, saldo: out.nuncaPagou.saldo },
}, null, 1));
console.log('\nlacuna real (top 8):');
for (const c of out.parcelasFaltando.lacunaReal.top.slice(0, 8))
  console.log(` - ${c.pessoa} | ${c.produto} | linhas=${c.lancamentos} declarado=${c.declarado} faltando=[${c.faltando}] semLabel=${c.semLabel} aberto=${c.aberto}`);
