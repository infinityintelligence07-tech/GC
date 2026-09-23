/**
 * Lê PDFs dos contratos IAM na fila e aplica Melhor dia + 1º boleto nas parcelas.
 * Uso: node scripts/gc-iam-aplicar-datas-contrato.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

function readEnv(key) {
  if (process.env[key]) return process.env[key].replaceAll('"', '').replaceAll("'", '');
  const text = fs.readFileSync('.env', 'utf8');
  const m = text.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.replaceAll('"', '').replaceAll("'", '') ?? '';
}

function extractFromText(text) {
  const melhor = text.match(/Melhor\s+dia\s+de\s+vencimento\s*:\s*(\d{1,2})/i);
  const primeiro = text.match(/1[ºo°]?\s*boleto\s+para\s*:\s*(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2,4})/i);
  let primeiroIso = null;
  if (primeiro) {
    let y = primeiro[3];
    if (y.length === 2) y = `20${y}`;
    primeiroIso = `${y}-${primeiro[2].padStart(2, '0')}-${primeiro[1].padStart(2, '0')}`;
  }
  // Pendência às vezes aparece como "Pendência: ... para DD/MM/YYYY" — opcional
  const pend = text.match(/[Pp]end[eê]ncia[^0-9]{0,40}(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2,4})/);
  let pendIso = null;
  if (pend) {
    let y = pend[3];
    if (y.length === 2) y = `20${y}`;
    pendIso = `${y}-${pend[2].padStart(2, '0')}-${pend[1].padStart(2, '0')}`;
  }
  return {
    melhor_dia: melhor ? Number(melhor[1]) : null,
    primeiro_boleto: primeiroIso,
    pendencia_due: pendIso,
  };
}

const url = readEnv('VITE_SUPABASE_URL');
const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || readEnv('VITE_SUPABASE_ANON_KEY');
const dbUrl = readEnv('DATABASE_URL').replace(/[?&]sslmode=[^&]*/g, '');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  SELECT DISTINCT ON (s.id)
    s.id, s.name, s.product, s.iam_control_aluno_id, s.iam_control_contrato_id,
    s.iam_control_contrato_status, s.enrollment_date, s.installments
  FROM conciliacao_items ci
  JOIN students s ON s.id = ci.student_id
  WHERE ci.tipo = 'iam_pendente'
    AND ci.status IN ('pendente', 'aprovado')
    AND s.iam_control_aluno_id IS NOT NULL
    AND jsonb_array_length(coalesce(s.installments, '[]'::jsonb)) > 0
  ORDER BY s.id
`);

console.log('fila com parcelas:', rows.length);

const relatorio = [];

for (const s of rows) {
  const res = await fetch(`${url}/functions/v1/iam-control-contrato`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      iam_control_aluno_id: Number(s.iam_control_aluno_id),
      contrato_id: s.iam_control_contrato_id,
      produto: s.product,
      status_conciliacao: s.iam_control_contrato_status,
    }),
  });
  const j = await res.json();
  if (!j.pdf_base64) {
    relatorio.push({ nome: s.name, ok: false, motivo: j.aviso || j.error || 'sem PDF' });
    console.log('SKIP', s.name, j.aviso || j.error || 'sem PDF');
    continue;
  }

  const parser = new PDFParse({ data: Buffer.from(j.pdf_base64, 'base64') });
  const parsed = await parser.getText();
  const ext = extractFromText(parsed.text || '');
  if (!ext.melhor_dia || !ext.primeiro_boleto) {
    relatorio.push({ nome: s.name, ok: false, motivo: 'não achou campos no PDF', ext, sample: (parsed.text || '').slice(0, 400) });
    console.log('SKIP', s.name, 'campos', ext);
    continue;
  }

  const r = await client.query(
    `SELECT public.iam_aplicar_datas_contrato($1::uuid, $2::date, $3::int, $4::date) AS result`,
    [s.id, ext.primeiro_boleto, ext.melhor_dia, ext.pendencia_due],
  );
  relatorio.push({ nome: s.name, ok: true, ext, result: r.rows[0]?.result });
  console.log('OK', s.name, ext);
}

fs.writeFileSync('scripts/.iam-aplicar-datas-relatorio.json', JSON.stringify(relatorio, null, 2));
console.log('feitos', relatorio.filter((x) => x.ok).length, '/', relatorio.length);
await client.end();
