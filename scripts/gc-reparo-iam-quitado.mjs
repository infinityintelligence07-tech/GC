/**
 * Reparo pontual de contrato IAM que foi PAGO no IAM Control mas ficou com
 * parcelas em aberto no GC (ficha montada pela regra antiga de cartão
 * parcelado, antes da correção 20260903130000, e não reenviada pelo IAM).
 *
 * Aplica o mesmo resultado que iam_repair_conciliado_quitado + 20260903134000
 * produziriam: quitado à vista (sem recebíveis), status Pago, fila
 * IAM CONTROL → GC fechada e aprovação GC gravada.
 *
 * Uso:
 *   node scripts/gc-reparo-iam-quitado.mjs --nome "PICASSO GONÇALVES ROCHA" --produto "Leader Skills"
 *   node scripts/gc-reparo-iam-quitado.mjs --id <uuid da ficha>
 *   ... --apply   (sem --apply roda numa transação e REVERTE)
 *
 * Já aplicado: DÉBORAH CRUZ DOS SANTOS / Plano e Ação (07/09/2026).
 */
import fs from 'node:fs';
import pg from 'pg';

const APLICAR = process.argv.includes('--apply');
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ID = arg('--id');
const NOME = arg('--nome');
const PRODUTO = arg('--produto');
if (!ID && !(NOME && PRODUTO)) {
  console.error('informe --id <uuid> ou --nome "<nome>" --produto "<produto>"');
  process.exit(1);
}

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

const FICHA_COLS = `
  s.id, s.name, s.product, s.status, s.status_mode, s.sale_value, s.down_payment, s.total_installments,
  s.paid_installments, jsonb_array_length(s.installments) n_parcelas, s.ac, c.name empresa,
  s.iam_control_aluno_id, s.iam_control_contrato_id, s.iam_control_contrato_status, s.iam_gc_conciliado_at`;
const FILA_SQL = `
  SELECT id, tipo, status, resumo, conciliado_at, conciliado_por_nome
  FROM public.conciliacao_items WHERE student_id = $1 AND tipo = 'iam_pendente' ORDER BY created_at`;

const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');

  // Localiza a ficha (só empresas ativas; exige match único).
  const { rows: candidatas } = ID
    ? await client.query(`SELECT ${FICHA_COLS} FROM public.students s JOIN public.companies c ON c.id = s.company_id WHERE s.id = $1`, [ID])
    : await client.query(
        `SELECT ${FICHA_COLS} FROM public.students s JOIN public.companies c ON c.id = s.company_id
          WHERE c.active AND public.gc_nome_norm(s.name) = public.gc_nome_norm($1)
            AND lower(btrim(s.product)) = lower(btrim($2))`,
        [NOME, PRODUTO],
      );
  if (candidatas.length !== 1) {
    throw new Error(`esperava 1 ficha, achei ${candidatas.length}: ${JSON.stringify(candidatas.map((r) => [r.id, r.name, r.product, r.empresa]))}`);
  }
  const antes = candidatas[0];
  if (!antes.iam_control_aluno_id) throw new Error('ficha não veio do IAM Control — reparo não se aplica');
  if (['Cancelado', 'Solicitação Cancelamento'].includes(antes.status)) throw new Error('aluno em cancelamento — não mexer');
  if (Number(antes.sale_value) <= 0) throw new Error('sale_value zerado');
  const jaQuitada = Number(antes.total_installments) === 0 && Number(antes.down_payment) >= Number(antes.sale_value) - 0.01;
  if (jaQuitada && antes.status === 'Pago' && antes.iam_gc_conciliado_at) throw new Error('ficha já está quitada e aprovada — nada a fazer');

  console.log('ANTES ficha:', antes);
  console.log('ANTES fila :', (await client.query(FILA_SQL, [antes.id])).rows);

  const statusIam = String(antes.iam_control_contrato_status ?? 'PARA_CONCILIAR').replace(/_/g, ' ');
  const nota =
    `Reparo IAM: contrato ${statusIam} quitado no IAM (pago). Ficha montada pela regra antiga (cartão parcelado → parcelas em aberto), ` +
    'antes da correção de 03/09/2026, e não reenviada pelo IAM. Cartão de crédito entra para a empresa uma vez só, independente do parcelamento do cliente — ' +
    'financeiro alinhado (sem recebíveis futuros). Quitado à vista entra direto na carteira e na dashboard, sem aprovação GC.';

  await client.query(
    `UPDATE public.students s SET
       down_payment = round(s.sale_value, 2),
       total_installments = 0,
       installment_value = 0,
       installments = '[]'::jsonb,
       paid_installments = 0,
       status = 'Pago',
       status_mode = 'Automático',
       iam_control_contrato_status = 'CONCILIADO',
       iam_gc_conciliado_at = coalesce(s.iam_gc_conciliado_at, now()),
       history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'type', 'Sistema',
         'text', $2::text
       )),
       updated_at = now()
     WHERE s.id = $1`,
    [antes.id, nota],
  );

  const { rowCount: filaFechada } = await client.query(
    `UPDATE public.conciliacao_items SET
       status = 'conciliado',
       conciliado_at = now(),
       conciliado_por_nome = 'Sistema IAM',
       conciliado_nota = 'Fechado automaticamente: contrato quitado no IAM (pago). Entra direto na dashboard, sem aprovação GC.',
       updated_at = now()
     WHERE student_id = $1 AND tipo = 'iam_pendente' AND status IN ('pendente', 'aprovado')`,
    [antes.id],
  );

  const { rows: [depois] } = await client.query(`SELECT ${FICHA_COLS} FROM public.students s JOIN public.companies c ON c.id = s.company_id WHERE s.id = $1`, [antes.id]);
  console.log('\nDEPOIS ficha:', depois);
  console.log(`DEPOIS fila : ${filaFechada} item(ns) fechado(s)`, (await client.query(FILA_SQL, [antes.id])).rows);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nREPARO APLICADO.');
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
