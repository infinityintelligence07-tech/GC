/**
 * Reparo: fichas vindas do IAM Control cuja data do contrato (enrollment_date /
 * data_treinamento_origem) ficou com a data da MATRÍCULA antiga do aluno no IAM,
 * e não a data da VENDA daquele contrato (bug corrigido em
 * 20260907230000_iam_enrollment_date_data_venda.sql).
 *
 * Não temos o payload do IAM guardado, mas as parcelas geradas pela sync são
 * sempre data_venda + n meses — então data_venda = venc. da parcela 1 − 1 mês.
 * Só mexe em fichas onde essa inferência é segura:
 *   - ficha ligada a contrato IAM (iam_control_contrato_id);
 *   - financeiro NÃO veio do Kamino (sem histórico "Kamino");
 *   - parcelas ainda no padrão da sync (todas no mesmo dia do mês, 1 mês entre
 *     elas — ou seja, ninguém renegociou vencimento no GC);
 *   - data atual ANTERIOR à inferida (o sentido do bug: matrícula antiga). Se a
 *     data atual é posterior, alguém mexeu na parcela no GC — não inferimos.
 *
 * Também aplica a migração acima (CREATE OR REPLACE FUNCTION, idempotente).
 *
 * Uso:
 *   node scripts/gc-reparo-iam-data-contrato.mjs            # dry-run (lista)
 *   node scripts/gc-reparo-iam-data-contrato.mjs --apply    # aplica
 *   node scripts/gc-reparo-iam-data-contrato.mjs --apply --id <uuid>   # só uma ficha
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260907230000_iam_enrollment_date_data_venda.sql';
const APLICAR = process.argv.includes('--apply');
const idArg = process.argv.indexOf('--id');
const SO_ID = idArg >= 0 ? process.argv[idArg + 1] : null;

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

const CANDIDATOS_SQL = `
  WITH linhas AS (
    SELECT s.id, (i->>'number')::int AS n, (i->>'dueDate')::date AS venc
    FROM public.students s
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.installments, '[]'::jsonb)) i
    WHERE s.iam_control_contrato_id IS NOT NULL
  ),
  v1 AS (
    SELECT id, venc AS venc1 FROM linhas WHERE n = 1
  ),
  parc AS (
    SELECT l.id, v1.venc1, count(*) AS n,
           -- todas as parcelas no padrão da sync: venc1 + (n-1) meses?
           bool_and(l.venc = (v1.venc1 + make_interval(months => l.n - 1))::date) AS padrao_sync
    FROM linhas l
    JOIN v1 ON v1.id = l.id
    GROUP BY l.id, v1.venc1
  )
  SELECT s.id, s.name, s.product, s.status, c.name AS empresa,
         left(s.enrollment_date, 10) AS data_atual,
         (p.venc1 - interval '1 month')::date::text AS data_venda_inferida,
         p.venc1::text AS venc_parcela_1, p.n AS n_parcelas
  FROM public.students s
  JOIN public.companies c ON c.id = s.company_id
  JOIN parc p ON p.id = s.id
  WHERE p.padrao_sync
    AND p.venc1 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(s.history, '[]'::jsonb)) h
      WHERE h->>'text' ILIKE '%kamino%'
    )
    -- só o sentido do bug: data atual (matrícula antiga) ANTERIOR à venda inferida.
    -- Data atual posterior à inferida = parcela mexida no GC; não inferimos.
    AND coalesce(nullif(left(s.enrollment_date, 10), '')::date, 'epoch'::date) < (p.venc1 - interval '1 month')::date
    AND ($1::uuid IS NULL OR s.id = $1::uuid)
  ORDER BY c.name, s.name, s.product`;

const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'dry-run (nada será alterado)'}\n`);

try {
  await client.query('BEGIN');

  // 1) regra nova na função de upsert (idempotente)
  await client.query(fs.readFileSync(MIGRACAO, 'utf8'));
  console.log('função iam_control_upsert_student redefinida (data_venda > data_matricula).\n');

  // 2) fichas com data errada
  const { rows } = await client.query(CANDIDATOS_SQL, [SO_ID]);
  console.log(`${rows.length} ficha(s) com data do contrato divergente da venda inferida:`);
  console.table(rows.map((r) => ({
    nome: r.name, produto: r.product, empresa: r.empresa, status: r.status,
    'data atual': r.data_atual, 'data venda (inferida)': r.data_venda_inferida,
    'venc. parc. 1': r.venc_parcela_1, parcelas: r.n_parcelas,
  })));

  if (APLICAR && rows.length) {
    const { rowCount } = await client.query(
      `UPDATE public.students s
          SET enrollment_date = v.nova,
              data_treinamento_origem = v.nova,
              history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'date', now(), 'type', 'Sistema',
                'text', 'Data do contrato corrigida: ' || coalesce(v.antiga, '—') || ' → ' || v.nova
                        || ' (sync IAM usava a data da matrícula do aluno em vez da venda do contrato).'
              )),
              updated_at = now()
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS antiga, unnest($3::text[]) AS nova) v
        WHERE s.id = v.id`,
      [rows.map((r) => r.id), rows.map((r) => r.data_atual), rows.map((r) => r.data_venda_inferida)],
    );
    console.log(`\n${rowCount} ficha(s) atualizada(s).`);
  }

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
