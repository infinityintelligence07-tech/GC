import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.tmp_backup_extract');
const backup = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'cancellation_cases_ids.json'), 'utf8')));
const current = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'current_cancellation_cases_ids.json'), 'utf8')));
const missing = [...backup].filter((id) => !current.has(id));
fs.writeFileSync(path.join(dir, 'missing_cancellation_cases_ids.json'), JSON.stringify(missing, null, 2));
console.log('Missing cancellation cases:', missing.length);
