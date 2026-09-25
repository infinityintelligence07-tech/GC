import * as XLSX from 'xlsx';
import type { Student, StudentStatus } from '@/types';
import { isStudentFullyPaid } from '@/lib/acPortfolioVisibility';
import { isContratoCancelado } from '@/lib/iamPendenteConciliacao';

/**
 * `negativacao`: parcela em aberto de aluno À Negativar/Negativado.
 * Na tela esses valores ficam fora do card A Vencer/Vencido. Na planilha
 * entram na mesma aba, com a Situação preenchida, para não faltar aluno.
 */
export type ForecastExportBucket = 'pago' | 'a_vencer' | 'negativacao';

/**
 * Rótulos dos cards do dashboard. A coluna Situação usa exatamente estes nomes
 * para que filtrar a planilha por um card dê o mesmo recorte da tela.
 */
const CARD_LABEL: Partial<Record<StudentStatus, string>> = {
  'Em Dia': 'Em Dia',
  'Aluno Novo': 'Alunos Novos',
  'Vencido 1': 'Vencido 1',
  'Vencido 2': 'Vencido 2',
  'À Negativar': 'À Negativar',
  Negativado: 'Negativado',
  'Solicitação Cancelamento': 'Solicitação Cancelamento',
  Pendente: 'Pendências',
};

export type ForecastExportRow = {
  bucket: ForecastExportBucket;
  studentId: string;
  studentName: string;
  ac: string;
  product?: string;
  whatsapp?: string;
  email?: string;
  /** Status exibido do aluno, usado para desmembrar a coluna Situação por card. */
  displayStatus?: StudentStatus;
  saleValue?: number;
  installmentNumber: number;
  dueDate: string;
  value: number;
  paidValue: number;
  paidDate?: string;
};

// Código de formato do Excel: o arquivo guarda sempre no padrão americano e o
// Excel exibe conforme o idioma da máquina (R$ 15.231,12 em pt-BR).
const MONEY_FMT = 'R$ #,##0.00';

/** Coluna livre para anotações de quem recebe a planilha. Fica sempre na frente. */
const COLUNA_EDICAO = '';
const LARGURA_EDICAO = 18;

const COLUNAS_FIXAS_A_VENCER = [
  COLUNA_EDICAO,
  'Aluno',
  'WhatsApp',
  'Email',
  'Produto',
  'Assessor',
  'Valor Venda',
  'Nº Parcelas',
  'Vencimentos',
  'Situação',
] as const;

const COLUNAS_FIXAS_PAGO = [
  COLUNA_EDICAO,
  'Aluno',
  'WhatsApp',
  'Email',
  'Produto',
  'Assessor',
  'Valor Venda',
  'Nº Parcelas',
  'Vencimentos',
  'Datas Pagamento',
] as const;

const moneyPreview = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtBR(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Mês de referência no formato Agosto/26. */
function mesAno(iso?: string): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const mes = MESES[Number(m) - 1];
  if (!y || !mes) return '';
  return `${mes}/${y.slice(-2)}`;
}

/** YYYY-MM para ordenar colunas de mês. */
function ymKey(iso?: string): string | null {
  if (!iso || iso.length < 7) return null;
  const k = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(k) ? k : null;
}

/**
 * Aba Pago fecha por caixa, então a competência segue o dia em que o dinheiro
 * entrou: parcela de setembro paga em outubro conta em Outubro. Sem data de
 * pagamento registrada, o vencimento é a melhor referência disponível.
 */
function competenciaIso(r: ForecastExportRow): string | undefined {
  return r.bucket === 'pago' ? r.paidDate || r.dueDate : r.dueDate;
}

function situacaoLabel(r: ForecastExportRow): string {
  return (r.displayStatus && CARD_LABEL[r.displayStatus]) || 'A Vencer / Vencido';
}

function studentKey(r: ForecastExportRow): string {
  return `${r.studentId}::${r.product || ''}`;
}

type Celula = string | number | undefined;

type AlunoAgregado = {
  studentName: string;
  whatsapp: string;
  email: string;
  product: string;
  ac: string;
  saleValue?: number;
  situacao: string;
  /** Números de parcela ordenados. */
  numeros: number[];
  /** Vencimentos ISO ordenados (mesmo índice que numeros quando possível). */
  vencimentos: string[];
  /** Datas de pagamento (aba Pago). */
  datasPagamento: string[];
  /** Valor por competência YYYY-MM. */
  porMes: Record<string, number>;
};

