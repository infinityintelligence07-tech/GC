/**
 * Detalha os contratos Liberty que caíram na empresa IAM - GC e mostra em que
 * empresas a sync do IAM Control está criando fichas. SOMENTE LEITURA.
 *
 * Uso: node scripts/gc-liberty-na-iam.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const brl = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);

const url = (fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1] ?? '')
  .replaceAll('"', '')
  .replace(/[?&]sslmode=[^&]*/g, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const saldoExpr = `(select coalesce(sum((i->>'value')::numeric), 0)
                      from jsonb_array_elements(s.installments) i
                     where coalesce((i->>'paid')::boolean, false) = false)`;

const liberty = (
  await c.query(`
    select s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac,
           s.iam_control_contrato_status as iamst,
           s.iam_gc_conciliado_at is not null as aprovado,
           to_char(s.created_at, 'YYYY-MM-DD') as criada,
           ${saldoExpr} as saldo
      from public.students s
      join public.companies c on c.id = s.company_id
     where c.name = 'IAM - GC' and s.product ilike '%liberty%'
     order by 7 desc`)
).rows;

console.log('=== LIBERTY DENTRO DA EMPRESA IAM - GC ===');
let contam = 0;
let naoContam = 0;
for (const r of liberty) {
  if (r.aprovado) contam += Number(r.saldo);
  else naoContam += Number(r.saldo);
  console.log(
    `  ${pad(String(r.name).slice(0, 32), 33)} ${pad(r.product, 14)} ${pad(r.ac.slice(0, 14), 15)} ` +
      `${pad(String(r.iamst), 14)} aprovado:${r.aprovado ? 'sim' : 'nao'} ` +
      `criada ${r.criada} ${brl(r.saldo).padStart(12)}`,
  );
}
console.log(`\n  somam na dashboard: ${brl(contam)}  |  nao somam: ${brl(naoContam)}`);

const porEmpresa = (
  await c.query(`
    select c.name as empresa,
           count(*) filter (where s.iam_control_aluno_id is not null)::int as iam,
           count(*)::int as total,
           coalesce(sum(${saldoExpr}) filter (where s.iam_control_aluno_id is not null), 0) as saldo_iam
      from public.students s
      join public.companies c on c.id = s.company_id
     group by 1 order by 2 desc`)
).rows;

console.log('\n=== FICHAS CRIADAS PELA SYNC DO IAM CONTROL, POR EMPRESA ===');
console.log(`  ${pad('empresa', 22)} ${'do IAM'.padStart(7)} ${'total'.padStart(7)} ${'saldo IAM'.padStart(15)}`);
for (const r of porEmpresa)
  console.log(
    `  ${pad(r.empresa, 22)} ${String(r.iam).padStart(7)} ${String(r.total).padStart(7)} ${brl(r.saldo_iam).padStart(15)}`,
  );

const produtosIam = (
  await c.query(`
    select coalesce(nullif(trim(s.product), ''), '(sem produto)') as produto, count(*)::int as n,
           coalesce(sum(${saldoExpr}), 0) as saldo
      from public.students s
      join public.companies c on c.id = s.company_id
     where c.name = 'IAM - GC' and s.iam_control_aluno_id is not null
     group by 1 order by 3 desc`)
).rows;

console.log('\n=== PRODUTOS DAS FICHAS IAM DENTRO DE IAM - GC ===');
for (const r of produtosIam)
  console.log(`  ${pad(r.produto, 26)} ${String(r.n).padStart(4)} ${brl(r.saldo).padStart(15)}`);

await c.end();
