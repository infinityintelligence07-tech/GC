/**
 * SOMENTE LEITURA: decompõe o card "A Vencer / Vencido" do Dashboard (IAM - GC)
 * nas parcelas que o compõem, separando:
 *
 *   Kamino          — carteira normal, deveria casar com o extrato do Kamino
 *   Cancelamento    — alunos no funil de cancelamento (o Kamino já não cobra)
 *   IAM Control     — contratos vindos do IAM Control já aprovados no GC
 *
 * Replica a regra do card em src/pages/DashboardPage.tsx (forecastBase +
 * getForecastTotals com forecastIndex=0, dateBasis='vencimento', sem filtros)
 * e confronta o bloco Kamino com o extrato KAMINO GC (1).xlsx.
 *
 * Uso: node scripts/gc-card-composicao.mjs
 */
import fs from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

XLSX.set_fs(fs);

const SAIDA = 'KAMINO_GC_Card_Composicao.xlsx';
const XLSX_PATH = 'KAMINO GC (1).xlsx';
const IAM_COMPANY_NAME = 'IAM - GC';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('sem conexão com o banco');
}

const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// ─────────── regras do app (espelhadas de src/lib/*) ───────────

const FUNIL_CANCELAMENTO_ATIVO = new Set([
  'solicitado', 'em_tratamento', 'juridico', 'aguardando_conciliacao', 'pagamento_multa_pendente',
]);
const IAM_STATUSES_REQUIRING_GC_APPROVAL = new Set([
  'CONCILIADO', 'PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR',
]);

const normIamStatus = (s) => String(s ?? '').toUpperCase().trim().replace(/\s+/g, '_');
const isIamControlStudent = (s) => s.iam_control_aluno_id != null && Number.isFinite(Number(s.iam_control_aluno_id));

function isIamConciliadoQuitadoAvista(s) {
  if (!isIamControlStudent(s)) return false;
  if (normIamStatus(s.iam_control_contrato_status) !== 'CONCILIADO') return false;
  const sale = Number(s.sale_value ?? 0);
  const down = Number(s.down_payment ?? 0);
  const totalInst = Number(s.total_installments ?? 0);
  const paidInst = Number(s.paid_installments ?? 0);
  if (totalInst === 0 && down >= sale - 0.01) return true;
  if (totalInst > 0 && paidInst >= totalInst) return true;
  const inst = s.installments ?? [];
  if (inst.length > 0 && inst.every((i) => i.paid)) return true;
  return false;
}

function countsInFinancialTotals(s) {
  if (isIamControlStudent(s)) {
    return Boolean(s.iam_gc_conciliado_at) || isIamConciliadoQuitadoAvista(s);
  }
  return true; // Kamino: kamino_synced_at não existe no schema live → ramo legado
}

const isStudentCancelado = (s) => s.status === 'Cancelado' || s.status_cancelamento === 'cancelado';
const isRendaExtraAtivo = (s) => !!s.is_renda_extra && !isStudentCancelado(s);
const isSolicitacaoCancelamento = (s) =>
  (s.status_cancelamento && FUNIL_CANCELAMENTO_ATIVO.has(s.status_cancelamento)) ||
  s.status === 'Solicitação Cancelamento';

// ─────────── extrato Kamino ───────────

const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const kaminoAbertoPorContrato = new Map();
let kaminoAbertoTotal = 0;
let kaminoLinhasAbertas = 0;
const kaminoNomes = new Set();
for (const r of rawRows) {
  const pessoa = normalizeString(r.Pessoa);
  const produto = normalizeString(r.Classificação);
  kaminoNomes.add(norm(pessoa));
  const receb = normalizeDate(r.Recebimento, XLSX);
  const recebido = normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  const pago = !!receb || recebido > 0;
  if (pago) continue;
  const valor = normalizeNumber(r['Valor a Receber (R$)']) ?? 0;
  kaminoLinhasAbertas++;
  kaminoAbertoTotal = R(kaminoAbertoTotal + valor);
  const k = `${norm(pessoa)}|${norm(produto)}`;
  kaminoAbertoPorContrato.set(k, R((kaminoAbertoPorContrato.get(k) ?? 0) + valor));
}

