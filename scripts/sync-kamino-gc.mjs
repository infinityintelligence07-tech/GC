/**
 * Sincroniza alunos do GC com planilha Kamino.
 *
 * Regras:
 * - Fonte da verdade: KAMINO GC.xlsx (alunos + valores financeiros)
 * - AC divergente: mantém o AC do GC
 * - Alunos em cancelamento (cancellation_cases): nunca excluir; manter etapa/nome/treinamento; atualizar valores só se houver match na planilha
 *
 * Uso:
 *   node scripts/sync-kamino-gc.mjs --dry-run
 *   node scripts/sync-kamino-gc.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { parseKaminoFile, studentKey } from './lib/kamino-parse.mjs';

const XLSX_DEFAULT = path.resolve('scripts/KAMINO-GC.xlsx');
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) ?? XLSX_DEFAULT;

function readEnvDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.replaceAll('"', '');
  const text = fs.readFileSync(path.resolve('.env'), 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL não encontrado em .env');
  return m[1].replaceAll('"', '');
}

function normName(s) {
  return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`Planilha não encontrada: ${XLSX_PATH}`);

  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();

  const { rows: acs } = await client.query(`SELECT id, name FROM public.acs WHERE active = true`);
  const acNames = acs.map((a) => a.name);

  console.log('Lendo planilha:', XLSX_PATH);
  const kaminoStudents = parseKaminoFile(XLSX_PATH, acNames);
  const kaminoByKey = new Map(kaminoStudents.map((s) => [s.key, s]));
  console.log('Alunos Kamino (grupos nome+produto):', kaminoStudents.length);

  const { rows: dbStudents } = await client.query(`
    SELECT id, name, whatsapp, email, cpf, address, numero, cidade, estado, cep,
           status, status_mode, ac, product, enrollment_date, data_treinamento_origem,
           due_day, sale_value, down_payment, total_installments, paid_installments,
           installment_value, installments, history, is_renda_extra, renda_extra_status,
           renda_extra_ac, status_cancelamento, cancellation_case_id, tags, detalhes,
           company_id, ciclo, status_antes_cancelamento
    FROM public.students
  `);

  const { rows: cancelCases } = await client.query(`
    SELECT id, student_id, student_name, funnel_stage, stage, ac, treinamento
    FROM public.cancellation_cases
  `);

  const protectedStudentIds = new Set(
    cancelCases.map((c) => c.student_id).filter(Boolean),
  );
  console.log('Alunos atuais no GC:', dbStudents.length);
  console.log('Casos cancelamento:', cancelCases.length, '| alunos protegidos:', protectedStudentIds.size);

  const dbByKey = new Map();
  const dbById = new Map();
  for (const s of dbStudents) {
    dbById.set(s.id, s);
    const k = studentKey(s.name, s.product);
    if (!dbByKey.has(k)) dbByKey.set(k, []);
    dbByKey.get(k).push(s);
  }

  const { rows: companies } = await client.query(`SELECT id, name FROM public.companies WHERE active = true ORDER BY name`);
  const defaultCompanyId = companies.find((c) => /iam/i.test(c.name))?.id ?? companies[0]?.id ?? null;

  const plan = {
    insert: [],
    update: [],
    updateValuesOnly: [],
    keepProtected: [],
    delete: [],
  };

  const matchedDbIds = new Set();

  for (const kStudent of kaminoStudents) {
    const candidates = dbByKey.get(kStudent.key) ?? [];
    let existing = candidates[0] ?? null;

    if (!existing) {
      const byName = dbStudents.filter((s) => normName(s.name) === normName(kStudent.name));
      if (byName.length === 1) existing = byName[0];
    }

    if (existing) {
      matchedDbIds.add(existing.id);
      const keepAc = String(existing.ac ?? '').trim() || kStudent.ac;
      const isProtected = protectedStudentIds.has(existing.id);

      const patch = {
        id: existing.id,
        whatsapp: kStudent.whatsapp || existing.whatsapp,
        email: kStudent.email || existing.email,
        sale_value: kStudent.saleValue,
        down_payment: kStudent.downPayment,
        total_installments: kStudent.totalInstallments,
        paid_installments: kStudent.paidInstallments,
        installment_value: kStudent.installmentValue,
        installments: JSON.stringify(kStudent.installments),
        due_day: kStudent.dueDay,
        detalhes: kStudent.detalhes,
        enrollment_date: isProtected ? existing.enrollment_date : (kStudent.enrollmentDate || existing.enrollment_date),
        data_treinamento_origem: isProtected ? existing.data_treinamento_origem : (kStudent.data_treinamento_origem || existing.data_treinamento_origem),
        ac: keepAc,
        status: isProtected ? existing.status : kStudent.status,
        status_mode: existing.status_mode ?? 'Automático',
        name: isProtected ? existing.name : kStudent.name,
        product: isProtected ? existing.product : kStudent.product,
      };

      if (isProtected) plan.updateValuesOnly.push(patch);
      else plan.update.push(patch);
    } else {
      plan.insert.push({
        id: randomUUID(),
        company_id: defaultCompanyId,
        name: kStudent.name,
        whatsapp: kStudent.whatsapp,
        email: kStudent.email,
        cpf: '',
        address: '', numero: '', cidade: '', estado: '', cep: '',
        ac: kStudent.ac,
        product: kStudent.product,
        enrollment_date: kStudent.enrollmentDate,
        data_treinamento_origem: kStudent.data_treinamento_origem,
        due_day: kStudent.dueDay,
        sale_value: kStudent.saleValue,
        down_payment: kStudent.downPayment,
        total_installments: kStudent.totalInstallments,
        paid_installments: kStudent.paidInstallments,
        installment_value: kStudent.installmentValue,
        installments: JSON.stringify(kStudent.installments),
        detalhes: kStudent.detalhes,
        status: kStudent.status,
        status_mode: 'Automático',
        history: '[]',
        tags: '[]',
      });
    }
  }

  for (const s of dbStudents) {
    if (matchedDbIds.has(s.id)) continue;
    if (protectedStudentIds.has(s.id)) {
      plan.keepProtected.push(s);
      const k = studentKey(s.name, s.product);
      const km = kaminoByKey.get(k);
      if (km) {
        plan.updateValuesOnly.push({
          id: s.id,
          whatsapp: km.whatsapp || s.whatsapp,
          email: km.email || s.email,
          sale_value: km.saleValue,
          down_payment: km.downPayment,
          total_installments: km.totalInstallments,
          paid_installments: km.paidInstallments,
          installment_value: km.installmentValue,
          installments: JSON.stringify(km.installments),
          due_day: km.dueDay,
          detalhes: km.detalhes,
          ac: String(s.ac ?? '').trim() || km.ac,
          name: s.name,
          product: s.product,
          status: s.status,
          status_mode: s.status_mode,
          enrollment_date: s.enrollment_date,
          data_treinamento_origem: s.data_treinamento_origem,
        });
      }
      continue;
    }
    plan.delete.push(s);
  }

  console.log('\n=== PLANO ===');
  console.log('Inserir:', plan.insert.length);
  console.log('Atualizar (carteira):', plan.update.length);
  console.log('Atualizar só valores (cancelamento):', plan.updateValuesOnly.length);
  console.log('Manter cancelamento sem match Kamino:', plan.keepProtected.filter((s) => !plan.updateValuesOnly.some((u) => u.id === s.id)).length);
  console.log('Excluir:', plan.delete.length);

  if (DRY) {
    console.log('\n[DRY-RUN] Nada foi alterado. Rode com --apply para executar.');
    if (plan.delete.length > 0) {
      console.log('\nExemplos a excluir:');
      plan.delete.slice(0, 8).forEach((s) => console.log(' -', s.name, '|', s.product, '| AC:', s.ac));
    }
    await client.end();
    return;
  }

  console.log('\nAplicando...');
  await client.query('BEGIN');
  try {
    const deleteIds = plan.delete.map((s) => s.id);
    if (deleteIds.length > 0) {
      await client.query(`DELETE FROM public.conciliacao_import_errors WHERE student_id = ANY($1::uuid[])`, [deleteIds]);
      await client.query(`DELETE FROM public.conciliacao_items WHERE student_id = ANY($1::uuid[])`, [deleteIds]);
      await client.query(`DELETE FROM public.antecipacao_items WHERE student_id = ANY($1::uuid[])`, [deleteIds]);
      await client.query(`DELETE FROM public.students WHERE id = ANY($1::uuid[])`, [deleteIds]);
    }

    const upsertOne = async (p) => {
      await client.query(`
        UPDATE public.students SET
          name = $2, whatsapp = $3, email = $4, ac = $5, product = $6,
          enrollment_date = $7, data_treinamento_origem = $8, due_day = $9,
          sale_value = $10, down_payment = $11, total_installments = $12,
          paid_installments = $13, installment_value = $14, installments = $15::jsonb,
          detalhes = $16, status = $17, status_mode = $18, updated_at = now()
        WHERE id = $1
      `, [
        p.id, p.name, p.whatsapp ?? '', p.email ?? null, p.ac ?? '', p.product ?? '',
        p.enrollment_date ?? null, p.data_treinamento_origem ?? null, p.due_day ?? 10,
        p.sale_value ?? 0, p.down_payment ?? 0, p.total_installments ?? 0,
        p.paid_installments ?? 0, p.installment_value ?? 0, p.installments ?? '[]',
        p.detalhes ?? null, p.status ?? 'Em Dia', p.status_mode ?? 'Automático',
      ]);
    };

    for (const p of [...plan.update, ...plan.updateValuesOnly]) await upsertOne(p);

    for (const p of plan.insert) {
      await client.query(`
        INSERT INTO public.students (
          id, company_id, name, whatsapp, email, cpf, address, numero, cidade, estado, cep,
          status, status_mode, ac, product, enrollment_date, data_treinamento_origem,
          due_day, sale_value, down_payment, total_installments, paid_installments,
          installment_value, installments, history, tags, detalhes
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26::jsonb,$27
        )
      `, [
        p.id, p.company_id, p.name, p.whatsapp ?? '', p.email, p.cpf, p.address, p.numero,
        p.cidade, p.estado, p.cep, p.status, p.status_mode, p.ac, p.product,
        p.enrollment_date, p.data_treinamento_origem, p.due_day, p.sale_value, p.down_payment,
        p.total_installments, p.paid_installments, p.installment_value, p.installments,
        p.history, p.tags, p.detalhes,
      ]);
    }

    // AC dos casos de cancelamento: mantém o do GC (student/case), só alinha se case vazio
    await client.query(`
      UPDATE public.cancellation_cases cc
      SET ac = COALESCE(NULLIF(cc.ac, ''), s.ac),
          student_name = COALESCE(s.name, cc.student_name),
          updated_at = now()
      FROM public.students s
      WHERE cc.student_id = s.id
    `);

    await client.query('COMMIT');

    const { rows: [{ count: finalCount }] } = await client.query(`SELECT count(*)::int AS count FROM public.students`);
    const { rows: funnel } = await client.query(`
      SELECT funnel_stage, count(*)::int AS n FROM public.cancellation_cases GROUP BY funnel_stage ORDER BY n DESC
    `);

    console.log('Concluído. Alunos no GC agora:', finalCount);
    console.log('Cancelamentos por etapa:');
    for (const r of funnel) console.log(`  ${r.funnel_stage}: ${r.n}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
