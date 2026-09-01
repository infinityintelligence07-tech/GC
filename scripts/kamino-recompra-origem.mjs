/**
 * Testa se o código de turma no campo Detalhe permite vincular cada linha de
 * Recompra ao treinamento de origem do aluno. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-recompra-origem.mjs
 */
import fs from 'node:fs';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const ehRecompra = (p) => /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(p);

// Códigos de turma: Conf_Am_45, Mg_Am_11, Ipr_Bc_203, Mp_Am_09, Pmr_Am_23...
const CODIGO = /\b([A-Za-z]{2,4})_([A-Za-z]{2,4})_(\d{1,4})\b/g;
const codigos = (detalhe) => {
  const out = [];
  for (const m of detalhe.matchAll(CODIGO)) out.push({ full: m[0], prefixo: m[1].toUpperCase() });
  return out;
};

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
  const detalhe = normalizeString(out.Detalhe);
  return {
    pessoa: normalizeString(out.Pessoa) || 'Sem Nome',
    produto: normalizeString(out.Classificação) || 'Sem Treinamento',
    detalhe,
    codigos: codigos(detalhe),
    renegociacao: /renegoci/i.test(detalhe),
    venc: normalizeDate(out.Vencimento, XLSX),
    aReceber: normalizeNumber(out['Valor a Receber (R$)']) ?? 0,
    pago: !!receb || recebido > 0,
  };
});

// ── Prefixo de codigo -> produto, aprendido nas linhas NAO recompra ────────
const aprendizado = new Map();
for (const l of linhas) {
  if (ehRecompra(l.produto)) continue;
  for (const c of l.codigos) {
    if (!aprendizado.has(c.prefixo)) aprendizado.set(c.prefixo, new Map());
    const m = aprendizado.get(c.prefixo);
    m.set(l.produto, (m.get(l.produto) ?? 0) + 1);
  }
}
console.log('=== PREFIXO DE TURMA -> TREINAMENTO (aprendido nas linhas de treinamento) ===');
const mapaPrefixo = new Map();
for (const [pref, m] of [...aprendizado.entries()].sort()) {
  const ordenado = [...m.entries()].sort((a, b) => b[1] - a[1]);
  mapaPrefixo.set(pref, ordenado[0][0]);
  console.log(
    `  ${pref.padEnd(5)} -> ${ordenado[0][0].padEnd(22)} (${ordenado[0][1]}x)` +
      (ordenado.length > 1 ? ` | outros: ${ordenado.slice(1, 4).map(([p, n]) => `${p} ${n}x`).join(', ')}` : ''),
  );
}

// ── Cobertura: a linha de recompra tem codigo? bate com treinamento do aluno? ──
const porPessoa = new Map();
for (const l of linhas) {
  const k = norm(l.pessoa);
  if (!porPessoa.has(k)) porPessoa.set(k, []);
  porPessoa.get(k).push(l);
}

const res = {
  semCodigo: [],
  codigoSemMapa: [],
  bateComTreinamentoDoAluno: [],
  codigoDeTreinamentoAusente: [],
};
const contratos = new Map();
for (const [, ls] of porPessoa) {
  const rec = ls.filter((l) => ehRecompra(l.produto));
  if (rec.length === 0) continue;
  const produtosDoAluno = new Set(ls.filter((l) => !ehRecompra(l.produto)).map((l) => l.produto));
  const k = norm(ls[0].pessoa);
  const alvos = new Map();
  let semCodigo = 0;
  for (const l of rec) {
    const prefs = [...new Set(l.codigos.map((c) => c.prefixo))];
    if (prefs.length === 0) {
      semCodigo++;
      res.semCodigo.push(l);
      continue;
    }
    for (const p of prefs) {
      const produto = mapaPrefixo.get(p);
      if (!produto) {
        res.codigoSemMapa.push({ ...l, prefixo: p });
        continue;
      }
      alvos.set(produto, (alvos.get(produto) ?? 0) + 1);
      if (produtosDoAluno.has(produto)) res.bateComTreinamentoDoAluno.push(l);
      else res.codigoDeTreinamentoAusente.push({ pessoa: l.pessoa, produto, prefixo: p });
    }
  }
  const abertoRec = R(rec.filter((l) => !l.pago).reduce((s, x) => s + x.aReceber, 0));
  contratos.set(k, {
    pessoa: ls[0].pessoa,
    treinamentos: [...produtosDoAluno],
    nTreinamentos: produtosDoAluno.size,
    recompraLinhas: rec.length,
    semCodigo,
    alvosSugeridos: [...alvos.entries()].sort((a, b) => b[1] - a[1]),
    abertoRec,
    renegociacao: rec.some((l) => l.renegociacao),
  });
}

