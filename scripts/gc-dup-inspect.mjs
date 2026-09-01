/**
 * SOMENTE LEITURA: mostra o estado atual no GC dos alunos envolvidos
 * nos casos de lançamento duplicado, para conferência antes de qualquer ajuste.
 *
 * Uso: node scripts/gc-dup-inspect.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const ALVOS = [
  'Maiara Maria dos Santos',
  'Neile dos Santos Tangerino',
  'Gabriela Dias da Silva',
];

// O pooler do Supabase apresenta cadeia self-signed; mesmo padrão de sync-kamino-gc.mjs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// O host do pooler muda de aws-0 para aws-1 conforme o projeto é remanejado de região,
// e o .env pode ficar defasado. Tenta as variações antes de desistir.
async function conectar() {
  const base = readEnv('DATABASE_URL');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  const erros = [];
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      console.log(`conectado via ${new URL(cs).host}`);
      return c;
    } catch (e) {
      erros.push(`${new URL(cs).host}: ${e.message}`);
      await c.end().catch(() => {});
    }
  }
  throw new Error(`nenhuma conexão funcionou:\n  ${erros.join('\n  ')}`);
}

const client = await conectar();

const { rows: cols } = await client.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
    ORDER BY ordinal_position`,
);
console.log('colunas de public.students:');
console.log(cols.map((c) => `${c.column_name}:${c.data_type}`).join(' | '));

const { rows } = await client.query(
  `SELECT * FROM public.students WHERE name = ANY($1::text[]) ORDER BY name, product`,
  [ALVOS],
);

for (const r of rows) {
  const insts = typeof r.installments === 'string' ? JSON.parse(r.installments) : (r.installments ?? []);
  const somaTodas = insts.reduce((s, i) => s + Number(i.value ?? 0), 0);
  const abertas = insts.filter((i) => !i.paid);
  const somaAberta = abertas.reduce((s, i) => s + Number(i.value ?? 0), 0);

  console.log('\n' + '='.repeat(100));
  console.log(`${r.name} | ${r.product} | ciclo=${r.ciclo ?? '-'} | AC=${r.ac ?? '-'}`);
  console.log(`id=${r.id}  company_id=${r.company_id}`);
  console.log(
    `status=${r.status} (${r.status_mode}) | cancelamento=${r.status_cancelamento} | ` +
      `matricula=${r.enrollment_date ?? '-'} | dia venc=${r.due_day}`,
  );
  console.log(
    `sale_value=${brl(r.sale_value)} | entrada=${brl(r.down_payment)} | ` +
      `parcelas=${r.paid_installments}/${r.total_installments} | valor parcela=${brl(r.installment_value)}`,
  );
  console.log(`soma parcelas=${brl(somaTodas)} | em aberto=${brl(somaAberta)} (${abertas.length} parcelas)`);
  console.log(`created=${r.created_at?.toISOString?.() ?? r.created_at} updated=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
  console.log('parcelas:');
  for (const i of insts) {
    console.log(
      `   #${String(i.number).padStart(2)} | venc ${i.dueDate} | valor ${brl(i.value).padStart(10)} | ` +
        `${i.paid ? `PAGO ${i.paidDate ?? '?'}${i.paidValue != null ? ` (recebido ${brl(i.paidValue)})` : ''}` : 'ABERTO'}` +
        `${i.tipoParcela ? ` | tipo=${i.tipoParcela}` : ''}` +
        `${i.tags?.length ? ` | tags=${i.tags.join(',')}` : ''}` +
        `${i.observacao ? ` | obs=${i.observacao}` : ''}`,
    );
  }
}

console.log(`\n\ntotal de fichas encontradas: ${rows.length}`);
await client.end();
