const fs = require('fs');
const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Usuario/Downloads/KAMINO GC (1).xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(/[R$\s.]/g, '').replace(',', '.')) || 0);
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

let totalSemRecebimento = 0;
let totalRecebidoZero = 0;
const porPessoa = new Map();
for (const r of rows) {
  const aReceber = num(r['Valor a Receber (R$)']);
  const recebido = num(r['Valor Recebido (R$)']);
  const temRecebimento = String(r['Recebimento'] || '').trim() !== '';
  if (!temRecebimento) totalSemRecebimento += aReceber;
  if (recebido === 0) totalRecebidoZero += aReceber;
  const aberto = !temRecebimento && recebido === 0;
  if (aberto) {
    const k = norm(r['Pessoa']);
    porPessoa.set(k, (porPessoa.get(k) || 0) + aReceber);
  }
}
console.log('total (sem data de recebimento):', totalSemRecebimento.toFixed(2));
console.log('total (recebido = 0):', totalRecebidoZero.toFixed(2));
console.log('pessoas com aberto:', porPessoa.size);
fs.writeFileSync('scripts/planilha-aberto.json', JSON.stringify(Object.fromEntries(porPessoa)));
