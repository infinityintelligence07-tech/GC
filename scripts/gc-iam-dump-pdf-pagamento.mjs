import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

function readEnv(key) {
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

const url = readEnv('VITE_SUPABASE_URL');
const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

const alvos = [
  { nome: 'AMANDA', iam: 17894, contrato: '2161' },
  { nome: 'RENATA', iam: 17463, contrato: '2140' },
  { nome: 'FLAVIA1', iam: 11800, contrato: '2157' },
  { nome: 'FLAVIA2', iam: 11800, contrato: '2168' },
];

for (const a of alvos) {
  const res = await fetch(`${url}/functions/v1/iam-control-contrato`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      iam_control_aluno_id: a.iam,
      contrato_id: a.contrato,
      produto: 'Confronto',
    }),
  });
  const j = await res.json();
  console.log('\n====', a.nome, a.contrato, 'pdf?', Boolean(j.pdf_base64), j.aviso || '');
  if (!j.pdf_base64) continue;
  const p = new PDFParse({ data: Buffer.from(j.pdf_base64, 'base64') });
  const d = await p.getText();
  const t = d.text || '';
  const idx = t.toLowerCase().indexOf('forma de pagamento');
  console.log(t.slice(Math.max(0, idx), Math.max(0, idx) + 800));
}
