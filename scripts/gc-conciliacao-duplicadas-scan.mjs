/**
 * Conta alunos com renegociações abertas duplicadas (mesma proposta enviada
 * mais de uma vez) — SOMENTE LEITURA, não apaga nada.
 *
 * Uso: node scripts/gc-conciliacao-duplicadas-scan.mjs
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  if (!m) throw new Error(`${key} não encontrado em .env`);
  return m[1].replaceAll('"', '');
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('não foi possível conectar ao banco');
}

const dt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o ?? null)).digest('hex').slice(0, 12);

const client = await conectar();

const { rows } = await client.query(
  `SELECT id, student_id, student_name, tipo, status, created_at, depois
   FROM public.conciliacao_items
   WHERE status IN ('pendente', 'aprovado')
   ORDER BY student_name, created_at`,
);

console.log(`Itens abertos na fila de Conciliação: ${rows.length}`);

const porTipo = {};
for (const r of rows) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
console.log('\n=== ABERTOS POR TIPO ===');
for (const [t, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(` ${t}: ${n}`);
}

// Duplicata = mesmo aluno, mesmo tipo e mesmo conteúdo proposto.
const grupos = new Map();
for (const r of rows) {
  const k = `${r.student_id}|${r.tipo}|${hash(r.depois)}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(r);
}
const dups = [...grupos.values()].filter((g) => g.length > 1);

console.log(`\n=== GRUPOS DUPLICADOS (mesmo aluno + tipo + proposta) ===`);
console.log(`grupos: ${dups.length} | itens excedentes: ${dups.reduce((s, g) => s + g.length - 1, 0)}`);
for (const g of dups) {
  console.log(
    ` - ${g[0].student_name} · ${g[0].tipo} · ${g.length}x (${g.map((r) => dt(r.created_at)).join(', ')})`,
  );
}

await client.end();
