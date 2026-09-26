import type { Installment, Student } from '@/types';
import { isStudentFullyPaid } from '@/lib/acPortfolioVisibility';
import { isEntradaPendenciaInstallment } from '@/lib/studentDisplayStatus';
import { isContratoCancelado, isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { resolveStudentFinance } from '@/lib/studentFinance';
import { toDisplayName } from '@/lib/utils';

/** Forma de pagamento no modelo da planilha IAM. */
export type FormaPagtoModelo = 'BOLETO' | 'CARTAO' | 'PIX';

/**
 * Uma linha = uma parcela (formato vertical).
 * PIX/CARTAO (entrada) só na 1ª linha do aluno.
 */
export type ModeloGcIamParcelaRow = {
  formaPagto: FormaPagtoModelo;
  assessor: string;
  nomeAluno: string;
  telefone: string;
  treinamento: string;
  email: string;
  contrato: string;
  valorContrato: number;
  /** Número da parcela; vazio em linha só de entrada/à vista. */
  numeroParcela: number | null;
  /** Data de vencimento DD/MM/YYYY. */
  dataVencimento: string;
  dataEntrada: string;
  pix: number | null;
  cartao: number | null;
  valorParcela: number | null;
  /** Verde na célula do valor da parcela. */
  paid: boolean;
};

export type ModeloGcIamExport = {
  rows: ModeloGcIamParcelaRow[];
};

/** Verde claro — só parcelas pagas (fundo branco no restante). */
export const PAID_CELL_FILL = '#C6EFCE';

const HEADERS = [
  'FORMA DE PAGTO',
  'ASSESSOR',
  'NOME ALUNO',
  'TELEFONE',
  'TREINAMENTO',
  'E-MAIL',
  'CONTRATOS',
  'VALOR DO CONTRATO',
  'Nº PARCELA',
  'DATA VENCIMENTO',
  'DATA DA ENTRADA',
  'PIX',
  'CARTAO',
  'VALOR PARCELA',
] as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function fmtBR(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

/** Primeiro nome do assessor em MAIÚSCULAS (modelo: BIANCA, ELAINE, LUANA). */
export function assessorCurto(ac?: string | null): string {
  const first = (ac || '').trim().split(/\s+/)[0] || '';
  return first.toLocaleUpperCase('pt-BR');
}

function blobHints(student: Student): string {
  const parts: string[] = [
    student.detalhes ?? '',
    student.iamControlPendenteTipo ?? '',
    ...(student.history ?? []).map((h) => h.text),
    ...(student.installments ?? []).flatMap((i) => [
      ...(i.tags ?? []),
      i.observacao ?? '',
    ]),
  ];
  return fold(parts.join(' '));
}

export function detectFormaPagto(student: Student): FormaPagtoModelo {
  const finance = resolveStudentFinance(student);
  const fluxo = (student.installments ?? []).filter((i) => !isEntradaPendenciaInstallment(i));
  const hints = blobHints(student);
  const hasCartao = /\bcartao\b|\bcredito\b/.test(hints);
  const hasPix = /\bpix\b/.test(hints) || String(student.iamControlPendenteTipo ?? '').toUpperCase() === 'PIX';
  const hasBoleto = /\bboleto\b/.test(hints);

  const quitadoAvista =
    isIamConciliadoQuitadoAvista(student) ||
    (fluxo.length === 0 && finance.downPayment >= finance.saleValue - 1 && finance.saleValue > 0.0049);

  if (quitadoAvista || fluxo.length === 0) {
    if (hasCartao && !hasPix) return 'CARTAO';
    if (hasPix && !hasCartao) return 'PIX';
    if (hasCartao) return 'CARTAO';
    return 'PIX';
  }

  if (hasBoleto) return 'BOLETO';
  if (hasCartao && !hasPix) return 'CARTAO';
  return 'BOLETO';
}

export function detectEntradaDestino(student: Student): 'PIX' | 'CARTAO' {
  const hints = blobHints(student);
  const hasCartao = /\bcartao\b|\bcredito\b/.test(hints);
  const hasPix = /\bpix\b/.test(hints);
  if (hasCartao && !hasPix) return 'CARTAO';
  return 'PIX';
}

/**
 * Parcelas do fluxo (exclui entrada embutida/pendência já representada em PIX/CARTAO).
 */
export function installmentsForExport(student: Student): Installment[] {
  const finance = resolveStudentFinance(student);
  const embeddedId = finance.embeddedEntradaInstallment?.number;
  return [...(student.installments ?? [])]
    .filter((i) => {
      if (isEntradaPendenciaInstallment(i)) return false;
      if (embeddedId != null && i.number === embeddedId) return false;
      return true;
    })
    .sort((a, b) => a.number - b.number || (a.dueDate || '').localeCompare(b.dueDate || ''));
}

function resolvePixCartao(student: Student, forma: FormaPagtoModelo): { pix: number | null; cartao: number | null } {
  const finance = resolveStudentFinance(student);
  const entrada = roundMoney(finance.downPayment);
  const sale = roundMoney(finance.saleValue);
  let pix: number | null = null;
  let cartao: number | null = null;

  if (forma === 'BOLETO') {
    if (entrada > 0.0049) {
      if (detectEntradaDestino(student) === 'CARTAO') cartao = entrada;
      else pix = entrada;
    }
  } else if (forma === 'PIX') {
    const v = entrada > 0.0049 ? entrada : sale;
    if (v > 0.0049) pix = v;
  } else if (entrada > 0.0049 && sale > entrada + 0.05 && detectEntradaDestino(student) === 'PIX') {
    pix = entrada;
    cartao = roundMoney(sale - entrada);
  } else {
    const v = entrada > 0.0049 ? entrada : sale;
    if (v > 0.0049) cartao = v;
  }
  return { pix, cartao };
}

/**
 * Monta linhas verticais: 1 parcela = 1 linha (sem colunas de mês na lateral).
 * Cancelados e quitados (tudo pago) não entram na planilha.
 */
export function buildModeloGcIamExport(students: Student[]): ModeloGcIamExport {
  const sorted = students
    .filter((s) => !isContratoCancelado(s) && s.status !== 'Pago' && !isStudentFullyPaid(s))
    .sort((a, b) => toDisplayName(a.name).localeCompare(toDisplayName(b.name), 'pt-BR'));

  const rows: ModeloGcIamParcelaRow[] = [];

  for (const student of sorted) {
    const finance = resolveStudentFinance(student);
    const forma = detectFormaPagto(student);
    const insts = installmentsForExport(student);
    const { pix, cartao } = resolvePixCartao(student, forma);
    const sale = roundMoney(finance.saleValue);
    const entrada = roundMoney(finance.downPayment);
    const valorContrato = sale > 0.0049 ? sale : entrada;
    const base = {
      formaPagto: forma,
      assessor: assessorCurto(student.ac),
      nomeAluno: toDisplayName(student.name),
      telefone: student.whatsapp || '',
      treinamento: student.product || '',
      email: student.email || '',
      contrato: toDisplayName(student.name),
      valorContrato,
      dataEntrada: fmtBR(student.enrollmentDate),
    };

    if (insts.length === 0) {
      rows.push({
        ...base,
        numeroParcela: null,
        dataVencimento: '',
        pix,
        cartao,
        valorParcela: null,
        paid: false,
      });
      continue;
    }

    insts.forEach((inst, idx) => {
      const val = roundMoney(Number(inst.value) || 0);
      rows.push({
        ...base,
        numeroParcela: inst.number > 0 ? inst.number : null,
        dataVencimento: fmtBR(inst.dueDate),
        // Entrada PIX/CARTAO só na primeira linha do aluno.
        pix: idx === 0 ? pix : null,
        cartao: idx === 0 ? cartao : null,
        valorParcela: val > 0.0049 ? val : null,
        paid: !!inst.paid && val > 0.0049,
      });
    });
  }

  return { rows };
}

function moneyCsv(n: number | null | undefined): string {
  if (n == null || !(n > 0.0049)) return '';
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function modeloGcIamToCsv(data: ModeloGcIamExport): string {
  const lines: string[] = [HEADERS.map(csvEscape).join(',')];
  for (const r of data.rows) {
    const cells = [
      r.formaPagto,
      r.assessor,
      r.nomeAluno,
      r.telefone,
      r.treinamento,
      r.email,
      r.contrato,
      moneyCsv(r.valorContrato),
      r.numeroParcela != null ? String(r.numeroParcela) : '',
      r.dataVencimento,
      r.dataEntrada,
      moneyCsv(r.pix),
      moneyCsv(r.cartao),
      moneyCsv(r.valorParcela),
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function modeloGcIamToSpreadsheetMl(data: ModeloGcIamExport): string {
  const styles = `
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
      <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Header">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#000000"/>
      <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
    </Style>
    <Style ss:ID="Money">
      <NumberFormat ss:Format="&quot;R$&quot;\\ #,##0.00"/>
      <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Paid">
      <NumberFormat ss:Format="&quot;R$&quot;\\ #,##0.00"/>
      <Interior ss:Color="${PAID_CELL_FILL}" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Text">
      <Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/>
    </Style>
  </Styles>`;

  const cellText = (v: string, style = 'Text') =>
    `<Cell ss:StyleID="${style}"><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
  const cellNum = (n: number, paid = false) =>
    `<Cell ss:StyleID="${paid ? 'Paid' : 'Money'}"><Data ss:Type="Number">${n}</Data></Cell>`;
  const cellEmpty = () => `<Cell ss:StyleID="Text"><Data ss:Type="String"></Data></Cell>`;

  const rowsXml: string[] = [
    `<Row>${HEADERS.map((h) => cellText(h, 'Header')).join('')}</Row>`,
  ];

  for (const r of data.rows) {
    const cells: string[] = [
      cellText(r.formaPagto),
      cellText(r.assessor),
      cellText(r.nomeAluno),
      cellText(r.telefone),
      cellText(r.treinamento),
      cellText(r.email),
      cellText(r.contrato),
      r.valorContrato > 0.0049 ? cellNum(r.valorContrato) : cellEmpty(),
      r.numeroParcela != null ? cellText(String(r.numeroParcela)) : cellEmpty(),
      cellText(r.dataVencimento),
      cellText(r.dataEntrada),
      r.pix != null && r.pix > 0.0049 ? cellNum(r.pix) : cellEmpty(),
      r.cartao != null && r.cartao > 0.0049 ? cellNum(r.cartao) : cellEmpty(),
      r.valorParcela != null && r.valorParcela > 0.0049
        ? cellNum(r.valorParcela, r.paid)
        : cellEmpty(),
    ];
    rowsXml.push(`<Row>${cells.join('')}</Row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${styles}
 <Worksheet ss:Name="GC IAM">
  <Table>
${rowsXml.join('\n')}
  </Table>
 </Worksheet>
</Workbook>`;
}

function stampDate(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function modeloGcIamFileName(ext: 'csv' | 'xls'): string {
  return `GC_IAM_modelo_${stampDate()}.${ext}`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadModeloGcIam(students: Student[], format: 'xls' | 'csv' = 'xls') {
  const data = buildModeloGcIamExport(students);
  if (format === 'csv') {
    const csv = modeloGcIamToCsv(data);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), modeloGcIamFileName('csv'));
    return;
  }
  const xml = modeloGcIamToSpreadsheetMl(data);
  triggerDownload(
    new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }),
    modeloGcIamFileName('xls'),
  );
}
