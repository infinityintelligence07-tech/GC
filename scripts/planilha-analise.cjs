const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Usuario/Downloads/KAMINO GC (1).xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(/[R$\s.]/g, '').replace(',', '.')) || 0);

let aberto = 0;
const porClasse = new Map();
let parciais = [];
let saldoParcial = 0;
for (const r of rows) {
  const aReceber = num(r['Valor a Receber (R$)']);
  const recebido = num(r['Valor Recebido (R$)']);
  const temRecebimento = String(r['Recebimento'] || '').trim() !== '';
  if (!temRecebimento && recebido === 0) {
    aberto += aReceber;
    const c = String(r['Classificação']).trim();
    porClasse.set(c, (porClasse.get(c) || 0) + aReceber);
  }
  if (recebido > 0 && recebido < aReceber - 0.005) {
    parciais.push({ pessoa: r['Pessoa'], aReceber, recebido, saldo: +(aReceber - recebido).toFixed(2), venc: r['Vencimento'], receb: r['Recebimento'] });
    saldoParcial += aReceber - recebido;
  }
}
console.log('total em aberto:', aberto.toFixed(2));
console.log('--- por classificacao ---');
for (const [c, v] of [...porClasse.entries()].sort((a, b) => b[1] - a[1])) console.log(c, '=>', v.toFixed(2));
console.log('--- recebimentos parciais (recebido < a receber) ---');
console.log('qtd:', parciais.length, 'saldo restante total:', saldoParcial.toFixed(2));
for (const p of parciais) console.log(JSON.stringify(p));