const lista = [...contratos.values()];
const multi = lista.filter((c) => c.nTreinamentos >= 2);
const resolvivel = multi.filter((c) => {
  const dentro = c.alvosSugeridos.filter(([p]) => c.treinamentos.includes(p));
  return dentro.length === 1;
});
const ambiguo = multi.filter((c) => {
  const dentro = c.alvosSugeridos.filter(([p]) => c.treinamentos.includes(p));
  return dentro.length > 1;
});
const semPista = multi.filter((c) => c.alvosSugeridos.filter(([p]) => c.treinamentos.includes(p)).length === 0);

console.log('\n=== COBERTURA DO CODIGO NAS LINHAS DE RECOMPRA ===');
const totalRec = linhas.filter((l) => ehRecompra(l.produto)).length;
console.log(`linhas de recompra: ${totalRec}`);
console.log(`  sem nenhum codigo de turma: ${res.semCodigo.length}`);
console.log(`  com codigo que bate com um treinamento do proprio aluno: ${res.bateComTreinamentoDoAluno.length}`);
console.log(`  com codigo de treinamento que o aluno nao tem na planilha: ${res.codigoDeTreinamentoAusente.length}`);
console.log(`  com codigo de prefixo desconhecido: ${res.codigoSemMapa.length}`);

console.log('\n=== ALUNOS COM 2+ TREINAMENTOS (hoje viram ficha de Recompra orfa) ===');
console.log(`total: ${multi.length} | saldo ${brl(multi.reduce((s, c) => s + c.abertoRec, 0))}`);
console.log(`  origem deduzivel por codigo (1 alvo): ${resolvivel.length} | saldo ${brl(resolvivel.reduce((s, c) => s + c.abertoRec, 0))}`);
console.log(`  ambiguo (2+ alvos): ${ambiguo.length} | saldo ${brl(ambiguo.reduce((s, c) => s + c.abertoRec, 0))}`);
console.log(`  sem pista: ${semPista.length} | saldo ${brl(semPista.reduce((s, c) => s + c.abertoRec, 0))}`);

console.log('\nexemplos deduziveis:');
for (const c of resolvivel.sort((a, b) => b.abertoRec - a.abertoRec).slice(0, 10))
  console.log(
    `  ${c.pessoa} | treinamentos: ${c.treinamentos.join(' + ')} | codigo aponta: ` +
      `${c.alvosSugeridos.filter(([p]) => c.treinamentos.includes(p)).map(([p, n]) => `${p} (${n}x)`).join(', ')} | aberto ${brl(c.abertoRec)}`,
  );

console.log('\nexemplos ambiguos:');
for (const c of ambiguo.sort((a, b) => b.abertoRec - a.abertoRec).slice(0, 8))
  console.log(
    `  ${c.pessoa} | treinamentos: ${c.treinamentos.join(' + ')} | codigos apontam: ` +
      `${c.alvosSugeridos.map(([p, n]) => `${p} (${n}x)`).join(', ')} | aberto ${brl(c.abertoRec)}`,
  );

fs.writeFileSync(
  'scripts/kamino-recompra-origem.json',
  JSON.stringify({ mapaPrefixo: Object.fromEntries(mapaPrefixo), multi, resolvivel, ambiguo, semPista }, null, 1),
);
console.log('\nrelatorio: scripts/kamino-recompra-origem.json');
