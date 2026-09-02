/**
 * Remove itens de conciliação de renegociação DUPLICADOS: quando o mesmo aluno
 * tem duas propostas abertas com payload `depois` idêntico, mantém a mais
 * recente (que carrega a observação/comprovante) e apaga as anteriores.
 *
 * Motivo: conciliar as duas somaria a entrada duas vezes, porque o Conciliar
 * acumula downPayment (ConciliacaoPage.tsx, "novoDownPayment").
 *
 * Roda em dry-run por padrão. Só apaga com --apply.
 *
 * Uso:
 *   node scripts/gc-conciliacao-remove-duplicada.mjs "Alex%Bortolassi"
 *   node scripts/gc-conciliacao-remove-duplicada.mjs "Alex%Bortolassi" --apply
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const ALVO = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '%';

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

const dt = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o ?? null)).digest('hex').slice(0, 12);

const client = await conectar();
const q = async (sql, p = []) => (await client.query(sql, p)).rows;

const abertas = await q(
  `SELECT id, student_id, student_name, status, created_at, depois, autor_observacao
   FROM public.conciliacao_items
   WHERE tipo = 'renegociacao'
     AND status IN ('pendente', 'aprovado')
     AND student_name ILIKE $1
   ORDER BY student_name, created_at`,
  [ALVO],
);

// Agrupa por aluno + conteúdo da proposta: só é duplicata se o plano é igual.
const grupos = new Map();
for (const r of abertas) {
  const k = `${r.student_id}|${hash(r.depois)}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(r);
}

const duplicados = [...grupos.values()].filter((g) => g.length > 1);

console.log(`Modo: ${APPLY ? 'APLICAR (vai apagar)' : 'DRY-RUN (nada será alterado)'}`);
console.log(`Renegociações abertas analisadas: ${abertas.length}`);
console.log(`Grupos duplicados encontrados: ${duplicados.length}\n`);

if (duplicados.length === 0) {
  console.log('Nada a fazer.');
  await client.end();
  process.exit(0);
}

const paraApagar = [];
for (const grupo of duplicados) {
  const ordenado = [...grupo].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const manter = ordenado[ordenado.length - 1];
  const apagar = ordenado.slice(0, -1);

  console.log(`ALUNO: ${manter.student_name}`);
  console.log(`  MANTER  ${dt(manter.created_at)} · ${manter.status} · obs=${manter.autor_observacao ? 'sim' : 'não'} · ${manter.id}`);
  for (const r of apagar) {
    console.log(`  APAGAR  ${dt(r.created_at)} · ${r.status} · obs=${r.autor_observacao ? 'sim' : 'não'} · ${r.id}`);
    paraApagar.push(r.id);
  }
  console.log('');
}

if (!APPLY) {
  console.log(`Dry-run: ${paraApagar.length} item(ns) seriam apagados. Rode de novo com --apply para efetivar.`);
  await client.end();
  process.exit(0);
}

// Recheca o estado dentro da transação: nada é apagado se o item saiu de
// pendente/aprovado entre a leitura e a escrita.
await client.query('BEGIN');
try {
  const res = await client.query(
    `DELETE FROM public.conciliacao_items
     WHERE id = ANY($1::uuid[])
       AND tipo = 'renegociacao'
       AND status IN ('pendente', 'aprovado')
     RETURNING id, student_name, created_at`,
    [paraApagar],
  );
  if (res.rowCount !== paraApagar.length) {
    throw new Error(
      `esperava apagar ${paraApagar.length} item(ns), o banco casou ${res.rowCount} — transação desfeita`,
    );
  }
  await client.query('COMMIT');
  console.log(`Apagados ${res.rowCount} item(ns):`);
  for (const r of res.rows) console.log(` - ${r.student_name} · ${dt(r.created_at)} · ${r.id}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Falhou, nada foi alterado:', e.message);
  process.exitCode = 1;
}

await client.end();
