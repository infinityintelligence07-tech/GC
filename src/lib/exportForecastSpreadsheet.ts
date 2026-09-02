import * as XLSX from 'xlsx';

export type ForecastExportBucket = 'pago' | 'a_vencer';

export type ForecastExportRow = {
  bucket: ForecastExportBucket;
  studentId: string;
  studentName: string;
  ac: string;
  product?: string;
  whatsapp?: string;
  email?: string;
  status?: string;
  saleValue?: number;
  installmentNumber: number;
  dueDate: string;
  value: number;
  paidValue: number;
  paidDate?: string;
};

function fmtBR(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function toSheetRows(rows: ForecastExportRow[]) {
  return rows
    .slice()
    .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.installmentNumber - b.installmentNumber)
    .map((r) => ({
      Aluno: r.studentName,
      WhatsApp: r.whatsapp || '',
      Email: r.email || '',
      Produto: r.product || '',
      Assessor: r.ac || '',
      Status: r.status || '',
      'Valor Venda': typeof r.saleValue === 'number' ? r.saleValue : '',
      Parcela: r.installmentNumber,
      Vencimento: fmtBR(r.dueDate),
      'Data Pagamento': fmtBR(r.paidDate),
      'Valor Parcela': r.value,
      'Valor Recebido': r.bucket === 'pago' ? r.paidValue : '',
      Situação: r.bucket === 'pago' ? 'Pago' : 'A Vencer / Vencido',
    }));
}

export function exportForecastSpreadsheet(
  rows: ForecastExportRow[],
  opts: {
    dateBasis: 'vencimento' | 'pagamento';
    periodLabel: string;
    filePrefix?: string;
  },
): void {
  const aVencer = rows.filter((r) => r.bucket === 'a_vencer');
  const pago = rows.filter((r) => r.bucket === 'pago');
  const totalAv = aVencer.reduce((s, r) => s + r.value, 0);
  const totalPg = pago.reduce((s, r) => s + r.value, 0);
  const totalPgReal = pago.reduce((s, r) => s + r.paidValue, 0);

  const wb = XLSX.utils.book_new();

  const resumo = [
    { Campo: 'Base', Valor: opts.dateBasis === 'vencimento' ? 'Data de Vencimento' : 'Data de Pagamento' },
    { Campo: 'Período', Valor: opts.periodLabel },
    { Campo: 'Linhas A Vencer / Vencido', Valor: aVencer.length },
    { Campo: 'Total A Vencer / Vencido', Valor: totalAv },
    { Campo: 'Linhas Pago', Valor: pago.length },
    { Campo: 'Total Pago (valor parcela)', Valor: totalPg },
    { Campo: 'Total Recebido', Valor: totalPgReal },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');

  if (opts.dateBasis === 'vencimento' || aVencer.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(toSheetRows(aVencer)),
      'A Vencer Vencido',
    );
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toSheetRows(pago)), 'Pago');

  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const periodSlug = opts.periodLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'periodo';
  const prefix = opts.filePrefix || 'projecao-carteira';
  XLSX.writeFile(wb, `${prefix}-${opts.dateBasis}-${periodSlug}-${stamp}.xlsx`);
}
