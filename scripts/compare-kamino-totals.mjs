import fs from 'node:fs';
import pg from 'pg';
import { parseKaminoFile, studentKey } from './lib/kamino-parse.mjs';

function totalsFromInstallments(installments) {
  let aberto = 0;
  let pago = 0;
  for (const i of installments ?? []) {
    const v = Number(i.value || 0);
    if (!v) continue;
    if (i.paid) pago += v;
    else aberto += v;
  }
  return { aberto, pago };
}

async function main() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const env = fs.readFileSync('.env', 'utf8').match(/DATABASE_URL=(.+)/m)[1].replaceAll('"', '');
  const kamino = parseKaminoFile('./scripts/KAMINO-GC.xlsx');
  const kTotals = { aberto: 0, pago: 0 };
  for (const s of kamino) {
    const t = totalsFromInstallments(s.installments);
    kTotals.aberto += t.aberto;
    kTotals.pago += t.pago;
  }

  const client = new pg.Client({ connectionString: env });
  await client.connect();
  const { rows } = await client.query(`
    SELECT name, product, installments, status_cancelamento, is_renda_extra, renda_extra_status, down_payment
    FROM students
  `);
  await client.end();

  const gcByKey = new Map();
  for (const r of rows) {
    gcByKey.set(studentKey(r.name, r.product), r);
  }

  let missingCount = 0;
  let missingAberto = 0;
  let missingPago = 0;
  let diffAberto = 0;
  let diffPago = 0;

  for (const s of kamino) {
    const gc = gcByKey.get(s.key);
    if (!gc) {
      missingCount += 1;
      const t = totalsFromInstallments(s.installments);
      missingAberto += t.aberto;
      missingPago += t.pago;
      continue;
    }
    const kt = totalsFromInstallments(s.installments);
    const gt = totalsFromInstallments(gc.installments);
    diffAberto += kt.aberto - gt.aberto;
    diffPago += kt.pago - gt.pago;
  }

  const scopes = {
    todos: { aberto: 0, pago: 0, entrada: 0 },
    semCancelado: { aberto: 0, pago: 0, entrada: 0 },
    forecastBase: { aberto: 0, pago: 0, entrada: 0 },
  };

  for (const r of rows) {
    const t = totalsFromInstallments(r.installments);
    const entrada = Number(r.down_payment || 0);
    scopes.todos.aberto += t.aberto;
    scopes.todos.pago += t.pago;
    scopes.todos.entrada += entrada;

    if (r.status_cancelamento === 'cancelado') continue;
    scopes.semCancelado.aberto += t.aberto;
    scopes.semCancelado.pago += t.pago;
    scopes.semCancelado.entrada += entrada;

    if (r.is_renda_extra && r.renda_extra_status && r.renda_extra_status !== 'Conciliar Exclusão') continue;
    scopes.forecastBase.aberto += t.aberto;
    scopes.forecastBase.pago += t.pago;
    scopes.forecastBase.entrada += entrada;
  }

  console.log('KAMINO (planilha):', kTotals);
  console.log('GC scopes:', scopes);
  console.log('Gap Kamino vs GC todos:', {
    aberto: kTotals.aberto - scopes.todos.aberto,
    pago: kTotals.pago - scopes.todos.pago,
  });
  console.log('Alunos Kamino:', kamino.length, 'GC:', rows.length);
  console.log('Só na Kamino:', missingCount, { missingAberto, missingPago });
  console.log('Matched diff (Kamino - GC):', { diffAberto, diffPago });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
