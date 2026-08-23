/**
 * Gera listas de IDs faltantes (backup vs GC atual) para merge add-only.
 */
import fs from 'node:fs';
import path from 'node:path';

const EXTRACT = path.resolve('.tmp_backup_extract');

function diffTable(backupFile, currentFile, outFile) {
  const backup = new Set(JSON.parse(fs.readFileSync(path.join(EXTRACT, backupFile), 'utf8')));
  const current = new Set(JSON.parse(fs.readFileSync(path.join(EXTRACT, currentFile), 'utf8')));
  const missing = [...backup].filter((id) => !current.has(id));
  fs.writeFileSync(path.join(EXTRACT, outFile), JSON.stringify(missing, null, 2));
  console.log(`${outFile}: faltam ${missing.length} (backup ${backup.size}, atual ${current.size})`);
  return missing.length;
}

// current students from MCP export
const raw = fs.readFileSync(path.join(EXTRACT, 'current_students_raw.json'), 'utf8');
const parsed = JSON.parse(raw);
const ids = (Array.isArray(parsed) ? parsed : parsed.result ?? parsed).map((r) => r.id);
fs.writeFileSync(path.join(EXTRACT, 'current_students_ids.json'), JSON.stringify(ids, null, 2));

diffTable('students_ids.json', 'current_students_ids.json', 'missing_students_ids.json');
