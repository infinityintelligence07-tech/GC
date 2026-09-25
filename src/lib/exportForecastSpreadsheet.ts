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
  displayStatus?: StudentStatus;
  saleValue?: number;
  installmentNumber: number;
  dueDate: string;
  value: number;
  paidValue: number;
  paidDate?: string;
};

const MONEY_FMT = 'R$ #,##0.00';
const COLUNA_EDICAO = '';
const LARGURA_EDICAO = 18;

const COLUNAS_BASE = [
  COLUNA_EDICAO,
  'Aluno',
  'WhatsApp',
  'Email',
  'Produto',
  'Assessor',
  'Valor Venda',
  'Nº Parcela',
  'Data Vencimento',
  'Mês/Ano',
  'Data Pagamento',
  'Valor Parcela',
  'Valor Recebido',
  'Situação',
] as const;

const COLUNAS_A_VENCER = COLUNAS_BASE.filter(
  (c) => c !== 'Data Pagamento' && c !== 'Valor Recebido',
);

const COLUNAS_PAGO = COLUNAS_BASE.filter((c) => c !== 'Situação');

const COLUNAS_DINHEIRO = new Set<string>(['Valor Venda', 'Valor Parcela', 'Valor Recebido']);

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

function mesAno(iso?: string): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const mes = MESES[Number(m) - 1];
  if (!y || !mes) return '';
  return `${mes}/${y.slice(-2)}`;
}

function competencia(r: ForecastExportRow): string {
  return mesAno(r.bucket === 'pago' ? r.paidDate || r.dueDate : r.dueDate);
}

function situacaoLabel(r: ForecastExportRow): string {
  return (r.displayStatus && CARD_LABEL[r.displayStatus]) || 'A Vencer / Vencido';
}

type Celula = string | number | undefined;

function larguraColunas(linhas: Record<string, unknown>[], colunas: readonly string[]) {
  return colunas.map((col) => {
    if (col === COLUNA_EDICAO) return { wch: LARGURA_EDICAO };
    let max = col.length;
    for (const linha of linhas) {
      const v = linha[col];
      if (v === undefined || v === null) continue;
      const texto = typeof v === 'number' && COLUNAS_DINHEIRO.has(col) ? moneyPreview(v) : String(v);
      if (texto.length > max) max = texto.length;
    }
    return { wch: Math.min(Math.max(max + 2, 10), 42) };
  });
}

function aplicarFormatoMoeda(ws: XLSX.WorkSheet, colunas: readonly string[]) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let c = range.s.c; c <= range.e.c; c++) {
    if (!COLUNAS_DINHEIRO.has(colunas[c])) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === 'n') cell.z = MONEY_FMT;
    }
  }
}

/** Uma linha por parcela (formato vertical — não espalha meses na lateral). */
function toSheetRows(rows: ForecastExportRow[], colunas: readonly string[]) {
  return rows
    .slice()
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'pt-BR') || a.installmentNumber - b.installmentNumber)
    .map((r) => {
      const completa: Record<string, Celula> = {
        Aluno: r.studentName,
        WhatsApp: r.whatsapp || '',
        Email: r.email || '',
        Produto: r.product || '',
        Assessor: r.ac || '',
        'Valor Venda': typeof r.saleValue === 'number' ? r.saleValue : undefined,
        'Nº Parcela': r.installmentNumber > 0 ? r.installmentNumber : undefined,
        'Data Vencimento': fmtBR(r.dueDate),
        'Mês/Ano': competencia(r),
        'Data Pagamento': fmtBR(r.paidDate),
        'Valor Parcela': r.value,
        'Valor Recebido': r.bucket === 'pago' ? r.paidValue : undefined,
        Situação: situacaoLabel(r),
      };
      const linha: Record<string, Celula> = {};
      for (const col of colunas) linha[col] = completa[col];
      return linha;
    });
}

function montarAba(rows: ForecastExportRow[], colunas: readonly string[]): XLSX.WorkSheet {
  const linhas = toSheetRows(rows, colunas);
  const ws = XLSX.utils.json_to_sheet(linhas, { header: [...colunas] });
  aplicarFormatoMoeda(ws, colunas);
  ws['!cols'] = larguraColunas(linhas, colunas);
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
  students?: Student[];
};

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
    XLSX.utils.book_append_sheet(wb, montarAba(emAberto, COLUNAS_A_VENCER), 'A Vencer Vencido');
  }
  XLSX.utils.book_append_sheet(wb, montarAba(pago, COLUNAS_PAGO), 'Pago');

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
