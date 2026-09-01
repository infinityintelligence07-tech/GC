/**
 * Aplica a regra real do app (isStudentInAcPortfolio + fila IAM→GC) sobre a base
 * e mostra o que a dashboard exibe, separando o que fica retido na Conciliação.
 * Também detalha os contratos Liberty. SOMENTE LEITURA.
 *
 * Uso: node scripts/gc-carteira-regra-do-app.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const EMPRESA = 'IAM - GC';
const KAMINO_SALDO = 5825808.29;

const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const soma = (a, f) => R(a.reduce((s, x) => s + f(x), 0));

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  return (fs.readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1] ?? '').replaceAll('"', '');
}

const client = new pg.Client({
  connectionString: readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const cols = (
  await client.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='students'`,
  )
).rows.map((r) => r.column_name);
const has = (c) => cols.includes(c);
const pick = (c, alias = c) => (has(c) ? `s.${c} as "${alias}"` : `null as "${alias}"`);

const rows = (
  await client.query(
    `select s.id, s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac,
            s.status, s.status_mode as "statusMode",
            ${pick('status_cancelamento', 'statusCancelamento')},
            ${pick('renda_extra_status', 'rendaExtraStatus')},
            ${pick('iam_control_aluno_id', 'iamId')},
            ${pick('iam_control_contrato_status', 'iamStatus')},
            ${pick('iam_gc_conciliado_at', 'iamGcConciliadoAt')},
            ${pick('kamino_synced_at', 'kaminoSyncedAt')},
            ${pick('iam_control_pendente_tipo', 'pendenteTipo')},
            s.sale_value as "saleValue", s.down_payment as "downPayment",
            s.total_installments as "totalInst", s.paid_installments as "paidInst",
            to_char(s.created_at, 'YYYY-MM-DD') as "criadaEm",
            coalesce(jsonb_array_length(s.installments), 0) as "nInst",
            (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as saldo,
            (select count(*) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as "nAbertas"
       from public.students s
       join public.companies c on c.id = s.company_id
      where c.name = $1`,
    [EMPRESA],
  )
).rows.map((r) => ({ ...r, saldo: R(Number(r.saldo)) }));

const filaIam = (
  await client.query(
    `select status, count(*)::int as n from public.conciliacao_items where tipo = 'iam_pendente' group by status`,
  )
).rows;

const libertyPorEmpresa = (
  await client.query(
    `select c.name as empresa, count(*)::int as n,
            coalesce(sum((select coalesce(sum((i->>'value')::numeric), 0)
                            from jsonb_array_elements(s.installments) i
                           where coalesce((i->>'paid')::boolean, false) = false)), 0) as saldo
       from public.students s
       join public.companies c on c.id = s.company_id
      where s.product ilike '%liberty%'
      group by c.name order by 2 desc`,
  )
).rows;
await client.end();

// ── Regras do app, espelhadas de src/lib ─────────────────────────────────
const normIam = (s) => String(s ?? '').toUpperCase().trim().replace(/\s+/g, '_');
const IAM_REQUER_APROVACAO = new Set(['CONCILIADO', 'PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR']);
const ehIam = (s) => s.iamId != null && Number.isFinite(Number(s.iamId));

function quitadoAvista(s) {
  if (!ehIam(s)) return false;
  if (normIam(s.iamStatus) !== 'CONCILIADO') return false;
  const sale = Number(s.saleValue ?? 0);
  const down = Number(s.downPayment ?? 0);
  const total = Number(s.totalInst ?? 0);
  const paid = Number(s.paidInst ?? 0);
  if (total === 0 && down >= sale - 0.01) return true;
  if (total > 0 && paid >= total) return true;
  return s.nInst > 0 && s.nAbertas === 0;
}

function precisaAprovacaoGc(s) {
  if (!ehIam(s)) return false;
  if (s.iamGcConciliadoAt) return false;
  if (quitadoAvista(s)) return false;
  return IAM_REQUER_APROVACAO.has(normIam(s.iamStatus));
}

const emCancelamento = (s) =>
  ['solicitado', 'em_tratamento', 'juridico', 'aguardando_conciliacao', 'pagamento_multa_pendente'].includes(
    s.statusCancelamento,
  ) || s.status === 'Solicitação Cancelamento';

function naCarteira(s) {
  if (precisaAprovacaoGc(s)) return false;
  if (emCancelamento(s)) return true;
  if (s.nInst > 0 && s.nAbertas === 0) return false;
  if (s.nInst === 0 && quitadoAvista(s)) return false;
  if (s.status === 'Pago') return false;
  if (s.statusCancelamento === 'cancelado') return false;
  return true;
}

/** countsInAcPortfolioTotals: IAM só soma depois de aprovado na Conciliação GC. */
function somaNaCarteira(s) {
  if (ehIam(s)) return Boolean(s.iamGcConciliadoAt) || quitadoAvista(s);
  return true;
}

