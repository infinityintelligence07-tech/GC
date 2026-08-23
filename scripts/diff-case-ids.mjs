import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.tmp_backup_extract');
const backupCases = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'cancellation_cases_ids.json'), 'utf8')));
const currentCases = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'current_cancellation_cases_ids.json'), 'utf8')));

const missing = [...backupCases].filter((id) => !currentCases.has(id));
const extraInCurrent = [...currentCases].filter((id) => !backupCases.has(id));

console.log('Backup cases:', backupCases.size);
console.log('Current cases:', currentCases.size);
console.log('Missing in current (to add):', missing.length);
console.log('Only in current (keep):', extraInCurrent.length);
if (missing.length) console.log('Missing IDs:', missing.join('\n'));
