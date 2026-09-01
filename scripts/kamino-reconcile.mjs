/**
 * Conferência Kamino x GC — SOMENTE LEITURA.
 *
 * Fase 1 (este script): lê a planilha de Recebimentos do Kamino, agrupa por
 * contrato (pessoa + classificação), separa recebidos de em aberto e gera o SQL
 * de conferência contra a tabela students.
 *
 * Uso:
 *   node scripts/kamino-reconcile.mjs "KAMINO GC (1).xlsx"
 *
 * Saídas:
 *   scripts/kamino-reconcile-report.json  — dados da planilha
 *   scripts/kamino-check-abertos.sql      — confere contratos com parcela em aberto
 *   scripts/kamino-check-nomes.sql        — acha alunos do GC ausentes na planilha
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { parseKaminoFile, normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? 'KAMINO GC (1).xlsx';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const round = (n) => Number((n ?? 0).toFixed(2));
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Forma de pagamento declarada no campo Detalhe da linha. */
function metodosDoDetalhe(detalhe) {
  const d = String(detalhe ?? '');
  const found = [];
  if (/cart[aã]o/i.test(d)) found.push('Cartão');
  if (/\bpix\b/i.test(d)) found.push('Pix');
  if (/qr_?code/i.test(d)) found.push('QrCode');
  if (/\blink\b/i.test(d)) found.push('Link');
  if (/\bboleto\b/i.test(d)) found.push('Boleto');
  return found;
}

const abs = path.resolve(XLSX_PATH);
if (!fs.existsSync(abs)) throw new Error(`Planilha não encontrada: ${abs}`);

// ── Linhas cruas (análise de formas de recebimento) ────────────────────────
const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const linhas = rawRows.map((r) => {
  const forma = normalizeString(r['Forma de Recebimento']);
  const receb = normalizeDate(r.Recebimento, XLSX);
  return {
    pessoa: normalizeString(r.Pessoa),
    produto: normalizeString(r.Classificação),
    unidade: normalizeString(r['Unidade de Negócio']),
    centroCusto: normalizeString(r['Centro de Custo']),
    forma,
    isBoletoBancario: /boleto/i.test(forma),
    metodos: metodosDoDetalhe(r.Detalhe),
    venc: normalizeDate(r.Vencimento, XLSX),
    receb,
    pago: !!receb || (normalizeNumber(r['Valor Recebido (R$)']) ?? 0) > 0,
    valorReceber: normalizeNumber(r['Valor a Receber (R$)']) ?? 0,
    valorRecebido: normalizeNumber(r['Valor Recebido (R$)']) ?? 0,
  };
});

// ── Contratos (parser oficial do projeto) ──────────────────────────────────
const kamino = parseKaminoFile(abs, []);

const contratos = kamino.map((k) => {
  const abertas = k.installments.filter((i) => !i.paid);
  const pagas = k.installments.filter((i) => i.paid);
  const doContrato = linhas.filter(
    (l) => norm(l.pessoa) === norm(k.name) && norm(l.produto) === norm(k.product),
  );
  const metodos = [...new Set(doContrato.flatMap((l) => l.metodos))];
  return {
    pessoa: k.name,
    produto: k.product,
    ac: k.ac,
    nomeNorm: norm(k.name),
    produtoNorm: norm(k.product),
    parcelas: k.installments.length,
    nAbertas: abertas.length,
    nPagas: pagas.length,
    somaAberta: round(abertas.reduce((a, i) => a + i.value, 0)),
    somaPaga: round(pagas.reduce((a, i) => a + i.value, 0)),
    contrato: round(k.saleValue),
    primeiroVencAberto: abertas.map((i) => i.dueDate).sort()[0] ?? null,
    ultimoVencAberto: abertas.map((i) => i.dueDate).sort().slice(-1)[0] ?? null,
    ultimoRecebimento: doContrato.filter((l) => l.receb).map((l) => l.receb).sort().slice(-1)[0] ?? null,
    metodos,
    formas: [...new Set(doContrato.map((l) => l.forma))],
    temBoletoBancario: doContrato.some((l) => l.isBoletoBancario),
    unidade: doContrato[0]?.unidade ?? '',
    centroCusto: doContrato[0]?.centroCusto ?? '',
  };
});

const emAberto = contratos.filter((c) => c.nAbertas > 0);
const quitados = contratos.filter((c) => c.nAbertas === 0);

// ── SQL de conferência dos contratos com parcela em aberto ─────────────────
const valuesAbertos = emAberto
  .map(
    (c) =>
      `(${sqlStr(c.nomeNorm)},${sqlStr(c.produtoNorm)},${c.parcelas},${c.nAbertas},${c.nPagas},${c.somaAberta},${c.contrato})`,
  )
  .join(',\n');

