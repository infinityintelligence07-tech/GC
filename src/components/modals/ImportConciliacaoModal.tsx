// ─── Modal: Importar Planilha de Conferência ─────────────────────────────────
// Lê a planilha modelo (Aluno, VALOR PAGO, Recebimento, Vencimento…) ou export
// legado do Kamino (Pessoa, Valor Recebido…). Para cada linha:
//   1. Procura os contratos pelo nome (Pessoa) — independentemente da aba
//      (Alunos, Cancelamento, Renda Extra).
//   2. Usa o assessor quando informado e só baixa automaticamente quando existe
//      uma única combinação contrato + vencimento + valor compatível.
//      Planilha de conferência: o valor precisa ser EXATAMENTE igual ao da
//      parcela; Kamino legado aceita tolerância de ±15%.
//   3. Marca como paga (paid=true) com paidDate = Recebimento.
// Linhas ambíguas ou sem identificação segura vão para "Erros".

import { useRef, useState } from 'react';
import { X, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, Download, Check, Pencil, XCircle, CalendarClock, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { createConciliacaoImportErrorsBulkDb, updateStudentDb, createConciliacaoItemsBulkDb } from '@/lib/supabaseMutations';
import type { Student, Installment, ConciliacaoImportError, ConciliacaoImportSummary, ConciliacaoImportErrorMotivo } from '@/types';

const MOTIVO_LABEL: Record<ConciliacaoImportErrorMotivo, string> = {
  aluno_nao_encontrado: 'Aluno não encontrado',
  multiplos_alunos: 'Múltiplos alunos com mesmo nome',
  parcela_nao_encontrada: 'Parcela não encontrada (vencimento)',
  valor_diverge: 'Valor diverge do registrado',
  vencimento_diverge: 'Vencimento diverge da parcela',
  parcela_ja_paga: 'Parcela já estava paga',
  sem_pagamento: 'Linha sem pagamento',
};

// ─── Lazy XLSX loader (mesmo CDN do importador de alunos) ────────────────────
interface XLSXModule {
  read: (data: Uint8Array, opts: { type: 'array'; cellDates?: boolean }) => { Sheets: Record<string, any>; SheetNames: string[] };
  utils: {
    json_to_sheet: (data: Record<string, unknown>[], opts?: { header?: string[] }) => any;
    book_new: () => any;
    book_append_sheet: (wb: any, ws: any, name: string) => void;
    sheet_to_json: <T = Record<string, unknown>>(ws: any, opts?: { defval?: string; raw?: boolean }) => T[];
  };
  writeFile: (wb: any, filename: string) => void;
  SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null };
}

const XLSX_CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoadPromise: Promise<XLSXModule> | null = null;
function loadXLSX(): Promise<XLSXModule> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is undefined'));
  const existing = (window as any).XLSX as XLSXModule | undefined;
  if (existing) return Promise.resolve(existing);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise<XLSXModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_CDN_URL;
    script.async = true;
    script.onload = () => {
      const x = (window as any).XLSX as XLSXModule | undefined;
      x ? resolve(x) : reject(new Error('XLSX indefinido'));
    };
    script.onerror = () => { xlsxLoadPromise = null; reject(new Error('Falha ao carregar SheetJS')); };
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

