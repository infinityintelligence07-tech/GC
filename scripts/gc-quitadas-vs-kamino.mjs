/**
 * SOMENTE LEITURA: detalha as fichas que estão QUITADAS no GC mas que o extrato
 * Kamino ainda mostra com saldo em aberto, para entender como foram baixadas.
 *
 * Uso: node scripts/gc-quitadas-vs-kamino.mjs
 */
import fs from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';
import { normalizeDate, normalizeNumber, normalizeString } from './lib/kamino-parse.mjs';

const XLSX_PATH = 'KAMINO GC (1).xlsx';
const IAM_COMPANY_NAME = 'IAM - GC';

// Nome + produto conforme aparecem no extrato Kamino.
const ALVOS = [
  ['ANGELICA LEA SERVICOS AMBULATORIAIS', 'MISSAO GOVERNAR'],
  ['VICTOR GUEDES WAIANDT', 'MISSAO GOVERNAR'],
  ['JAQUELINE TAIS ALVES PEREIRA', 'MISSAO GOVERNAR'],
  ['VALDIRENE TAMOS DAS MERCES', 'MISSAO GOVERNAR'],
  ['TAINARA ALVES', 'CONFRONTO'],
  ['RONALDO BEDA DA SILVA', 'MISSAO GOVERNAR'],
  ['ISMAEL JOAQUIM LIMA', 'MISSAO GOVERNAR'],
  ['GELTA OLIVEIRA CARVALHO', 'FUNDO - RECEITA (RECOMPRA)'],
  ['LUCELIA CORADINI', 'MISSAO GOVERNAR'],
];

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
const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

// ─── extrato Kamino: linhas em aberto de cada alvo ───
const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
const alvoSet = new Set(ALVOS.map(([n, p]) => `${norm(n)}|${norm(p)}`));

const kaminoLinhas = new Map();
for (const r of rawRows) {
  const k = `${norm(normalizeString(r.Pessoa))}|${norm(normalizeString(r.Classificação))}`;
  if (!alvoSet.has(k)) continue;
  const receb = normalizeDate(r.Recebimento, XLSX);
  const recebido = normalizeNumber(r['Valor Recebido (R$)']) ?? 0;
  if (!kaminoLinhas.has(k)) kaminoLinhas.set(k, []);
  kaminoLinhas.get(k).push({
    venc: normalizeDate(r.Vencimento, XLSX),
    receb,
    pago: !!receb || recebido > 0,
    aReceber: normalizeNumber(r['Valor a Receber (R$)']) ?? 0,
    recebido,
    forma: normalizeString(r['Forma de Recebimento']),
    detalhe: String(r.Detalhe ?? '').slice(0, 90),
  });
}

// ─── fichas no GC ───
const client = await conectar();
const { rows: alunos } = await client.query(
  `SELECT s.* FROM public.students s JOIN public.companies c ON c.id = s.company_id
    WHERE c.name = $1`,
  [IAM_COMPANY_NAME],
);
await client.end();

for (const [nomeK, prodK] of ALVOS) {
  const k = `${norm(nomeK)}|${norm(prodK)}`;
  const linhas = kaminoLinhas.get(k) ?? [];
  const abertas = linhas.filter((l) => !l.pago);
  const fichas = alunos.filter((s) => norm(s.name) === norm(nomeK) && norm(s.product) === norm(prodK));

  console.log('\n' + '='.repeat(105));
  console.log(`${nomeK} | ${prodK}`);
  console.log(
    `KAMINO: ${linhas.length} lançamentos (${abertas.length} em aberto = R$ ${brl(abertas.reduce((a, l) => a + l.aReceber, 0))})`,
  );
  const vencAbertos = abertas.map((l) => l.venc).sort();
  if (vencAbertos.length) {
    console.log(`  em aberto vencendo de ${vencAbertos[0]} a ${vencAbertos[vencAbertos.length - 1]}`);
    for (const l of abertas.slice(0, 4)) {
      console.log(`    venc ${l.venc} | R$ ${brl(l.aReceber).padStart(10)} | ${l.forma} | ${l.detalhe}`);
    }
    if (abertas.length > 4) console.log(`    ... e mais ${abertas.length - 4}`);
  }

  if (!fichas.length) {
    console.log('GC: nenhuma ficha com esse nome+produto');
    continue;
  }
  for (const f of fichas) {
    const insts = f.installments ?? [];
    const datasBaixa = [...new Set(insts.filter((i) => i.paid).map((i) => i.paidDate))].sort();
    const comMarca = insts.filter((i) => i.paid && i.paidMarkedAt).length;
    console.log(
      `GC: contrato R$ ${brl(f.sale_value)} | ${insts.filter((i) => i.paid).length}/${insts.length} pagas | ` +
        `status ${f.status} (${f.status_mode}) | AC ${f.ac ?? '-'}`,
    );
    console.log(`  id=${f.id} | iam_aluno_id=${f.iam_control_aluno_id ?? '-'} | criada ${String(f.created_at).slice(0, 10)} | atualizada ${String(f.updated_at).slice(0, 10)}`);
    console.log(`  datas de baixa distintas: ${datasBaixa.join(', ') || '(nenhuma)'}`);
    console.log(`  parcelas com registro de conciliação (paidMarkedAt): ${comMarca} de ${insts.filter((i) => i.paid).length}`);
    for (const i of insts) {
      console.log(
        `    #${String(i.number).padStart(2)} | venc ${i.dueDate} | R$ ${brl(i.value).padStart(10)} | ` +
          `${i.paid ? `PAGO ${i.paidDate ?? '?'}` : 'ABERTO'}${i.paidMarkedAt ? ` | marcado ${String(i.paidMarkedAt).slice(0, 10)}` : ''}`,
      );
    }
    const hist = (f.history ?? []).slice(-3);
    if (hist.length) {
      console.log('  últimos registros de histórico:');
      for (const h of hist) console.log(`    ${String(h.date).slice(0, 10)} | ${h.type} | ${String(h.text).slice(0, 150)}`);
    }
  }
}
