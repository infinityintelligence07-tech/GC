/**
 * Aplica 20260910150000_iam_ficha_kamino_nao_aguarda_aprovacao_gc.sql:
 *   ficha que já existe no GC pela planilha Kamino e é casada com um contrato
 *   do IAM Control recebe a aprovação GC na hora (não cai na fila
 *   IAM CONTROL → GC nem sai da carteira). Caso: Clodoaldo Brandolise.
 *
 * Sem --apply: aplica numa transação, mostra o que o backfill faria e REVERTE.
 * Com --apply: confirma.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260910150000_iam_ficha_kamino_nao_aguarda_aprovacao_gc.sql';
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

const SQL_FICHAS = `
  SELECT s.name, s.product, s.status, s.status_mode, s.iam_control_contrato_id cid, s.iam_control_contrato_status st,
         s.iam_gc_conciliado_at, s.sale_value, s.total_installments,
         (SELECT string_agg(ci.status, ',') FROM public.conciliacao_items ci WHERE ci.student_id = s.id AND ci.tipo = 'iam_pendente') itens_iam
    FROM public.students s WHERE s.id = ANY($1::uuid[]) ORDER BY s.name`;

const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
try {
  await client.query('BEGIN');

  // Candidatas ao backfill (mesmo filtro da migração), antes de aplicar.
  const { rows: antes } = await client.query(`
    SELECT s.id FROM public.students s JOIN public.companies co ON co.id = s.company_id
     WHERE co.active AND s.iam_control_aluno_id IS NOT NULL AND s.iam_gc_conciliado_at IS NULL
       AND upper(coalesce(s.iam_control_contrato_status, '')) IN ('CONCILIADO', 'PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR')
       AND coalesce(s.status_cancelamento, 'nenhum') <> 'cancelado' AND s.status <> 'Cancelado'
       AND (EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.history) = 'array' THEN s.history ELSE '[]'::jsonb END) h
                    WHERE h->>'text' ILIKE 'Importado via planilha Kamino%' OR h->>'text' ILIKE 'Conciliação Kamino×GC%')
            OR EXISTS (SELECT 1 FROM public._kamino_sync_staging k WHERE k.skey = public.gc_student_key(s.name, s.product)))`);
  const ids = antes.map((r) => r.id);
  console.log(`Fichas Kamino na fila IAM → GC (backfill): ${ids.length}`);
  console.table((await client.query(SQL_FICHAS, [ids])).rows);

  await client.query(fs.readFileSync(MIGRACAO, 'utf8'));

  console.log('\nDepois da migração:');
  console.table((await client.query(SQL_FICHAS, [ids])).rows);
  const { rows: hist } = await client.query(
    `SELECT name, product, history->-1->>'text' ultimo FROM public.students WHERE id = ANY($1::uuid[])`, [ids]);
  for (const h of hist) console.log(' ', h.name, '·', h.product, '→', h.ultimo);

  // Fichas IAM puras (não Kamino) da fila continuam intocadas.
  const { rows: fila } = await client.query(`
    SELECT count(*)::int n FROM public.conciliacao_items WHERE tipo = 'iam_pendente' AND status = 'pendente'`);
  console.log(`\nItens IAM → GC ainda pendentes (fichas IAM puras): ${fila[0].n}`);

  if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nAPLICADO.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nDRY-RUN: nada gravado. Rode com --apply para confirmar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
