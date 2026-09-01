/**
 * SOMENTE LEITURA: extrai o texto do PDF "KAMINO - Recebimentos", identifica as
 * linhas de recebimento e soma por data de recebimento, para localizar de onde
 * sai o total de "baixados" que o usuário está vendo.
 *
 * Uso: node scripts/gc-pdf-recebimentos.mjs [YYYY-MM-DD]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

const PDF_PATH = 'KAMINO_GC_Recebimentos.pdf';
const CORTE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-21';
const ALVO = 49061.04;

const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const marca = (v) => (Math.abs(R(v) - ALVO) < 1 ? '   <<<< 49.061,04' : '');
const isoDe = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(PDF_PATH)), useSystemFonts: true }).promise;
console.log(`páginas: ${doc.numPages}`);

let texto = '';
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  let linha = '';
  let ultimoY = null;
  for (const item of content.items) {
    const y = Math.round(item.transform[5]);
    if (ultimoY !== null && Math.abs(y - ultimoY) > 2) {
      texto += linha.trim() + '\n';
      linha = '';
    }
    linha += item.str + ' ';
    ultimoY = y;
  }
  texto += linha.trim() + '\n';
}

const linhas = texto.split('\n');
console.log(`linhas de texto: ${linhas.length}`);

// Cada lançamento termina com: ... Valor Total  Vencimento  Recebimento  Competência
const num = String.raw`-?[\d.,]+`;
const re = new RegExp(
  String.raw`(${num})\s+(${num})\s+(${num})\s+(${num})\s+(${num})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*$`,
);
const toNum = (s) => Number(String(s).replaceAll(',', '')) || 0;

const regs = [];
for (const l of linhas) {
  const m = re.exec(l.trim());
  if (!m) continue;
  regs.push({
    valorTotal: toNum(m[5]),
    venc: isoDe(m[6]),
    receb: isoDe(m[7]),
    pessoa: l.trim().slice(0, 46),
  });
}
console.log(`lançamentos reconhecidos: ${regs.length}`);
console.log(`soma geral: R$ ${brl(regs.reduce((a, r) => a + r.valorTotal, 0))}`);

const porMes = new Map();
for (const r of regs) {
  const k = (r.receb ?? '????-??').slice(0, 7);
  if (!porMes.has(k)) porMes.set(k, { n: 0, total: 0 });
  const g = porMes.get(k);
  g.n += 1;
  g.total += r.valorTotal;
}
console.log('\n=== RECEBIMENTOS POR MÊS ===');
for (const [k, g] of [...porMes].sort()) {
  console.log(`${k} | ${String(g.n).padStart(5)} linhas | R$ ${brl(g.total).padStart(14)}${marca(g.total)}`);
}

console.log(`\n=== RECEBIMENTOS APÓS ${CORTE} ===`);
const pos = regs.filter((r) => r.receb && r.receb > CORTE).sort((a, b) => a.receb.localeCompare(b.receb));
const porDia = new Map();
for (const r of pos) {
  if (!porDia.has(r.receb)) porDia.set(r.receb, { n: 0, total: 0 });
  const g = porDia.get(r.receb);
  g.n += 1;
  g.total += r.valorTotal;
}
let acc = 0;
for (const [d, g] of [...porDia].sort()) {
  acc += g.total;
  console.log(
    `${d} | ${String(g.n).padStart(4)} linhas | R$ ${brl(g.total).padStart(13)} | acumulado R$ ${brl(acc).padStart(13)}${marca(g.total)}${marca(acc)}`,
  );
}
console.log(`TOTAL após ${CORTE}: ${pos.length} linhas | R$ ${brl(acc)}${marca(acc)}`);
