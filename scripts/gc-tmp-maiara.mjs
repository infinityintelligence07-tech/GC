import fs from 'node:fs';
import pg from 'pg';

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

const c = await conectar();
console.log('--- itens recompra_vinculo (Maiara) ---');
console.table((await c.query(`
  SELECT id, status, student_id, student_name, ac, resumo, created_at, conciliado_at
  FROM public.conciliacao_items
  WHERE tipo = 'recompra_vinculo' AND student_name ILIKE '%maiara%'
  ORDER BY created_at DESC
`)).rows);
console.log('--- fichas Maiara ---');
console.table((await c.query(`
  SELECT id, name, product, ac, company_id, recompra_treinamento, created_at
  FROM public.students WHERE name ILIKE '%maiara%maria%' ORDER BY created_at
`)).rows);
console.log('--- itens recompra_vinculo abertos com student_id NULL ou ficha inexistente ---');
console.table((await c.query(`
  SELECT ci.id, ci.status, ci.student_id, ci.student_name, ci.created_at,
         (s.id IS NOT NULL) AS ficha_existe
  FROM public.conciliacao_items ci
  LEFT JOIN public.students s ON s.id = ci.student_id
  WHERE ci.tipo = 'recompra_vinculo' AND ci.status IN ('pendente','aprovado')
    AND (ci.student_id IS NULL OR s.id IS NULL)
  ORDER BY ci.created_at DESC
`)).rows);
console.log('--- FK conciliacao_items.student_id ---');
console.table((await c.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid = 'public.conciliacao_items'::regclass AND contype = 'f'
`)).rows);
await c.end();
