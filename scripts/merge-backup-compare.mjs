/**
 * Compara IDs do backup (pg_restore COPY) com o GC atual e lista o que falta inserir.
 * Uso: node scripts/merge-backup-compare.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BACKUP_DIR = path.resolve('.tmp_backup_extract');

function extractCopyIds(filePath, idColumnIndex = 0) {
  const text = fs.readFileSync(filePath, 'utf8');
  const start = text.indexOf('FROM stdin;');
  if (start < 0) return [];
  const body = text.slice(start + 'FROM stdin;'.length);
  const end = body.indexOf('\n\\.\n');
  const data = end >= 0 ? body.slice(0, end) : body;
  const ids = new Set();
  for (const line of data.split('\n')) {
    if (!line.trim() || line.startsWith('\\')) continue;
    const firstTab = line.indexOf('\t');
    const id = firstTab >= 0 ? line.slice(0, firstTab) : line;
    if (/^[0-9a-f-]{36}$/i.test(id)) ids.add(id);
  }
  return [...ids];
}

const tables = [
  { file: 'cases.sql', table: 'cancellation_cases' },
  { file: 'students.sql', table: 'students' },
];

for (const { file, table } of tables) {
  const full = path.join(BACKUP_DIR, file);
  if (!fs.existsSync(full)) {
    console.log(`${table}: arquivo ${file} não encontrado`);
    continue;
  }
  const ids = extractCopyIds(full);
  const out = path.join(BACKUP_DIR, `${table}_ids.json`);
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log(`${table}: ${ids.length} IDs no backup → ${out}`);
}
