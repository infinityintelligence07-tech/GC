/**
 * SOMENTE LEITURA: lista empresas e mede a sobreposição de fichas entre elas.
 *
 * Uso: node scripts/gc-companies-check.mjs
 */
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
  const base = readEnv('DATABASE_URL');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('sem conexão');
}

const client = await conectar();

const { rows: companies } = await client.query(
  `SELECT c.id, c.*, (SELECT count(*) FROM public.students s WHERE s.company_id = c.id) AS fichas
     FROM public.companies c ORDER BY 1`,
);
console.log('=== EMPRESAS ===');
for (const c of companies) console.log(JSON.stringify(c));

const { rows: dupPares } = await client.query(
  `WITH por_empresa AS (
     SELECT lower(btrim(name)) AS nome, lower(btrim(coalesce(product,''))) AS produto,
            company_id, count(*) AS n
       FROM public.students GROUP BY 1,2,3
   )
   SELECT nome, produto, count(DISTINCT company_id) AS empresas, sum(n) AS fichas
     FROM por_empresa GROUP BY 1,2
    HAVING count(DISTINCT company_id) > 1
    ORDER BY 4 DESC`,
);
console.log(`\n=== MESMO ALUNO+PRODUTO EM MAIS DE UMA EMPRESA: ${dupPares.length} combinações ===`);
console.log(`fichas envolvidas: ${dupPares.reduce((s, r) => s + Number(r.fichas), 0)}`);

const { rows: dupDentro } = await client.query(
  `SELECT lower(btrim(name)) AS nome, lower(btrim(coalesce(product,''))) AS produto,
          company_id, count(*) AS n
     FROM public.students GROUP BY 1,2,3 HAVING count(*) > 1
    ORDER BY 4 DESC LIMIT 20`,
);
console.log(`\n=== DUPLICADAS DENTRO DA MESMA EMPRESA (top 20) ===`);
for (const r of dupDentro) console.log(`${r.n}x | ${r.nome} | ${r.produto} | company=${r.company_id}`);

const { rows: resumoDentro } = await client.query(
  `WITH d AS (
     SELECT company_id, min(coalesce(product,'(sem produto)')) AS produto,
            count(*) AS n, sum(sale_value) AS valor
       FROM public.students
      GROUP BY company_id, lower(btrim(name)), lower(btrim(coalesce(product,'')))
     HAVING count(*) > 1
   )
   SELECT company_id, produto, count(*) AS grupos, sum(n) AS fichas, sum(n) - count(*) AS excedentes
     FROM d GROUP BY 1,2 ORDER BY excedentes DESC`,
);
console.log('\n=== FICHAS EXCEDENTES POR EMPRESA/PRODUTO (mesma empresa) ===');
for (const r of resumoDentro)
  console.log(`${r.company_id} | ${r.produto} | ${r.grupos} grupos | ${r.fichas} fichas | ${r.excedentes} excedentes`);
console.log(`TOTAL de fichas excedentes: ${resumoDentro.reduce((s, r) => s + Number(r.excedentes), 0)}`);

const { rows: totais } = await client.query(
  `SELECT company_id, count(*) AS fichas,
          sum(sale_value) AS contratos,
          count(*) FILTER (WHERE status = 'Excluído') AS excluidos
     FROM public.students GROUP BY 1 ORDER BY 2 DESC`,
);
console.log('\n=== TOTAIS POR EMPRESA ===');
for (const r of totais)
  console.log(
    `${r.company_id} | ${r.fichas} fichas | contratos R$ ${Number(r.contratos).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | ${r.excluidos} com status Excluído`,
  );

await client.end();
