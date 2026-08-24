/**
 * Insere alunos do backup que faltam no GC (principalmente sem CPF),
 * sem sobrescrever e sem tratar CPF vazio como chave única.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EXTRACT = path.resolve('.tmp_backup_extract');

function readEnvDatabaseUrl() {
  const text = fs.readFileSync(path.resolve('.env'), 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL não encontrado');
  return m[1].replaceAll('"', '');
}

function extractCopyRows(sqlFile, tableName) {
  const text = fs.readFileSync(sqlFile, 'utf8');
  const marker = `COPY public.${tableName} (`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`COPY não encontrado: ${sqlFile}`);
  const bodyStart = text.indexOf('FROM stdin;', start) + 'FROM stdin;'.length;
  const bodyEnd = text.indexOf('\n\\.\n', bodyStart);
  const body = bodyEnd >= 0 ? text.slice(bodyStart, bodyEnd) : text.slice(bodyStart);
  const rows = [];
  let current = '';
  const uuidStart = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\t/i;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    if (uuidStart.test(line)) {
      if (current) rows.push(current);
      current = line;
    } else if (current) current += '\n' + line;
  }
  if (current) rows.push(current);
  const header = text.slice(start, text.indexOf(') FROM stdin;', start));
  const columns = header.slice(marker.length).split(',').map((c) => c.trim());
  return { columns, rows };
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const missingIds = new Set(
    JSON.parse(fs.readFileSync(path.join(EXTRACT, 'missing_students_ids.json'), 'utf8')),
  );
  console.log('IDs candidatos (backup − GC):', missingIds.size);

  const { columns, rows } = extractCopyRows(path.join(EXTRACT, 'students.sql'), 'students');
  const filtered = rows.filter((row) => missingIds.has(row.slice(0, row.indexOf('\t'))));
  console.log('Linhas no backup para esses IDs:', filtered.length);

  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();

  const staging = '_merge_students_gap';
  await client.query(`DROP TABLE IF EXISTS public.${staging}`);
  await client.query(`CREATE TABLE public.${staging} (LIKE public.students INCLUDING DEFAULTS)`);

  // Generated column cpf_digits cannot be copied — exclude it if present
  const copyCols = columns.filter((c) => c !== 'cpf_digits');
  // Rebuild rows without cpf_digits column if needed
  let copyRows = filtered;
  if (columns.includes('cpf_digits')) {
    const idx = columns.indexOf('cpf_digits');
    copyRows = filtered.map((row) => {
      const parts = row.split('\t');
      parts.splice(idx, 1);
      return parts.join('\t');
    });
  }

  const stream = client.query(copyFrom(`COPY public.${staging} (${copyCols.join(', ')}) FROM STDIN`));
  await pipeline(Readable.from(copyRows.map((r) => r + '\n')), stream);

  const colList = copyCols.join(', ');
  const res = await client.query(`
    INSERT INTO public.students (${colList})
    SELECT ${copyCols.map((c) => `s.${c}`).join(', ')}
    FROM public.${staging} s
    WHERE NOT EXISTS (SELECT 1 FROM public.students t WHERE t.id = s.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.students t
        WHERE length(regexp_replace(coalesce(s.cpf,''), '[^0-9]', '', 'g')) >= 11
          AND t.company_id = s.company_id
          AND t.cpf_digits = regexp_replace(coalesce(s.cpf,''), '[^0-9]', '', 'g')
          AND lower(btrim(coalesce(t.product,''))) = lower(btrim(coalesce(s.product,'')))
          AND lower(btrim(coalesce(t.ciclo,''))) = lower(btrim(coalesce(s.ciclo,'')))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.students t2
        WHERE lower(btrim(coalesce(t2.name,''))) = lower(btrim(coalesce(s.name,'')))
          AND lower(btrim(coalesce(t2.product,''))) = lower(btrim(coalesce(s.product,'')))
          AND t2.company_id = s.company_id
      )
    ON CONFLICT (id) DO NOTHING
  `);

  await client.query(`DROP TABLE IF EXISTS public.${staging}`);

  const { rows: carteira } = await client.query(`
    WITH base AS (
      SELECT id, ac, installments
      FROM public.students
      WHERE coalesce(status_cancelamento,'nenhum') <> 'cancelado'
        AND coalesce(status,'') <> 'Pago'
        AND NOT (
          coalesce(is_renda_extra,false) = true
          AND nullif(renda_extra_status,'') IS NOT NULL
          AND renda_extra_status <> 'Conciliar Exclusão'
        )
    )
    SELECT coalesce(ac,'(sem)') AS ac,
      count(DISTINCT id)::int AS alunos,
      round(sum(coalesce((inst->>'value')::numeric,0)) FILTER (
        WHERE coalesce((inst->>'paid')::boolean,false)=false
      ), 2) AS aberto
    FROM base b
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.installments,'[]'::jsonb)) inst
    GROUP BY ac
    ORDER BY aberto DESC
  `);

  console.log('Inseridos agora:', res.rowCount);
  console.log('Carteira aberta atual:');
  for (const r of carteira) {
    console.log(`  ${r.ac}: ${r.alunos} alunos | R$ ${Number(r.aberto).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