function agregarAlunos(rows: ForecastExportRow[], modo: 'a_vencer' | 'pago'): AlunoAgregado[] {
  const map = new Map<string, AlunoAgregado>();

  const sorted = rows.slice().sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName, 'pt-BR') ||
      (a.product || '').localeCompare(b.product || '', 'pt-BR') ||
      a.installmentNumber - b.installmentNumber ||
      (a.dueDate || '').localeCompare(b.dueDate || ''),
  );

  for (const r of sorted) {
    const key = studentKey(r);
    let ag = map.get(key);
    if (!ag) {
      ag = {
        studentName: r.studentName,
        whatsapp: r.whatsapp || '',
        email: r.email || '',
        product: r.product || '',
        ac: r.ac || '',
        saleValue: typeof r.saleValue === 'number' ? r.saleValue : undefined,
        situacao: situacaoLabel(r),
        numeros: [],
        vencimentos: [],
        datasPagamento: [],
        porMes: {},
      };
      map.set(key, ag);
    } else if (ag.saleValue == null && typeof r.saleValue === 'number') {
      ag.saleValue = r.saleValue;
    }

    if (r.installmentNumber > 0) ag.numeros.push(r.installmentNumber);
    if (r.dueDate) ag.vencimentos.push(r.dueDate);
    if (modo === 'pago' && r.paidDate) ag.datasPagamento.push(r.paidDate);

    const ym = ymKey(competenciaIso(r));
    if (ym) {
      const valor = modo === 'pago' ? (Number(r.paidValue) || Number(r.value) || 0) : (Number(r.value) || 0);
      ag.porMes[ym] = Math.round(((ag.porMes[ym] || 0) + valor) * 100) / 100;
    }
  }

  return [...map.values()].sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'pt-BR') ||
    a.product.localeCompare(b.product, 'pt-BR'),
  );
}

function coletarMesesOrdenados(alunos: AlunoAgregado[]): string[] {
  const set = new Set<string>();
  for (const a of alunos) {
    for (const ym of Object.keys(a.porMes)) set.add(ym);
  }
  return [...set].sort();
}

function joinUnicos(itens: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of itens) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out.join(' | ');
}

function joinNumeros(nums: number[]): string {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of nums) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.join(' | ');
}

function larguraColunas(linhas: Record<string, unknown>[], colunas: readonly string[], moneyCols: Set<string>) {
  return colunas.map((col) => {
    if (col === COLUNA_EDICAO) return { wch: LARGURA_EDICAO };
    let max = col.length;
    for (const linha of linhas) {
      const v = linha[col];
      if (v === undefined || v === null) continue;
      const texto = typeof v === 'number' && moneyCols.has(col) ? moneyPreview(v) : String(v);
      if (texto.length > max) max = texto.length;
    }
    return { wch: Math.min(Math.max(max + 2, 10), 48) };
  });
}

function aplicarFormatoMoeda(ws: XLSX.WorkSheet, colunas: readonly string[], moneyCols: Set<string>) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (!moneyCols.has(colunas[c])) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === 'n') cell.z = MONEY_FMT;
    }
  }
}

function montarAbaAVencer(rows: ForecastExportRow[]): XLSX.WorkSheet {
  const alunos = agregarAlunos(rows, 'a_vencer');
  const mesesYm = coletarMesesOrdenados(alunos);
  const mesesLabel = mesesYm.map((ym) => mesAno(`${ym}-01`));
  const colunas: string[] = [...COLUNAS_FIXAS_A_VENCER, ...mesesLabel];
  const moneyCols = new Set<string>(['Valor Venda', ...mesesLabel]);

  const linhas: Record<string, Celula>[] = alunos.map((a) => {
    const linha: Record<string, Celula> = {
      [COLUNA_EDICAO]: undefined,
      Aluno: a.studentName,
      WhatsApp: a.whatsapp,
      Email: a.email,
      Produto: a.product,
      Assessor: a.ac,
      'Valor Venda': a.saleValue,
      'Nº Parcelas': joinNumeros(a.numeros),
      Vencimentos: joinUnicos(a.vencimentos.map(fmtBR)),
      Situação: a.situacao,
    };
    mesesYm.forEach((ym, i) => {
      const v = a.porMes[ym];
      if (v != null && v > 0.0049) linha[mesesLabel[i]] = v;
    });
    return linha;
  });

  const ws = XLSX.utils.json_to_sheet(linhas, { header: colunas });
  aplicarFormatoMoeda(ws, colunas, moneyCols);
  ws['!cols'] = larguraColunas(linhas, colunas, moneyCols);
  if (linhas.length > 0 && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: range.s.r, c: range.s.c + 1 }, e: range.e }),
    };
  }
  return ws;
}

