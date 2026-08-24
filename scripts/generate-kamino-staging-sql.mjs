import fs from 'node:fs';
import path from 'node:path';

const students = JSON.parse(fs.readFileSync(path.resolve('scripts/kamino-parsed.json'), 'utf8'));
const outDir = path.resolve('scripts/kamino-live-batches');
fs.mkdirSync(outDir, { recursive: true });

function sqlStr(value) {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

const BATCH = 25;
const files = [];

for (let i = 0; i < students.length; i += BATCH) {
  const chunk = students.slice(i, i + BATCH);
  const n = String(Math.floor(i / BATCH) + 1).padStart(3, '0');
  const lines = chunk.map((s) => {
    const enrollment = s.enrollmentDate || null;
    const origem = s.data_treinamento_origem || enrollment;
    return `(${sqlStr(s.key)}, ${sqlStr(s.name)}, ${sqlStr(s.whatsapp)}, ${sqlStr(s.email)}, ${sqlStr(s.ac)}, ${sqlStr(s.product)}, ${enrollment ? sqlStr(enrollment) : 'NULL'}::date, ${origem ? sqlStr(origem) : 'NULL'}::date, ${s.dueDay ?? 10}, ${s.saleValue ?? 0}, ${s.downPayment ?? 0}, ${s.totalInstallments ?? 0}, ${s.paidInstallments ?? 0}, ${s.installmentValue ?? 0}, ${sqlJson(s.installments)}, ${sqlStr(s.detalhes)}, ${sqlStr(s.status)})`;
  });

  let sql = '';
  if (i === 0) sql += 'TRUNCATE public._kamino_sync_staging;\n';
  sql += `INSERT INTO public._kamino_sync_staging (
  skey, name, whatsapp, email, ac, product,
  enrollment_date, data_treinamento_origem, due_day,
  sale_value, down_payment, total_installments, paid_installments,
  installment_value, installments, detalhes, status
) VALUES\n${lines.join(',\n')}\nON CONFLICT (skey) DO UPDATE SET
  name = EXCLUDED.name,
  whatsapp = EXCLUDED.whatsapp,
  email = EXCLUDED.email,
  ac = EXCLUDED.ac,
  product = EXCLUDED.product,
  enrollment_date = EXCLUDED.enrollment_date,
  data_treinamento_origem = EXCLUDED.data_treinamento_origem,
  due_day = EXCLUDED.due_day,
  sale_value = EXCLUDED.sale_value,
  down_payment = EXCLUDED.down_payment,
  total_installments = EXCLUDED.total_installments,
  paid_installments = EXCLUDED.paid_installments,
  installment_value = EXCLUDED.installment_value,
  installments = EXCLUDED.installments,
  detalhes = EXCLUDED.detalhes,
  status = EXCLUDED.status;`;

  const file = path.join(outDir, `batch-${n}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  files.push(file);
}

fs.writeFileSync(path.join(outDir, '99-run-sync.sql'), 'SELECT public.run_kamino_sync_from_staging();\n', 'utf8');
console.log(JSON.stringify({ batches: files.length, students: students.length, outDir }));
