/**
 * Detalha o achado "Recompra fundida no contrato principal".
 * Compara o agrupamento real da planilha (pessoa + classificação) com o
 * agrupamento que o parser do GC produz. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-fusao-recompra.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const HOJE = new Date().toISOString().slice(0, 10);
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const soma = (arr, f) => R(arr.reduce((s, x) => s + f(x), 0));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ehRecompra = (p) => /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(p);

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
  const receb = normalizeDate(out.Recebimento, XLSX);
  const recebido = normalizeNumber(out['Valor Recebido (R$)']) ?? 0;
  const cc = normalizeString(out['Centro de Custo']);
  return {
    linha: i + 2,
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa) || 'Sem Nome',
    produto: normalizeString(out.Classificação) || 'Sem Treinamento',
    cc,
    detalhe: normalizeString(out.Detalhe),
    titulo: normalizeString(out['Título do Contrato']),
    venc: normalizeDate(out.Vencimento, XLSX),
    comp: normalizeDate(out.Competência, XLSX),
    receb,
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
  };
});

// ── Contratos verdadeiros: pessoa + classificação ─────────────────────────
const contratos = new Map();
for (const l of linhas) {
  const k = `${norm(l.pessoa)}||${norm(l.produto)}`;
  if (!contratos.has(k)) contratos.set(k, { pessoa: l.pessoa, produto: l.produto, ls: [] });
  contratos.get(k).ls.push(l);
}
const resumo = [...contratos.values()].map((c) => {
  const abertas = c.ls.filter((l) => !l.pago);
  const vencs = c.ls.map((l) => l.venc).filter(Boolean).sort();
  return {
    pessoa: c.pessoa,
    produto: c.produto,
    recompra: ehRecompra(c.produto),
    lancamentos: c.ls.length,
    contrato: soma(c.ls, (l) => l.aReceber),
    recebido: soma(c.ls, (l) => l.recebido),
    aberto: soma(abertas, (l) => l.aReceber),
    abertas: abertas.length,
    pagas: c.ls.length - abertas.length,
    primeiroVenc: vencs[0] ?? null,
    ultimoVenc: vencs[vencs.length - 1] ?? null,
    primeiroVencAberto: abertas.map((l) => l.venc).filter(Boolean).sort()[0] ?? null,
    ccs: [...new Set(c.ls.map((l) => l.cc).filter(Boolean))],
    titulos: [...new Set(c.ls.map((l) => l.titulo).filter(Boolean))],
  };
});

const porPessoa = new Map();
for (const c of resumo) {
  const k = norm(c.pessoa);
  if (!porPessoa.has(k)) porPessoa.set(k, { principais: [], recompras: [] });
  porPessoa.get(k)[c.recompra ? 'recompras' : 'principais'].push(c);
}

// ── Classificação do destino no parser ────────────────────────────────────
const recompras = resumo.filter((c) => c.recompra);
const buckets = { fundido: [], fichaPropria: [], separadoMultiploPrincipal: [] };
for (const c of recompras) {
  const p = porPessoa.get(norm(c.pessoa));
  const n = p.principais.length;
  if (n === 1) buckets.fundido.push({ ...c, principal: p.principais[0] });
  else if (n === 0) buckets.fichaPropria.push(c);
  else buckets.separadoMultiploPrincipal.push({ ...c, nPrincipais: n });
}

const stat = (arr) => ({
  contratos: arr.length,
  comSaldo: arr.filter((c) => c.aberto > 0).length,
  saldo: soma(arr.filter((c) => c.aberto > 0), (c) => c.aberto),
  contratoTotal: soma(arr, (c) => c.contrato),
  lancamentos: arr.reduce((s, c) => s + c.lancamentos, 0),
});

// ── Distorções na ficha fundida ───────────────────────────────────────────
const statusOf = (abertas, pagas, primeiroVencAberto) => {
  if (abertas === 0) return 'Pago';
  if (pagas === 0 && (!primeiroVencAberto || primeiroVencAberto >= HOJE)) return 'Aluno Novo';
  if (!primeiroVencAberto || primeiroVencAberto >= HOJE) return 'Em Dia';
  const d = Math.floor((Date.parse(HOJE) - Date.parse(primeiroVencAberto)) / 86400000);
  return d <= 30 ? 'Vencido 1' : d <= 60 ? 'Vencido 2' : 'À Negativar';
};

const fundidos = buckets.fundido.map((c) => {
  const p = c.principal;
  const abertasTot = c.abertas + p.abertas;
  const pagasTot = c.pagas + p.pagas;
  const pvaTot = [c.primeiroVencAberto, p.primeiroVencAberto].filter(Boolean).sort()[0] ?? null;
  const statusPrincipal = statusOf(p.abertas, p.pagas, p.primeiroVencAberto);
  const statusFundido = statusOf(abertasTot, pagasTot, pvaTot);
  const acCcRecompra = c.ccs.join(' ; ');
  const acCcPrincipal = p.ccs.join(' ; ');
  return {
    pessoa: c.pessoa,
    produtoPrincipal: p.produto,
    produtoRecompra: c.produto,
    // contrato como o GC passa a enxergar
    valorPrincipal: p.contrato,
    valorRecompra: c.contrato,
    valorFichaFundida: R(p.contrato + c.contrato),
    inflacaoPct: p.contrato > 0 ? R(((c.contrato / p.contrato) * 100)) : null,
    parcelasPrincipal: p.lancamentos,
    parcelasRecompra: c.lancamentos,
    parcelasFichaFundida: p.lancamentos + c.lancamentos,
    abertoPrincipal: p.aberto,
    abertoRecompra: c.aberto,
    abertoFundido: R(p.aberto + c.aberto),
    statusPrincipal,
    statusFundido,
    statusMudou: statusPrincipal !== statusFundido,
    principalQuitadoRecompraAberta: p.aberto <= 0 && c.aberto > 0,
    // datas
    primeiroVencPrincipal: p.primeiroVenc,
    primeiroVencRecompra: c.primeiroVenc,
    diaVencMuda:
      p.primeiroVenc && c.primeiroVenc && c.primeiroVenc < p.primeiroVenc
        ? `${p.primeiroVenc.slice(8, 10)} -> ${c.primeiroVenc.slice(8, 10)}`
        : null,
    // rastreabilidade
    ccIguais: acCcRecompra === acCcPrincipal,
    titulosDistintos: [...new Set([...p.titulos, ...c.titulos])].length,
  };
});

const porClassificacao = {};
for (const c of recompras) {
  const k = c.produto;
  porClassificacao[k] ??= { contratos: 0, comSaldo: 0, saldo: 0, contratoTotal: 0, lancamentos: 0 };
  const b = porClassificacao[k];
  b.contratos++;
  if (c.aberto > 0) b.comSaldo++;
  b.saldo = R(b.saldo + (c.aberto > 0 ? c.aberto : 0));
  b.contratoTotal = R(b.contratoTotal + c.contrato);
  b.lancamentos += c.lancamentos;
};

const out = {
  hoje: HOJE,
  totalRecompra: stat(recompras),
  porClassificacao,
  destinoNoParser: {
    fundidoNoPrincipal: stat(buckets.fundido),
    fichaPropriaSemPrincipal: stat(buckets.fichaPropria),
    separadoPorMultiploPrincipal: stat(buckets.separadoMultiploPrincipal),
  },
  distorcaoFichaFundida: {
    fichas: fundidos.length,
    fichasComSaldoRecompra: fundidos.filter((f) => f.abertoRecompra > 0).length,
    saldoRecompraFundido: soma(fundidos, (f) => f.abertoRecompra),
    valorContratoInflado: soma(fundidos, (f) => f.valorRecompra),
    parcelasInjetadas: fundidos.reduce((s, f) => s + f.parcelasRecompra, 0),
    statusAlterado: fundidos.filter((f) => f.statusMudou).length,
    principalQuitadoMasFichaAberta: fundidos.filter((f) => f.principalQuitadoRecompraAberta).length,
    diaVencimentoAlterado: fundidos.filter((f) => f.diaVencMuda).length,
    centroCustoDiferente: fundidos.filter((f) => !f.ccIguais).length,
    top: fundidos.sort((a, b) => b.abertoRecompra - a.abertoRecompra).slice(0, 25),
  },
};

fs.writeFileSync('scripts/kamino-fusao-recompra.json', JSON.stringify(out, null, 1));

console.log('=== CONTRATOS DE RECOMPRA/FUNDO/ANTECIPACAO NA PLANILHA ===');
console.log(
  `contratos ${out.totalRecompra.contratos} | com saldo ${out.totalRecompra.comSaldo} | ` +
    `saldo ${brl(out.totalRecompra.saldo)} | valor contratado ${brl(out.totalRecompra.contratoTotal)} | ` +
    `${out.totalRecompra.lancamentos} lancamentos`,
);
console.log('\npor classificacao:');
for (const [k, v] of Object.entries(porClassificacao).sort((a, b) => b[1].saldo - a[1].saldo))
  console.log(`  ${k}: ${v.contratos} contratos | ${v.comSaldo} com saldo | saldo ${brl(v.saldo)} | contratado ${brl(v.contratoTotal)} | ${v.lancamentos} linhas`);

console.log('\n=== O QUE O PARSER FAZ COM ELES ===');
for (const [k, v] of Object.entries(out.destinoNoParser))
  console.log(`  ${k}: ${v.contratos} contratos | ${v.comSaldo} com saldo | saldo ${brl(v.saldo)} | ${v.lancamentos} linhas`);

console.log('\n=== DISTORCAO NAS FICHAS FUNDIDAS ===');
const d = out.distorcaoFichaFundida;
console.log(`fichas afetadas: ${d.fichas} (com saldo de recompra: ${d.fichasComSaldoRecompra})`);
console.log(`saldo de recompra colado no contrato principal: ${brl(d.saldoRecompraFundido)}`);
console.log(`valor de contrato inflado: ${brl(d.valorContratoInflado)} | parcelas injetadas: ${d.parcelasInjetadas}`);
console.log(`status da ficha muda por causa da fusao: ${d.statusAlterado}`);
console.log(`principal quitado mas ficha continua aberta: ${d.principalQuitadoMasFichaAberta}`);
console.log(`dia de vencimento da ficha muda: ${d.diaVencimentoAlterado}`);
console.log(`centro de custo (AC) diferente entre os dois contratos: ${d.centroCustoDiferente}`);

console.log('\nmaiores casos:');
for (const f of d.top.slice(0, 15))
  console.log(
    `  ${f.pessoa}\n    principal: ${f.produtoPrincipal} | ${f.parcelasPrincipal}p | contrato ${brl(f.valorPrincipal)} | aberto ${brl(f.abertoPrincipal)} | ${f.statusPrincipal}` +
      `\n    recompra:  ${f.produtoRecompra} | ${f.parcelasRecompra}p | contrato ${brl(f.valorRecompra)} | aberto ${brl(f.abertoRecompra)}` +
      `\n    ficha GC:  ${f.parcelasFichaFundida}p | contrato ${brl(f.valorFichaFundida)} (+${f.inflacaoPct}%) | aberto ${brl(f.abertoFundido)} | ${f.statusFundido}`,
  );
console.log('\nrelatorio: scripts/kamino-fusao-recompra.json');
