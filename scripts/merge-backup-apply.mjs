/**
 * Mescla dados do backup no GC: insere somente registros ausentes (ON CONFLICT DO NOTHING).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EXTRACT = path.resolve('.tmp_backup_extract');

const TABLES = [
  { table: 'students', sqlFile: 'students.sql', missingIdsFile: 'missing_students_ids.json' },
  { table: 'cancellation_cases', sqlFile: 'cases.sql', missingIdsFile: 'missing_cancellation_cases_ids.json' },
  { table: 'conciliacao_items', sqlFile: 'conciliacao.sql', missingIdsFile: 'missing_conciliacao_items_ids.json' },
];

function readEnvDatabaseUrl() {
  const text = fs.readFileSync(path.resolve('.env'), 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL não encontrado em .env');
  return m[1].replace(/^"|"$/g, '');
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
    } else if (current) {
      current += '\n' + line;
    }
  }
  if (current) rows.push(current);
  const header = text.slice(start, text.indexOf(') FROM stdin;', start));
  const columns = header.slice(marker.length).split(',').map((c) => c.trim());
  return { columns, rows };
}

async function copyRows(client, stagingTable, columns, rows) {
  if (rows.length === 0) return;
  const copySql = `COPY public.${stagingTable} (${columns.join(', ')}) FROM STDIN`;
  const stream = client.query(copyFrom(copySql));
  const input = Readable.from(rows.map((r) => r + '\n'));
  await pipeline(input, stream);
}

async function mergeTable(client, { table, sqlFile, missingIdsFile }) {
  const sqlPath = path.join(EXTRACT, sqlFile);
  const missingPath = path.join(EXTRACT, missingIdsFile);
  if (!fs.existsSync(sqlPath) || !fs.existsSync(missingPath)) {
    console.log(`[${table}] pulando (arquivo ausente)`);
    return 0;
  }

  const missingIds = new Set(JSON.parse(fs.readFileSync(missingPath, 'utf8')));
  if (missingIds.size === 0) {
    console.log(`[${table}] nada a inserir`);
    return 0;
  }

  const { columns, rows } = extractCopyRows(sqlPath, table);
  const filtered = rows.filter((row) => missingIds.has(row.slice(0, row.indexOf('\t'))));
  const staging = `_merge_${table}`;

  await client.query(`DROP TABLE IF EXISTS public.${staging}`);
  await client.query(`CREATE TABLE public.${staging} (LIKE public.${table} INCLUDING ALL)`);
  await copyRows(client, staging, columns, filtered);

  const colList = columns.join(', ');
  let insertSql;
  if (table === 'students') {
    insertSql = `INSERT INTO public.${table} (${colList})
     SELECT s.${columns.join(', s.')}
     FROM public.${staging} s
     WHERE NOT EXISTS (
       SELECT 1 FROM public.students t
       WHERE t.company_id = s.company_id
         AND t.cpf_digits = s.cpf_digits
         AND lower(btrim(coalesce(t.product, ''))) = lower(btrim(coalesce(s.product, '')))
         AND lower(btrim(coalesce(t.ciclo, ''))) = lower(btrim(coalesce(s.ciclo, '')))
     )
     ON CONFLICT (id) DO NOTHING`;
  } else {
    insertSql = `INSERT INTO public.${table} (${colList})
     SELECT ${colList} FROM public.${staging}
     ON CONFLICT (id) DO NOTHING`;
  }
  const res = await client.query(insertSql);
  await client.query(`DROP TABLE IF EXISTS public.${staging}`);
  console.log(`[${table}] faltavam ${missingIds.size}, copiados ${filtered.length}, inseridos ${res.rowCount}`);
  return res.rowCount ?? 0;
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const only = process.argv[2];
  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();
  try {
    for (const cfg of TABLES) {
      if (only && cfg.table !== only) continue;
      await mergeTable(client, cfg);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