const comSaldo = rows.filter((r) => r.saldo > 0);

console.log('=== FILA CONCILIACAO > IAM CONTROL -> GC ===');
for (const f of filaIam) console.log(`  itens ${pad(f.status, 14)} ${f.n}`);

const retidos = comSaldo.filter((r) => precisaAprovacaoGc(r));
const visiveis = comSaldo.filter((r) => naCarteira(r));
const naDash = visiveis.filter(somaNaCarteira);
const iamNaoAprovado = comSaldo.filter((r) => ehIam(r) && !somaNaCarteira(r));
const iamMudo = iamNaoAprovado.filter((r) => !precisaAprovacaoGc(r));

console.log('\n=== O QUE A REGRA DO APP FAZ COM O SALDO EM ABERTO ===');
console.log(`  todas as fichas com saldo:            ${String(comSaldo.length).padStart(4)} ${brl(soma(comSaldo, (x) => x.saldo)).padStart(15)}`);
console.log(`  visiveis na carteira (linha da lista):${String(visiveis.length).padStart(4)} ${brl(soma(visiveis, (x) => x.saldo)).padStart(15)}`);
console.log(`  IAM sem aprovacao GC (nao soma):      ${String(iamNaoAprovado.length).padStart(4)} ${brl(soma(iamNaoAprovado, (x) => x.saldo)).padStart(15)}`);
console.log(`    dos quais estao na fila Conciliacao:${String(retidos.length).padStart(4)} ${brl(soma(retidos, (x) => x.saldo)).padStart(15)}`);
console.log(`    dos quais NAO geram item na fila:   ${String(iamMudo.length).padStart(4)} ${brl(soma(iamMudo, (x) => x.saldo)).padStart(15)}`);
console.log(`  SOMA na carteira do AC / dashboard:   ${String(naDash.length).padStart(4)} ${brl(soma(naDash, (x) => x.saldo)).padStart(15)}`);
console.log(`  planilha Kamino:                       790 ${brl(KAMINO_SALDO).padStart(15)}`);
console.log(`  dashboard vs planilha: ${brl(soma(naDash, (x) => x.saldo) - KAMINO_SALDO)}`);

console.log('\n=== CARTEIRA POR AC, COM A REGRA DO APP ===');
const kamPorAc = new Map([
  ['Luana dos Santos', { n: 295, s: 2197903.74 }],
  ['Bianca Alarcon', { n: 264, s: 1866705.19 }],
  ['Elaine Valadares', { n: 231, s: 1761199.36 }],
]);
const gcPorAc = new Map();
for (const r of naDash) {
  if (!gcPorAc.has(r.ac)) gcPorAc.set(r.ac, { n: 0, s: 0 });
  const v = gcPorAc.get(r.ac);
  v.n++;
  v.s = R(v.s + r.saldo);
}
console.log(
  `  ${pad('AC', 26)} ${'kam#'.padStart(5)} ${'kam saldo'.padStart(15)} ${'gc#'.padStart(5)} ${'gc saldo'.padStart(15)} ${'dif'.padStart(14)}`,
);
for (const ac of [...new Set([...kamPorAc.keys(), ...gcPorAc.keys()])].sort()) {
  const k = kamPorAc.get(ac) ?? { n: 0, s: 0 };
  const g = gcPorAc.get(ac) ?? { n: 0, s: 0 };
  console.log(
    `  ${pad(ac, 26)} ${String(k.n).padStart(5)} ${brl(k.s).padStart(15)} ${String(g.n).padStart(5)} ` +
      `${brl(g.s).padStart(15)} ${((g.s - k.s >= 0 ? '+' : '-') + brl(Math.abs(R(g.s - k.s)))).padStart(14)}`,
  );
}

console.log('\n=== IAM SEM APROVACAO GC, POR STATUS DO CONTRATO IAM ===');
const porIamStatus = new Map();
for (const r of iamNaoAprovado) {
  const k = `${normIam(r.iamStatus) || '(vazio)'}${precisaAprovacaoGc(r) ? '  -> vai para a fila' : '  -> fica mudo'}`;
  if (!porIamStatus.has(k)) porIamStatus.set(k, { n: 0, s: 0 });
  const v = porIamStatus.get(k);
  v.n++;
  v.s = R(v.s + r.saldo);
}
for (const [k, v] of [...porIamStatus].sort((a, b) => b[1].s - a[1].s))
  console.log(`  ${pad(k, 40)} ${String(v.n).padStart(4)} ${brl(v.s).padStart(15)}`);

