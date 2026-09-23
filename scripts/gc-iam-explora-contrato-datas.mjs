/**
 * Chama iam-control-contrato com IDs conhecidos e lista chaves do payload bruto.
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
  readEnv('VITE_SUPABASE_ANON_KEY') ||
  readEnv('SUPABASE_ANON_KEY');

const alvos = [
  { nome: 'LARISSA', iam: 17213, contrato: '2155', produto: 'Confronto' },
  { nome: 'LUIZ', iam: 7605, contrato: '2153', produto: 'Confronto' },
  { nome: 'AGDA', iam: 16387, contrato: '2154', produto: 'Confronto' },
];

const out = [];

for (const a of alvos) {
  const res = await fetch(`${url}/functions/v1/iam-control-contrato`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      iam_control_aluno_id: a.iam,
      contrato_id: a.contrato,
      produto: a.produto,
      somente_meta: true,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  console.log('\n====', a.nome, 'meta ====');
  console.log(JSON.stringify(json, null, 2).slice(0, 2000));
  out.push({ ...a, meta: json });
}

// Busca cliente completo
const busca = await fetch(`${url}/functions/v1/iam-control-busca-cliente`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nomes: ['LUIZ MAURICIO FERNANDES CAETANO', 'AGDA DAMACENO ZELANTE', 'LARISSA MASIERO'],
    max_paginas: 30,
  }),
});
const body = await busca.json();
out.push({ busca_keys: Object.keys(body), encontrados: (body.encontrados ?? []).length });

for (const e of body.encontrados ?? []) {
  const c = e.cliente ?? e;
  console.log('\n==== cliente', c.nome, 'top keys', Object.keys(c));
  for (const m of c.matriculas ?? []) {
    console.log(' matricula keys', Object.keys(m));
    for (const t of m.treinamentos ?? []) {
      console.log(' treinamento FULL', JSON.stringify(t, null, 2));
    }
  }
  if (c.financeiro) console.log(' financeiro', JSON.stringify(c.financeiro));
}

fs.writeFileSync('scripts/.iam-explora-out.json', JSON.stringify(out, null, 2));
console.log('\nsaved scripts/.iam-explora-out.json');
