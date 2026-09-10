/**
 * Aplica 20260910130000_iam_bonus_que_compra_entra_no_gc.sql:
 *   aluno bônus (nome "(bônus N)" ou matrícula ALUNO_BONUS) que COMPRA
 *   treinamento deixa de ser bônus e entra no GC; sem compra continua fora.
 *
 * Sem --apply: aplica numa transação, roda os cenários de teste com payloads
 * sintéticos e REVERTE tudo. Com --apply: aplica a função nova (os testes
 * continuam revertidos). Depois rode scripts/gc-iam-pull-completo.mjs.
 */
import fs from 'node:fs';
import pg from 'pg';

const MIGRACAO = 'supabase/migrations/20260910130000_iam_bonus_que_compra_entra_no_gc.sql';
const APLICAR = process.argv.includes('--apply');

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '') ?? '';
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function conectar() {
  const base = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
  const candidatos = [base];
  for (const [de, para] of [['aws-0-', 'aws-1-'], ['aws-1-', 'aws-0-']]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try { await c.connect(); return c; } catch { await c.end().catch(() => {}); }
  }
  throw new Error('sem conexão com o banco');
}

const venda = (contratoId, valor) => ({
  id_treinamento: 6, nome: 'Confronto', sigla: 'CONF', valor_total: valor, valor_pago: 0, valor_pendente: valor,
  formas_pagamento: [{ forma: 'PIX', valor }], data_venda: '2026-09-06T12:00:00.000Z', valor_entrada: valor,
  parcelas_pagas: 0, parcelas_detalhe: [], contrato_id: String(contratoId), status_conciliacao: 'PARA_CONCILIAR',
});
const brinde = () => ({
  id_treinamento: 2, nome: 'Programação Neurolinguística', sigla: 'PNL', valor_total: 0, valor_pago: 0, valor_pendente: 0,
  formas_pagamento: [], data_venda: null, contrato_id: null, status_conciliacao: null,
});
const payload = (id, nome, matriculas) => ({
  iam_control_aluno_id: id, nome, cpf: `99${String(id).padStart(9, '0')}`, email: `teste${id}@gc.test`, whatsapp: '',
  status_iam_control: 'ATIVO', financeiro: {}, matriculas, atualizado_em: '2026-09-10T12:00:00.000Z',
});
const CENARIOS = [
  ['nome bônus SEM compra → ignorado', payload(9900001, 'TESTE GC UM (bônus 1)', [{ id_matricula: 'x1', origem_aluno: 'COMPROU_INGRESSO', treinamentos: [brinde()] }]), 'ignorado'],
  ['nome bônus COM compra → criado, nome limpo', payload(9900002, 'TESTE GC DOIS (bônus 2)', [{ id_matricula: 'x2', origem_aluno: 'COMPROU_INGRESSO', treinamentos: [brinde(), venda(9900002, 9500)] }]), 'criado'],
  ['matrícula ALUNO_BONUS SEM compra → ignorado', payload(9900003, 'TESTE GC TRES', [{ id_matricula: 'x3', origem_aluno: 'ALUNO_BONUS', treinamentos: [brinde()] }]), 'ignorado'],
  ['matrícula ALUNO_BONUS COM compra → criado (só a venda)', payload(9900004, 'TESTE GC QUATRO', [{ id_matricula: 'x4', origem_aluno: 'ALUNO_BONUS', treinamentos: [brinde(), venda(9900004, 11646)] }]), 'criado'],
];

const sql = fs.readFileSync(MIGRACAO, 'utf8');
const client = await conectar();
client.on('notice', (n) => console.log('NOTICE:', n.message));
console.log(`modo: ${APLICAR ? 'APLICAR DE VERDADE' : 'validação (transação revertida)'}\n`);

let falhas = 0;
try {
  await client.query('BEGIN');
  await client.query(sql);

  const { rows: nomes } = await client.query(`
    SELECT public.iam_nome_sem_marca_bonus('MARIA SILVA (bônus 1)') a,
           public.iam_nome_sem_marca_bonus('JOAO PEREIRA (BONUS)') b,
           public.iam_nome_sem_marca_bonus('ANA bonus 2') c,
           public.iam_nome_sem_marca_bonus('CARLOS SOUZA') d`);
  console.log('nome limpo:', nomes[0]);

  await client.query('SAVEPOINT testes');
  for (const [titulo, p, esperado] of CENARIOS) {
    const { rows } = await client.query('SELECT public.iam_control_upsert_student($1::jsonb) r', [JSON.stringify(p)]);
    const r = rows[0].r;
    const acao = r.acao === 'multiplo' ? (r.criados > 0 ? 'criado' : 'ignorado') : r.acao;
    const ok = acao === esperado;
    if (!ok) falhas++;
    let extra = '';
    if (r.student_id) {
      const { rows: [s] } = await client.query('SELECT name, product, sale_value FROM public.students WHERE id = $1', [r.student_id]);
      extra = ` → ficha "${s.name}" · ${s.product} · R$ ${s.sale_value}`;
    }
    console.log(`${ok ? 'OK ' : 'ERR'} ${titulo}: ${acao}${r.motivo ? ` (${r.motivo})` : ''}${extra}`);
  }
  await client.query('ROLLBACK TO SAVEPOINT testes');

  if (falhas > 0) {
    await client.query('ROLLBACK');
    console.log(`\n${falhas} cenário(s) falharam — nada foi alterado.`);
    process.exitCode = 1;
  } else if (APLICAR) {
    await client.query('COMMIT');
    console.log('\nMIGRAÇÃO APLICADA. Rode agora: node scripts/gc-iam-pull-completo.mjs');
  } else {
    await client.query('ROLLBACK');
    console.log('\nrevertido — nada foi alterado. Rode com --apply para aplicar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU, nada foi alterado:', e.message);
  process.exitCode = 1;
}

await client.end();