function montarAbaPago(rows: ForecastExportRow[]): XLSX.WorkSheet {
  const alunos = agregarAlunos(rows, 'pago');
  const mesesYm = coletarMesesOrdenados(alunos);
  const mesesLabel = mesesYm.map((ym) => mesAno(`${ym}-01`));
  const colunas: string[] = [...COLUNAS_FIXAS_PAGO, ...mesesLabel];
  const moneyCols = new Set<string>(['Valor Venda', ...mesesLabel]);

  const linhas: Record<string, Celula>[] = alunos.map((a) => {
    const linha: Record<string, Celula> = {
      [COLUNA_EDICAO]: undefined,
      Aluno: a.studentName,
      WhatsApp: a.whatsapp,
      Email: a.email,
      Produto: a.product,
      Assessor: a.ac,
      'Valor Venda': a.saleValue,
      'Nº Parcelas': joinNumeros(a.numeros),
      Vencimentos: joinUnicos(a.vencimentos.map(fmtBR)),
      'Datas Pagamento': joinUnicos(a.datasPagamento.map(fmtBR)),
    };
    mesesYm.forEach((ym, i) => {
      const v = a.porMes[ym];
      if (v != null && v > 0.0049) linha[mesesLabel[i]] = v;
    });
    return linha;
  });

  const ws = XLSX.utils.json_to_sheet(linhas, { header: colunas });
  aplicarFormatoMoeda(ws, colunas, moneyCols);
  ws['!cols'] = larguraColunas(linhas, colunas, moneyCols);
  if (linhas.length > 0 && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: range.s.r, c: range.s.c + 1 }, e: range.e }),
    };
  }
  return ws;
}

export type ForecastExportOpts = {
  dateBasis: 'vencimento' | 'pagamento';
  periodLabel: string;
  filePrefix?: string;
  /**
   * Alunos da base — cancelados e quitados (tudo pago) saem da planilha.
   * Sem esta lista, a planilha exporta todos os `rows` recebidos.
   */
  students?: Student[];
};

/** Cancelado ou contrato quitado: não entram na planilha de projeção. */
export function shouldIncludeStudentInForecastExport(student: Student): boolean {
  if (isContratoCancelado(student)) return false;
  if (student.status === 'Pago') return false;
  if (isStudentFullyPaid(student)) return false;
  return true;
}

export function filterForecastExportRows(
  rows: ForecastExportRow[],
  students: Student[] | undefined,
): ForecastExportRow[] {
  if (!students?.length) return rows;
  const allowed = new Set(
    students.filter(shouldIncludeStudentInForecastExport).map((s) => s.id),
  );
  return rows.filter((r) => allowed.has(r.studentId));
}

export function buildForecastWorkbook(
  rows: ForecastExportRow[],
  opts: ForecastExportOpts,
): XLSX.WorkBook {
  const filtradas = filterForecastExportRows(rows, opts.students);
  const emAberto = filtradas.filter((r) => r.bucket === 'a_vencer' || r.bucket === 'negativacao');
  const pago = filtradas.filter((r) => r.bucket === 'pago');

  const wb = XLSX.utils.book_new();

  if (opts.dateBasis === 'vencimento' || emAberto.length > 0) {
    XLSX.utils.book_append_sheet(wb, montarAbaAVencer(emAberto), 'A Vencer Vencido');
  }
  XLSX.utils.book_append_sheet(wb, montarAbaPago(pago), 'Pago');

  return wb;
}

export function forecastFileName(opts: ForecastExportOpts): string {
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const periodSlug = opts.periodLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'periodo';
  const prefix = opts.filePrefix || 'projecao-carteira';
  return `${prefix}-${opts.dateBasis}-${periodSlug}-${stamp}.xlsx`;
}

export function exportForecastSpreadsheet(rows: ForecastExportRow[], opts: ForecastExportOpts): void {
  XLSX.writeFile(buildForecastWorkbook(rows, opts), forecastFileName(opts));
}