// ─────────── carteira GC ───────────

const client = await conectar();
const { rows: alunos } = await client.query(
  `SELECT s.* FROM public.students s
     JOIN public.companies c ON c.id = s.company_id
    WHERE c.name = $1`,
  [IAM_COMPANY_NAME],
);
await client.end();

// Baixas feitas no GC depois do corte do extrato (recebimento mais recente da
// planilha). O extrato ainda mostra essas parcelas em aberto, então elas são a
// causa esperada de o GC ficar abaixo do Kamino.
const CORTE_EXTRATO = '2026-08-21';
const pagoAposCortePorContrato = new Map();
for (const s of alunos) {
  let v = 0;
  for (const i of s.installments ?? []) {
    if (!i.paid) continue;
    const marcado = i.paidMarkedAt ? String(i.paidMarkedAt).slice(0, 10) : null;
    const pagoEm = i.paidDate ? String(i.paidDate).slice(0, 10) : null;
    if ((marcado ?? pagoEm ?? '') < CORTE_EXTRATO) continue;
    v += Number(i.value ?? 0);
  }
  if (v <= 0.005) continue;
  const k = `${norm(s.name)}|${norm(s.product)}`;
  pagoAposCortePorContrato.set(k, R((pagoAposCortePorContrato.get(k) ?? 0) + v));
}

const forecastBase = alunos.filter(
  (s) =>
    s.status_cancelamento !== 'cancelado' &&
    countsInFinancialTotals(s) &&
    !(isRendaExtraAtivo(s) && s.renda_extra_status && s.renda_extra_status !== 'Conciliar Exclusão'),
);

const BUCKETS = ['Cancelamento', 'IAM Control', 'Kamino'];
const resumo = Object.fromEntries(BUCKETS.map((b) => [b, { valor: 0, parcelas: 0, alunos: 0 }]));
const linhas = [];
let cardTotal = 0;
let cardParcelas = 0;
const cardAlunos = new Set();

for (const s of forecastBase) {
  if (isIamConciliadoQuitadoAvista(s)) continue;
  const abertas = (s.installments ?? []).filter((i) => !i.paid);
  const aberto = R(abertas.reduce((a, i) => a + Number(i.value ?? 0), 0));
  if (aberto <= 0.005) continue;

  // Prioridade: cancelamento em funil > IAM Control > Kamino
  const bucket = isSolicitacaoCancelamento(s)
    ? 'Cancelamento'
    : isIamControlStudent(s)
      ? 'IAM Control'
      : 'Kamino';

  cardTotal = R(cardTotal + aberto);
  cardParcelas += abertas.length;
  cardAlunos.add(s.id);
  resumo[bucket].valor = R(resumo[bucket].valor + aberto);
  resumo[bucket].parcelas += abertas.length;
  resumo[bucket].alunos += 1;

  const chave = `${norm(s.name)}|${norm(s.product)}`;
  const noKamino = kaminoAbertoPorContrato.has(chave);

  linhas.push({
    bucket,
    aluno: s.name,
    produto: s.product,
    ac: s.ac,
    status: s.status,
    status_cancelamento: s.status_cancelamento,
    iam_status: s.iam_control_contrato_status ?? '',
    iam_aprovado_gc: s.iam_gc_conciliado_at ? 'SIM' : 'NAO',
    parcelas_abertas: abertas.length,
    valor_no_card: aberto,
    kamino_tem_contrato: noKamino ? 'SIM' : 'NAO',
    kamino_nome_existe: kaminoNomes.has(norm(s.name)) ? 'SIM' : 'NAO',
    kamino_aberto: noKamino ? kaminoAbertoPorContrato.get(chave) : 0,
    diferenca_vs_kamino: R(aberto - (noKamino ? kaminoAbertoPorContrato.get(chave) : 0)),
    ficha_id: s.id,
  });
}

// Contratos que o Kamino tem em aberto mas não aparecem no card
const chavesCard = new Set(linhas.map((l) => `${norm(l.aluno)}|${norm(l.produto)}`));
const soNoKamino = [];
for (const [k, v] of kaminoAbertoPorContrato) {
  if (chavesCard.has(k)) continue;
  const [nome, produto] = k.split('|');
  soNoKamino.push({ aluno: nome, produto, kamino_aberto: v });
}
soNoKamino.sort((a, b) => b.kamino_aberto - a.kamino_aberto);

