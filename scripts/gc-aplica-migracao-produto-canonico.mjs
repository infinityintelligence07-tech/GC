/**
 * Aplica 20260908180000_produto_canonico_pmr_pnl.sql — nome canônico de
 * produto (PMR / PNL), rótulo IAM canônico, renomeação das fichas e fusão da
 * ficha duplicada do Jose Israel Vieira do Nascimento.
 *
 * Sem --apply: roda numa transação e REVERTE, mostrando o antes/depois.
 * Com --apply: aplica de verdade.
 *
 * Uso:
 *   node scripts/gc-aplica-migracao-produto-canonico.mjs
 *   node scripts/gc-aplica-migracao-produto-canonico.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260908180000_produto_canonico_pmr_pnl.sql';
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

const CONTAGEM_SQL = `
  SELECT c.name empresa, s.product, count(*) n
    FROM public.students s JOIN public.companies c ON c.id = s.company_id
   WHERE s.product ILIKE '%pmr%' OR s.product ILIKE '%pnl%' OR s.product ILIKE 'programa%'
   GROUP BY 1, 2 ORDER BY 1, 2`;

const DUP_SQL = `
  SELECT c.name empresa, s.name, s.product, count(*) n, array_agg(s.id::text) ids
    FROM public.students s JOIN public.companies c ON c.id = s.company_id
   WHERE s.product IN ('PMR', 'PNL')
   GROUP BY 1, 2, 3 HAVING count(*) > 1 ORDER BY 1, 2`;

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

const mostrar = async (titulo) => {
  const { rows } = await client.query(CONTAGEM_SQL);
  console.log(titulo);
  for (const r of rows) console.log(`  ${r.empresa.padEnd(16)} | ${String(r.product).padEnd(52)} | ${r.n}`);
};

try {
  await client.query('BEGIN');
  await mostrar('produtos ANTES:');
  await client.query(sql);
  await mostrar('\nprodutos DEPOIS:');

  const { rows: [lbl] } = await client.query(
    `SELECT public.iam_treinamento_label('{"nome":"Programação Mental para Riqueza e Relacionamento","sigla":"PMR"}'::jsonb) a,
            public.iam_treinamento_label('{"nome":"Programação Neurolinguística","sigla":"PNL"}'::jsonb) b,
            public.iam_treinamento_label('{"nome":"Missão Governar","sigla":"MG"}'::jsonb) c`);
  console.log('\nrótulo IAM:', lbl);

  const { rows: dups } = await client.query(DUP_SQL);
  console.log(`\nmesmo nome + produto PMR/PNL na mesma empresa (possíveis duplicatas): ${dups.length}`);
  for (const d of dups) console.log(`  ${d.empresa} | ${d.name} | ${d.product} | ${d.n} fichas: ${d.ids.join(', ')}`);

  const { rows: ji } = await client.query(
    `SELECT id, product, sale_value, total_installments, paid_installments, iam_control_aluno_id, iam_control_contrato_id, iam_control_contrato_status
       FROM public.students WHERE name ILIKE '%israel vieira%' AND company_id = (SELECT id FROM public.companies WHERE name = 'IAM - GC') ORDER BY product`);
  console.log('\nJose Israel (IAM - GC) depois:');
  for (const r of ji) console.log('  ', JSON.stringify(r));

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
