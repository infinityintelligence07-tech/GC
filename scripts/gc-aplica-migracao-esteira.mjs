/**
 * Aplica a migração que recria a trigger da esteira de assessores e preenche o
 * AC das fichas criadas pelo IAM Control enquanto a trigger estava ausente.
 *
 * Sem --apply: roda a migração numa transação e REVERTE (nada muda), mostrando
 * exatamente quais fichas receberiam qual AC.
 * Com --apply: aplica de verdade.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-esteira.mjs
 *   node scripts/gc-aplica-migracao-esteira.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260903150000_restaura_esteira_ac_e_backfill_iam.sql';
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

const SEM_AC_SQL = `
  SELECT s.id, s.name, s.product, c.name AS empresa
  FROM public.students s JOIN public.companies c ON c.id = s.company_id
  WHERE s.iam_control_aluno_id IS NOT NULL AND coalesce(btrim(s.ac), '') = ''
  ORDER BY s.created_at`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

try {
  await client.query('BEGIN');

  const { rows: antes } = await client.query(SEM_AC_SQL);
  const idsAntes = antes.map((r) => r.id);
  console.log(`fichas IAM sem AC antes: ${antes.length}`);

  client.on('notice', (n) => console.log(`  ${n.message}`));
  await client.query(sql);
  console.log('sintaxe da migração: OK');

  const { rows: trg } = await client.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_students_assign_ac_esteira'`,
  );
  console.log(`trigger trg_students_assign_ac_esteira: ${trg.length ? 'PRESENTE' : 'AUSENTE (!)'}`);

  const { rows: depois } = await client.query(
    `SELECT s.id, s.name, s.product, s.ac, c.name AS empresa
     FROM public.students s JOIN public.companies c ON c.id = s.company_id
     WHERE s.id = ANY($1::uuid[]) ORDER BY c.name, s.ac, s.name`,
    [idsAntes],
  );
  const preenchidas = depois.filter((r) => r.ac && r.ac.trim());
  const restantes = depois.filter((r) => !r.ac || !r.ac.trim());

  console.log(`\nAC preenchido: ${preenchidas.length}`);
  for (const r of preenchidas) {
    console.log(`  ${r.empresa.padEnd(24)} ${r.name.slice(0, 34).padEnd(34)} ${String(r.product).slice(0, 26).padEnd(26)} → ${r.ac}`);
  }
  console.log(`\nSeguem sem AC (empresa sem assessores ou produto fora do GC): ${restantes.length}`);
  for (const r of restantes) {
    console.log(`  ${r.empresa.padEnd(24)} ${r.name.slice(0, 34).padEnd(34)} ${String(r.product).slice(0, 26)}`);
  }

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