const bucketKamino = resumo['Kamino'].valor;
const delta = R(bucketKamino - kaminoAbertoTotal);

// ─────────── saída ───────────

console.log('=== CARD "A VENCER / VENCIDO" — IAM - GC ===');
console.log(`total do card: R$ ${brl(cardTotal)} | ${cardParcelas} parcelas | ${cardAlunos.size} alunos`);
console.log(`fichas avaliadas na empresa: ${alunos.length} | dentro da regra do card: ${forecastBase.length}`);

console.log('\n=== COMPOSIÇÃO ===');
for (const b of BUCKETS) {
  const r = resumo[b];
  const pct = cardTotal > 0 ? ((r.valor / cardTotal) * 100).toFixed(1) : '0.0';
  console.log(`${b.padEnd(14)} R$ ${brl(r.valor).padStart(14)} | ${pct.padStart(5)}% | ${r.alunos} alunos | ${r.parcelas} parcelas`);
}
console.log(`${'TOTAL'.padEnd(14)} R$ ${brl(cardTotal).padStart(14)}`);

console.log('\n=== CONFRONTO DO BLOCO KAMINO COM O EXTRATO ===');
console.log(`extrato Kamino em aberto:  R$ ${brl(kaminoAbertoTotal)} (${kaminoLinhasAbertas} lançamentos)`);
console.log(`bloco Kamino no card GC:   R$ ${brl(bucketKamino)}`);
console.log(`diferença (GC − Kamino):   R$ ${brl(delta)}`);

// ─────────── conciliação contrato a contrato: card inteiro vs extrato inteiro ───────────
// O extrato do Kamino também cobra alunos que no GC estão no funil de cancelamento
// ou vieram do IAM Control, então a comparação só fecha somando o card todo.
const cardPorContrato = new Map();
for (const l of linhas) {
  const k = `${norm(l.aluno)}|${norm(l.produto)}`;
  const cur = cardPorContrato.get(k) ?? { valor: 0, bucket: l.bucket, fichas: 0, aluno: l.aluno, produto: l.produto, status: l.status };
  cur.valor = R(cur.valor + l.valor_no_card);
  cur.fichas += 1;
  cardPorContrato.set(k, cur);
}

// Quanto do extrato Kamino cai em cada bloco do card
const kaminoPorBucket = { Cancelamento: 0, 'IAM Control': 0, Kamino: 0, 'Sem ficha no card': 0 };
for (const [k, v] of kaminoAbertoPorContrato) {
  const noCard = cardPorContrato.get(k);
  kaminoPorBucket[noCard ? noCard.bucket : 'Sem ficha no card'] = R(
    kaminoPorBucket[noCard ? noCard.bucket : 'Sem ficha no card'] + v,
  );
}

console.log('\n=== O EXTRATO KAMINO DISTRIBUÍDO NOS BLOCOS DO CARD ===');
for (const [b, v] of Object.entries(kaminoPorBucket)) {
  console.log(`${b.padEnd(20)} R$ ${brl(v).padStart(14)}`);
}
console.log(`${'TOTAL'.padEnd(20)} R$ ${brl(kaminoAbertoTotal).padStart(14)}`);

const conc = [];
const chavesTodas = new Set([...cardPorContrato.keys(), ...kaminoAbertoPorContrato.keys()]);
for (const k of chavesTodas) {
  const g = cardPorContrato.get(k);
  const kam = kaminoAbertoPorContrato.get(k) ?? 0;
  const gcVal = g?.valor ?? 0;
  const [nomeK, prodK] = k.split('|');
  conc.push({
    aluno: g?.aluno ?? nomeK,
    produto: g?.produto ?? prodK,
    bucket: g?.bucket ?? '(fora do card)',
    status: g?.status ?? '',
    fichas_no_gc: g?.fichas ?? 0,
    card_gc: gcVal,
    kamino_aberto: R(kam),
    diferenca: R(gcVal - kam),
    baixado_no_gc_apos_corte: pagoAposCortePorContrato.get(k) ?? 0,
    situacao: !g ? 'só no Kamino' : kam === 0 ? 'só no GC' : Math.abs(gcVal - kam) < 0.005 ? 'igual' : gcVal > kam ? 'GC maior' : 'GC menor',
  });
}