// ── Os 57 Pendente: sao IAM mesmo? ───────────────────────────────────────
const pendentes = comSaldo.filter((r) => r.status === 'Pendente');
console.log(`\n=== AS FICHAS EM STATUS "Pendente" COM SALDO (${pendentes.length} | ${brl(soma(pendentes, (x) => x.saldo))}) ===`);
const pIam = pendentes.filter(ehIam);
const pNaoIam = pendentes.filter((r) => !ehIam(r));
console.log(`  vindas do IAM Control:      ${String(pIam.length).padStart(3)} ${brl(soma(pIam, (x) => x.saldo)).padStart(14)}`);
console.log(`  SEM vinculo com IAM Control:${String(pNaoIam.length).padStart(3)} ${brl(soma(pNaoIam, (x) => x.saldo)).padStart(14)}`);
const pRetidas = pendentes.filter(precisaAprovacaoGc);
console.log(`  efetivamente retidas na fila:${String(pRetidas.length).padStart(3)} ${brl(soma(pRetidas, (x) => x.saldo)).padStart(14)}`);
const pVazam = pendentes.filter((r) => !precisaAprovacaoGc(r) && naCarteira(r));
console.log(`  VAZAM para a carteira:      ${String(pVazam.length).padStart(3)} ${brl(soma(pVazam, (x) => x.saldo)).padStart(14)}`);

const motivo = new Map();
for (const p of pVazam) {
  const m = !ehIam(p)
    ? 'nao e IAM Control (cadastro manual/importacao)'
    : p.iamGcConciliadoAt
      ? 'ja aprovado na Conciliacao, mas status ficou Pendente'
      : `status IAM fora da lista: ${normIam(p.iamStatus) || '(vazio)'}`;
  if (!motivo.has(m)) motivo.set(m, { n: 0, s: 0 });
  const v = motivo.get(m);
  v.n++;
  v.s = R(v.s + p.saldo);
}
console.log('  por que vazam:');
for (const [k, v] of [...motivo].sort((a, b) => b[1].s - a[1].s))
  console.log(`    ${pad(k, 52)} ${String(v.n).padStart(3)} ${brl(v.s).padStart(14)}`);

console.log('\n  amostra das que vazam:');
for (const p of pVazam.sort((a, b) => b.saldo - a.saldo).slice(0, 12))
  console.log(
    `    ${pad(p.name.slice(0, 34), 34)} ${pad(p.product.slice(0, 16), 16)} ${pad(p.ac.slice(0, 17), 17)} ` +
      `${brl(p.saldo).padStart(12)} | iamId ${p.iamId ?? '-'} | iamStatus ${p.iamStatus ?? '-'} | kaminoSync ${p.kaminoSyncedAt ? 'sim' : 'nao'} | criada ${p.criadaEm}`,
  );

// ── Liberty ──────────────────────────────────────────────────────────────
const liberty = rows.filter((r) => /liberty/i.test(r.product ?? ''));
console.log(`\n=== CONTRATOS LIBERTY DENTRO DA EMPRESA "${EMPRESA}" (${liberty.length}) ===`);
for (const l of liberty.sort((a, b) => b.saldo - a.saldo))
  console.log(
    `  ${pad(l.name.slice(0, 32), 32)} ${pad(l.product, 14)} ${pad(l.ac.slice(0, 12), 12)} ${pad(l.status, 12)} ` +
      `${brl(l.saldo).padStart(12)} | ${l.nInst}p (${l.nAbertas} abertas) | venda ${brl(Number(l.saleValue ?? 0))} | ` +
      `iamId ${l.iamId ?? '-'} | iamStatus ${l.iamStatus ?? '-'} | kaminoSync ${l.kaminoSyncedAt ? 'sim' : 'nao'} | criada ${l.criadaEm}`,
  );

console.log('\n=== ONDE MORAM OS CONTRATOS LIBERTY NO BANCO INTEIRO ===');
for (const e of libertyPorEmpresa)
  console.log(`  ${pad(e.empresa, 22)} ${String(e.n).padStart(4)} fichas ${brl(Number(e.saldo)).padStart(15)}`);
