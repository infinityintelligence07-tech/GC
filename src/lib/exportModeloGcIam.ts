import type { Installment, Student } from '@/types';
import { isEntradaPendenciaInstallment } from '@/lib/studentDisplayStatus';
import { isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { resolveStudentFinance } from '@/lib/studentFinance';
import { toDisplayName } from '@/lib/utils';

/** Forma de pagamento no modelo da planilha IAM. */
export type FormaPagtoModelo = 'BOLETO' | 'CARTAO' | 'PIX';

export type ModeloGcIamMonthCol = {
  /** YYYY-MM */
  key: string;
  /** Ex.: MARÇO */
  label: string;
};

export type ModeloGcIamMoneyCell = {
  value: number;
  /** Célula verde só quando a(s) parcela(s) do mês estão pagas. */
  paid: boolean;
};

export type ModeloGcIamRow = {
  formaPagto: FormaPagtoModelo;
  assessor: string;
  nomeAluno: string;
  telefone: string;
  treinamento: string;
  email: string;
  contrato: string;
  valorContrato: number;
  /** Dia(s) de vencimento, ex. "15" ou "15 | 25". */
  vencimento: string;
  /** Data da entrada (matrícula) DD/MM/YYYY. */
  dataEntrada: string;
  pix: number | null;
  cartao: number | null;
  /** Valor por mês (chave YYYY-MM). */
  months: Record<string, ModeloGcIamMoneyCell>;
};

export type ModeloGcIamExport = {
  monthCols: ModeloGcIamMonthCol[];
  rows: ModeloGcIamRow[];
  /** Totais por coluna de mês (soma dos valores). */
  monthTotals: Record<string, number>;
};

const MESES_PT = [
  'JANEIRO',
  'FEVEREIRO',
  'MARÇO',
  'ABRIL',
  'MAIO',
  'JUNHO',
  'JULHO',
  'AGOSTO',
  'SETEMBRO',
  'OUTUBRO',
  'NOVEMBRO',
  'DEZEMBRO',
] as const;

/** Verde claro — só parcelas pagas (fundo branco no restante). */
export const PAID_CELL_FILL = '#C6EFCE';

const FIXED_HEADERS = [
  'FORMA DE PAGTO',
  'ASSESSOR',
  'NOME ALUNO',
  'TELEFONE',
  'TREINAMENTO',
  'E-MAIL',
  'CONTRATOS',
  'VALOR DO CONTRATO',
  'VENCIMENTO',
  'DATA DA ENTRADA',
  'PIX',
  'CARTAO',
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

function ymFromIso(iso?: string): string | null {
  if (!iso) return null;
  const m = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

function dayFromIso(iso?: string): number | null {
  if (!iso || iso.length < 10) return null;
  const d = Number(iso.slice(8, 10));
  return Number.isFinite(d) && d >= 1 && d <= 31 ? d : null;
}

function fmtBR(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function monthLabel(ym: string): string {
  const idx = Number(ym.slice(5, 7)) - 1;
  return MESES_PT[idx] ?? ym;
}

function addMonths(ym: string, delta: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function compareYm(a: string, b: string): number {
  return a.localeCompare(b);
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

/**
 * Detecta forma de pagamento no espírito do modelo:
 * - fluxo de boletos → BOLETO
 * - quitado à vista / sem parcelas de fluxo → PIX ou CARTAO (hints no histórico/tags)
 */
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

/** Para boleto: entrada vai em PIX ou CARTAO conforme hint do método. */
export function detectEntradaDestino(student: Student): 'PIX' | 'CARTAO' {
  const hints = blobHints(student);
  const hasCartao = /\bcartao\b|\bcredito\b/.test(hints);
  const hasPix = /\bpix\b/.test(hints);
  if (hasCartao && !hasPix) return 'CARTAO';
  return 'PIX';
}

function isMultaInstallment(inst: Installment): boolean {
  return (inst.tags ?? []).includes('multa-cancelamento');
}

/**
 * Parcelas que entram nas colunas de mês (exclui entrada embutida/pendência
 * já representada em PIX/CARTAO).
 */
export function installmentsForMonthColumns(student: Student): Installment[] {
  const finance = resolveStudentFinance(student);
  const embeddedId = finance.embeddedEntradaInstallment?.number;
  return (student.installments ?? []).filter((i) => {
    if (isEntradaPendenciaInstallment(i)) return false;
    if (embeddedId != null && i.number === embeddedId) return false;
    if (isMultaInstallment(i)) return true;
    return true;
  });
}

function buildVencimento(student: Student, monthInsts: Installment[]): string {
  const days = new Set<number>();
  if (student.dueDay >= 1 && student.dueDay <= 31) days.add(student.dueDay);
  for (const i of monthInsts) {
    const d = dayFromIso(i.dueDate);
    if (d != null) days.add(d);
  }
  if (days.size === 0) return '';
  return [...days].sort((a, b) => a - b).join(' | ');
}

function buildMonthRange(keys: string[]): ModeloGcIamMonthCol[] {
  if (keys.length === 0) return [];
  const sorted = [...keys].sort(compareYm);
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const cols: ModeloGcIamMonthCol[] = [];
  let cur = start;
  // Proteção: no máximo 48 meses
  for (let n = 0; n < 48; n++) {
    cols.push({ key: cur, label: monthLabel(cur) });
    if (cur === end) break;
    cur = addMonths(cur, 1);
  }
  return cols;
}

function accumulateMonth(
  map: Record<string, { value: number; paidValue: number; openValue: number }>,
  ym: string,
  value: number,
  paid: boolean,
) {
  const cur = map[ym] ?? { value: 0, paidValue: 0, openValue: 0 };
  cur.value = roundMoney(cur.value + value);
  if (paid) cur.paidValue = roundMoney(cur.paidValue + value);
  else cur.openValue = roundMoney(cur.openValue + value);
  map[ym] = cur;
}

/**
 * Monta as linhas no formato do modelo GC IAM a partir dos alunos da empresa ativa.
 */
export function buildModeloGcIamExport(students: Student[]): ModeloGcIamExport {
  const sorted = [...students].sort((a, b) =>
    toDisplayName(a.name).localeCompare(toDisplayName(b.name), 'pt-BR'),
  );

  const draftRows: Array<{
    row: Omit<ModeloGcIamRow, 'months'> & {
      monthAcc: Record<string, { value: number; paidValue: number; openValue: number }>;
    };
  }> = [];

  const allYm = new Set<string>();

  for (const student of sorted) {
    const finance = resolveStudentFinance(student);
    const forma = detectFormaPagto(student);
    const monthInsts = installmentsForMonthColumns(student);
    const monthAcc: Record<string, { value: number; paidValue: number; openValue: number }> = {};

    for (const inst of monthInsts) {
      const ym = ymFromIso(inst.dueDate);
      if (!ym) continue;
      const val = roundMoney(Number(inst.value) || 0);
      if (val <= 0.0049) continue;
      allYm.add(ym);
      accumulateMonth(monthAcc, ym, val, !!inst.paid);
    }

    let pix: number | null = null;
    let cartao: number | null = null;
    const entrada = roundMoney(finance.downPayment);
    const sale = roundMoney(finance.saleValue);

    if (forma === 'BOLETO') {
      if (entrada > 0.0049) {
        if (detectEntradaDestino(student) === 'CARTAO') cartao = entrada;
        else pix = entrada;
      }
    } else if (forma === 'PIX') {
      const v = entrada > 0.0049 ? entrada : sale;
      if (v > 0.0049) pix = v;
    } else {
      // CARTAO — à vista / valor no cartão; se houver entrada PIX no hint, separa
      if (entrada > 0.0049 && sale > entrada + 0.05 && detectEntradaDestino(student) === 'PIX') {
        pix = entrada;
        cartao = roundMoney(sale - entrada);
      } else {
        const v = entrada > 0.0049 ? entrada : sale;
        if (v > 0.0049) cartao = v;
      }
    }

    draftRows.push({
      row: {
        formaPagto: forma,
        assessor: assessorCurto(student.ac),
        nomeAluno: toDisplayName(student.name),
        telefone: student.whatsapp || '',
        treinamento: student.product || '',
        email: student.email || '',
        contrato: toDisplayName(student.name),
        valorContrato: sale > 0.0049 ? sale : entrada,
        vencimento: forma === 'BOLETO' ? buildVencimento(student, monthInsts) : '',
        dataEntrada: fmtBR(student.enrollmentDate),
        pix,
        cartao,
        monthAcc,
      },
    });
  }

  const monthCols = buildMonthRange([...allYm]);
  const monthTotals: Record<string, number> = {};
  for (const col of monthCols) monthTotals[col.key] = 0;

  const rows: ModeloGcIamRow[] = draftRows.map(({ row }) => {
    const months: Record<string, ModeloGcIamMoneyCell> = {};
    for (const col of monthCols) {
      const acc = row.monthAcc[col.key];
      if (!acc || acc.value <= 0.0049) continue;
      // Verde só se não há saldo em aberto naquele mês (todas as parcelas pagas).
      const paid = acc.openValue <= 0.0049 && acc.paidValue > 0.0049;
      months[col.key] = { value: acc.value, paid };
      monthTotals[col.key] = roundMoney((monthTotals[col.key] ?? 0) + acc.value);
    }
    return {
      formaPagto: row.formaPagto,
      assessor: row.assessor,
      nomeAluno: row.nomeAluno,
      telefone: row.telefone,
      treinamento: row.treinamento,
      email: row.email,
      contrato: row.contrato,
      valorContrato: row.valorContrato,
      vencimento: row.vencimento,
      dataEntrada: row.dataEntrada,
      pix: row.pix,
      cartao: row.cartao,
      months,
    };
  });

  return { monthCols, rows, monthTotals };
}

function moneyCsv(n: number | null | undefined): string {
  if (n == null || !(n > 0.0049)) return '';
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** CSV no modelo (sem cores — CSV não guarda formatação). */
export function modeloGcIamToCsv(data: ModeloGcIamExport): string {
  const headers = [...FIXED_HEADERS, ...data.monthCols.map((c) => c.label)];
  const lines: string[] = [headers.map(csvEscape).join(',')];

  // Linha de totais (como no modelo — só meses preenchidos)
  const totalCells = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ...data.monthCols.map((c) => moneyCsv(data.monthTotals[c.key] || null)),
  ];
  lines.push(totalCells.map(csvEscape).join(','));

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
      r.vencimento,
      r.dataEntrada,
      moneyCsv(r.pix),
      moneyCsv(r.cartao),
      ...data.monthCols.map((c) => moneyCsv(r.months[c.key]?.value ?? null)),
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

/**
 * SpreadsheetML (.xls) — Excel / Google Sheets abrem com fundo branco e
 * verde só nas parcelas pagas. CSV não permite cor de célula.
 */
export function modeloGcIamToSpreadsheetMl(data: ModeloGcIamExport): string {
  const headers = [...FIXED_HEADERS, ...data.monthCols.map((c) => c.label)];
  const colCount = headers.length;

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
  const cellNum = (n: number, paid: boolean) =>
    `<Cell ss:StyleID="${paid ? 'Paid' : 'Money'}"><Data ss:Type="Number">${n}</Data></Cell>`;
  const cellEmpty = () => `<Cell ss:StyleID="Text"><Data ss:Type="String"></Data></Cell>`;

  const rowsXml: string[] = [];

  rowsXml.push(
    `<Row>${headers.map((h) => cellText(h, 'Header')).join('')}</Row>`,
  );

  // Totais
  {
    const cells: string[] = [];
    for (let i = 0; i < 12; i++) cells.push(cellEmpty());
    for (const col of data.monthCols) {
      const t = data.monthTotals[col.key] ?? 0;
      cells.push(t > 0.0049 ? cellNum(t, false) : cellEmpty());
    }
    rowsXml.push(`<Row>${cells.join('')}</Row>`);
  }

  for (const r of data.rows) {
    const cells: string[] = [
      cellText(r.formaPagto),
      cellText(r.assessor),
      cellText(r.nomeAluno),
      cellText(r.telefone),
      cellText(r.treinamento),
      cellText(r.email),
      cellText(r.contrato),
      r.valorContrato > 0.0049 ? cellNum(r.valorContrato, false) : cellEmpty(),
      cellText(r.vencimento),
      cellText(r.dataEntrada),
      r.pix != null && r.pix > 0.0049 ? cellNum(r.pix, false) : cellEmpty(),
      r.cartao != null && r.cartao > 0.0049 ? cellNum(r.cartao, false) : cellEmpty(),
    ];
    for (const col of data.monthCols) {
      const cell = r.months[col.key];
      if (!cell || cell.value <= 0.0049) cells.push(cellEmpty());
      else cells.push(cellNum(cell.value, cell.paid));
    }
    rowsXml.push(`<Row>${cells.join('')}</Row>`);
  }

  void colCount;

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

/**
 * Exporta no modelo IAM.
 * - `xls`: SpreadsheetML com fundo branco e verde só em parcelas pagas
 * - `csv`: mesmos dados sem formatação (CSV não guarda cor)
 */
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
