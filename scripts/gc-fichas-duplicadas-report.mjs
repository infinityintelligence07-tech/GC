/**
 * SOMENTE LEITURA: relatório das fichas duplicadas (mesmo aluno + mesmo produto)
 * dentro de cada empresa ATIVA do GC. A empresa "Banco de Dados" é arquivo
 * histórico inativo e fica de fora.
 *
 * Gera KAMINO_GC_Fichas_Duplicadas.xlsx com uma linha por ficha, agrupadas, e uma
 * sugestão de qual manter — para conferência humana antes de excluir qualquer coisa.
 *
 * Uso: node scripts/gc-fichas-duplicadas-report.mjs
 */
import fs from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const SAIDA = 'KAMINO_GC_Fichas_Duplicadas.xlsx';

// O build ESM do xlsx não vem com fs acoplado; sem isto writeFile falha.
XLSX.set_fs(fs);

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
const chave = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

const client = await conectar();

const { rows: empresas } = await client.query(
  `SELECT id, name FROM public.companies WHERE active = true ORDER BY name`,
);
const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.name]));

const { rows: alunos } = await client.query(
  `SELECT s.*, (SELECT count(*) FROM public.cancellation_cases c WHERE c.student_id = s.id) AS casos
     FROM public.students s
    WHERE s.company_id = ANY($1::uuid[])`,
  [empresas.map((e) => e.id)],
);

