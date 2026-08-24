/**
 * Parser Kamino (subset do ImportStudentsModal) para scripts Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const KAMINO_FILL_DOWN_COLUMNS = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'];
const CC_NON_ASSESSOR_KEYWORDS = [
  'gestão de contas', 'gestao de contas', 'antecipação', 'antecipacao',
  'cancelamento', 'negativação', 'negativacao', 'tmf', 'academy',
];

export function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim().replace(/\s/g, '').replace(/R\$/g, '');
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function normalizeDate(value, xlsx) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!xlsx) return null;
    const date = xlsx.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function isRecompraClassificacao(produto) {
  return /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(produto);
}

function analyzeCentroCusto(cc) {
  const lower = cc.toLowerCase();
  const hasAntecipacao = /antecipa[cç][aã]o/.test(lower);
  const hasCancelamento = /cancelamento/.test(lower);
  const hasNegativacao = /negativa[cç][aã]o/.test(lower);
  const hasTmf = /\btmf\b/.test(lower);
  const assessorCandidates = [];
  const seen = new Set();
  for (const raw of cc.match(/\(([^()]+)\)/g) || []) {
    const inner = raw.slice(1, -1).trim();
    const innerLower = inner.toLowerCase();
    if (CC_NON_ASSESSOR_KEYWORDS.some((k) => innerLower.includes(k))) continue;
    const words = inner.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'-]+$/.test(w));
    if (words.length < 2) continue;
    const norm = inner.replace(/\s+/g, ' ').trim();
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    assessorCandidates.push(norm);
  }
  return { hasAntecipacao, hasCancelamento, hasNegativacao, hasTmf, assessorCandidates };
}

function fillDownKaminoRows(rows) {
  const lastSeenValues = {};
  return rows.map((row) => {
    const nextRow = { ...row };
    const allIdentityEmpty = KAMINO_FILL_DOWN_COLUMNS.every((col) => !normalizeString(nextRow[col]));
    if (allIdentityEmpty) return nextRow;
    KAMINO_FILL_DOWN_COLUMNS.forEach((column) => {
      const currentValue = normalizeString(nextRow[column]);
      if (currentValue) {
        lastSeenValues[column] = nextRow[column];
        return;
      }
      if (lastSeenValues[column] != null) nextRow[column] = lastSeenValues[column];
    });
    return nextRow;
  });
}

function calculateAutoStatus(installments) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const paid = installments.filter((i) => i.paid);
  const unpaid = installments.filter((i) => !i.paid);
  if (unpaid.length === 0 && installments.length > 0) return 'Pago';
  const overdue = unpaid.filter((i) => i.dueDate && new Date(i.dueDate + 'T00:00:00') < today);
  if (paid.length === 0 && overdue.length === 0 && installments.length > 1) return 'Aluno Novo';
  if (overdue.length === 0) return 'Em Dia';
  const oldest = overdue.reduce((a, b) => (a.dueDate < b.dueDate ? a : b));
  const diffDays = Math.floor((today - new Date(oldest.dueDate + 'T00:00:00')) / 86400000);
  if (diffDays <= 30) return 'Vencido 1';
  if (diffDays <= 60) return 'Vencido 2';
  return 'À Negativar';
}

export function studentKey(name, product) {
  return `${normalizeString(name).toLowerCase()}||${normalizeString(product).toLowerCase()}`;
}

/** Variantes de nome de AC → nome cadastrado no GC */
const AC_ALIASES = new Map([
  ['luana santos', 'Luana dos Santos'],
]);