// ─── Normalizadores ──────────────────────────────────────────────────────────
function normalizeDate(value: unknown, xlsx?: XLSXModule): string | null {
  if (value == null || value === '') return null;
  // Date object (SheetJS pode devolver Date quando cellDates=true ou em algumas versões)
  if (value instanceof Date && !isNaN(value.getTime())) {
    // Datas do Excel são calendários sem fuso. Usar componentes locais aqui
    // fazia o navegador em Brasília transformar 25/08 em 24/08.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    if (!xlsx) return null;
    const d = xlsx.SSF.parse_date_code(value);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  if (!str) return null;
  // ISO já formatado (YYYY-MM-DD ou com hora)
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY (com ou sem hora)
  const br = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  // Tenta Date.parse como fallback (ex: "Fri Apr 17 2026 ...")
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim().replace(/\s/g, '').replace(/R\$/g, '');
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normName(s: string): string {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Tolerância para comparar valores (centavos podem variar por arredondamento)
function valuesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

// Tolerância de conciliação Kamino → GC:
// - Se o valor pago for ATÉ 15% MAIOR que o da parcela, considera conciliado
//   (juros embutido na cobrança).
// - Se o valor pago for ATÉ 10% MENOR que o da parcela, considera conciliado
//   (desconto concedido).
// - Fora dessa faixa → não concilia, vira erro para resolver manualmente.
// Tolerância de valor para match automático com a planilha do Kamino.
// Aceita até 15% a menos (desconto) ou 15% a mais (juros/multa). Fora disso
// vira erro de "valor_diverge" com o motivo detalhado da diferença.
const KAMINO_TOLERANCE_DOWN = 0.15;
const KAMINO_TOLERANCE_UP = 0.15;
function valueWithinKaminoTolerance(installmentValue: number, paidValue: number): boolean {
  if (!installmentValue || installmentValue <= 0) return Math.abs(installmentValue - paidValue) < 0.01;
  const diffPct = (paidValue - installmentValue) / installmentValue;
  // diffPct positivo = pagou a mais; negativo = pagou a menos
  return diffPct >= -KAMINO_TOLERANCE_DOWN - 1e-9 && diffPct <= KAMINO_TOLERANCE_UP + 1e-9;
}

// ─── Tipos do parsing ────────────────────────────────────────────────────────
type SheetFormat = 'conferencia' | 'kamino';

interface KaminoPaymentRow {
  rowIndex: number;
  format: SheetFormat;
  pessoa: string;
  assessor?: string;
  vencimento: string | null;
  valorReceber: number | null;
  valorRecebido: number | null;
  recebimento: string | null;     // data do pagamento (paidDate)
  situacao: string;
  raw: Record<string, unknown>;
}

function detectSheetFormat(keys: string[]): SheetFormat {
  const normalized = keys.map((k) => k.replace(/\s+/g, ' ').trim().toLowerCase());
  if (normalized.includes('aluno') && normalized.some((k) => k.includes('valor pago'))) {
    return 'conferencia';
  }
  return 'kamino';
}

function pickField(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(row)) {
      if (k.replace(/\s+/g, ' ').trim().toLowerCase() === target) return v;
    }
  }
  return undefined;
}

function rowsFromSheetJson(
  json: Record<string, unknown>[],
  XLSX: XLSXModule,
  serializeRaw: (r: Record<string, unknown>) => Record<string, unknown>,
): KaminoPaymentRow[] {
  if (json.length === 0) return [];
  const format = detectSheetFormat(Object.keys(json[0] ?? {}));

  if (format === 'conferencia') {
    return json
      .map((r, idx) => {
        const aluno = String(pickField(r, 'Aluno') ?? '').trim();
        const valorPago = normalizeNumber(pickField(r, 'VALOR PAGO'));
        const valorOriginal = normalizeNumber(pickField(r, 'VALOR ORIGINAL'));
        return {
          rowIndex: idx + 2,
          format: 'conferencia' as const,
          pessoa: aluno,
          assessor: String(pickField(r, 'Assessor') ?? '').trim() || undefined,
          vencimento: normalizeDate(pickField(r, 'Vencimento'), XLSX),
          valorReceber: valorOriginal ?? valorPago,
          valorRecebido: valorPago,
          recebimento: normalizeDate(pickField(r, 'Recebimento'), XLSX),
          situacao: valorPago != null && valorPago > 0 ? 'pago' : '',
          raw: serializeRaw(r),
        } satisfies KaminoPaymentRow;
      })
      .filter((r) => r.pessoa);
  }

  const rows: KaminoPaymentRow[] = json.map((r, idx) => ({
    rowIndex: idx + 2,
    format: 'kamino' as const,
    pessoa: String(r['Pessoa'] ?? '').trim(),
    vencimento: normalizeDate(r['Vencimento'], XLSX),
    valorReceber: normalizeNumber(r['Valor a Receber (R$)']),
    valorRecebido: normalizeNumber(r['Valor Recebido (R$)']),
    recebimento: normalizeDate(r['Recebimento'], XLSX),
    situacao: String(r['Situação'] ?? r['Situacao'] ?? '').trim(),
    raw: serializeRaw(r),
  }));

  let lastName = '';
  for (const r of rows) {
    if (r.pessoa) lastName = r.pessoa;
    else r.pessoa = lastName;
  }
  return rows;
}

interface BaixaKaminoEntry {
  studentId: string;
  studentName: string;
  ac?: string;
  installmentNumber: number;
  installmentValue: number;
  paidValue: number;
  dueDate: string;
  paidDate: string;
}

// Linha da planilha que casou com uma parcela JÁ PAGA no GC, mas com valor
// recebido diferente do registrado (juros/desconto). Não é baixa: só é
// mostrada na pré-visualização e aplicada se o usuário marcar.
interface AjusteJaPagaEntry {
  studentId: string;
  studentName: string;
  product?: string;
  ciclo?: string;
  ac?: string;
  installmentNumber: number;
  installmentValue: number;
  dueDate: string;
  paidDate: string;
  currentPaidValue: number;
  newPaidValue: number;
  rowRecebimento: string;
}

interface ProcessResult {
  summary: ConciliacaoImportSummary;
  errors: Omit<ConciliacaoImportError, 'id' | 'createdAt'>[];
  studentUpdates: Map<string, Partial<Student>>; // por studentId
  baixas: BaixaKaminoEntry[];                    // para registrar no histórico
  ajustes: AjusteJaPagaEntry[];                  // parcelas já pagas com valor recebido divergente
}

// Detecta linhas que têm pagamento confirmado
function temPagamento(row: KaminoPaymentRow): boolean {
  if (row.recebimento) return true;
  if ((row.valorRecebido ?? 0) > 0) return true;
  const sit = (row.situacao ?? '').toLowerCase();
  return /recebid|pago|liquidad|baixad/.test(sit);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ImportConciliacaoModal({ isOpen, onClose }: Props) {
  const students = useAppStore((s) => s.students);
  const setImportErrors = useConciliacaoStore((s) => s.setImportErrors);
  const importErrors = useConciliacaoStore((s) => s.importErrors);
  const currentUser = useAppStore((s) => s.currentUser);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ProcessResult | null>(null);
  const [result, setResult] = useState<ConciliacaoImportSummary | null>(null);
  // Edição inline por linha de erro (index da linha em preview.errors)
  const [rowEdits, setRowEdits] = useState<Record<number, { valor: string; dataPagamento: string }>>({});
  // Seleção por linha — quais erros serão conciliados ao clicar em "Confirmar".
  // Linhas resolvíveis começam selecionadas por padrão.
  const [rowSelected, setRowSelected] = useState<Record<number, boolean>>({});
  // Modo de edição ativo por linha (separado de rowEdits, que armazena valores)
  const [rowEditing, setRowEditing] = useState<Record<number, boolean>>({});
  // Parcelas já pagas com valor recebido divergente (index em preview.ajustes).
  // Começam DESMARCADAS: nada é alterado sem o usuário optar.
  const [ajusteSelected, setAjusteSelected] = useState<Record<number, boolean>>({});
  // Modal de vencimento divergente: índice do erro sendo resolvido + data editável
  const [vencModalIdx, setVencModalIdx] = useState<number | null>(null);
  const [vencModalDate, setVencModalDate] = useState<string>('');
  const QUICK_BLOCKED: ConciliacaoImportErrorMotivo[] = [
    'aluno_nao_encontrado',
    'multiplos_alunos',
    'sem_pagamento',
    'parcela_ja_paga',
    'parcela_nao_encontrada',
    'valor_diverge',
    // vencimento_diverge tem fluxo próprio: modal para trocar ou manter a data
    'vencimento_diverge',
  ];

  const isResolvable = (e: { motivo: ConciliacaoImportErrorMotivo; studentId?: string }) =>
    !QUICK_BLOCKED.includes(e.motivo) && !!e.studentId;

  // Aplica conciliação de uma linha de erro sobre um snapshot do preview.
  // Retorna novo preview ou null se falhou.
  function resolveErrorOnPreview(
    p: ProcessResult,
    idx: number,
    overrides?: { valor?: number; dataPagamento?: string },
  ): ProcessResult | null {
    const err = p.errors[idx];
    if (!err) return null;
    if (QUICK_BLOCKED.includes(err.motivo)) return null;
    const studentId = err.studentId;
    if (!studentId) return null;
    const student = students.find((s) => s.id === studentId);
    if (!student) return null;

    const valor = overrides?.valor ?? err.valor ?? 0;
    const paidDate = overrides?.dataPagamento ?? err.dataPagamento ?? new Date().toISOString().split('T')[0];
    const dueDate = err.vencimento;

    const prevPatch = p.studentUpdates.get(studentId);
    const currentInsts = (prevPatch?.installments as Installment[] | undefined) ?? student.installments.map((i) => ({ ...i }));

    let target: Installment | undefined;
    if (dueDate) target = currentInsts.find((i) => !i.paid && i.dueDate === dueDate);
    if (!target) {
      const unpaid = currentInsts.filter((i) => !i.paid);
      if (dueDate && unpaid.length) {
        const ref = new Date(dueDate).getTime();
        target = unpaid.slice().sort((a, b) => Math.abs(new Date(a.dueDate).getTime() - ref) - Math.abs(new Date(b.dueDate).getTime() - ref))[0];
      } else {
        target = unpaid[0];
      }
    }
    if (!target) return null;

    const newInsts = currentInsts.map((i) => i.number === target!.number ? { ...i, paid: true, paidDate, value: valor } : i);
    const totalPagas = newInsts.filter((i) => i.paid).length;
    const restantes = newInsts.length - totalPagas;
    const fmtBRLh = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
    const fmtDateH = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
    const histEntry = {
      date: new Date().toISOString(),
      type: 'Sistema' as const,
      text: `Baixa via Conciliação Kamino (resolução manual no preview) — Parcela ${target.number}: ${fmtBRLh(valor)} pago em ${fmtDateH(paidDate)}. ${totalPagas}/${newInsts.length} pagas (faltam ${restantes}).`,
    };
    const baseHistory = (prevPatch?.history as { date: string; type: 'Sistema'; text: string }[] | undefined) ?? (student.history ?? []);

    const newUpdates = new Map(p.studentUpdates);
    newUpdates.set(studentId, {
      installments: newInsts,
      paidInstallments: totalPagas,
      history: [...baseHistory, histEntry],
    });
    const newBaixas = [...p.baixas, {
      studentId,
      studentName: student.name,
      ac: student.ac,
      installmentNumber: target.number,
      installmentValue: valor,
      dueDate: target.dueDate,
      paidDate,
    }];
    const newErrors = p.errors.filter((_, i) => i !== idx);
    return {
      ...p,
      studentUpdates: newUpdates,
      baixas: newBaixas,
      errors: newErrors,
      summary: { ...p.summary, pagas: p.summary.pagas + 1, erros: p.summary.erros - 1 },
    };
  }

  // Resolve erro de vencimento divergente: baixa a parcela identificada no
  // matching, mantendo o vencimento atual ou trocando pelo da planilha.
  function resolveVencimentoOnPreview(
    p: ProcessResult,
    idx: number,
    keepInstallmentDate: boolean,
    overrideDate?: string,
  ): ProcessResult | null {
    const err = p.errors[idx];
    if (!err || err.motivo !== 'vencimento_diverge' || !err.studentId) return null;
    const student = students.find((s) => s.id === err.studentId);
    if (!student) return null;
    const instNumber = Number((err.raw as Record<string, unknown>)?.__installmentNumber__);
    if (!Number.isFinite(instNumber)) return null;

    const prevPatch = p.studentUpdates.get(student.id);
    const currentInsts = (prevPatch?.installments as Installment[] | undefined) ?? student.installments.map((i) => ({ ...i }));
    const target = currentInsts.find((i) => i.number === instNumber && !i.paid);
    if (!target) return null;

    const paidDate = err.dataPagamento ?? new Date().toISOString().split('T')[0];
    const newDueDate = keepInstallmentDate ? target.dueDate : (overrideDate || err.vencimento || target.dueDate);
    const paidValue = err.valor ?? target.value;

    const newInsts = currentInsts.map((i) => i.number === instNumber
      ? {
          ...i,
          paid: true,
          paidDate,
          dueDate: newDueDate,
          ...(Math.abs(paidValue - i.value) > 0.01 ? { paidValue } : {}),
        }
      : i);
    const totalPagas = newInsts.filter((i) => i.paid).length;
    const restantes = newInsts.length - totalPagas;
    const fmtBRLh = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
    const fmtDateH = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
    const vencNota = keepInstallmentDate
      ? `Vencimento mantido em ${fmtDateH(target.dueDate)}.`
      : `Vencimento alterado de ${fmtDateH(target.dueDate)} para ${fmtDateH(newDueDate)} (planilha).`;
    const histEntry = {
      date: new Date().toISOString(),
      type: 'Sistema' as const,
      text: `Baixa via Planilha de Conferência (vencimento divergente) — Parcela ${target.number}: ${fmtBRLh(paidValue)} pago em ${fmtDateH(paidDate)}. ${vencNota} ${totalPagas}/${newInsts.length} pagas (faltam ${restantes}).`,
    };
    const baseHistory = (prevPatch?.history as { date: string; type: 'Sistema'; text: string }[] | undefined) ?? (student.history ?? []);

    const newUpdates = new Map(p.studentUpdates);
    newUpdates.set(student.id, {
      installments: newInsts,
      paidInstallments: totalPagas,
      history: [...baseHistory, histEntry],
    });
    const newBaixas = [...p.baixas, {
      studentId: student.id,
      studentName: student.name,
      ac: student.ac,
      installmentNumber: target.number,
      installmentValue: Number(target.value) || 0,
      paidValue,
      dueDate: newDueDate,
      paidDate,
    }];
    return {
      ...p,
      studentUpdates: newUpdates,
      baixas: newBaixas,
      errors: p.errors.filter((_, i) => i !== idx),
      summary: { ...p.summary, pagas: p.summary.pagas + 1, erros: p.summary.erros - 1 },
    };
  }

  const applyVencimentoResolve = (idx: number, keepInstallmentDate: boolean, overrideDate?: string) => {
    setPreview((p) => {
      if (!p) return p;
      const next = resolveVencimentoOnPreview(p, idx, keepInstallmentDate, overrideDate);
      if (!next) {
        alert('Não foi possível aplicar a baixa: parcela em aberto não encontrada.');
        return p;
      }
      return next;
    });
    setVencModalIdx(null);
    setRowSelected((r) => { const c = { ...r }; delete c[idx]; return c; });
    setRowEdits((r) => { const c = { ...r }; delete c[idx]; return c; });
    setRowEditing((r) => { const c = { ...r }; delete c[idx]; return c; });
  };

  const applyRowConciliar = (idx: number, overrides?: { valor?: number; dataPagamento?: string }) => {
    setPreview((p) => {
      if (!p) return p;
      const next = resolveErrorOnPreview(p, idx, overrides);
      if (!next) {
        const err = p.errors[idx];
        if (err && QUICK_BLOCKED.includes(err.motivo)) {
          alert('Este erro precisa ser resolvido manualmente após confirmar a importação (sub-aba Erros da Conciliação).');
        } else {
          alert('Não foi possível aplicar a baixa: aluno ou parcela em aberto não encontrados.');
        }
        return p;
      }
      return next;
    });
    setRowEdits((r) => { const c = { ...r }; delete c[idx]; return c; });
  };

  const applyRowIgnorar = (idx: number) => {
    setPreview((p) => {
      if (!p) return p;
      return {
        ...p,
        errors: p.errors.filter((_, i) => i !== idx),
        summary: { ...p.summary, erros: p.summary.erros - 1 },
      };
    });
    setRowEdits((r) => { const c = { ...r }; delete c[idx]; return c; });
    setRowSelected((r) => { const c = { ...r }; delete c[idx]; return c; });
    setRowEditing((r) => { const c = { ...r }; delete c[idx]; return c; });
  };

  const selectAll = () => {
    if (!preview) return;
    const next: Record<number, boolean> = {};
    preview.errors.forEach((e, i) => { if (isResolvable(e)) next[i] = true; });
    setRowSelected(next);
  };

  const deselectAll = () => setRowSelected({});

  // Conta quantos erros serão conciliados ao clicar em "Confirmar"
  const selectedCount = preview
    ? preview.errors.filter((e, i) => rowSelected[i] && isResolvable(e)).length
    : 0;
  const ajustesSelectedCount = preview
    ? preview.ajustes.filter((_, i) => ajusteSelected[i]).length
    : 0;

  if (!isOpen) return null;

  const reset = () => {
    setFileName('');
    setPreview(null);
    setResult(null);
    setRowEdits({});
    setRowSelected({});
    setRowEditing({});
    setAjusteSelected({});
    setVencModalIdx(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };


  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDownloadTemplate = () => {
    const link = document.createElement('a');
    link.href = '/templates/planilha-conferencia-modelo.xlsx';
    link.download = 'planilha-conferencia-modelo.xlsx';
    link.click();
  };

  // ─── Parsing + matching (preview) ─────────────────────────────────────────
  const handleFile = async (file: File) => {
    setParsing(true);
    setPreview(null);
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: true });

      // Normaliza chaves do header: trim + colapsa espaços (Kamino exporta " Valor Recebido (R$) " com espaços)
      const normalizeKey = (k: string) => k.replace(/\s+/g, ' ').trim();
      const json = jsonRaw.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) out[normalizeKey(k)] = v;
        return out;
      });

      // raw serializável: Date → ISO string (Postgres jsonb não aceita Date)
      const serializeRaw = (r: Record<string, unknown>): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          out[k] = v instanceof Date ? v.toISOString() : v;
        }
        return out;
      };

      const rows = rowsFromSheetJson(json, XLSX, serializeRaw);

      const result = processRows(rows, students, file.name);
      setPreview(result);
      // Pré-seleciona todas as linhas resolvíveis
      const initSel: Record<number, boolean> = {};
      result.errors.forEach((e, i) => {
        if (!QUICK_BLOCKED.includes(e.motivo) && !!e.studentId) initSel[i] = true;
      });
      setRowSelected(initSel);
      setRowEdits({});
      setRowEditing({});
      setAjusteSelected({});
    } catch (err) {
      alert(`Erro ao ler planilha: ${(err as Error).message}`);
      reset();
    } finally {
      setParsing(false);
    }
  };

  // ─── Confirmação: aplica updates + grava erros ────────────────────────────
  const handleConfirm = async () => {
    if (!preview) return;
    setImporting(true);
    try {
      // 0. Aplicar conciliações selecionadas dos erros (com edições inline, se houver)
      let working = preview;
      // de trás pra frente para manter índices estáveis enquanto removemos
      const selectedIdxs = working.errors
        .map((e, i) => ({ e, i }))
        .filter(({ e, i }) => rowSelected[i] && isResolvable(e))
        .map(({ i }) => i)
        .reverse();
      for (const idx of selectedIdxs) {
        const edit = rowEdits[idx];
        const overrides = edit ? {
          valor: edit.valor ? Number(edit.valor.replace(',', '.')) : undefined,
          dataPagamento: edit.dataPagamento || undefined,
        } : undefined;
        const next = resolveErrorOnPreview(working, idx, overrides);
        if (next) working = next;
      }

      // 0b. Parcelas já pagas com valor recebido divergente: só as marcadas.
      // Atualiza apenas paidValue + histórico — não é baixa, não gera item
      // de conciliação (senão entraria de novo como "entrada" no extrato).
      const ajustesMarcados = working.ajustes.filter((_, i) => ajusteSelected[i]);
      if (ajustesMarcados.length > 0) {
        const fmtBRLa = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
        const fmtDateA = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
        const newUpdates = new Map(working.studentUpdates);
        for (const aj of ajustesMarcados) {
          const original = students.find((s) => s.id === aj.studentId);
          if (!original) continue;
          const patch = newUpdates.get(aj.studentId) ?? {};
          const baseInsts = patch.installments ?? original.installments;
          const insts = baseInsts.map((i) =>
            i.number === aj.installmentNumber && i.paid ? { ...i, paidValue: aj.newPaidValue } : i,
          );
          const entry = {
            date: new Date().toISOString(),
            type: 'Sistema' as const,
            text: `Valor recebido atualizado via Conciliação Kamino — Parcela ${aj.installmentNumber} (já paga em ${fmtDateA(aj.paidDate)}): ${fmtBRLa(aj.currentPaidValue)} → ${fmtBRLa(aj.newPaidValue)}. Saldo não alterado.`,
          };
          newUpdates.set(aj.studentId, {
            ...patch,
            installments: insts,
            history: [...(patch.history ?? original.history ?? []), entry],
          });
        }
        working = { ...working, studentUpdates: newUpdates };
      }

      // 1. Aplicar updates de parcelas pagas em paralelo
      const updates = Array.from(working.studentUpdates.entries());
      const updateResults = await Promise.allSettled(
        updates.map(([id, patch]) => updateStudentDb(id, patch))
      );
      const failed = updateResults.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.error(`${failed} alunos falharam ao atualizar`);
      }

      // Atualiza store local imediatamente (sem esperar realtime)
      const updatesById = new Map(updates);
      useAppStore.setState((s) => ({
        students: s.students.map((st) => {
          const patch = updatesById.get(st.id);
          return patch ? { ...st, ...patch } : st;
        }),
      }));

      // Auto-finalização de cancelamentos: se algum aluno em
      // 'pagamento_multa_pendente' acabou de ter sua parcela de multa
      // marcada como paga, dispara concluirConciliacaoCancelamento para
      // mover o caso para Finalizado e o aluno para status "Cancelado".
      try {
        const finalizeCb = useAppStore.getState().concluirConciliacaoCancelamento;
        const studentsAfter = useAppStore.getState().students;
        for (const [studentId] of updates) {
          const st = studentsAfter.find((s) => s.id === studentId);
          if (!st) continue;
          if (st.statusCancelamento !== 'pagamento_multa_pendente') continue;
          const finePending = (st.installments ?? []).some(
            (i) => !i.paid && (i.tags ?? []).includes('multa-cancelamento'),
          );
          if (!finePending && st.cancellationCaseId) {
            finalizeCb(st.cancellationCaseId);
          }
        }
      } catch (e) {
        console.error('Falha ao auto-finalizar cancelamento pós-Kamino:', e);
      }

      // 2. Salvar erros (se houver) — apenas os que não foram conciliados/ignorados
      if (working.errors.length > 0) {
        try {
          const created = await createConciliacaoImportErrorsBulkDb(working.errors);
          setImportErrors([...created, ...importErrors]);
        } catch (e) {
          console.error('Falha ao salvar erros de importação:', e);
        }
      }

      // 3. Registrar histórico de baixas (uma entrada por parcela baixada).
      // Já entram como 'conciliado' — a importação Kamino É a conciliação.
      if (working.baixas.length > 0) {
        try {
          const fmtBRL = (n: number) =>
            new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
          const fmtDate = (s: string) => {
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
          };
          const nowIso = new Date().toISOString();
          const items = working.baixas.map((b) => ({
            tipo: 'baixa_kamino' as const,
            studentId: b.studentId,
            studentName: b.studentName,
            ac: b.ac,
            resumo: `Parcela ${b.installmentNumber} (venc. ${fmtDate(b.dueDate)} • ${fmtBRL(b.installmentValue)}) baixada via Kamino em ${fmtDate(b.paidDate)}.`,
            antes: { paid: false, paidDate: null, numero: b.installmentNumber, valor: b.installmentValue, vencimento: b.dueDate },
            depois: {
              paid: true,
              paidDate: b.paidDate,
              numero: b.installmentNumber,
              valor: b.installmentValue,
              paidValue: b.paidValue,
              vencimento: b.dueDate,
            },
            autorId: currentUser?.id,
            autorNome: currentUser?.name,
            status: 'conciliado' as const,
            conciliadoAt: nowIso,
            conciliadoPorId: currentUser?.id,
            conciliadoPorNome: currentUser?.name,
            conciliadoNota: `Importação Kamino${working.summary.fileName ? ` (${working.summary.fileName})` : ''}`,
          }));
          const created = await createConciliacaoItemsBulkDb(items);
          useConciliacaoStore.setState((s) => ({ items: [...created, ...s.items] }));
        } catch (e) {
          console.error('Falha ao registrar histórico de baixas Kamino:', e);
        }
      }

      setResult(working.summary);
      setPreview(null);
    } catch (err) {
      alert(`Erro ao importar: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="text-primary" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Importar Planilha Conferência</h2>
              <p className="text-xs text-muted-foreground">Cruza pagamentos da planilha com uma única parcela do contrato (nome + assessor + vencimento + valor).</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-muted">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Result final */}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="text-emerald-600" size={18} />
                <h3 className="font-semibold text-emerald-900">Importação concluída</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Parcelas baixadas" value={result.pagas} color="emerald" />
                <Stat label="Já pagas" value={result.jaPagas} color="slate" />
                {(result.ajustesValor ?? 0) > 0 && (
                  <Stat label="Já pagas c/ valor diferente" value={result.ajustesValor ?? 0} color="amber" />
                )}
                <Stat label="Sem pagamento" value={result.semPagamento} color="slate" />
                <Stat label="Erros" value={result.erros} color={result.erros > 0 ? 'rose' : 'slate'} />
              </div>
              {result.erros > 0 && (
                <p className="text-xs text-emerald-900/80 mt-3">
                  Veja a sub-aba <strong>Erros</strong> da Conciliação para resolver as divergências.
                </p>
              )}
              <div className="flex justify-end mt-4">
                <button onClick={handleClose} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
                  Fechar
                </button>
              </div>
            </div>
          )}

          {/* Upload area */}
          {!result && !preview && (
            <div className="space-y-3">
              <button
                onClick={handleDownloadTemplate}
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Download size={12} /> Baixar planilha modelo
              </button>
              <label
                className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
                  parsing ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                  disabled={parsing}
                />
                {parsing ? (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <Loader2 className="animate-spin" size={28} />
                    <p className="text-sm font-medium">Lendo planilha...</p>
                  </div>
                ) : (
                  <>
                    <Upload className="mx-auto text-muted-foreground mb-2" size={28} />
                    <p className="text-sm font-medium text-foreground">Clique ou arraste a planilha de conferência</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls ou .csv</p>
                  </>
                )}
              </label>

              <div className="text-xs text-muted-foreground bg-muted/30 rounded-xl p-3 space-y-1">
                <p><strong>Como funciona:</strong></p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li>Use a <strong>planilha modelo</strong> (Aluno, VALOR PAGO, Recebimento, Vencimento).</li>
                  <li>O sistema localiza o contrato pelo nome e assessor, e baixa <strong>somente a parcela com vencimento e valor exatamente iguais</strong> aos da planilha.</li>
                  <li>Divergências ficam na sub-aba <strong>Erros de Importação</strong> para revisão.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Preview */}
          {preview && !result && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Arquivo: <strong className="text-foreground">{fileName}</strong></p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Total de linhas" value={preview.summary.totalRows} color="slate" />
                <Stat label="Serão baixadas" value={preview.summary.pagas} color="emerald" />
                <Stat label="Já pagas" value={preview.summary.jaPagas} color="slate" />
                <Stat label="Erros" value={preview.summary.erros} color={preview.summary.erros > 0 ? 'rose' : 'slate'} />
              </div>

              {preview.ajustes.length > 0 && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="text-sky-600 shrink-0 mt-0.5" size={16} />
                    <div className="text-xs text-sky-900 flex-1">
                      <p className="font-semibold mb-1">
                        {preview.ajustes.length} linha(s) da planilha correspondem a parcelas que JÁ ESTÃO PAGAS no GC, mas com valor recebido diferente.
                      </p>
                      <p>
                        Elas <strong>não serão baixadas</strong> e não alteram o saldo. Marque apenas as que você quer que
                        tenham o <strong>valor recebido</strong> atualizado (juros/desconto). Desmarcadas, nada é feito.
                      </p>
                    </div>
                  </div>
                  <div className="divide-y divide-sky-200/70 rounded-lg border border-sky-200 bg-white">
                    {preview.ajustes.map((aj, i) => {
                      const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
                      const fmtDate = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s || '—'; };
                      const contrato = `${aj.product || 'Treinamento não informado'}${aj.ciclo ? ` (${aj.ciclo})` : ''}`;
                      return (
                        <label key={`${aj.studentId}-${aj.installmentNumber}`} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-sky-50/60">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-sky-600"
                            checked={!!ajusteSelected[i]}
                            onChange={(e) => setAjusteSelected((prev) => ({ ...prev, [i]: e.target.checked }))}
                          />
                          <div className="flex-1 min-w-0 text-xs">
                            <p className="font-semibold text-foreground truncate">
                              {aj.studentName}
                              <span className="font-normal text-muted-foreground"> · {contrato}{aj.ac ? ` · ${aj.ac}` : ''}</span>
                            </p>
                            <p className="text-muted-foreground">
                              Parcela {aj.installmentNumber} (venc. {fmtDate(aj.dueDate)} · {fmtBRL(aj.installmentValue)}) — já paga em {fmtDate(aj.paidDate)}
                              {aj.rowRecebimento ? ` · planilha: recebido em ${fmtDate(aj.rowRecebimento)}` : ''}
                            </p>
                            <p className="text-sky-900">
                              Valor recebido registrado <strong>{fmtBRL(aj.currentPaidValue)}</strong> → planilha <strong>{fmtBRL(aj.newPaidValue)}</strong>
                              {' '}({aj.newPaidValue > aj.currentPaidValue ? '+' : '−'}{fmtBRL(Math.abs(aj.newPaidValue - aj.currentPaidValue))})
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {preview.summary.erros > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
                    <div className="text-xs text-amber-900 flex-1">
                      <p className="font-semibold mb-1">{preview.summary.erros} linha(s) não puderam ser baixadas automaticamente.</p>
                      <p>Linhas ambíguas, sem parcela identificada ou com divergência ficam protegidas e devem ser resolvidas manualmente na sub-aba <strong>Erros</strong>, onde o contrato e a parcela podem ser escolhidos.</p>
                    </div>
                    {preview.errors.some((e) => isResolvable(e)) && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={selectAll}
                          className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 inline-flex items-center gap-1"
                          title="Selecionar todas as linhas resolvíveis"
                        >
                          <Check size={12} /> Selecionar todos
                        </button>
                        <button
                          onClick={deselectAll}
                          className="px-2 py-1 rounded-md bg-white border border-amber-300 text-amber-900 text-[11px] font-semibold hover:bg-amber-100 inline-flex items-center gap-1"
                        >
                          <XCircle size={12} /> Desmarcar todos
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-amber-200 bg-white">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100/60 text-amber-900 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-semibold w-8"></th>
                          <th className="text-left px-2 py-1.5 font-semibold">Linha</th>
                          <th className="text-left px-2 py-1.5 font-semibold">Aluno</th>
                          <th className="text-left px-2 py-1.5 font-semibold">Vencimento</th>
                          <th className="text-right px-2 py-1.5 font-semibold">Valor</th>
                          <th className="text-left px-2 py-1.5 font-semibold">Motivo</th>
                          <th className="text-right px-2 py-1.5 font-semibold">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((e, i) => {
                          const blocked = QUICK_BLOCKED.includes(e.motivo) || !e.studentId;
                          const edit = rowEdits[i];
                          const editing = !!rowEditing[i];
                          const checked = !!rowSelected[i];
                          return (
                            <tr key={i} className={`border-t border-amber-100 align-middle ${checked ? '' : 'opacity-60'}`}>
                              <td className="px-2 py-1.5">
                                <button
                                  type="button"
                                  disabled={blocked}
                                  onClick={() => setRowSelected((r) => ({ ...r, [i]: !r[i] }))}
                                  className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors ${
                                    checked
                                      ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                                      : 'bg-white border-border hover:bg-muted'
                                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                                  title={blocked ? 'Resolva manualmente após confirmar' : (checked ? 'Desmarcar (não conciliar)' : 'Marcar para conciliar')}
                                  aria-label="Selecionar para conciliar"
                                >
                                  {checked && <Check size={14} />}
                                </button>
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">{e.rowIndex}</td>
                              <td className="px-2 py-1.5 font-medium text-foreground">{e.studentName}</td>
                              <td className="px-2 py-1.5">
                                {editing ? (
                                  <input
                                    type="date"
                                    value={edit?.dataPagamento ?? ''}
                                    onChange={(ev) => setRowEdits((r) => ({ ...r, [i]: { valor: r[i]?.valor ?? '', dataPagamento: ev.target.value } }))}
                                    className="border border-border rounded px-1 py-0.5 text-xs w-[110px]"
                                  />
                                ) : (
                                  (edit?.dataPagamento || e.vencimento) ? (edit?.dataPagamento || e.vencimento)!.split('-').reverse().join('/') : '—'
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {editing ? (
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={edit?.valor ?? ''}
                                    onChange={(ev) => setRowEdits((r) => ({ ...r, [i]: { valor: ev.target.value, dataPagamento: r[i]?.dataPagamento ?? '' } }))}
                                    className="border border-border rounded px-1 py-0.5 text-xs w-[90px] text-right"
                                    placeholder="0,00"
                                  />
                                ) : (
                                  (() => {
                                    const v = edit?.valor ? Number(edit.valor.replace(',', '.')) : (e.valor ?? null);
                                    return v != null && Number.isFinite(v)
                                      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
                                      : '—';
                                  })()
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-semibold">
                                  {MOTIVO_LABEL[e.motivo] ?? e.motivo}
                                </span>
                                {typeof (e.raw as Record<string, unknown>)?.__detail__ === 'string' && (
                                  <p className="mt-1 text-[10px] text-amber-800 leading-tight">
                                    {String((e.raw as Record<string, unknown>).__detail__)}
                                  </p>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center justify-end gap-1">
                                  {editing ? (
                                    <button
                                      onClick={() => {
                                        // Fecha edição. Os valores já foram salvos ao digitar.
                                        setRowEditing((r) => { const c = { ...r }; delete c[i]; return c; });
                                        if (!blocked) setRowSelected((r) => ({ ...r, [i]: true }));
                                      }}
                                      className="p-1 rounded border border-border hover:bg-muted"
                                      title="Fechar edição"
                                    >
                                      <X size={12} />
                                    </button>
                                  ) : (
                                    <>
                                      {e.motivo === 'vencimento_diverge' && Number.isFinite(Number((e.raw as Record<string, unknown>)?.__installmentNumber__)) && (
                                        <button
                                          onClick={() => { setVencModalIdx(i); setVencModalDate(e.vencimento ?? ''); }}
                                          className="p-1 rounded border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                                          title="Resolver vencimento: trocar a data ou manter a atual"
                                        >
                                          <CalendarClock size={12} />
                                        </button>
                                      )}
                                      <button
                                        disabled={blocked}
                                        onClick={() => {
                                          setRowEdits((r) => ({
                                            ...r,
                                            [i]: {
                                              valor: r[i]?.valor ?? (e.valor != null ? String(e.valor).replace('.', ',') : ''),
                                              dataPagamento: r[i]?.dataPagamento ?? (e.dataPagamento ?? e.vencimento ?? ''),
                                            },
                                          }));
                                          setRowEditing((r) => ({ ...r, [i]: true }));
                                        }}
                                        className="p-1 rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                                        title={blocked ? 'Resolva manualmente após confirmar' : 'Editar valor/data antes de conciliar'}
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        onClick={() => applyRowIgnorar(i)}
                                        className="p-1 rounded border border-border hover:bg-muted text-rose-700"
                                        title="Remover esta linha (não vai para Erros)"
                                      >
                                        <XCircle size={12} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}


              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button onClick={reset} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted">
                  Cancelar
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={importing || (preview.summary.pagas === 0 && selectedCount === 0 && ajustesSelectedCount === 0 && preview.summary.erros === 0)}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {importing ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                  {(() => {
                    const total = preview.summary.pagas + selectedCount;
                    const ajustesTxt = ajustesSelectedCount > 0 ? ` + ${ajustesSelectedCount} ajuste${ajustesSelectedCount !== 1 ? 's' : ''} de valor` : '';
                    return importing ? 'Importando...' : `Confirmar (${total} baixa${total !== 1 ? 's' : ''}${ajustesTxt})`;
                  })()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal: vencimento divergente — trocar a data da parcela ou manter */}
      {vencModalIdx != null && preview?.errors[vencModalIdx]?.motivo === 'vencimento_diverge' && (() => {
        const err = preview.errors[vencModalIdx];
        const raw = err.raw as Record<string, unknown>;
        const instNumber = Number(raw?.__installmentNumber__);
        const instDue = String(raw?.__installmentDueDate__ ?? '');
        const fmtD = (s?: string | null) => { if (!s) return '—'; const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
        const fmtV = (n?: number | null) => n != null ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n) : '—';
        const idx = vencModalIdx;
        return (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <CalendarClock className="text-sky-600" size={18} />
                  <h3 className="font-semibold text-foreground">Vencimento divergente</h3>
                </div>
                <button onClick={() => setVencModalIdx(null)} className="p-1.5 rounded-lg hover:bg-muted">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3 text-sm">
                <p>
                  <strong>{err.studentName}</strong> — parcela {instNumber} de {fmtV(err.valor)}. O valor bate, mas o vencimento é diferente do informado na planilha.
                </p>
                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1 text-xs">
                  <p>Vencimento da parcela: <strong>{fmtD(instDue)}</strong></p>
                  <p>Vencimento na planilha: <strong>{fmtD(err.vencimento)}</strong></p>
                </div>
                <p className="text-xs text-muted-foreground">
                  A parcela será baixada como paga{err.dataPagamento ? ` em ${fmtD(err.dataPagamento)}` : ''}. Escolha o vencimento que deve ficar registrado:
                </p>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">Novo vencimento (editável)</label>
                  <input
                    type="date"
                    value={vencModalDate}
                    onChange={(ev) => setVencModalDate(ev.target.value)}
                    className="border border-border rounded-lg px-2 py-1.5 text-sm w-full"
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 px-5 pb-5">
                <button
                  onClick={() => applyVencimentoResolve(idx, false, vencModalDate || undefined)}
                  disabled={!vencModalDate}
                  className="flex-1 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
                >
                  Trocar para {fmtD(vencModalDate || err.vencimento)}
                </button>
                <button
                  onClick={() => applyVencimentoResolve(idx, true)}
                  className="flex-1 px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
                >
                  Manter {fmtD(instDue)}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: 'emerald' | 'rose' | 'slate' | 'amber' }) {
  const map = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    rose: 'bg-rose-50 border-rose-200 text-rose-900',
    slate: 'bg-muted/50 border-border text-foreground',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[color]}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70 font-semibold">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ─── Lógica pura de matching ────────────────────────────────────────────────
function processRows(rows: KaminoPaymentRow[], students: Student[], fileName: string): ProcessResult {
  const batchId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `batch_${Date.now()}`;

  // Index alunos por nome normalizado (suporta múltiplos com mesmo nome)
  const byName = new Map<string, Student[]>();
  for (const s of students) {
    const k = normName(s.name);
    const arr = byName.get(k) ?? [];
    arr.push(s);
    byName.set(k, arr);
  }

  // Trabalhar sobre cópias de installments por studentId (acumula múltiplas baixas)
  const draft = new Map<string, Installment[]>();
  const getDraft = (s: Student): Installment[] => {
    const cur = draft.get(s.id);
    if (cur) return cur;
    const copy = s.installments.map((i) => ({ ...i }));
    draft.set(s.id, copy);
    return copy;
  };

  const errors: Omit<ConciliacaoImportError, 'id' | 'createdAt'>[] = [];
  const baixas: BaixaKaminoEntry[] = [];
  const ajustes: AjusteJaPagaEntry[] = [];
  let pagas = 0, jaPagas = 0, semPagamento = 0;

  const pushError = (
    row: KaminoPaymentRow,
    motivo: ConciliacaoImportErrorMotivo,
    studentId?: string,
    detail?: string,
    extras?: Record<string, unknown>,
  ) => {
    const rawWithDetail = detail || extras
      ? { ...row.raw, ...(extras ?? {}), ...(detail ? { __detail__: detail } : {}) }
      : row.raw;
    errors.push({
      batchId,
      fileName,
      rowIndex: row.rowIndex,
      studentName: row.pessoa || '(sem nome)',
      studentId,
      vencimento: row.vencimento ?? undefined,
      // Sempre prioriza o "Valor Recebido (R$)" da planilha — é o valor que efetivamente
      // entrou e que o operador precisa ver no modal "Resolver" como "Valor pago (planilha)".
      valor:
        (row.valorRecebido != null && row.valorRecebido > 0)
          ? row.valorRecebido
          : (row.valorReceber ?? undefined),
      dataPagamento: row.recebimento ?? undefined,
      motivo,
      raw: rawWithDetail,
      status: 'pendente',
    });
  };

  for (const row of rows) {
    if (!row.pessoa) continue; // linha vazia

    if (!temPagamento(row)) {
      semPagamento++;
      continue;
    }

    const matchesRaw = byName.get(normName(row.pessoa)) ?? [];
    if (matchesRaw.length === 0) {
      pushError(row, 'aluno_nao_encontrado');
      continue;
    }
    // O assessor pode desambiguar contratos quando a planilha possui essa coluna.
    // Se o nome do assessor não encontrar correspondência, não escolhemos um
    // contrato por heurística: a linha fica para resolução manual.
    const assessorName = normName(row.assessor ?? '').replace(/\s+-\s+assessor(?:\s+\d+)?$/, '');
    const assessorMatches = row.assessor
      ? matchesRaw.filter((s) => {
          const studentAc = normName(s.ac);
          return studentAc === assessorName || normName(row.assessor ?? '').startsWith(`${studentAc} - assessor`);
        })
      : matchesRaw;
    if (row.assessor && assessorMatches.length === 0 && matchesRaw.length > 1) {
      pushError(row, 'multiplos_alunos', undefined, `A planilha informa o assessor "${row.assessor}", mas há ${matchesRaw.length} contratos com este nome. Selecione o contrato correto manualmente.`);
      continue;
    }
    const matchesStudents = (assessorMatches.length > 0 ? assessorMatches : matchesRaw).slice().sort((a, b) => {
      const aHasOpen = row.vencimento ? getDraft(a).some((i) => i.dueDate === row.vencimento && !i.paid) : false;
      const bHasOpen = row.vencimento ? getDraft(b).some((i) => i.dueDate === row.vencimento && !i.paid) : false;
      if (aHasOpen !== bHasOpen) return aHasOpen ? -1 : 1;
      const aHasVenc = row.vencimento ? getDraft(a).some((i) => i.dueDate === row.vencimento) : false;
      const bHasVenc = row.vencimento ? getDraft(b).some((i) => i.dueDate === row.vencimento) : false;
      if (aHasVenc !== bHasVenc) return aHasVenc ? -1 : 1;
      if (!!a.isRendaExtra !== !!b.isRendaExtra) return a.isRendaExtra ? 1 : -1;
      const ai = a.installments?.length ?? 0;
      const bi = b.installments?.length ?? 0;
      if (ai !== bi) return bi - ai;
      return (b.saleValue ?? 0) - (a.saleValue ?? 0);
    });

    // Valor que deve casar: prefere "Valor Recebido"; cai pra "Valor a Receber"
    const valorPago = row.valorRecebido && row.valorRecebido > 0 ? row.valorRecebido : row.valorReceber;
    if (valorPago == null || row.vencimento == null) {
      pushError(row, 'parcela_nao_encontrada', matchesStudents[0]?.id);
      continue;
    }

    // Tenta achar parcela em algum dos alunos com aquele nome.
    // Match exigido: dueDate === row.vencimento && value === valorPago && !paid.
    // Planilha de conferência: o valor precisa ser EXATAMENTE igual ao da
    // parcela (só baixa a parcela idêntica à linha da planilha). Kamino
    // legado mantém a tolerância de ±15% (juros/desconto embutidos).
    const installmentValueMatches = (installmentValue: number): boolean => {
      if (row.format === 'conferencia') {
        if (row.valorRecebido != null && valuesMatch(installmentValue, row.valorRecebido)) return true;
        if (row.valorReceber != null && valuesMatch(installmentValue, row.valorReceber)) return true;
        return false;
      }
      return valueWithinKaminoTolerance(installmentValue, valorPago);
    };
    const exactMatches: Array<{ student: Student; installment: Installment }> = [];
    const paidMatches: Array<{ student: Student; installment: Installment }> = [];
    // Aluno + valor da parcela onde o vencimento bateu mas o valor está fora
    // da tolerância. Guardamos o id para vincular o erro ao cadastro CERTO.
    const divergeMatches: Array<{ student: Student; installment: Installment }> = [];

    for (const s of matchesStudents) {
      const insts = getDraft(s);
      // 1. Vencimento bate + valor compatível (exato na conferência) e não paga
      const exato = insts.find((i) => i.dueDate === row.vencimento && installmentValueMatches(i.value) && !i.paid);
      if (exato) {
        exactMatches.push({ student: s, installment: exato });
        continue;
      }
      // 2. Vencimento + valor compatível (já paga) → flag
      const jaPaga = insts.find((i) => i.dueDate === row.vencimento && installmentValueMatches(i.value) && i.paid);
      if (jaPaga) paidMatches.push({ student: s, installment: jaPaga });
      // 3. Vencimento bate mas valor fora da tolerância → flag (apenas sinaliza)
      const venc = insts.find((i) => i.dueDate === row.vencimento && !i.paid);
      if (venc) divergeMatches.push({ student: s, installment: venc });
    }

    if (exactMatches.length > 1) {
      const contratos = exactMatches
        .map(({ student, installment }) => `${student.product || 'Treinamento não informado'}${student.ciclo ? ` (${student.ciclo})` : ''} — parcela ${installment.number}`)
        .join('; ');
      pushError(row, 'multiplos_alunos', undefined, `Há mais de um contrato com vencimento e valor compatíveis: ${contratos}. Selecione o contrato correto manualmente.`);
      continue;
    }

    if (exactMatches.length === 1) {
      const { student: studentMatched, installment: target } = exactMatches[0];
      const insts = getDraft(studentMatched);
      const paidValue = Number(valorPago) || Number(target.value) || 0;
      target.paid = true;
      target.paidDate = row.recebimento ?? new Date().toISOString().split('T')[0];
      if (Math.abs(paidValue - target.value) > 0.01) {
        target.paidValue = paidValue;
      }
      baixas.push({
        studentId: studentMatched.id,
        studentName: studentMatched.name,
        ac: studentMatched.ac,
        installmentNumber: target.number,
        installmentValue: Number(target.value) || 0,
        paidValue,
        dueDate: target.dueDate,
        paidDate: target.paidDate,
      });
      pagas++;
      continue;
    }

    if (paidMatches.length > 1) {
      pushError(row, 'multiplos_alunos', undefined, 'A mesma parcela já está paga em mais de um contrato com este nome. Selecione o contrato correto manualmente.');
      continue;
    }
    if (paidMatches.length === 1) {
      const { student: paidStudent, installment: paidInstallment } = paidMatches[0];
      const paidValue = Number(valorPago) || Number(paidInstallment.value) || 0;
      const currentPaidValue = Number(paidInstallment.paidValue) || Number(paidInstallment.value) || 0;
      // Parcela já paga no GC: nunca vira baixa nem mexe no saldo. Se a
      // planilha trouxer um valor recebido diferente (juros/desconto), a
      // linha é apresentada na pré-visualização e só é aplicada se o usuário
      // marcar explicitamente.
      jaPagas++;
      if (Math.abs(currentPaidValue - paidValue) > 0.01) {
        ajustes.push({
          studentId: paidStudent.id,
          studentName: paidStudent.name,
          product: paidStudent.product,
          ciclo: paidStudent.ciclo,
          ac: paidStudent.ac,
          installmentNumber: paidInstallment.number,
          installmentValue: Number(paidInstallment.value) || 0,
          dueDate: paidInstallment.dueDate,
          paidDate: paidInstallment.paidDate ?? '',
          currentPaidValue,
          newPaidValue: paidValue,
          rowRecebimento: row.recebimento ?? '',
        });
      }
      continue;
    }
    if (divergeMatches.length > 1) {
      pushError(row, 'multiplos_alunos', undefined, 'O vencimento existe em mais de um contrato, mas os valores divergem. Selecione o contrato correto manualmente antes de baixar.');
      continue;
    }
    if (divergeMatches.length === 1) {
      const { student: divergeStudent, installment: divergeInstallment } = divergeMatches[0];
      const divergeInstallmentValue = Number(divergeInstallment.value) || 0;
      const diffAbs = valorPago - divergeInstallmentValue;
      const diffPct = divergeInstallmentValue > 0 ? (diffAbs / divergeInstallmentValue) * 100 : 0;
      const fmt = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
      const sinal = diffAbs < 0 ? 'a menos' : 'a mais';
      const regra = row.format === 'conferencia'
        ? 'A conferência só baixa a parcela com valor idêntico ao da planilha — revise antes de baixar.'
        : 'Fora da tolerância de ±15% — revise o valor antes de baixar.';
      const detail = `Parcela registrada ${fmt(divergeInstallmentValue)} · pago ${fmt(valorPago)} (${fmt(Math.abs(diffAbs))} ${sinal} · ${diffPct.toFixed(2).replace('.', ',')}%). ${regra}`;
      pushError(row, 'valor_diverge', divergeStudent.id, detail);
      continue;
    }
    // Conferência: nenhuma parcela com o vencimento da planilha, mas existe
    // parcela em aberto com o MESMO valor → vencimento divergente. A linha
    // vira erro resolvível no preview: modal para trocar a data da parcela
    // pela da planilha ou manter a atual antes de dar a baixa.
    if (row.format === 'conferencia') {
      const fmtD = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
      const vencCandidates: Array<{ student: Student; installment: Installment }> = [];
      for (const s of matchesStudents) {
        for (const i of getDraft(s)) {
          if (!i.paid && i.dueDate !== row.vencimento && installmentValueMatches(i.value)) {
            vencCandidates.push({ student: s, installment: i });
          }
        }
      }
      if (vencCandidates.length > 0) {
        // Só é ambíguo quando MAIS DE UM CONTRATO tem parcela com este valor.
        // Dentro do mesmo contrato (caso comum: todas as parcelas iguais),
        // puxa a parcela em aberto com vencimento mais próximo do da planilha.
        const contractIds = new Set(vencCandidates.map(({ student }) => student.id));
        if (contractIds.size > 1) {
          const contratos = vencCandidates
            .map(({ student, installment }) => `${student.product || 'Treinamento não informado'}${student.ciclo ? ` (${student.ciclo})` : ''} — parcela ${installment.number} (${fmtD(installment.dueDate)})`)
            .join('; ');
          pushError(row, 'vencimento_diverge', undefined, `Há ${contractIds.size} contratos com parcela em aberto deste valor: ${contratos}. Selecione o contrato correto manualmente.`);
          continue;
        }
        const ref = new Date(row.vencimento).getTime();
        const { student: vs, installment: vi } = vencCandidates.slice().sort((a, b) => {
          const da = Math.abs(new Date(a.installment.dueDate).getTime() - ref);
          const db = Math.abs(new Date(b.installment.dueDate).getTime() - ref);
          return da - db || a.installment.number - b.installment.number;
        })[0];
        const outras = vencCandidates.length - 1;
        pushError(
          row,
          'vencimento_diverge',
          vs.id,
          `A parcela ${vi.number} tem o mesmo valor, mas vence em ${fmtD(vi.dueDate)} (planilha: ${fmtD(row.vencimento)})${outras > 0 ? ` — é a mais próxima entre ${vencCandidates.length} parcelas em aberto com este valor` : ''}. Escolha entre trocar a data da parcela ou manter a atual.`,
          { __installmentNumber__: vi.number, __installmentDueDate__: vi.dueDate },
        );
        continue;
      }
    }
    pushError(row, 'parcela_nao_encontrada', undefined);
  }

  // Monta updates por aluno (apenas os que mudaram).
  // Inclui também entradas em `history` para cada parcela baixada,
  // espelhando o comportamento de "Confirmar Pagamento" manual.
  const fmtBRLh = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  const fmtDateH = (s: string) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };
  const studentUpdates = new Map<string, Partial<Student>>();
  for (const [id, insts] of draft.entries()) {
    const original = students.find((s) => s.id === id);
    if (!original) continue;
    // Identifica novas baixas (em paralelo de índice — ordem é estável)
    const novas = insts.filter((i, idx) => i.paid && !original.installments[idx]?.paid);
    const valoresAtualizados = insts.filter((i, idx) =>
      i.paid &&
      typeof i.paidValue === 'number' &&
      Math.abs((original.installments[idx]?.paidValue ?? original.installments[idx]?.value ?? 0) - i.paidValue) > 0.01,
    );
    const alteradas = [...new Map(
      [...novas, ...valoresAtualizados].map((i) => [i.number, i]),
    ).values()];
    if (alteradas.length === 0) continue;
    const totalPagas = insts.filter((i) => i.paid).length;
    const restantes = insts.length - totalPagas;
    const newHistoryEntries = alteradas.map((i) => ({
      date: new Date().toISOString(),
      type: 'Sistema' as const,
      text: `Baixa via Conciliação Kamino — Parcela ${i.number}: ${fmtBRLh(Number(i.paidValue ?? i.value) || 0)} pago em ${fmtDateH(i.paidDate ?? '')}. ${totalPagas}/${insts.length} pagas (faltam ${restantes}).`,
    }));
    studentUpdates.set(id, {
      installments: insts,
      paidInstallments: totalPagas,
      history: [...(original.history ?? []), ...newHistoryEntries],
    });
  }

  return {
    summary: {
      batchId,
      fileName,
      totalRows: rows.filter((r) => r.pessoa).length,
      pagas,
      jaPagas,
      semPagamento,
      erros: errors.length,
      ajustesValor: ajustes.length,
    },
    errors,
    studentUpdates,
    baixas,
    ajustes,
  };
}
