/**
 * Exporta students do GC via Supabase REST (anon key).
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

const url = readEnv('VITE_SUPABASE_URL');
const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
const supabase = createClient(url, key);

const PAGE = 500;
const fields = [
  'id', 'name', 'whatsapp', 'email', 'cpf', 'address', 'numero', 'cidade', 'estado', 'cep',
  'status', 'status_mode', 'ac', 'product', 'enrollment_date', 'data_treinamento_origem',
  'due_day', 'sale_value', 'down_payment', 'total_installments', 'paid_installments',
  'installment_value', 'installments', 'history', 'is_renda_extra', 'renda_extra_status',
  'renda_extra_ac', 'status_cancelamento', 'cancellation_case_id', 'tags', 'detalhes',
  'company_id', 'ciclo', 'status_antes_cancelamento',
].join(',');

async function main() {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('students')
      .select(fields)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const { data: cancelCases, error: cErr } = await supabase
    .from('cancellation_cases')
    .select('id, student_id, student_name, funnel_stage, stage, ac, treinamento');
  if (cErr) throw cErr;

  fs.writeFileSync('scripts/.gc-students.json', JSON.stringify(all, null, 2), 'utf8');
  fs.writeFileSync('scripts/.gc-cancel-cases.json', JSON.stringify(cancelCases, null, 2), 'utf8');
  console.log(JSON.stringify({ students: all.length, cancelCases: cancelCases.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
