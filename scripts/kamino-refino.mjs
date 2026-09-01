/**
 * Refina a auditoria Kamino separando ruído contábil de erro real.
 * Uso: node scripts/kamino-refino.mjs
 */
import fs from 'node:fs';

const a = JSON.parse(fs.readFileSync('scripts/kamino-auditoria.json', 'utf8'));
const round = (n) => Number((n ?? 0).toFixed(2));
const soma = (arr, f) => round(arr.reduce((s, x) => s + f(x), 0));

// 1. Pagamento parcial: separa taxa bancária (diferença pequena) de parcial real
const parciais = a.problemas.valorRecebidoParcial.map((l) => ({
  ...l,
  falta: round(l.aReceber - l.recebido),
  pct: round(((l.aReceber - l.recebido) / l.aReceber) * 100),
}));
const parcialReal = parciais.filter((l) => l.falta > 50 && l.pct > 5);
const taxaBancaria = parciais.filter((l) => !(l.falta > 50 && l.pct > 5));

// 2. Parcelas faltando: só importa em contrato que ainda tem saldo aberto
const faltandoComSaldo = a.problemas.parcelasFaltando.filter((c) => c.somaAberta > 0);
const faltandoQuitado = a.problemas.parcelasFaltando.filter((c) => c.somaAberta <= 0);

// 3. Duplicidade exata: aberta pesa mais que paga
const dupAbertas = a.problemas.duplicidadeExata.filter((d) => !d.atual.pago);
const dupPagas = a.problemas.duplicidadeExata.filter((d) => d.atual.pago);

// 4. Centavos residuais (parcelas de R$ 0,01/0,02 que viram parcela no GC)
const cent = a.problemas.centavosResiduais;
const centAbertos = cent.filter((l) => !l.pago);

// 5. Negativação
const negContratos = a.contratosResumo.filter((c) => c.negativacao);
const negComSaldo = negContratos.filter((c) => c.somaAberta > 0);

// 6. Recompra: o parser do GC funde essas linhas no contrato principal do aluno
const recompra = a.contratosResumo.filter((c) => /recompra|antecipa|fundo/i.test(c.produto));
const recompraComSaldo = recompra.filter((c) => c.somaAberta > 0);

// 7. Contratos abandonados: têm saldo aberto e nada recebido há muito tempo
const hoje = Date.parse(a.hoje);
const dias = (d) => (d ? Math.floor((hoje - Date.parse(d)) / 86400000) : null);
const abandonados = a.contratosResumo
  .filter((c) => c.somaAberta > 0)
  .map((c) => ({ ...c, diasSemReceber: dias(c.ultimoRecebimento), atrasoMax: dias(c.primeiroVencAberto) }))
  .filter((c) => c.atrasoMax != null && c.atrasoMax > 90)
  .sort((x, y) => y.somaAberta - x.somaAberta);

// 8. Contratos totalmente inadimplentes (nada pago e tudo vencido)
const nuncaPagou = a.contratosResumo
  .filter((c) => c.pagas === 0 && c.somaAberta > 0)
  .sort((x, y) => y.somaAberta - x.somaAberta);

// 9. Multi-contrato: mesma pessoa com vários produtos em aberto
const porPessoa = {};
for (const c of a.contratosResumo) {
  if (c.somaAberta <= 0) continue;
  const p = c.pessoa;
  porPessoa[p] ??= { contratos: 0, saldo: 0, produtos: [] };
  porPessoa[p].contratos++;
  porPessoa[p].saldo = round(porPessoa[p].saldo + c.somaAberta);
  porPessoa[p].produtos.push(c.produto);
}
const multiContrato = Object.entries(porPessoa)
  .filter(([, v]) => v.contratos > 1)
  .sort((x, y) => y[1].saldo - x[1].saldo);

// 10. Quitados por forma — listas para conferência
const quitados = a.quitados;
const quitAvista = quitados.filter((c) => c.tipoPagamento === 'À vista');
const quitCartao = quitados.filter((c) => c.tipoPagamento === 'Cartão/Pix/Link parcelado');
const quitBoleto = quitados.filter((c) => c.tipoPagamento === 'Boleto quitado');

const metodoPrincipal = (c) => {
  if (c.metodos.includes('Cartão')) return 'Cartão';
  if (c.metodos.includes('Pix')) return 'Pix';
  if (c.metodos.includes('QrCode')) return 'QrCode (Pix)';
  if (c.metodos.includes('Link')) return 'Link';
  if (c.metodos.includes('Boleto')) return 'Boleto';
  return 'Não identificado';
};
const quitPorMetodo = {};
for (const c of quitados) {
  const m = metodoPrincipal(c);
  quitPorMetodo[m] ??= { contratos: 0, valor: 0 };
  quitPorMetodo[m].contratos++;
  quitPorMetodo[m].valor = round(quitPorMetodo[m].valor + c.contrato);
}