// Agrupa por empresa + aluno + produto
const grupos = new Map();
for (const a of alunos) {
  const k = `${a.company_id}|${chave(a.name)}|${chave(a.product)}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(a);
}
const duplicados = [...grupos.values()].filter((g) => g.length > 1);

// Ordena grupos por impacto financeiro das cópias excedentes
duplicados.sort((a, b) => {
  const exc = (g) => g.slice(1).reduce((s, f) => s + Number(f.sale_value ?? 0), 0);
  return exc(b) - exc(a);
});

function pontos(f) {
  const insts = f.installments ?? [];
  return [
    Number(f.paid_installments ?? 0),
    insts.length,
    (f.history ?? []).length,
    insts.reduce((s, i) => s + (i.tags?.length ?? 0), 0),
    f.iam_control_aluno_id != null ? 1 : 0,
    Number(f.casos ?? 0),
    new Date(f.updated_at).getTime(),
    new Date(f.created_at).getTime(),
  ];
}
const compara = (a, b) => {
  const pa = pontos(a);
  const pb = pontos(b);
  for (let i = 0; i < pa.length; i++) if (pb[i] !== pa[i]) return pb[i] - pa[i];
  return 0;
};

const linhas = [];
let excedentes = 0;
let valorExcedente = 0;
let abertoExcedente = 0;
let gruposIdenticos = 0;

duplicados.forEach((grupo, idx) => {
  const ordenado = [...grupo].sort(compara);
  const manter = ordenado[0];

  const assinatura = (f) =>
    JSON.stringify({
      sale: R(f.sale_value),
      insts: (f.installments ?? []).map((i) => [i.number, i.dueDate, R(i.value), !!i.paid, i.paidDate ?? null]),
    });
  const identicas = new Set(ordenado.map(assinatura)).size === 1;
  if (identicas) gruposIdenticos++;

  for (const f of ordenado) {
    const insts = f.installments ?? [];
    const abertas = insts.filter((i) => !i.paid);
    const emAberto = R(abertas.reduce((s, i) => s + Number(i.value ?? 0), 0));
    const ehManter = f.id === manter.id;

    if (!ehManter) {
      excedentes++;
      valorExcedente += Number(f.sale_value ?? 0);
      abertoExcedente += emAberto;
    }

    const motivos = [];
    if (ehManter) {
      if (Number(f.paid_installments ?? 0) > Number(ordenado[1].paid_installments ?? 0)) motivos.push('mais parcelas pagas');
      if ((f.history ?? []).length > (ordenado[1].history ?? []).length) motivos.push('mais histórico');
      if (insts.length > (ordenado[1].installments ?? []).length) motivos.push('mais parcelas');
      if (f.iam_control_aluno_id != null && ordenado[1].iam_control_aluno_id == null) motivos.push('vinculada ao IAM Control');
      if (Number(f.casos ?? 0) > 0) motivos.push('tem caso de cancelamento');
      if (!motivos.length) motivos.push('fichas equivalentes — mantida a mais recente');
    }

    linhas.push({
      grupo: idx + 1,
      sugestao: ehManter ? 'MANTER' : 'EXCLUIR (conferir)',
      copias_no_grupo: grupo.length,
      identicas: identicas ? 'SIM' : 'NAO',
      aluno: f.name,
      produto: f.product,
      empresa: nomeEmpresa.get(f.company_id) ?? f.company_id,
      ac: f.ac,
      status: f.status,
      modo_status: f.status_mode,
      cancelamento: f.status_cancelamento,
      casos_cancelamento: Number(f.casos ?? 0),
      matricula: f.enrollment_date ?? '',
      contrato: R(f.sale_value),
      parcelas_pagas: Number(f.paid_installments ?? 0),
      total_parcelas: insts.length,
      soma_parcelas: R(insts.reduce((s, i) => s + Number(i.value ?? 0), 0)),
      em_aberto: emAberto,
      qtd_historico: (f.history ?? []).length,
      qtd_tags_parcelas: insts.reduce((s, i) => s + (i.tags?.length ?? 0), 0),
      iam_aluno_id: f.iam_control_aluno_id ?? '',
      iam_contrato_id: f.iam_control_contrato_id ?? '',
      cpf: f.cpf ?? '',
      criada_em: dia(f.created_at),
      atualizada_em: dia(f.updated_at),
      ficha_id: f.id,
      motivo: motivos.join('; '),
    });
  }
});

// Resumo por produto
const porProduto = new Map();
for (const l of linhas) {
  if (l.sugestao === 'MANTER') continue;
  const k = `${l.empresa} | ${l.produto}`;
  const cur = porProduto.get(k) ?? { empresa: l.empresa, produto: l.produto, fichas: 0, contrato: 0, em_aberto: 0 };
  cur.fichas++;
  cur.contrato = R(cur.contrato + l.contrato);
  cur.em_aberto = R(cur.em_aberto + l.em_aberto);
  porProduto.set(k, cur);
}

const resumo = [
  { metrica: 'Grupos duplicados (aluno + produto, mesma empresa)', valor: duplicados.length },
  { metrica: 'Fichas envolvidas', valor: duplicados.reduce((s, g) => s + g.length, 0) },
  { metrica: 'Fichas excedentes (candidatas a exclusão)', valor: excedentes },
  { metrica: 'Grupos com cópias 100% idênticas (exclusão segura)', valor: gruposIdenticos },
  { metrica: 'Contrato somado nas fichas excedentes (R$)', valor: R(valorExcedente) },
  { metrica: 'Em aberto somado nas fichas excedentes (R$)', valor: R(abertoExcedente) },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet([...porProduto.values()].sort((a, b) => b.contrato - a.contrato)),
  'Por produto',
);
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Fichas');
XLSX.writeFile(wb, SAIDA);

console.log(`\n=== RESUMO ===`);
for (const r of resumo) console.log(`${r.metrica}: ${r.valor.toLocaleString('pt-BR')}`);
console.log(`\n=== EXCEDENTES POR PRODUTO ===`);
for (const p of [...porProduto.values()].sort((a, b) => b.contrato - a.contrato)) {
  console.log(
    `${p.empresa} | ${p.produto}: ${p.fichas} fichas | contrato R$ ${p.contrato.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | em aberto R$ ${p.em_aberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
  );
}
console.log(`\nplanilha gerada: ${SAIDA} (${linhas.length} linhas)`);

await client.end();
