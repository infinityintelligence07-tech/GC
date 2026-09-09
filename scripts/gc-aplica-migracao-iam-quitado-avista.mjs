/**
 * Aplica 20260909170000_iam_quitado_avista_autoaprova.sql: trigger que grava a
 * aprovação GC de contrato IAM CONCILIADO quitado à vista (tira "Pendente",
 * fecha item iam_pendente) + backfill das fichas já nessa situação.
 *
 * Sem --apply: roda numa transação e REVERTE, mostrando o antes/depois.
 * Com --apply: aplica de verdade.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-iam-quitado-avista.mjs
 *   node scripts/gc-aplica-migracao-iam-quitado-avista.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260909170000_iam_quitado_avista_autoaprova.sql';
const APLICAR = process.argv.includes('--apply');

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

const ALVOS_SQL = `
  SELECT s.id, s.name, s.product, s.status, s.status_mode, s.iam_gc_conciliado_at IS NOT NULL aprovado_gc,
         (SELECT count(*) FROM public.conciliacao_items ci
           WHERE ci.student_id = s.id AND ci.tipo = 'iam_pendente' AND ci.status IN ('pendente', 'aprovado')) fila_aberta
    FROM public.students s JOIN public.companies co ON co.id = s.company_id AND co.active
   WHERE s.iam_control_aluno_id IS NOT NULL
     AND upper(coalesce(s.iam_control_contrato_status, '')) = 'CONCILIADO'
     AND coalesce(s.status_cancelamento, 'nenhum') <> 'cancelado'
     AND s.status <> 'Cancelado'
     AND coalesce(s.total_installments, 0) = 0
     AND coalesce(s.sale_value, 0) > 0
     AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01
     AND (s.iam_gc_conciliado_at IS NULL OR s.id = ANY($1::uuid[]))
   ORDER BY s.name`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');
  const { rows: antes } = await client.query(ALVOS_SQL, [[]]);
  console.log(`ANTES — ${antes.length} ficha(s) quitada(s) à vista sem aprovação GC:`);
  console.table(antes.map((r) => ({ nome: r.name.slice(0, 30), produto: r.product.slice(0, 14), status: r.status, modo: r.status_mode, fila: Number(r.fila_aberta) })));

  await client.query(sql);

  const ids = antes.map((r) => r.id);
  const { rows: depois } = await client.query(ALVOS_SQL, [ids]);
  console.log(`\nDEPOIS — ${depois.filter((r) => !r.aprovado_gc).length} ainda sem aprovação (esperado 0):`);
  console.table(depois.map((r) => ({ nome: r.name.slice(0, 30), status: r.status, modo: r.status_mode, aprovado: r.aprovado_gc, fila: Number(r.fila_aberta) })));

  const { rows: trg } = await client.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.students'::regclass AND tgname = 'students_iam_quitado_avista_autoaprova'`,
  );
  console.log(`trigger: ${trg.length ? 'PRESENTE' : 'AUSENTE (!)'}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nMIGRAÇÃO APLICADA.');
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
