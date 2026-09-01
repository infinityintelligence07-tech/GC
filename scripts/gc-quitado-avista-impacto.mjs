/**
 * Mede o impacto dos contratos IAM quitados à vista que chegam sem parcelas
 * (`installments = []`) — SOMENTE LEITURA, nenhum UPDATE.
 *
 * Esses contratos são reconhecidos por isIamConciliadoQuitadoAvista (o valor
 * entra no card Pago pela entrada), mas isStudentFullyPaid ignora array vazio,
 * então o aluno continua na carteira ativa e some do filtro "Pago".
 *
 * Uso: node scripts/gc-quitado-avista-impacto.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  if (!m) throw new Error(`${key} não encontrado em .env`);
  return m[1].replaceAll('"', '');
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// O host do pooler alterna entre aws-0 e aws-1 conforme o projeto é remanejado.
async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('não foi possível conectar ao banco');
}

const brl = (n) =>
  Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const client = await conectar();

// Espelha isIamConciliadoQuitadoAvista (src/lib/iamPendenteConciliacao.ts:40).
const QUITADO_AVISTA = `
  s.iam_control_aluno_id IS NOT NULL
  AND upper(btrim(coalesce(s.iam_control_contrato_status, ''))) = 'CONCILIADO'
  AND (
    (coalesce(s.total_installments, 0) = 0
      AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01)
    OR (coalesce(s.total_installments, 0) > 0
      AND coalesce(s.paid_installments, 0) >= coalesce(s.total_installments, 0))
    OR (jsonb_array_length(coalesce(s.installments, '[]'::jsonb)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(s.installments, '[]'::jsonb)) e
        WHERE coalesce((e->>'paid')::boolean, false) = false
      ))
  )
`;

const SEM_PARCELAS = `jsonb_array_length(coalesce(s.installments, '[]'::jsonb)) = 0`;

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

const geral = await q(`
  SELECT
    c.name AS empresa,
    count(*) FILTER (WHERE ${QUITADO_AVISTA})                        AS quitados_avista,
    count(*) FILTER (WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS})    AS sem_parcelas,
    coalesce(sum(s.down_payment) FILTER (WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}), 0) AS valor_entrada,
    coalesce(sum(s.sale_value)   FILTER (WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}), 0) AS valor_venda
  FROM public.students s
  JOIN public.companies c ON c.id = s.company_id
  GROUP BY c.name
  ORDER BY c.name
`);

console.log('=== CONTRATOS IAM QUITADOS À VISTA, POR EMPRESA ===');
for (const r of geral) {
  console.log(
    `${r.empresa}: quitados à vista=${r.quitados_avista} | sem parcelas=${r.sem_parcelas} | entrada=${brl(r.valor_entrada)} | venda=${brl(r.valor_venda)}`,
  );
}

const porStatus = await q(`
  SELECT s.status, s.status_mode, count(*) AS n,
         coalesce(sum(s.down_payment), 0) AS valor
  FROM public.students s
  WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}
  GROUP BY s.status, s.status_mode
  ORDER BY count(*) DESC
`);

console.log('\n=== COMO ESSES ALUNOS APARECEM HOJE (status gravado) ===');
for (const r of porStatus) {
  console.log(` - status=${r.status} | modo=${r.status_mode} | alunos=${r.n} | entrada=${brl(r.valor)}`);
}

// O furo: sem status 'Pago' gravado, o aluno fica na carteira ativa porque
// isStudentFullyPaid retorna false para installments vazio.
const naCarteira = await q(`
  SELECT count(*) AS n, coalesce(sum(s.down_payment), 0) AS valor
  FROM public.students s
  WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}
    AND coalesce(s.status, '') <> 'Pago'
    AND coalesce(s.status_cancelamento, 'nenhum') = 'nenhum'
`);

console.log('\n=== FURO 1: QUITADO QUE CONTINUA NA CARTEIRA ATIVA ===');
console.log(` alunos=${naCarteira[0].n} | entrada somada=${brl(naCarteira[0].valor)}`);

const porAc = await q(`
  SELECT coalesce(nullif(btrim(s.ac), ''), '(sem AC)') AS ac,
         count(*) AS n, coalesce(sum(s.down_payment), 0) AS valor
  FROM public.students s
  WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}
    AND coalesce(s.status, '') <> 'Pago'
    AND coalesce(s.status_cancelamento, 'nenhum') = 'nenhum'
  GROUP BY 1
  ORDER BY sum(s.down_payment) DESC
`);

console.log('\n=== POR ASSESSOR ===');
for (const r of porAc) console.log(` - ${r.ac}: ${r.n} aluno(s) | ${brl(r.valor)}`);

const amostra = await q(`
  SELECT s.name, s.product, s.ac, s.status, s.sale_value, s.down_payment,
         s.total_installments, s.paid_installments
  FROM public.students s
  WHERE ${QUITADO_AVISTA} AND ${SEM_PARCELAS}
    AND coalesce(s.status, '') <> 'Pago'
  ORDER BY s.down_payment DESC NULLS LAST
  LIMIT 15
`);

console.log('\n=== AMOSTRA (maiores valores) ===');
for (const r of amostra) {
  console.log(
    ` - ${r.name} | ${r.product} | AC=${r.ac || '—'} | status=${r.status} | venda=${brl(r.sale_value)} | entrada=${brl(r.down_payment)}`,
  );
}

await client.end();
