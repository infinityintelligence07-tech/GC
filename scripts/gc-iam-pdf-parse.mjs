/**
 * Tenta endpoints IAM que possam trazer cronograma/vencimentos do contrato.
 */
import fs from 'node:fs';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '').replaceAll("'", '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '').replaceAll("'", '') ?? '';
}

const url = readEnv('VITE_SUPABASE_URL');
const key =
  readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
  readEnv('VITE_SUPABASE_ANON_KEY');

// Invoca via edge que já tem o token — estendemos diagnostico? Melhor usar
// uma function inline via fetch ao próprio IAM através de um script que
// chama uma edge existente. Como não temos o token local, usamos o
// iam-control-diagnostico? Não.
//
// Alternativa: deploy rápido não. Usar shell com secrets do supabase?
// Vamos pedir ao edge iam-control-contrato paths extras via query no body
// — ainda não existe.
//
// Cheat: o pull clientes já veio sem datas. Vamos tentar pdf-parse no PDF.

let pdfParse;
try {
  const require = (await import('node:module')).createRequire(import.meta.url);
  pdfParse = require('pdf-parse');
} catch {
  console.log('pdf-parse não instalado, tentando install…');
}

if (!pdfParse) {
  const { execSync } = await import('node:child_process');
  execSync('npm install pdf-parse --no-save', { stdio: 'inherit' });
  const require = (await import('node:module')).createRequire(import.meta.url);
  pdfParse = require('pdf-parse');
}

const buf = fs.readFileSync('scripts/.iam-contrato-agda.pdf');
const data = await pdfParse(buf);
console.log('pages', data.numpages, 'text len', data.text?.length);
console.log('--- TEXT START ---');
console.log((data.text || '').slice(0, 4000));
console.log('--- TEXT END ---');

const datas = [...(data.text || '').matchAll(/\b\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4}\b/g)].map((m) => m[0]);
console.log('datas', [...new Set(datas)]);

const lines = (data.text || '').split(/\n/).filter((l) => /venc|parcela|boleto|mensal|dia\s*\d|1ª|2ª|entrada/i.test(l));
console.log('linhas relevantes:');
for (const l of lines.slice(0, 40)) console.log(' ', l.trim());
