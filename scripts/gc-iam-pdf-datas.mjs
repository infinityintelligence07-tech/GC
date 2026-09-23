/**
 * Baixa PDF do contrato IAM e tenta extrair datas de vencimento do texto.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '').replaceAll("'", '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '').replaceAll("'", '') ?? '';
}

const url = readEnv('VITE_SUPABASE_URL');
const key =
  readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
  readEnv('VITE_SUPABASE_ANON_KEY') ||
  readEnv('SUPABASE_ANON_KEY');

const alvo = { nome: 'AGDA', iam: 16387, contrato: '2154', produto: 'Confronto' };

const res = await fetch(`${url}/functions/v1/iam-control-contrato`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    iam_control_aluno_id: alvo.iam,
    contrato_id: alvo.contrato,
    produto: alvo.produto,
    somente_meta: false,
  }),
});
const json = await res.json();
console.log('ok', json.ok, 'keys', Object.keys(json), 'aviso', json.aviso, 'pdf?', Boolean(json.pdf_base64));

if (!json.pdf_base64) {
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));
  process.exit(1);
}

const buf = Buffer.from(json.pdf_base64, 'base64');
fs.writeFileSync('scripts/.iam-contrato-agda.pdf', buf);
console.log('pdf bytes', buf.length);

// Extrai texto bruto do PDF (strings literais) — sem lib pesada
const raw = buf.toString('latin1');
const datas = [...raw.matchAll(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]);
const uniq = [...new Set(datas)];
console.log('datas encontradas no PDF:', uniq.slice(0, 40));

// Trechos perto de venc/parcela
const lower = raw.toLowerCase();
for (const word of ['venc', 'parcela', 'boleto', 'mensal', 'dia ']) {
  let idx = 0;
  let n = 0;
  while ((idx = lower.indexOf(word, idx)) !== -1 && n < 3) {
    const snippet = raw.slice(Math.max(0, idx - 40), idx + 80).replace(/[^\x20-\x7E\u00C0-\u00FF]/g, ' ');
    console.log(`\n[${word}]`, snippet);
    idx += word.length;
    n++;
  }
}
