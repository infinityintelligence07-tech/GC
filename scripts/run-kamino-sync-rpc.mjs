/**
 * Carrega batches Kamino via RPC Supabase e executa sync.
 * Uso: node scripts/run-kamino-sync-rpc.mjs [--dry-run]
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

const dryRun = process.argv.includes('--dry-run');
const syncOnly = process.argv.includes('--sync-only');
const url = readEnv('VITE_SUPABASE_URL');
const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
const supabase = createClient(url, key);

const kamino = JSON.parse(fs.readFileSync('scripts/.kamino-parsed.json', 'utf8'));
const batchSize = 35;

function toPayload(batch) {
  return batch.map((k) => ({
    skey: k.key,
    name: k.name,
    whatsapp: k.whatsapp || '',
    email: k.email || null,
    ac: k.ac || '',
    product: k.product || '',
    enrollment_date: k.enrollmentDate || null,
    data_treinamento_origem: k.data_treinamento_origem || k.enrollmentDate || null,
    due_day: k.dueDay ?? 10,
    sale_value: k.saleValue ?? 0,
    down_payment: k.downPayment ?? 0,
    total_installments: k.totalInstallments ?? 0,
    paid_installments: k.paidInstallments ?? 0,
    installment_value: k.installmentValue ?? 0,
    installments: k.installments ?? [],
    detalhes: k.detalhes || null,
    status: k.status || 'Em Dia',
  }));
}

async function main() {
  console.log('Alunos Kamino:', kamino.length, dryRun ? '(dry-run)' : '');

  if (dryRun) {
    console.log('Batches:', Math.ceil(kamino.length / batchSize));
    return;
  }

  if (!syncOnly) {
  let loaded = 0;
  for (let i = 0; i < kamino.length; i += batchSize) {
    const batch = kamino.slice(i, i + batchSize);
    const payload = toPayload(batch);
    const truncate = i === 0;
    const { data, error } = await supabase.rpc('load_kamino_batch', {
      p_payload: payload,
      p_truncate: truncate,
    });
    if (error) throw error;
    loaded += batch.length;
    console.log(`Batch ${Math.floor(i / batchSize) + 1}: +${batch.length} (rpc rows ${data}) | total ${loaded}`);
  }
  } else {
    console.log('Pulando carga — staging já populado (--sync-only)');
  }

  const { data: syncResult, error: syncErr } = await supabase.rpc('run_kamino_sync_from_staging');
  if (syncErr) throw syncErr;

  console.log('\n=== SYNC CONCLUÍDO ===');
  console.log(JSON.stringify(syncResult, null, 2));

  const { data: funnel, error: fErr } = await supabase
    .from('cancellation_cases')
    .select('funnel_stage');
  if (!fErr && funnel) {
    const counts = {};
    for (const r of funnel) counts[r.funnel_stage] = (counts[r.funnel_stage] ?? 0) + 1;
    console.log('\nCancelamentos por etapa:', counts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