const porSituacao = new Map();
for (const c of conc) {
  const cur = porSituacao.get(c.situacao) ?? { contratos: 0, efeito: 0, baixasPosCorte: 0 };
  cur.contratos += 1;
  cur.efeito = R(cur.efeito + c.diferenca);
  cur.baixasPosCorte = R(cur.baixasPosCorte + c.baixado_no_gc_apos_corte);
  porSituacao.set(c.situacao, cur);
}

console.log('\n=== DE ONDE VEM A DIFERENÇA DE R$ ' + brl(R(cardTotal - kaminoAbertoTotal)) + ' (card inteiro vs extrato) ===');
const gap = [...porSituacao.entries()]
  .map(([situacao, v]) => ({
    situacao, contratos: v.contratos, efeito: v.efeito, baixas_gc_pos_corte: v.baixasPosCorte,
  }))
  .sort((a, b) => a.efeito - b.efeito);
for (const g of gap) {
  console.log(
    `${String(g.contratos).padStart(4)} contratos | ${g.efeito >= 0 ? '+' : ''}R$ ${brl(g.efeito).padStart(13)} | ` +
      `baixas pós-${CORTE_EXTRATO}: R$ ${brl(g.baixas_gc_pos_corte).padStart(12)} | ${g.situacao}`,
  );
}
console.log(`     conferência: soma dos efeitos = R$ ${brl(R(gap.reduce((a, g) => a + g.efeito, 0)))}`);
console.log(
  `     total baixado no GC após o corte do extrato: R$ ${brl(R(gap.reduce((a, g) => a + g.baixas_gc_pos_corte, 0)))}`,
);

const top = (situacao, n, ordem) =>
  conc.filter((c) => c.situacao === situacao).sort(ordem).slice(0, n);

console.log('\n=== 12 MAIORES: GC ABAIXO DO KAMINO ===');
for (const c of top('GC menor', 12, (a, b) => a.diferenca - b.diferenca)) {
  console.log(`R$ ${brl(c.diferenca).padStart(12)} | ${c.aluno} | ${c.produto} | GC ${brl(c.card_gc)} vs Kamino ${brl(c.kamino_aberto)} | ${c.bucket}`);
}

console.log('\n=== 12 MAIORES: SÓ NO EXTRATO KAMINO (fora do card) ===');
for (const c of top('só no Kamino', 12, (a, b) => a.diferenca - b.diferenca)) {
  console.log(`R$ ${brl(c.kamino_aberto).padStart(12)} | ${c.aluno} | ${c.produto}`);
}

console.log('\n=== 12 MAIORES: SÓ NO GC (fora do extrato Kamino) ===');
for (const c of top('só no GC', 12, (a, b) => b.diferenca - a.diferenca)) {
  console.log(`R$ ${brl(c.card_gc).padStart(12)} | ${c.aluno} | ${c.produto} | ${c.bucket} | status ${c.status}`);
}

// ─────────── diagnóstico dos contratos "só no Kamino" ───────────
// Nem todos estão realmente ausentes do GC: pode ser nome/produto grafado
// diferente, ficha quitada, ou ficha barrada pelas regras do card.
const porNomeGc = new Map();
for (const s of alunos) {
  const k = norm(s.name);
  if (!porNomeGc.has(k)) porNomeGc.set(k, []);
  porNomeGc.get(k).push(s);
}

