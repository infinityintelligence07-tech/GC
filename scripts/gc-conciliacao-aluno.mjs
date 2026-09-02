/**
 * Lista os itens de conciliação de um aluno — SOMENTE LEITURA.
 * Serve para descobrir por que um item "já conciliado" voltou para a fila.
 *
 * Uso: node scripts/gc-conciliacao-aluno.mjs "Alex%Bortolassi"
 */
import fs from 'node:fs';
import pg from 'pg';

const ALVO = process.argv[2] ?? 'Alex%Bortolassi';

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

const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');

const client = await conectar();
const q = async (sql, p = []) => (await client.query(sql, p)).rows;

const alunos = await q(
  `SELECT s.id, s.name, s.ac, s.product, s.status, s.status_mode,
          s.sale_value, s.down_payment, s.total_installments, s.paid_installments,
          jsonb_array_length(coalesce(s.installments, '[]'::jsonb)) AS n_parcelas,
          c.name AS empresa
   FROM public.students s
   JOIN public.companies c ON c.id = s.company_id
   WHERE s.name ILIKE $1
   ORDER BY s.name`,
  [ALVO],
);

console.log('=== ALUNO(S) ===');
for (const a of alunos) {
  console.log(
    ` ${a.name} | ${a.empresa} | AC=${a.ac} | ${a.product} | status=${a.status} (${a.status_mode})\n` +
      `   venda=${brl(a.sale_value)} entrada=${brl(a.down_payment)} parcelas=${a.n_parcelas} (total=${a.total_installments}, pagas=${a.paid_installments})\n` +
      `   id=${a.id}`,
  );
}

const ids = alunos.map((a) => a.id);

const itens = await q(
  `SELECT id, tipo, status, resumo, autor_nome,
          created_at, updated_at,
          aprovado_at, aprovado_por_nome,
          conciliado_at, conciliado_por_nome,
          reprovado_at, reprovado_por_nome,
          student_id, student_name
   FROM public.conciliacao_items
   WHERE student_name ILIKE $1 OR student_id = ANY($2::uuid[])
   ORDER BY created_at`,
  [ALVO, ids],
);

console.log(`\n=== ITENS DE CONCILIAÇÃO (${itens.length}) ===`);
for (const i of itens) {
  console.log(
    ` [${i.status.toUpperCase()}] ${i.tipo} · criado ${dt(i.created_at)} por ${i.autor_nome ?? '—'}\n` +
      `   aprovado=${dt(i.aprovado_at)} ${i.aprovado_por_nome ?? ''} | conciliado=${dt(i.conciliado_at)} ${i.conciliado_por_nome ?? ''} | reprovado=${dt(i.reprovado_at)}\n` +
      `   vinculo: student_id=${i.student_id ?? 'NULO'}\n` +
      `   resumo: ${String(i.resumo ?? '').slice(0, 140)}\n` +
      `   id=${i.id}`,
  );
}

// Um item marcado conciliado sem carimbo de data indica que o update otimista
// da UI não chegou a persistir no banco.
const incoerentes = itens.filter(
  (i) =>
    (i.status === 'conciliado' && !i.conciliado_at) ||
    (i.status === 'aprovado' && !i.aprovado_at) ||
    (i.status === 'reprovado' && !i.reprovado_at),
);
console.log('\n=== ITENS COM STATUS SEM CARIMBO DE DATA ===');
console.log(incoerentes.length ? incoerentes.map((i) => `${i.id} (${i.status})`).join('\n') : ' nenhum');

const semVinculo = itens.filter((i) => !i.student_id);
console.log('\n=== ITENS SEM student_id (só casam por nome) ===');
console.log(semVinculo.length ? semVinculo.map((i) => `${i.id} (${i.tipo}/${i.status})`).join('\n') : ' nenhum');

await client.end();