fs.writeFileSync(
  'scripts/kamino-check-abertos.sql',
  `with kam(nome, produto, parcelas, abertas, pagas, soma_aberta, contrato) as (values
${valuesAbertos}
),
gc as (
  select s.id, s.name, s.product, s.ac, s.status, s.status_mode,
         upper(translate(trim(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as nome,
         upper(translate(trim(s.product), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as produto,
         coalesce(s.sale_value,0) as sale_value, coalesce(s.down_payment,0) as down_payment,
         coalesce(jsonb_array_length(s.installments),0) as n_inst,
         (select count(*) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = false) as n_abertas,
         (select count(*) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = true) as n_pagas,
         (select coalesce(sum((i->>'value')::numeric),0) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = false) as soma_aberta
  from public.students s
  join public.companies c on c.id = s.company_id
  where c.name = 'IAM - GC'
)
select k.nome, k.produto, k.parcelas as kam_parcelas, k.abertas as kam_abertas, k.pagas as kam_pagas,
       k.soma_aberta as kam_saldo, k.contrato as kam_contrato,
       g.ac as gc_ac, g.status as gc_status, g.status_mode,
       g.n_inst as gc_parcelas, g.n_abertas as gc_abertas, g.n_pagas as gc_pagas,
       g.soma_aberta as gc_saldo, g.sale_value as gc_contrato, g.down_payment as gc_entrada,
       case
         when g.id is null then 'ausente_no_gc'
         when g.n_abertas = 0 then 'gc_quitado_indevido'
         when g.n_inst = 1 and k.parcelas > 1 then 'parcelas_colapsadas'
         when g.n_inst <> k.parcelas then 'qtd_parcelas_diferente'
         when abs(g.soma_aberta - k.soma_aberta) > 0.05 then 'saldo_aberto_diferente'
         when g.n_pagas <> k.pagas then 'qtd_pagas_diferente'
         else 'ok'
       end as problema
from kam k
left join gc g on g.nome = k.nome and g.produto = k.produto
order by problema, k.nome;
`,
);

// ── SQL para achar alunos do GC ausentes na planilha ───────────────────────
const nomesKamino = [...new Set(contratos.map((c) => c.nomeNorm))];
fs.writeFileSync(
  'scripts/kamino-check-nomes.sql',
  `with kam(nome) as (values
${nomesKamino.map((n) => `(${sqlStr(n)})`).join(',\n')}
)
select s.name, s.product, s.ac, s.status,
       (select count(*) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = false) as gc_abertas,
       (select coalesce(sum((i->>'value')::numeric),0) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = false) as gc_saldo
from public.students s
join public.companies c on c.id = s.company_id
where c.name = 'IAM - GC'
  and upper(translate(trim(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) not in (select nome from kam)
  and (select count(*) from jsonb_array_elements(s.installments) i where coalesce((i->>'paid')::boolean,false) = false) > 0
order by gc_saldo desc;
`,
);

// ── Recebidos por forma de pagamento ──────────────────────────────────────
const pagos = linhas.filter((l) => l.pago);
const porForma = {};
for (const l of pagos) {
  const chave = l.isBoletoBancario
    ? 'Boleto bancário'
    : l.metodos.find((m) => m !== 'Boleto') ?? (l.metodos.length ? l.metodos[0] : 'Não identificado');
  porForma[chave] ??= { linhas: 0, valor: 0 };
  porForma[chave].linhas++;
  porForma[chave].valor = round(porForma[chave].valor + (l.valorRecebido || l.valorReceber));
}

const classificaQuitado = (c) => {
  if (!c.temBoletoBancario && c.parcelas === 1) return 'À vista (1 lançamento, sem boleto)';
  if (!c.temBoletoBancario) return 'Cartão/Pix/Link (parcelado, sem boleto bancário)';
  return 'Boleto quitado';
};

const quitadosPorTipo = {};
for (const c of quitados) {
  const t = classificaQuitado(c);
  quitadosPorTipo[t] ??= { contratos: 0, valor: 0 };
  quitadosPorTipo[t].contratos++;
  quitadosPorTipo[t].valor = round(quitadosPorTipo[t].valor + c.contrato);
}

const report = {
  geradoEm: new Date().toISOString(),
  planilha: path.basename(abs),
  totais: {
    linhasPlanilha: linhas.length,
    pessoasDistintas: new Set(linhas.map((l) => norm(l.pessoa))).size,
    contratos: contratos.length,
    contratosComAberto: emAberto.length,
    contratosQuitados: quitados.length,
    linhasPagas: pagos.length,
    linhasAbertas: linhas.length - pagos.length,
    valorRecebido: round(pagos.reduce((a, l) => a + (l.valorRecebido || l.valorReceber), 0)),
    valorAberto: round(linhas.filter((l) => !l.pago).reduce((a, l) => a + l.valorReceber, 0)),
  },
  porFormaRecebida: porForma,
  quitadosPorTipo,
  emAberto,
  quitados: quitados.map((c) => ({ ...c, tipoPagamento: classificaQuitado(c) })),
};

fs.writeFileSync('scripts/kamino-reconcile-report.json', JSON.stringify(report, null, 1));

console.log('=== TOTAIS ===');
console.log(report.totais);
console.log('\n=== RECEBIDO POR FORMA (linhas pagas) ===');
console.log(porForma);
console.log('\n=== CONTRATOS 100% QUITADOS POR TIPO ===');
console.log(quitadosPorTipo);
console.log('\n=== UNIDADES DE NEGÓCIO ===');
console.log([...new Set(linhas.map((l) => l.unidade))]);
console.log('\n=== FORMAS DE RECEBIMENTO ===');
console.log([...new Set(linhas.map((l) => l.forma))]);
console.log('\nSQL gerado: scripts/kamino-check-abertos.sql (%d contratos), scripts/kamino-check-nomes.sql (%d nomes)', emAberto.length, nomesKamino.length);
