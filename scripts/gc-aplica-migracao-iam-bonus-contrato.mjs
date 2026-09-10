/**
 * Aplica 20260910120000_iam_bonus_com_contrato_vendido.sql:
 *   sync IAM passa a subir treinamento VENDIDO (contrato_id + valor) mesmo
 *   dentro de matrícula ALUNO_BONUS. Valida com o payload real do Igor da
 *   Silva Andrade (busca na API do IAM via edge function).
 *
 * Sem --apply: roda numa transação e REVERTE (mostra o que o upsert faria).
 * Com --apply: aplica a função nova. Depois rode scripts/gc-iam-pull-completo.mjs
 * para os clientes já descartados voltarem.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260910120000_iam_bonus_com_contrato_vendido.sql';
const APLICAR = process.argv.includes('--apply');
const NOME_TESTE = process.argv.find((a) => a.startsWith('--nome='))?.slice(7) ?? 'IGOR DA SILVA ANDRADE';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try { await c.connect(); return c; } catch { await c.end().catch(() => {}); }
  }
  throw new Error('sem conexão com o banco');
}

async function buscarPayloadIam(nome) {
  const url = readEnv('VITE_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || readEnv('VITE_SUPABASE_ANON_KEY');
  const r = await fetch(`${url}/functions/v1/iam-control-busca-cliente`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ nome, max_paginas: 20 }),
  });
  const j = await r.json();
  return (j.encontrados ?? []).map((e) => e.cliente);
}

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  const clientes = await buscarPayloadIam(NOME_TESTE);
  console.log(`IAM: ${clientes.length} cliente(s) para "${NOME_TESTE}"`);

  await client.query('BEGIN');
  for (const c of clientes) {
    const { rows } = await client.query('SELECT public.iam_control_upsert_student($1::jsonb) r', [JSON.stringify(c)]);
    console.log('ANTES  (função atual):', c.nome, '→', JSON.stringify(rows[0].r).slice(0, 300));
  }

  await client.query(sql);

  // Simula o upsert com a função nova e reverte tudo (o backfill real é o pull).
  await client.query('SAVEPOINT simulacao');
  for (const c of clientes) {
    const { rows } = await client.query('SELECT public.iam_control_upsert_student($1::jsonb) r', [JSON.stringify(c)]);
    console.log('DEPOIS (função nova) :', c.nome, '→', JSON.stringify(rows[0].r, null, 1).slice(0, 1500));
  }
  await client.query('ROLLBACK TO SAVEPOINT simulacao');

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nMIGRAÇÃO APLICADA (função nova). Rode agora: node scripts/gc-iam-pull-completo.mjs');
  } else {
    await client.query('ROLLBACK');
    console.log('\nrevertido — nada foi alterado. Rode com --apply para aplicar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU, nada foi alterado:', e.message);
  process.exitCode = 1;
}

await client.end();
