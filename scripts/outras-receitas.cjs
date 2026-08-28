const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Usuario/Downloads/KAMINO GC (1).xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(/[R$\s.]/g, '').replace(',', '.')) || 0);
const fmtDate = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(v);
};
for (const r of rows) {
  if (String(r['Classificação']).trim() !== 'Outras Receitas Financeiras') continue;
  console.log(JSON.stringify({
    pessoa: r['Pessoa'],
    detalhe: r['Detalhe'],
    aReceber: num(r['Valor a Receber (R$)']),
    recebido: num(r['Valor Recebido (R$)']),
    vencimento: fmtDate(r['Vencimento']),
    recebimento: fmtDate(r['Recebimento']),
    forma: r['Forma de Recebimento'],
  }));
}
