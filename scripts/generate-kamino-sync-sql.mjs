/**
 * Gera plano de sync offline (sem conexão direta PG) e SQL para aplicar via Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { studentKey } from './lib/kamino-parse.mjs';

const kamino = JSON.parse(fs.readFileSync('scripts/.kamino-parsed.json', 'utf8'));
const studentsRaw = fs.readFileSync(process.argv[2] ?? 'scripts/.gc-students.json', 'utf8');
const dbStudents = JSON.parse(studentsRaw);
const cancelCases = JSON.parse(fs.readFileSync('scripts/.gc-cancel-cases.json', 'utf8'));

const kaminoByKey = new Map(kamino.map((s) => [s.key, s]));
const protectedStudentIds = new Set(cancelCases.map((c) => c.student_id).filter(Boolean));

const dbByKey = new Map();
for (const s of dbStudents) {
  const k = studentKey(s.name, s.product);
  if (!dbByKey.has(k)) dbByKey.set(k, []);
  dbByKey.get(k).push(s);
}

const defaultCompanyId = dbStudents.find((s) => s.company_id)?.company_id ?? null;
const matchedDbIds = new Set();
const sql = [];

function esc(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function jsonEsc(obj) {
  return esc(JSON.stringify(obj));
}

for (const kStudent of kamino) {
  const candidates = dbByKey.get(kStudent.key) ?? [];
  let existing = candidates[0] ?? null;
  if (!existing) {
    const nn = String(kStudent.name ?? '').trim().toLowerCase();
    const byName = dbStudents.filter((s) => String(s.name ?? '').trim().toLowerCase() === nn);
    if (byName.length === 1) existing = byName[0];
  }

  if (existing) {
    matchedDbIds.add(existing.id);
    const isProtected = protectedStudentIds.has(existing.id);
    const ac = String(existing.ac ?? '').trim() || kStudent.ac;
    sql.push(`UPDATE public.students SET
      name=${esc(isProtected ? existing.name : kStudent.name)},
      whatsapp=${esc(kStudent.whatsapp || existing.whatsapp || '')},
      email=${esc(kStudent.email || existing.email || null)},
      ac=${esc(ac)},
      product=${esc(isProtected ? existing.product : kStudent.product)},
      enrollment_date=${esc(isProtected ? existing.enrollment_date : kStudent.enrollmentDate)},
      data_treinamento_origem=${esc(isProtected ? existing.enrollment_date : kStudent.data_treinamento_origem)},
      due_day=${kStudent.dueDay ?? 10},
      sale_value=${kStudent.saleValue ?? 0},
      down_payment=${kStudent.downPayment ?? 0},
      total_installments=${kStudent.totalInstallments ?? 0},
      paid_installments=${kStudent.paidInstallments ?? 0},
      installment_value=${kStudent.installmentValue ?? 0},
      installments=${jsonEsc(kStudent.installments)}::jsonb,
      detalhes=${esc(kStudent.detalhes || null)},
      status=${esc(isProtected ? existing.status : kStudent.status)},
      updated_at=now()
      WHERE id=${esc(existing.id)};`);
  } else {
    const id = randomUUID();
    sql.push(`INSERT INTO public.students (
      id, company_id, name, whatsapp, email, cpf, address, numero, cidade, estado, cep,
      status, status_mode, ac, product, enrollment_date, data_treinamento_origem,
      due_day, sale_value, down_payment, total_installments, paid_installments,
      installment_value, installments, history, tags, detalhes
    ) VALUES (
      ${esc(id)}, ${esc(defaultCompanyId)}, ${esc(kStudent.name)}, ${esc(kStudent.whatsapp || '')}, ${esc(kStudent.email || null)},
      '', '', '', '', '', '', ${esc(kStudent.status)}, 'Automático', ${esc(kStudent.ac || '')}, ${esc(kStudent.product)},
      ${esc(kStudent.enrollmentDate)}, ${esc(kStudent.data_treinamento_origem)}, ${kStudent.dueDay ?? 10},
      ${kStudent.saleValue ?? 0}, ${kStudent.downPayment ?? 0}, ${kStudent.totalInstallments ?? 0},
      ${kStudent.paidInstallments ?? 0}, ${kStudent.installmentValue ?? 0}, ${jsonEsc(kStudent.installments)}::jsonb,
      '[]'::jsonb, '[]'::jsonb, ${esc(kStudent.detalhes || null)}
    );`);
  }
}

const deleteIds = [];
for (const s of dbStudents) {
  if (matchedDbIds.has(s.id)) continue;
  if (protectedStudentIds.has(s.id)) {
    const km = kaminoByKey.get(studentKey(s.name, s.product));
    if (km) {
      sql.push(`UPDATE public.students SET
        sale_value=${km.saleValue ?? 0}, down_payment=${km.downPayment ?? 0},
        total_installments=${km.totalInstallments ?? 0}, paid_installments=${km.paidInstallments ?? 0},
        installment_value=${km.installmentValue ?? 0}, installments=${jsonEsc(km.installments)}::jsonb,
        detalhes=${esc(km.detalhes || null)}, updated_at=now()
        WHERE id=${esc(s.id)};`);
    }
    continue;
  }
  deleteIds.push(s.id);
}

if (deleteIds.length) {
  const arr = deleteIds.map((id) => esc(id)).join(',');
  sql.unshift(`DELETE FROM public.conciliacao_import_errors WHERE student_id IN (${arr});`);
  sql.unshift(`DELETE FROM public.conciliacao_items WHERE student_id IN (${arr});`);
  sql.unshift(`DELETE FROM public.antecipacao_items WHERE student_id IN (${arr});`);
  sql.unshift(`DELETE FROM public.students WHERE id IN (${arr});`);
}

sql.push(`UPDATE public.cancellation_cases cc SET
  ac = COALESCE(NULLIF(cc.ac, ''), s.ac),
  student_name = COALESCE(s.name, cc.student_name),
  updated_at = now()
FROM public.students s WHERE cc.student_id = s.id;`);

const out = path.resolve('scripts/.kamino-sync.sql');
fs.writeFileSync(out, sql.join('\n\n'), 'utf8');

console.log(JSON.stringify({
  kamino: kamino.length,
  dbStudents: dbStudents.length,
  protected: protectedStudentIds.size,
  delete: deleteIds.length,
  updates: sql.filter((l) => l.startsWith('UPDATE public.students')).length,
  inserts: sql.filter((l) => l.startsWith('INSERT INTO public.students')).length,
  sqlFile: out,
}, null, 2));