const out = {
  parcial: {
    realCount: parcialReal.length,
    realValorFaltante: soma(parcialReal, (l) => l.falta),
    taxaCount: taxaBancaria.length,
    taxaValorTotal: soma(taxaBancaria, (l) => l.falta),
    topReal: parcialReal.sort((x, y) => y.falta - x.falta).slice(0, 15)
      .map((l) => ({ pessoa: l.pessoa, produto: l.produto, venc: l.venc, aReceber: l.aReceber, recebido: round(l.recebido), falta: l.falta })),
  },
  parcelasFaltando: {
    comSaldoAberto: faltandoComSaldo.length,
    jaQuitados: faltandoQuitado.length,
    saldoEnvolvido: soma(faltandoComSaldo, (c) => c.somaAberta),
    top: faltandoComSaldo.sort((x, y) => y.somaAberta - x.somaAberta).slice(0, 15)
      .map((c) => ({ pessoa: c.pessoa, produto: c.produto, lancamentos: c.lancamentos, declarado: c.parcelaTotalDeclarado, faltando: c.parcelasFaltando, aberto: c.somaAberta, ac: c.ac })),
  },
  duplicidade: {
    total: a.problemas.duplicidadeExata.length,
    abertas: dupAbertas.length,
    pagas: dupPagas.length,
    valorAbertas: soma(dupAbertas, (d) => d.atual.aReceber),
    top: dupAbertas.slice(0, 12).map((d) => ({ pessoa: d.atual.pessoa, produto: d.atual.produto, venc: d.atual.venc, valor: d.atual.aReceber })),
  },
  centavos: {
    total: cent.length,
    abertos: centAbertos.length,
    amostra: cent.slice(0, 10).map((l) => ({ pessoa: l.pessoa, produto: l.produto, venc: l.venc, valor: l.aReceber, pago: l.pago })),
  },
  labelDuplicado: {
    total: a.problemas.labelDuplicado.length,
    amostra: a.problemas.labelDuplicado.slice(0, 10).map((l) => ({ pessoa: l.pessoa, produto: l.produto, labels: l.labels, venc: l.venc, pago: l.pago })),
  },
  negativacao: {
    contratos: negContratos.length,
    comSaldo: negComSaldo.length,
    saldo: soma(negComSaldo, (c) => c.somaAberta),
    top: negComSaldo.sort((x, y) => y.somaAberta - x.somaAberta).slice(0, 15)
      .map((c) => ({ pessoa: c.pessoa, produto: c.produto, aberto: c.somaAberta, abertas: c.abertas, ac: c.ac })),
  },
  recompra: {
    contratos: recompra.length,
    comSaldo: recompraComSaldo.length,
    saldo: soma(recompraComSaldo, (c) => c.somaAberta),
    top: recompraComSaldo.sort((x, y) => y.somaAberta - x.somaAberta).slice(0, 12)
      .map((c) => ({ pessoa: c.pessoa, produto: c.produto, aberto: c.somaAberta, lancamentos: c.lancamentos })),
  },
  abandonados: {
    total: abandonados.length,
    saldo: soma(abandonados, (c) => c.somaAberta),
    top: abandonados.slice(0, 20).map((c) => ({ pessoa: c.pessoa, produto: c.produto, aberto: c.somaAberta, abertas: c.abertas, atrasoDias: c.atrasoMax, ultimoRecebimento: c.ultimoRecebimento, ac: c.ac, negativacao: c.negativacao })),
  },
  nuncaPagou: {
    total: nuncaPagou.length,
    saldo: soma(nuncaPagou, (c) => c.somaAberta),
    top: nuncaPagou.slice(0, 20).map((c) => ({ pessoa: c.pessoa, produto: c.produto, aberto: c.somaAberta, lancamentos: c.lancamentos, primeiroVenc: c.primeiroVencAberto, ac: c.ac })),
  },
  multiContrato: {
    pessoas: multiContrato.length,
    saldo: soma(multiContrato.map(([, v]) => v), (v) => v.saldo),
    top: multiContrato.slice(0, 15).map(([p, v]) => ({ pessoa: p, contratos: v.contratos, produtos: v.produtos, saldo: v.saldo })),
  },
  quitados: {
    total: quitados.length,
    avista: { contratos: quitAvista.length, valor: soma(quitAvista, (c) => c.contrato) },
    cartaoPixLink: { contratos: quitCartao.length, valor: soma(quitCartao, (c) => c.contrato) },
    boleto: { contratos: quitBoleto.length, valor: soma(quitBoleto, (c) => c.contrato) },
    porMetodo: quitPorMetodo,
    topAvista: quitAvista.sort((x, y) => y.contrato - x.contrato).slice(0, 15)
      .map((c) => ({ pessoa: c.pessoa, produto: c.produto, valor: c.contrato, metodos: c.metodos, ac: c.ac, recebimento: c.ultimoRecebimento })),
    topCartao: quitCartao.sort((x, y) => y.contrato - x.contrato).slice(0, 15)
      .map((c) => ({ pessoa: c.pessoa, produto: c.produto, valor: c.contrato, parcelas: c.lancamentos, metodos: c.metodos, ac: c.ac })),
  },
};

fs.writeFileSync('scripts/kamino-refino.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
