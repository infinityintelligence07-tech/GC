/**
 * Gabriela Dias da Silva / Confronto (empresa IAM - GC).
 *
 * A parcela de 10/06/2026 baixada em 10/06/2026 foi uma antecipação com desconto:
 * o Kamino (ID 46364) recebeu R$ 1.121,25 contra R$ 1.495,00 nominais. O valor da
 * parcela e o contrato ficam intactos; só o valor efetivamente recebido é corrigido,
 * para o desconto de R$ 373,75 ficar rastreável.
 *
 * Uso:
 *   node scripts/gc-dup-fix-gabriela.mjs            # dry-run
 *   node scripts/gc-dup-fix-gabriela.mjs --apply
 */
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const IAM_COMPANY = '00000000-0000-0000-0000-0000000a1a11';
const GABRIELA_ID = '47d46177-aca9-491b-b0e0-34c6e4524e6c';
const BACKUP_PATH = 'scripts/.gc-dup-fix-gabriela-backup.json';

const VENC = '2026-06-10';
const BAIXA = '2026-06-10';
const VALOR_NOMINAL = 1495;
const VALOR_RECEBIDO = 1121.25;
const KAMINO_ID = '46364';

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, connectionTimeoutMillis: 10000 });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error('sem conexão com o banco');
}

const R = (n) => Number(Number(n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

const client = await conectar();

const { rows } = await client.query(
  `SELECT * FROM public.students WHERE id = $1 AND company_id = $2`,
  [GABRIELA_ID, IAM_COMPANY],
);
if (rows.length !== 1) throw new Error(`esperava 1 ficha, encontrei ${rows.length}. Abortando.`);
const aluna = rows[0];
if (aluna.name !== 'Gabriela Dias da Silva' || aluna.product !== 'Confronto') {
  throw new Error(`ficha não confere: ${aluna.name} / ${aluna.product}`);
}

fs.writeFileSync(
  BACKUP_PATH,
  JSON.stringify({ geradoEm: new Date().toISOString(), ficha: aluna }, null, 2),
  'utf8',
);
console.log(`backup gravado em ${BACKUP_PATH}\n`);

const insts = aluna.installments;
const candidatas = insts.filter(
  (i) => i.dueDate === VENC && i.paidDate === BAIXA && R(i.value) === VALOR_NOMINAL && i.paid,
);
if (candidatas.length !== 1) {
  throw new Error(
    `esperava 1 parcela venc ${VENC} baixada em ${BAIXA} de R$ ${brl(VALOR_NOMINAL)}, ` +
      `encontrei ${candidatas.length}. Abortando.`,
  );
}
const alvo = candidatas[0];
const desconto = R(VALOR_NOMINAL - VALOR_RECEBIDO);

const novas = insts.map((i) =>
  i === alvo
    ? {
        ...i,
        paidValue: VALOR_RECEBIDO,
        observacao: `Antecipação com desconto de R$ ${brl(desconto)} — recebido R$ ${brl(VALOR_RECEBIDO)} (Kamino ID ${KAMINO_ID}).`,
      }
    : i,
);

const novoHistory = [
  ...(aluna.history ?? []),
  {
    date: new Date().toISOString(),
    type: 'Sistema',
    text:
      `Auditoria Kamino: parcela ${alvo.number} (venc ${VENC}) foi antecipação com desconto. ` +
      `Valor recebido registrado como R$ ${brl(VALOR_RECEBIDO)} contra R$ ${brl(VALOR_NOMINAL)} nominais ` +
      `(desconto de R$ ${brl(desconto)}). Valor da parcela e contrato mantidos.`,
  },
];

console.log(`${aluna.name} | ${aluna.product} | AC=${aluna.ac} | status=${aluna.status}`);
console.log(`  parcela #${alvo.number} venc ${alvo.dueDate} baixada ${alvo.paidDate}`);
console.log(`  valor da parcela: R$ ${brl(alvo.value)}  (inalterado)`);
console.log(`  recebido: ${alvo.paidValue != null ? `R$ ${brl(alvo.paidValue)}` : '(não informado)'}  ->  R$ ${brl(VALOR_RECEBIDO)}`);
console.log(`  desconto registrado: R$ ${brl(desconto)}`);
console.log(`  contrato: R$ ${brl(aluna.sale_value)}  (inalterado)`);

if (!APPLY) {
  console.log('\n>>> DRY-RUN: nada foi gravado. Rode com --apply para efetivar.');
  await client.end();
  process.exit(0);
}

try {
  await client.query('BEGIN');
  const upd = await client.query(
    `UPDATE public.students
        SET installments = $2::jsonb, history = $3::jsonb, updated_at = now()
      WHERE id = $1 AND company_id = $4
      RETURNING id`,
    [GABRIELA_ID, JSON.stringify(novas), JSON.stringify(novoHistory), IAM_COMPANY],
  );
  if (upd.rowCount !== 1) throw new Error(`UPDATE afetou ${upd.rowCount} linhas`);
  await client.query('COMMIT');
  console.log('\n>>> APLICADO com sucesso.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\n>>> ERRO: rollback executado, nada foi alterado.');
  throw e;
} finally {
  await client.end();
}
