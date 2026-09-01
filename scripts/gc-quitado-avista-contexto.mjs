/**
 * Contexto do impacto medido em gc-quitado-avista-impacto.mjs — SOMENTE LEITURA.
 * Responde: em que empresas esses contratos estão e se `status_mode` tem
 * grafias divergentes (o código compara com 'Automático' acentuado).
 *
 * Uso: node scripts/gc-quitado-avista-contexto.mjs
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

const client = await conectar();
const q = async (sql) => (await client.query(sql)).rows;

console.log('=== EMPRESAS CADASTRADAS ===');
for (const r of await q(`
  SELECT c.id, c.name, c.slug, count(s.id) AS alunos
  FROM public.companies c
  LEFT JOIN public.students s ON s.company_id = c.id
  GROUP BY c.id, c.name, c.slug
  ORDER BY count(s.id) DESC
`)) {
  console.log(` - ${r.name} (slug=${r.slug}) · ${r.alunos} aluno(s) · ${r.id}`);
}

console.log('\n=== GRAFIAS DE status_mode NA BASE INTEIRA ===');
for (const r of await q(`
  SELECT coalesce(status_mode, '(null)') AS modo, count(*) AS n
  FROM public.students
  GROUP BY 1
  ORDER BY count(*) DESC
`)) {
  console.log(` - ${JSON.stringify(r.modo)} · ${r.n} aluno(s)`);
}

console.log('\n=== ALUNOS IAM (iam_control_aluno_id preenchido) POR EMPRESA ===');
for (const r of await q(`
  SELECT c.name AS empresa,
         count(*) FILTER (WHERE s.iam_control_aluno_id IS NOT NULL) AS iam,
         count(*) AS total
  FROM public.students s
  JOIN public.companies c ON c.id = s.company_id
  GROUP BY c.name
  ORDER BY c.name
`)) {
  console.log(` - ${r.empresa}: ${r.iam} IAM de ${r.total} aluno(s)`);
}

await client.end();
