/**
 * Busca payload bruto do IAM Control para investigar datas de pendência/boleto.
 * Uso: node scripts/gc-iam-busca-datas.mjs
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
if (!url || !key) {
  console.error('Faltam VITE_SUPABASE_URL / PUBLISHABLE_KEY no .env');
  process.exit(1);
}

const res = await fetch(`${url}/functions/v1/iam-control-busca-cliente`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    nomes: [
      'WELLINGTON HENRIQUES DA COSTA',
      'LUIZ MAURICIO FERNANDES CAETANO',
      'BRENO CESAR CARNEIRO MACHADO',
      'BRENO CÉSAR CARNEIRO MACHADO',
    ],
    max_paginas: 30,
  }),
});

const text = await res.text();
fs.writeFileSync('scripts/.iam-busca-datas.json', text);
console.log('status', res.status, 'bytes', text.length);

let body;
try {
  body = JSON.parse(text);
} catch {
  console.log(text.slice(0, 500));
  process.exit(1);
}

const clientes = body.encontrados ?? body.clientes ?? body.matches ?? [];
console.log('chaves', Object.keys(body));
console.log('encontrados', Array.isArray(clientes) ? clientes.length : typeof clientes);

function walkKeys(obj, path = '', acc = new Set()) {
  if (obj == null || typeof obj !== 'object') return acc;
  if (Array.isArray(obj)) {
    for (const item of obj) walkKeys(item, path, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/data|venc|dia_|boleto|penden|parcela/i.test(k)) acc.add(p);
    walkKeys(v, p, acc);
  }
  return acc;
}

const keys = walkKeys(body);
console.log('campos com data/venc/parcela:');
for (const k of [...keys].sort()) console.log(' ', k);

for (const c of Array.isArray(clientes) ? clientes.slice(0, 5) : []) {
  const nome = c.nome ?? c.name ?? '?';
  console.log('\n===', nome, '===');
  for (const m of c.matriculas ?? []) {
    for (const t of m.treinamentos ?? []) {
      console.log(
        JSON.stringify(
          {
            treinamento: t.nome ?? t.sigla ?? t.treinamento,
            data_venda: t.data_venda,
            status_conciliacao: t.status_conciliacao,
            valor_entrada: t.valor_entrada,
            valor_pago: t.valor_pago,
            valor_pendente: t.valor_pendente,
            parcelas: t.parcelas,
            parcelas_detalhe: t.parcelas_detalhe,
            formas: t.formas_pagamento,
            extras_data: Object.fromEntries(
              Object.entries(t).filter(([k]) => /data|venc|dia_/i.test(k)),
            ),
          },
          null,
          2,
        ),
      );
    }
  }
}
