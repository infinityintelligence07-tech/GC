import fs from 'node:fs';
import pg from 'pg';

const text = fs.readFileSync('.tmp_backup_extract/cases.sql', 'utf8');
const cols = text.match(/COPY public.cancellation_cases \(([^)]+)\)/)[1].split(',').map((s) => s.trim());
const stageIdx = cols.indexOf('stage');
const funnelIdx = cols.indexOf('funnel_stage');
const start = text.indexOf('FROM stdin;') + 11;
const end = text.indexOf('\n\\.\n', start);
const backup = new Map();
for (const line of text.slice(start, end).split('\n')) {
  if (!/^[0-9a-f-]{36}\t/i.test(line)) continue;
  const p = line.split('\t');
  backup.set(p[0], { stage: p[stageIdx], funnel: p[funnelIdx] });
}

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replaceAll('"', '');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query('SELECT id::text, stage, funnel_stage FROM public.cancellation_cases');
let diff = 0;
for (const r of rows) {
  const b = backup.get(r.id);
  if (!b) continue;
  if (b.stage !== r.stage || b.funnel !== r.funnel_stage) diff++;
}
console.log('Casos em comum com divergência stage/funnel:', diff, 'de', rows.filter((r) => backup.has(r.id)).length);
await client.end();
