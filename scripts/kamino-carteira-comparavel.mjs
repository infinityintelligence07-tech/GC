/**
 * Mostra quanto do saldo em aberto do GC é carteira comparável com a planilha
 * Kamino, retirando em camadas o que a planilha não cobre. SOMENTE LEITURA.
 *
 * Uso: node scripts/kamino-carteira-comparavel.mjs
 */
import fs from 'node:fs';
import pg from 'pg';

const EMPRESA = 'IAM - GC';
const KAMINO_SALDO = 5825808.29;
const KAMINO_CONTRATOS = 790;

const R = (n) => Number((n ?? 0).toFixed(2));
const brl = (n) => R(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '');
  return (fs.readFileSync('.env', 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1] ?? '').replaceAll('"', '');
}

const client = new pg.Client({
  connectionString: readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, ''),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const rows = (
  await client.query(
    `select s.name, s.product, coalesce(nullif(trim(s.ac), ''), '(sem AC)') as ac, s.status,
            (select coalesce(sum((i->>'value')::numeric), 0) from jsonb_array_elements(s.installments) i
              where coalesce((i->>'paid')::boolean, false) = false) as saldo
       from public.students s
       join public.companies c on c.id = s.company_id
      where c.name = $1`,
    [EMPRESA],
  )
).rows.map((r) => ({ ...r, saldo: R(Number(r.saldo)) }));
await client.end();

const comSaldo = rows.filter((r) => r.saldo > 0);
const total = (arr) => R(arr.reduce((s, x) => s + x.saldo, 0));

const ehLiberty = (r) => /liberty/i.test(r.product ?? '');
const ehPendente = (r) => r.status === 'Pendente';
const ehCancelamento = (r) => /cancel/i.test(r.status ?? '');

const camadas = [
  { rotulo: 'Saldo em aberto no GC, sem filtro', teste: () => true },
  { rotulo: 'sem contratos Liberty (empresa errada)', teste: (r) => !ehLiberty(r) },
  { rotulo: 'sem Pendente (venda sem cobrança emitida)', teste: (r) => !ehLiberty(r) && !ehPendente(r) },
  {
    rotulo: 'sem Cancelado e Solicitação Cancelamento',
    teste: (r) => !ehLiberty(r) && !ehPendente(r) && !ehCancelamento(r),
  },
];

console.log('=== QUANTO DO GC E COMPARAVEL COM A PLANILHA ===');
console.log(`${pad('Camada', 48)} ${'fichas'.padStart(7)} ${'saldo'.padStart(16)} ${'vs planilha'.padStart(16)}`);
let ultimo = null;
for (const c of camadas) {
  const sub = comSaldo.filter(c.teste);
  ultimo = sub;
  console.log(
    `${pad(c.rotulo, 48)} ${String(sub.length).padStart(7)} ${brl(total(sub)).padStart(16)} ` +
      `${(R(total(sub) - KAMINO_SALDO) >= 0 ? '+' : '-') + brl(Math.abs(R(total(sub) - KAMINO_SALDO)))}`.padStart(17),
  );
}
console.log(`${pad('Planilha Kamino', 48)} ${String(KAMINO_CONTRATOS).padStart(7)} ${brl(KAMINO_SALDO).padStart(16)}`);

console.log('\n=== O QUE CADA CAMADA RETIRA ===');
const liberty = comSaldo.filter(ehLiberty);
const pendente = comSaldo.filter((r) => !ehLiberty(r) && ehPendente(r));
const cancel = comSaldo.filter((r) => !ehLiberty(r) && !ehPendente(r) && ehCancelamento(r));
console.log(`  Liberty:                ${String(liberty.length).padStart(4)} fichas ${brl(total(liberty)).padStart(14)}`);
console.log(`  Pendente:               ${String(pendente.length).padStart(4)} fichas ${brl(total(pendente)).padStart(14)}`);
console.log(`  Em cancelamento:        ${String(cancel.length).padStart(4)} fichas ${brl(total(cancel)).padStart(14)}`);

console.log('\n=== CARTEIRA COMPARAVEL POR AC ===');
const kamPorAc = new Map([
  ['Luana dos Santos', { n: 295, s: 2197903.74 }],
  ['Bianca Alarcon', { n: 264, s: 1866705.19 }],
  ['Elaine Valadares', { n: 231, s: 1761199.36 }],
]);
const gcPorAc = new Map();
for (const r of ultimo) {
  if (!gcPorAc.has(r.ac)) gcPorAc.set(r.ac, { n: 0, s: 0 });
  const v = gcPorAc.get(r.ac);
  v.n++;
  v.s = R(v.s + r.saldo);
}
console.log(
  `${pad('AC (Paula Passini = Bianca Alarcon)', 34)} ${'kam#'.padStart(5)} ${'kam saldo'.padStart(15)} ` +
    `${'gc#'.padStart(5)} ${'gc saldo'.padStart(15)} ${'dif'.padStart(14)}`,
);
for (const ac of [...new Set([...kamPorAc.keys(), ...gcPorAc.keys()])].sort()) {
  const k = kamPorAc.get(ac) ?? { n: 0, s: 0 };
  const g = gcPorAc.get(ac) ?? { n: 0, s: 0 };
  console.log(
    `${pad(ac, 34)} ${String(k.n).padStart(5)} ${brl(k.s).padStart(15)} ${String(g.n).padStart(5)} ` +
      `${brl(g.s).padStart(15)} ${((g.s - k.s >= 0 ? '+' : '-') + brl(Math.abs(R(g.s - k.s)))).padStart(14)}`,
  );
}
