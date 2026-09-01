/**
 * Aplica as correções de lançamento duplicado aprovadas pela operação.
 * Atua SOMENTE na empresa "IAM - GC" (a base ativa); a empresa "Banco de Dados"
 * é arquivo histórico inativo e não é tocada.
 *
 * Casos:
 *   1) Maiara Maria dos Santos / Fundo - Receita (Recompra)  -> exclui a ficha inteira
 *   2) Neile dos Santos Tangerino / Confronto                -> remove 1 das 2 parcelas
 *                                                               de 830,33 com venc 15/04/2026
 *
 * Uso:
 *   node scripts/gc-dup-fix.mjs            # dry-run: mostra o que faria
 *   node scripts/gc-dup-fix.mjs --apply    # grava (backup automático antes)
 */
import fs from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const IAM_COMPANY = '00000000-0000-0000-0000-0000000a1a11';
const BACKUP_PATH = 'scripts/.gc-dup-fix-backup.json';

const MAIARA_ID = 'e68e1cda-b2ce-4272-b580-c30a0fa0424c';
const NEILE_ID = '2ea807dd-d088-4b93-a170-536a959e27d3';

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
const hoje = new Date().toISOString();

const client = await conectar();

// ---------- backup ----------
const { rows: alvos } = await client.query(
  `SELECT * FROM public.students WHERE id = ANY($1::uuid[])`,
  [[MAIARA_ID, NEILE_ID]],
);
if (alvos.length !== 2) {
  throw new Error(`esperava 2 fichas alvo, encontrei ${alvos.length}. Abortando.`);
}
for (const a of alvos) {
  if (a.company_id !== IAM_COMPANY) {
    throw new Error(`ficha ${a.id} (${a.name}) não é da empresa IAM - GC. Abortando.`);
  }
}
fs.writeFileSync(BACKUP_PATH, JSON.stringify({ geradoEm: hoje, fichas: alvos }, null, 2), 'utf8');
console.log(`backup das ${alvos.length} fichas gravado em ${BACKUP_PATH}\n`);

// ---------- caso 1: excluir ficha de recompra da Maiara ----------
const maiara = alvos.find((a) => a.id === MAIARA_ID);
if (maiara.name !== 'Maiara Maria dos Santos' || maiara.product !== 'Fundo - Receita (Recompra)') {
  throw new Error(`ficha ${MAIARA_ID} não confere: ${maiara.name} / ${maiara.product}`);
}
const { rows: casosMaiara } = await client.query(
  `SELECT id, student_name, funnel_stage FROM public.cancellation_cases WHERE student_id = $1`,
  [MAIARA_ID],
);

console.log('--- CASO 1: excluir ficha ---');
console.log(`${maiara.name} | ${maiara.product} | AC=${maiara.ac} | status=${maiara.status}`);
console.log(
  `  remove do GC: contrato R$ ${brl(maiara.sale_value)} | ` +
    `${maiara.installments.length} parcelas, ${maiara.installments.filter((i) => !i.paid).length} em aberto`,
);
console.log(`  casos de cancelamento vinculados: ${casosMaiara.length}`);

// ---------- caso 2: remover parcela duplicada da Neile ----------
const neile = alvos.find((a) => a.id === NEILE_ID);
if (neile.name !== 'Neile dos Santos Tangerino' || neile.product !== 'Confronto') {
  throw new Error(`ficha ${NEILE_ID} não confere: ${neile.name} / ${neile.product}`);
}

const insts = neile.installments;
const dupes = insts.filter((i) => i.dueDate === '2026-04-15' && R(i.value) === 830.33);
if (dupes.length !== 2) {
  throw new Error(`esperava 2 parcelas de 830,33 em 15/04/2026, encontrei ${dupes.length}. Abortando.`);
}
if (dupes.some((i) => i.paid)) {
  throw new Error('uma das parcelas duplicadas está paga — precisa de decisão manual. Abortando.');
}

// Descarta a segunda ocorrência (a de maior número) e renumera na ordem original.
const descartada = dupes[dupes.length - 1];
const restantes = insts
  .filter((i) => i !== descartada)
  .map((i, idx) => ({ ...i, number: idx + 1 }));

const novoSaleValue = R(Number(neile.sale_value) - R(descartada.value));
const novoTotal = restantes.length;
const novoInstValue = R(novoSaleValue / novoTotal);
const somaRestantes = R(restantes.reduce((s, i) => s + Number(i.value ?? 0), 0));
if (somaRestantes !== novoSaleValue) {
  throw new Error(`soma das parcelas (${somaRestantes}) != novo contrato (${novoSaleValue}). Abortando.`);
}

const novoHistory = [
  ...(neile.history ?? []),
  {
    date: hoje,
    type: 'Sistema',
    text:
      `Parcela duplicada removida na auditoria Kamino: venc 15/04/2026, R$ ${brl(descartada.value)} ` +
      `(havia 2 lançamentos idênticos). Contrato corrigido de R$ ${brl(neile.sale_value)} ` +
      `para R$ ${brl(novoSaleValue)} e total de parcelas de ${insts.length} para ${novoTotal}.`,
  },
];

console.log('\n--- CASO 2: remover parcela duplicada ---');
console.log(`${neile.name} | ${neile.product} | AC=${neile.ac} | status=${neile.status}`);
console.log(`  parcela removida: #${descartada.number} venc ${descartada.dueDate} R$ ${brl(descartada.value)} (aberta)`);
console.log(`  contrato:  R$ ${brl(neile.sale_value)}  ->  R$ ${brl(novoSaleValue)}`);
console.log(`  parcelas:  ${insts.length}  ->  ${novoTotal}  (pagas seguem ${neile.paid_installments})`);
console.log(`  valor parcela: ${brl(neile.installment_value)}  ->  ${brl(novoInstValue)}`);

// ---------- execução ----------
if (!APPLY) {
  console.log('\n>>> DRY-RUN: nada foi gravado. Rode com --apply para efetivar.');
  await client.end();
  process.exit(0);
}

try {
  await client.query('BEGIN');

  const del = await client.query(
    `DELETE FROM public.students WHERE id = $1 AND company_id = $2 RETURNING id`,
    [MAIARA_ID, IAM_COMPANY],
  );
  if (del.rowCount !== 1) throw new Error(`DELETE da Maiara afetou ${del.rowCount} linhas`);

  const upd = await client.query(
    `UPDATE public.students
        SET installments = $2::jsonb,
            sale_value = $3,
            total_installments = $4,
            installment_value = $5,
            history = $6::jsonb,
            updated_at = now()
      WHERE id = $1 AND company_id = $7
      RETURNING id`,
    [
      NEILE_ID,
      JSON.stringify(restantes),
      novoSaleValue,
      novoTotal,
      novoInstValue,
      JSON.stringify(novoHistory),
      IAM_COMPANY,
    ],
  );
  if (upd.rowCount !== 1) throw new Error(`UPDATE da Neile afetou ${upd.rowCount} linhas`);

  await client.query('COMMIT');
  console.log('\n>>> APLICADO com sucesso (1 ficha excluída, 1 parcela removida).');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\n>>> ERRO: rollback executado, nada foi alterado.');
  throw e;
} finally {
  await client.end();
}
