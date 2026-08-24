/**
 * Compara carteira aberta (parcelas não pagas) do backup vs GC atual, por assessor.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const EXTRACT = path.resolve('.tmp_backup_extract');

function readEnvDatabaseUrl() {
  const text = fs.readFileSync(path.resolve('.env'), 'utf8');
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL não encontrado');
  return m[1].replaceAll('"', '');
}

function parseStudentsCopy(sqlFile) {
  const text = fs.readFileSync(sqlFile, 'utf8');
  const marker = 'COPY public.students (';
  const start = text.indexOf(marker);
  const header = text.slice(start, text.indexOf(') FROM stdin;', start));
  const columns = header.slice(marker.length).split(',').map((c) => c.trim());
  const bodyStart = text.indexOf('FROM stdin;', start) + 'FROM stdin;'.length;
  const bodyEnd = text.indexOf('\n\\.\n', bodyStart);
  const body = bodyEnd >= 0 ? text.slice(bodyStart, bodyEnd) : text.slice(bodyStart);

  const acIdx = columns.indexOf('ac');
  const statusIdx = columns.indexOf('status');
  const cancelIdx = columns.indexOf('status_cancelamento');
  const reIdx = columns.indexOf('is_renda_extra');
  const reStatusIdx = columns.indexOf('renda_extra_status');
  const instIdx = columns.indexOf('installments');
  const idIdx = columns.indexOf('id');

  const uuidStart = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\t/i;
  const rows = [];
  let current = '';
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

  const byAc = new Map();
  let alunos = 0;
  for (const row of rows) {
    const parts = row.split('\t');
    const status = parts[statusIdx];
    const cancel = parts[cancelIdx] === '\\N' ? null : parts[cancelIdx];
    const isRe = parts[reIdx] === 't';
    const reStatus = parts[reStatusIdx] === '\\N' ? null : parts[reStatusIdx];
    if (cancel === 'cancelado') continue;
    if (status === 'Pago') continue;
    if (isRe && reStatus && reStatus !== 'Conciliar Exclusão') continue;

    let installments = [];
    try {
      const raw = parts[instIdx];
      if (raw && raw !== '\\N') installments = JSON.parse(raw);
    } catch {
      installments = [];
    }

    let aberto = 0;
    for (const i of installments) {
      if (!i?.paid) aberto += Number(i?.value || 0);
    }
    const ac = parts[acIdx] === '\\N' || !parts[acIdx] ? '(sem AC)' : parts[acIdx];
    const cur = byAc.get(ac) || { alunos: 0, aberto: 0, semParcelas: 0 };
    cur.alunos += 1;
    cur.aberto += aberto;
    if (!installments.length) cur.semParcelas += 1;
    byAc.set(ac, cur);
    alunos += 1;
  }

  return { byAc, alunos };
}

async function currentByAc(client) {
  const { rows } = await client.query(`
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
    ),
    unpaid AS (
      SELECT b.ac,
        count(DISTINCT b.id)::int AS alunos,
        round(sum(coalesce((inst->>'value')::numeric,0)), 2) AS aberto
      FROM base b
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.installments, '[]'::jsonb)) inst
      WHERE coalesce((inst->>'paid')::boolean, false) = false
      GROUP BY b.ac
    )
    SELECT coalesce(ac,'(sem AC)') AS ac, alunos, aberto FROM unpaid ORDER BY aberto DESC
  `);
  return rows;
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const backup = parseStudentsCopy(path.join(EXTRACT, 'students.sql'));
  const client = new pg.Client({ connectionString: readEnvDatabaseUrl() });
  await client.connect();
  try {
    const current = await currentByAc(client);
    const acs = new Set([
      ...[...backup.byAc.keys()],
      ...current.map((r) => r.ac),
    ]);

    console.log('=== Carteira aberta (parcelas NÃO pagas) por assessor ===');
    console.log('Backup alunos elegíveis:', backup.alunos);
    console.log('');
    for (const ac of [...acs].sort()) {
      const b = backup.byAc.get(ac) || { alunos: 0, aberto: 0, semParcelas: 0 };
      const c = current.find((r) => r.ac === ac) || { alunos: 0, aberto: 0 };
      const diff = Number(c.aberto) - b.aberto;
      console.log(
        `${ac}\n  backup: ${money(b.aberto)} (${b.alunos} alunos, ${b.semParcelas} sem parcelas)\n  GC:     ${money(c.aberto)} (${c.alunos} alunos)\n  delta:  ${money(diff)}\n`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