function canonicalAcName(name, acNames = []) {
  const trimmed = normalizeString(name);
  if (!trimmed) return '';
  const alias = AC_ALIASES.get(trimmed.toLowerCase());
  if (alias) return alias;
  const exact = acNames.find((a) => a.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  return trimmed;
}

export function parseKaminoFile(filePath, acNames = []) {
  const xlsx = XLSX;
  const abs = path.resolve(filePath);
  const buf = fs.readFileSync(abs);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = fillDownKaminoRows(xlsx.utils.sheet_to_json(sheet, { defval: '' }));

  const acSet = new Set(acNames.map((n) => n.toLowerCase()));
  const groups = new Map();
  const recompraPending = new Map();

  for (const row of json) {
    const nome = normalizeString(row.Pessoa) || 'Sem Nome';
    const produto = normalizeString(row.Classificação) || 'Sem Treinamento';
    if (isRecompraClassificacao(produto)) {
      const k = nome.toLowerCase();
      if (!recompraPending.has(k)) recompraPending.set(k, []);
      recompraPending.get(k).push(row);
      continue;
    }
    const key = studentKey(nome, produto);
    if (!groups.has(key)) groups.set(key, { nome, produto, rows: [], recompraRows: [] });
    groups.get(key).rows.push(row);
  }

  for (const [nameKey, recompraRows] of recompraPending) {
    const sheetCandidates = Array.from(groups.values()).filter((g) => g.nome.toLowerCase() === nameKey);
    for (const row of recompraRows) {
      const produto = normalizeString(row.Classificação) || 'Recompra';
      if (sheetCandidates.length === 1) {
        sheetCandidates[0].recompraRows.push(row);
        continue;
      }
      const key = studentKey(nameKey, produto);
      if (!groups.has(key)) groups.set(key, { nome: normalizeString(row.Pessoa) || nameKey, produto, rows: [], recompraRows: [] });
      groups.get(key).rows.push(row);
    }
  }

  const students = [];

  for (const [key, group] of groups) {
    const rowGroup = [...group.rows, ...group.recompraRows];
    if (rowGroup.length === 0) continue;

    const first = rowGroup[0];
    const whatsapp = normalizeString(first.Telefone);
    const email = normalizeString(first['E-mail']);

    let acName = '';
    const acCandidates = new Map();
    let hasNegativacao = false;
    for (const r of rowGroup) {
      const cc = normalizeString(r['Centro de Custo']);
      if (!cc) continue;
      const a = analyzeCentroCusto(cc);
      if (a.hasNegativacao) hasNegativacao = true;
      for (const cand of a.assessorCandidates) {
        acCandidates.set(cand, (acCandidates.get(cand) ?? 0) + 1);
      }
    }
    for (const cand of acCandidates.keys()) {
      if (acSet.has(cand.toLowerCase())) {
        acName = cand;
        break;
      }
    }
    if (!acName) {
      const top = [...acCandidates.entries()].sort((a, b) => b[1] - a[1])[0];
      acName = top?.[0] ?? '';
    }
    acName = canonicalAcName(acName, acNames);

    const sortedRows = [...rowGroup].sort((a, b) => {
      const va = normalizeDate(a.Vencimento, xlsx) ?? '9999-12-31';
      const vb = normalizeDate(b.Vencimento, xlsx) ?? '9999-12-31';
      return va.localeCompare(vb);
    });

    const installments = [];
    let valorContrato = 0;
    let earliestVencimento = null;
    let earliestCompetencia = null;
    const detalhes = [];

    sortedRows.forEach((r, idx) => {
      const venc = normalizeDate(r.Vencimento, xlsx);
      const recebimento = normalizeDate(r.Recebimento, xlsx);
      const valorReceber = normalizeNumber(r['Valor a Receber (R$)']) ?? 0;
      const valorRecebido = normalizeNumber(r['Valor Recebido (R$)']);
      const det = normalizeString(r.Detalhe);
      const comp = normalizeDate(r.Competência, xlsx);
      if (det && !detalhes.includes(det)) detalhes.push(det);
      if (venc && (!earliestVencimento || venc < earliestVencimento)) earliestVencimento = venc;
      if (comp && (!earliestCompetencia || comp < earliestCompetencia)) earliestCompetencia = comp;
      const paid = !!recebimento || (valorRecebido != null && valorRecebido > 0);
      valorContrato += valorReceber;
      installments.push({
        number: idx + 1,
        dueDate: venc ?? '',
        value: valorReceber,
        paid,
        paidDate: paid ? (recebimento ?? venc ?? undefined) : undefined,
      });
    });

    if (!earliestVencimento) continue;

    const totalInstallments = installments.length;
    const paidCount = installments.filter((i) => i.paid).length;
    const installmentValue = totalInstallments > 0 ? valorContrato / totalInstallments : 0;
    let dueDay = 10;
    if (earliestVencimento) dueDay = Number(earliestVencimento.slice(8, 10));

    const enrollmentDate = earliestCompetencia || earliestVencimento || '';
    const status = hasNegativacao ? 'À Negativar' : calculateAutoStatus(installments);

    students.push({
      key,
      name: group.nome,
      whatsapp,
      email: email || null,
      ac: acName,
      product: group.produto,
      enrollmentDate,
      data_treinamento_origem: enrollmentDate,
      dueDay,
      saleValue: valorContrato,
      downPayment: 0,
      totalInstallments,
      paidInstallments: paidCount,
      installmentValue,
      installments,
      detalhes: detalhes.join(' | '),
      status,
      statusMode: 'Automático',
    });
  }

  return students;
}