const diagnostico = conc
  .filter((c) => c.situacao === 'só no Kamino')
  .sort((a, b) => b.kamino_aberto - a.kamino_aberto)
  .map((c) => {
    const fichas = porNomeGc.get(norm(c.aluno)) ?? [];
    const motivo = (() => {
      if (fichas.length === 0) return 'nome não existe no GC';
      const mesmoProduto = fichas.filter((s) => norm(s.product) === norm(c.produto));
      const alvo = mesmoProduto.length ? mesmoProduto : fichas;
      const comAberto = alvo.filter((s) => (s.installments ?? []).some((i) => !i.paid));
      if (!mesmoProduto.length) return `nome existe, produto diferente: ${[...new Set(fichas.map((s) => s.product))].join(' / ')}`;
      if (!comAberto.length) return 'ficha existe e está quitada no GC';
      const s = comAberto[0];
      if (s.status_cancelamento === 'cancelado') return 'ficha cancelada no GC';
      if (isRendaExtraAtivo(s) && s.renda_extra_status && s.renda_extra_status !== 'Conciliar Exclusão') return 'ficha em Renda Extra';
      if (!countsInFinancialTotals(s)) return 'IAM Control aguardando aprovação no GC';
      return 'ficha com saldo aberto — deveria estar no card (investigar)';
    })();
    return {
      aluno: c.aluno,
      produto: c.produto,
      kamino_aberto: c.kamino_aberto,
      fichas_com_esse_nome_no_gc: fichas.length,
      motivo,
    };
  });

console.log(`\n=== POR QUE ESSES ${diagnostico.length} CONTRATOS NÃO ESTÃO NO CARD ===`);
const porMotivo = new Map();
for (const d of diagnostico) {
  const chave = d.motivo.startsWith('nome existe, produto diferente') ? 'nome existe, produto grafado diferente' : d.motivo;
  const cur = porMotivo.get(chave) ?? { contratos: 0, valor: 0 };
  cur.contratos += 1;
  cur.valor = R(cur.valor + d.kamino_aberto);
  porMotivo.set(chave, cur);
}
for (const [m, v] of [...porMotivo].sort((a, b) => b[1].valor - a[1].valor)) {
  console.log(`${String(v.contratos).padStart(3)} contratos | R$ ${brl(v.valor).padStart(12)} | ${m}`);
}
console.log('\ndetalhe:');
for (const d of diagnostico) {
  console.log(`R$ ${brl(d.kamino_aberto).padStart(11)} | ${d.aluno} | ${d.produto} → ${d.motivo}`);
}


const abaResumo = [
  { bloco: 'Kamino (carteira normal)', valor: resumo['Kamino'].valor, alunos: resumo['Kamino'].alunos, parcelas: resumo['Kamino'].parcelas },
  { bloco: 'Cancelamento (funil ativo)', valor: resumo['Cancelamento'].valor, alunos: resumo['Cancelamento'].alunos, parcelas: resumo['Cancelamento'].parcelas },
  { bloco: 'IAM Control (aprovado no GC)', valor: resumo['IAM Control'].valor, alunos: resumo['IAM Control'].alunos, parcelas: resumo['IAM Control'].parcelas },
  { bloco: 'TOTAL DO CARD', valor: cardTotal, alunos: cardAlunos.size, parcelas: cardParcelas },
  { bloco: '', valor: '', alunos: '', parcelas: '' },
  { bloco: 'Extrato Kamino em aberto', valor: kaminoAbertoTotal, alunos: '', parcelas: kaminoLinhasAbertas },
  { bloco: 'Card − extrato Kamino', valor: R(cardTotal - kaminoAbertoTotal), alunos: '', parcelas: '' },
  { bloco: '', valor: '', alunos: '', parcelas: '' },
  ...Object.entries(kaminoPorBucket).map(([b, v]) => ({
    bloco: `Extrato Kamino que cai em: ${b}`, valor: v, alunos: '', parcelas: '',
  })),
];

const wbOut = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(abaResumo), 'Resumo');
XLSX.utils.book_append_sheet(
  wbOut,
  XLSX.utils.json_to_sheet(linhas.sort((a, b) => a.bucket.localeCompare(b.bucket) || b.valor_no_card - a.valor_no_card)),
  'Card detalhado',
);
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(gap), 'Origem da diferenca');
XLSX.utils.book_append_sheet(
  wbOut,
  XLSX.utils.json_to_sheet(conc.sort((a, b) => a.diferenca - b.diferenca)),
  'Conciliacao contratos',
);
XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(diagnostico), 'So no Kamino diagnostico');
XLSX.writeFile(wbOut, SAIDA);
console.log(`\nplanilha gerada: ${SAIDA}`);
