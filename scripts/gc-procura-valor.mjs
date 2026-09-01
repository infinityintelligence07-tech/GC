/**
 * SOMENTE LEITURA: procura um valor em todas as planilhas da raiz, célula a
 * célula e também como soma de colunas numéricas por aba.
 *
 * Uso: node scripts/gc-procura-valor.mjs 49061.04
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

XLSX.set_fs(fs);

const ALVO = Number(process.argv[2] ?? 49061.04);
const TOL = 0.5;
const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const arquivos = fs.readdirSync('.').filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
console.log('planilhas:', arquivos.join(' | '), '\n');

for (const arq of arquivos) {
  const wb = XLSX.read(fs.readFileSync(arq), { type: 'buffer' });
  for (const nomeAba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { defval: null });
    if (!rows.length) continue;

    for (const [idx, row] of rows.entries()) {
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number' && Math.abs(R(v) - ALVO) < TOL) {
          console.log(`CÉLULA  ${arq} > ${nomeAba} > linha ${idx + 2} > coluna "${k}" = ${brl(v)}`);
          console.log(`        linha: ${JSON.stringify(row).slice(0, 240)}`);
        }
      }
    }

    const colunas = new Map();
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (typeof v !== 'number') continue;
        colunas.set(k, (colunas.get(k) ?? 0) + v);
      }
    }
    for (const [k, soma] of colunas) {
      if (Math.abs(R(soma) - ALVO) < TOL) {
        console.log(`SOMA    ${arq} > ${nomeAba} > soma da coluna "${k}" = ${brl(soma)} (${rows.length} linhas)`);
      }
    }
  }
}
console.log('\nbusca concluída para', brl(ALVO));
