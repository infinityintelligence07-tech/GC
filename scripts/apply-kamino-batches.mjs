/**
 * Aplica batches Kamino via Supabase execute_sql (lê arquivos e imprime progresso).
 * Uso interno: node scripts/apply-kamino-batches.mjs --print-batch 1
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('scripts/kamino-sync-batches');
const arg = process.argv.find((a) => a.startsWith('--print-batch='));
const n = arg ? Number(arg.split('=')[1]) : Number(process.argv[2] ?? 0);

if (!n) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('batch-')).sort();
  console.log(JSON.stringify({ batches: files.length, files }, null, 2));
  process.exit(0);
}

const file = path.join(dir, `batch-${String(n).padStart(3, '0')}.sql`);
if (!fs.existsSync(file)) throw new Error(`Batch não encontrado: ${file}`);
process.stdout.write(fs.readFileSync(file, 'utf8'));
