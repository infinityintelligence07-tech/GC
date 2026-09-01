/**
 * Mostra, linha a linha, o que a fusão de Recompra faz com fichas específicas.
 * Reproduz o cronograma que scripts/lib/kamino-parse.mjs entrega ao GC.
 * SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-fusao-exemplos.mjs ["Nome do aluno" ...]
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const HOJE = new Date().toISOString().slice(0, 10);
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ehRecompra = (p) => /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(p);

const ALVOS = process.argv.slice(2).filter((a) => !a.endsWith('.mjs'));
const PADRAO = [
  'Willian Andre da Silva Vieira',
  'Heraldo Raimundo de Lima',
  'Ana Cassia do Nascimento Barros',
  'Nilmara Lima Rezende Soares',
];
const alvos = (ALVOS.length ? ALVOS : PADRAO).map(norm);

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
  const detalhe = normalizeString(out.Detalhe);
  return {
    excel: i + 2,
    id: normalizeString(out['0']),
    pessoa: normalizeString(out.Pessoa),
    produto: normalizeString(out.Classificação),
    cc: normalizeString(out['Centro de Custo']),
    label: (detalhe.match(/\((\d+)\/(\d+)\)/) ?? [null])[0],
    detalhe,
    venc: normalizeDate(out.Vencimento, XLSX),
    comp: normalizeDate(out.Competência, XLSX),
    receb,
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    recebido,
    pago: !!receb || recebido > 0,
  };
});

const statusOf = (inst) => {
  const abertas = inst.filter((i) => !i.pago);
  const pagas = inst.length - abertas.length;
  if (abertas.length === 0) return 'Pago';
  const venc = abertas.map((i) => i.venc).filter(Boolean).sort();
  const atrasadas = venc.filter((v) => v < HOJE);
  if (pagas === 0 && atrasadas.length === 0 && inst.length > 1) return 'Aluno Novo';
  if (atrasadas.length === 0) return 'Em Dia';
  const d = Math.floor((Date.parse(HOJE) - Date.parse(atrasadas[0])) / 86400000);
  return d <= 30 ? 'Vencido 1' : d <= 60 ? 'Vencido 2' : 'À Negativar';
};

const bloco = (ls) => {
  const abertas = ls.filter((l) => !l.pago);
  return {
    n: ls.length,
    contrato: R(ls.reduce((s, l) => s + l.aReceber, 0)),
    aberto: R(abertas.reduce((s, l) => s + l.aReceber, 0)),
    abertas: abertas.length,
    status: statusOf(ls),
    vencs: ls.map((l) => l.venc).filter(Boolean).sort(),
    ccs: [...new Set(ls.map((l) => l.cc).filter(Boolean))],
    comps: ls.map((l) => l.comp).filter(Boolean).sort(),
  };
};

for (const alvo of alvos) {
  const doAluno = linhas.filter((l) => norm(l.pessoa).includes(alvo));
  if (doAluno.length === 0) {
    console.log(`\n### ${alvo}: não encontrado na planilha`);
    continue;
  }
  const nome = doAluno[0].pessoa;
  const principais = doAluno.filter((l) => !ehRecompra(l.produto));
  const recompra = doAluno.filter((l) => ehRecompra(l.produto));
  const produtoPrincipal = [...new Set(principais.map((l) => l.produto))];

  const p = bloco(principais);
  const r = bloco(recompra);
  const f = bloco([...principais, ...recompra]);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${nome}`);
  console.log(`${'='.repeat(78)}`);
  console.log(`PLANILHA — 2 contratos distintos:`);
  console.log(
    `  [A] ${produtoPrincipal.join(' + ')}: ${p.n} parcelas | contrato ${brl(p.contrato)} | ` +
      `aberto ${brl(p.aberto)} (${p.abertas}) | status real ${p.status} | 1o venc ${p.vencs[0]} | competencia ${p.comps[0]}`,
  );
  console.log(`      centro de custo: ${p.ccs.join(' ;; ') || '-'}`);
  console.log(
    `  [B] ${[...new Set(recompra.map((l) => l.produto))].join(' + ')}: ${r.n} parcelas | contrato ${brl(r.contrato)} | ` +
      `aberto ${brl(r.aberto)} (${r.abertas}) | status real ${r.status} | 1o venc ${r.vencs[0]} | competencia ${r.comps[0]}`,
  );
  console.log(`      centro de custo: ${r.ccs.join(' ;; ') || '-'}`);
  console.log(
    `\nFICHA UNICA NO GC (produto "${produtoPrincipal[0]}"): ${f.n} parcelas | contrato ${brl(f.contrato)} ` +
      `(+${p.contrato > 0 ? R((r.contrato / p.contrato) * 100) : '?'}%) | aberto ${brl(f.aberto)} | status ${f.status} | ` +
      `dia venc ${f.vencs[0]?.slice(8, 10)} (era ${p.vencs[0]?.slice(8, 10)}) | matricula ${f.comps[0]} (era ${p.comps[0]})`,
  );

  const ordenado = [...principais, ...recompra].sort((a, b) =>
    (a.venc ?? '9999-12-31').localeCompare(b.venc ?? '9999-12-31'),
  );
  console.log(`\ncronograma que o GC monta (numero da parcela renumerado 1..N):`);
  console.log(
    `  GC#  origem     venc         valor        situacao   rotulo Kamino  id      linha`,
  );
  ordenado.forEach((l, i) => {
    const origem = ehRecompra(l.produto) ? 'RECOMPRA' : 'principal';
    console.log(
      `  ${String(i + 1).padStart(3)}  ${origem.padEnd(9)}  ${l.venc ?? '     -    '}  ` +
        `${brl(l.aReceber).padStart(10)}  ${(l.pago ? 'paga' : 'ABERTA').padEnd(9)}  ${(l.label ?? '-').padEnd(13)}  ` +
        `${l.id.padEnd(6)}  ${l.excel}`,
    );
  });
}
