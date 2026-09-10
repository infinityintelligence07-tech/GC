/**
 * Roda a edge function iam-control-pull-clientes em modo COMPLETO (todas as
 * páginas da API do IAM, sem filtro de atualizado_desde), chamando em ciclos
 * até `continuar` = false. Usado para backfill depois de mudar a regra do
 * upsert (ex.: 20260910120000 — venda dentro de matrícula bônus).
 *
 * Uso: node scripts/gc-iam-pull-completo.mjs [--max-paginas=20] [--page-inicio=1]
 */
import fs from 'node:fs';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

const url = readEnv('VITE_SUPABASE_URL') || readEnv('SUPABASE_URL');
const key = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || readEnv('VITE_SUPABASE_ANON_KEY');
const maxPaginas = Number(process.argv.find((a) => a.startsWith('--max-paginas='))?.split('=')[1] ?? 20);
let pageInicio = Number(process.argv.find((a) => a.startsWith('--page-inicio='))?.split('=')[1] ?? 1);

const totais = { recebidos: 0, criados: 0, atualizados: 0, ambiguos: 0, ignorados: 0, erros: 0 };
const ocorrencias = [];
for (let ciclo = 1; ciclo <= 50; ciclo++) {
  const r = await fetch(`${url}/functions/v1/iam-control-pull-clientes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ completo: true, max_paginas: maxPaginas, page_inicio: pageInicio }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) {
    console.error(`ciclo ${ciclo}: falhou (${r.status})`, JSON.stringify(j).slice(0, 600));
    process.exitCode = 1;
    break;
  }
  for (const k of Object.keys(totais)) totais[k] += Number(j.resumo?.[k] ?? 0);
  for (const o of j.resumo?.ocorrencias ?? []) ocorrencias.push(o);
  console.log(
    `ciclo ${ciclo}: páginas ${pageInicio}–${j.page_atual}/${j.total_paginas} · recebidos ${j.resumo.recebidos} · criados ${j.resumo.criados} · atualizados ${j.resumo.atualizados} · ignorados ${j.resumo.ignorados} · erros ${j.resumo.erros} · ${j.duracao_ms} ms`,
  );
  if (!j.continuar || !j.page_proxima) break;
  pageInicio = j.page_proxima;
}
console.log('\nTOTAL:', totais);
if (ocorrencias.length) console.log('ocorrências:', ocorrencias.slice(0, 25));
