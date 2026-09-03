import * as XLSX from 'xlsx';
import type { StudentStatus } from '@/types';

export type ForecastExportBucket = 'pago' | 'a_vencer';

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

const COLUNAS_BASE = [
  COLUNA_EDICAO,
  'Aluno',
  'WhatsApp',
  'Email',
  'Produto',
  'Assessor',
  'Valor Venda',
  'Parcela',
  'Vencimento',
  'Mês/Ano',
  'Data Pagamento',
  'Valor Parcela',
  'Valor Recebido',
  'Situação',
] as const;

// Nada foi pago nessas linhas, então data de pagamento e valor recebido sairiam
// vazios na coluna inteira.
const COLUNAS_A_VENCER = COLUNAS_BASE.filter(
  (c) => c !== 'Data Pagamento' && c !== 'Valor Recebido',
);

// A aba inteira é do card Pago, que não se desmembra: a coluna repetiria
// "Pago" da primeira à última linha.
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

/** Mês de referência no formato Agosto/26. */
function mesAno(iso?: string): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const mes = MESES[Number(m) - 1];
  if (!y || !mes) return '';
  return `${mes}/${y.slice(-2)}`;
}

/**
 * Aba Pago fecha por caixa, então a competência segue o dia em que o dinheiro
 * entrou: parcela de setembro paga em outubro conta em Outubro. Sem data de
 * pagamento registrada, o vencimento é a melhor referência disponível.
 */
function competencia(r: ForecastExportRow): string {
  return mesAno(r.bucket === 'pago' ? r.paidDate || r.dueDate : r.dueDate);
}

/** Largura da coluna medida pelo texto que o Excel vai mostrar, não pelo valor cru. */
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

/** Aplica o formato de moeda célula a célula: o xlsx community não tem estilo, só número. */
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

/**
 * Card em que o aluno aparece na tela. Status sem card correspondente
 * (Renda Extra, Em Negociação) mantém o rótulo genérico em vez de sair vazio.
 */
function situacaoLabel(r: ForecastExportRow): string {
  return (r.displayStatus && CARD_LABEL[r.displayStatus]) || 'A Vencer / Vencido';
}

type Celula = string | number | undefined;

/**
 * Projeta cada linha nas colunas da aba. A projeção é necessária porque o
 * json_to_sheet acrescenta ao cabeçalho qualquer chave extra que encontrar.
 */
function toSheetRows(rows: ForecastExportRow[], colunas: readonly string[]) {
  return rows
    .slice()
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.installmentNumber - b.installmentNumber)
    .map((r) => {
      const completa: Record<string, Celula> = {
        Aluno: r.studentName,
        WhatsApp: r.whatsapp || '',
        Email: r.email || '',
        Produto: r.product || '',
        Assessor: r.ac || '',
        // Célula vazia em vez de texto vazio: assim a coluna continua numérica.
        'Valor Venda': typeof r.saleValue === 'number' ? r.saleValue : undefined,
        Parcela: r.installmentNumber,
        Vencimento: fmtBR(r.dueDate),
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
  // header explícito: garante a ordem das colunas mesmo quando a primeira
  // linha não tem valor de venda ou valor recebido.
  const ws = XLSX.utils.json_to_sheet(linhas, { header: [...colunas] });
  aplicarFormatoMoeda(ws, colunas);
  ws['!cols'] = larguraColunas(linhas, colunas);
  if (linhas.length > 0 && ws['!ref']) {
    // Filtro só nas colunas de dados: a coluna de anotações não tem cabeçalho
    // para filtrar, e as linhas escondidas somem por inteiro de qualquer forma.
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
};

export function buildForecastWorkbook(
  rows: ForecastExportRow[],
  opts: ForecastExportOpts,
): XLSX.WorkBook {
  const aVencer = rows.filter((r) => r.bucket === 'a_vencer');
  const pago = rows.filter((r) => r.bucket === 'pago');

  const wb = XLSX.utils.book_new();

  if (opts.dateBasis === 'vencimento' || aVencer.length > 0) {
    XLSX.utils.book_append_sheet(wb, montarAba(aVencer, COLUNAS_A_VENCER), 'A Vencer Vencido');
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
