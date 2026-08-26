import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { Wallet, Search, Copy, Check, ChevronLeft, ChevronRight, Target, History, X, Upload, FileText, Trash2, Loader2, Eye, Pencil } from 'lucide-react';
import type { CancellationCase, RefundPaymentMethod, RefundPixKeyType } from '@/types';
import { refundPaymentMethodLabel, resolveRefundPaymentMethod } from '@/types';
import PeriodFilter, { type PeriodMode } from '@/components/ui/PeriodFilter';
import { getMetaForRange, subscribeGoals, migrateLegacyIfNeeded } from '@/lib/estornosGoals';
import EstornoCaseSummaryModal from '@/components/modals/EstornoCaseSummaryModal';
import { logActivity } from '@/lib/activityLog';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';
import { openCancellationPdf } from '@/lib/openCancellationPdf';


/**
 * Aba Estornos — lista, ordenada por data de pagamento, todas as parcelas de
 * estorno geradas quando um cancelamento é confirmado com saldo negativo
 * (aluno pagou mais do que a multa). Os dados vêm do `refundPlan` armazenado
 * em cada CancellationCase e NÃO são enviados para a Conciliação.
 */
export interface RefundLogEntry {
  action: string;
  at: string;
  byName: string;
  byUserId?: string | null;
  detail?: string;
}

interface RefundRow {
  caseId: string;
  studentName: string;
  ac?: string;
  product?: string;
  quantidadeInscricoes?: number;
  totalCase: number;
  installmentIndex: number;
  totalInstallments: number;
  date: string;
  value: number;
  pixKey: string;
  pixKeyType: string;
  paymentMethod: RefundPaymentMethod;
  boletoFileUrl?: string;
  boletoFileName?: string;
  createdAt: string;
  lancadoParaPagamento: boolean;
  lancadoAt?: string;
  lancadoPorNome?: string;
  log: RefundLogEntry[];
}

function rowKey(r: Pick<RefundRow, 'caseId' | 'installmentIndex'>) {
  return `${r.caseId}-${r.installmentIndex}`;
}

function formatDateBR(iso: string): string {
  try { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR'); } catch { return iso; }
}

function formatLogEntryText(e: RefundLogEntry): string {
  switch (e.action) {
    case 'marcou':
      return `${e.byName} marcou como lançado`;
    case 'desmarcou':
      return `${e.byName} desmarcou o lançamento`;
    case 'editou_dados':
    case 'dados_alterados':
      return `${e.byName} alterou dados do estorno${e.detail ? `: ${e.detail}` : ''}`;
    case 'metodo_pagamento':
      return `${e.byName} alterou o método de pagamento${e.detail ? `: ${e.detail}` : ''}`;
    case 'boleto_anexado':
      return `${e.byName} anexou boleto${e.detail ? `: ${e.detail}` : ''}`;
    case 'boleto_removido':
      return `${e.byName} removeu boleto${e.detail ? `: ${e.detail}` : ''}`;
    default:
      return `${e.byName} — ${e.action}${e.detail ? `: ${e.detail}` : ''}`;
  }
}

function logEntryBorderClass(action: string): string {
  if (action === 'marcou' || action === 'boleto_anexado') return 'border-emerald-200 bg-emerald-50';
  if (action === 'desmarcou' || action === 'boleto_removido') return 'border-rose-200 bg-rose-50';
  return 'border-sky-200 bg-sky-50';
}

function formatDateTimeBR(iso: string): string {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

interface EditRefundForm {
  paymentMethod: RefundPaymentMethod;
  pixKeyType: RefundPixKeyType;
  pixKey: string;
}

export default function EstornosPage() {
  const { cancellationCases, students, updateCancellationCase, currentUser } = useAppStore();
  const [search, setSearch] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('mes');
  const [periodAnchor, setPeriodAnchor] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [summaryCaseId, setSummaryCaseId] = useState<string | null>(null);
  const [logRow, setLogRow] = useState<RefundRow | null>(null);
  const [editRow, setEditRow] = useState<RefundRow | null>(null);
  const [editForm, setEditForm] = useState<EditRefundForm>({ paymentMethod: 'pix', pixKeyType: 'CPF', pixKey: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadRow = useRef<RefundRow | null>(null);

  const [onlyPending, setOnlyPending] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const [goalsTick, setGoalsTick] = useState(0);
  useEffect(() => { migrateLegacyIfNeeded(); }, []);
  useEffect(() => subscribeGoals(() => setGoalsTick((t) => t + 1)), []);

  const { dateFrom, dateTo } = useMemo(() => {
    const modeMap = periodMode;
    if (modeMap === 'tudo') return { dateFrom: '', dateTo: '' };
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (modeMap === 'ano') {
      const y = periodAnchor.getFullYear();
      return { dateFrom: fmt(new Date(y, 0, 1)), dateTo: fmt(new Date(y, 11, 31)) };
    }
    if (modeMap === 'trimestre') {
      const q = Math.floor(periodAnchor.getMonth() / 3);
      return { dateFrom: fmt(new Date(periodAnchor.getFullYear(), q * 3, 1)), dateTo: fmt(new Date(periodAnchor.getFullYear(), q * 3 + 3, 0)) };
    }
    const y = periodAnchor.getFullYear();
    const m = periodAnchor.getMonth();
    if (weekIdx != null) {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      let cursor = new Date(first);
      let idx = 1;
      while (cursor <= last) {
        const dow = cursor.getDay();
        const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
        const weekEnd = new Date(cursor);
        weekEnd.setDate(cursor.getDate() + daysUntilSunday);
        const end = weekEnd > last ? last : weekEnd;
        if (idx === weekIdx) return { dateFrom: fmt(cursor), dateTo: fmt(end) };
        cursor = new Date(end);
        cursor.setDate(cursor.getDate() + 1);
        idx++;
      }
    }
    return { dateFrom: fmt(new Date(y, m, 1)), dateTo: fmt(new Date(y, m + 1, 0)) };
  }, [periodMode, periodAnchor, weekIdx]);


  const rows: RefundRow[] = useMemo(() => {
    const list: RefundRow[] = [];
    cancellationCases.forEach((c) => {
      const plan = (c as any).refundPlan;
      if (!plan?.installments?.length) return;
      const st = students.find((s) => s.id === c.studentId);
      plan.installments.forEach((p: any, idx: number) => {
        list.push({
          caseId: c.id,
          studentName: c.studentName,
          ac: c.ac,
          product: st?.product ?? (c as any).treinamento ?? undefined,
          quantidadeInscricoes: c.quantidadeInscricoes,
          totalCase: Number(plan.totalValue ?? 0),
          installmentIndex: idx + 1,
          totalInstallments: plan.installments.length,
          date: p.date,
          value: Number(p.value ?? 0),
          pixKey: plan.pixKey ?? '',
          pixKeyType: plan.pixKeyType ?? '—',
          paymentMethod: resolveRefundPaymentMethod(plan),
          boletoFileUrl: p.boletoFileUrl,
          boletoFileName: p.boletoFileName,
          createdAt: plan.createdAt ?? c.createdAt ?? '',
          lancadoParaPagamento: !!p.lancadoParaPagamento,
          lancadoAt: p.lancadoAt,
          lancadoPorNome: p.lancadoPorNome,
          log: Array.isArray(p.lancadoLog) ? (p.lancadoLog as RefundLogEntry[]) : [],
        });
      });
    });
    return list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [cancellationCases, students]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search && !r.studentName.toLowerCase().includes(search.toLowerCase())) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      if (onlyPending && r.lancadoParaPagamento) return false;
      return true;
    });
  }, [rows, search, dateFrom, dateTo, onlyPending]);

  const totalGeral = filtered.reduce((s, r) => s + r.value, 0);
  const alunosComEstornoPendente = new Set(rows.filter((r) => !r.lancadoParaPagamento).map((r) => r.caseId)).size;


  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [search, dateFrom, dateTo, onlyPending]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageStart = (page - 1) * PAGE_SIZE;
  const paginated = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const copy = async (txt: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { /* noop */ }
  };

  const appendPlanLog = (plan: NonNullable<CancellationCase['refundPlan']>, entry: { action: string; detail?: string }) => {
    const stamp = new Date().toISOString();
    const userName = currentUser?.name ?? 'Sistema';
    const userId = currentUser?.authUserId ?? null;
    const prevLog = Array.isArray(plan.planLog) ? plan.planLog : [];
    return {
      ...plan,
      planLog: [...prevLog, { action: entry.action, at: stamp, byName: userName, byUserId: userId, detail: entry.detail }],
    };
  };

  const updatePaymentMethod = (caseId: string, studentName: string, next: RefundPaymentMethod) => {
    const c = cancellationCases.find((x) => x.id === caseId) as CancellationCase | undefined;
    if (!c?.refundPlan) return;
    const prev = resolveRefundPaymentMethod(c.refundPlan);
    if (prev === next) return;
    const userName = currentUser?.name ?? 'Sistema';
    const nextPlan = appendPlanLog(
      { ...c.refundPlan, paymentMethod: next },
      { action: 'metodo_pagamento', detail: `${refundPaymentMethodLabel(prev)} → ${refundPaymentMethodLabel(next)}` },
    );
    updateCancellationCase(c.id, { refundPlan: nextPlan });
    logActivity({
      action: 'estorno.metodo_pagamento',
      entity: 'cancellation',
      entityId: c.id,
      entityLabel: studentName,
      summary: `${userName} alterou o método de pagamento do estorno de ${studentName} de ${refundPaymentMethodLabel(prev)} para ${refundPaymentMethodLabel(next)}`,
      meta: { de: prev, para: next },
    });
  };

  const persistInstallment = (
    c: CancellationCase,
    installmentIndex: number,
    patch: Record<string, unknown>,
    planPatch?: Partial<NonNullable<CancellationCase['refundPlan']>>,
  ) => {
    if (!c.refundPlan) return;
    const nextInstallments = c.refundPlan.installments.map((p, idx) =>
      idx === installmentIndex - 1 ? { ...p, ...patch } : p,
    );
    updateCancellationCase(c.id, {
      refundPlan: { ...c.refundPlan, ...planPatch, installments: nextInstallments },
    });
  };

  const triggerBoletoUpload = (r: RefundRow) => {
    pendingUploadRow.current = r;
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleBoletoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const r = pendingUploadRow.current;
    pendingUploadRow.current = null;
    if (!file || !r) return;

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(file.name);
    if (!isPdf && !isImage) {
      setUploadError('Selecione um PDF ou imagem do boleto.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('Arquivo maior que 15 MB.');
      return;
    }

    const c = cancellationCases.find((x) => x.id === r.caseId) as CancellationCase | undefined;
    if (!c?.refundPlan) return;

    const key = rowKey(r);
    setUploadingKey(key);
    setUploadError(null);
    try {
      const companyId = useCompanyStore.getState().activeCompanyId;
      if (!companyId) throw new Error('Empresa ativa não identificada.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${companyId}/estornos-boleto/${c.id}_p${r.installmentIndex}_${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('cancellation-docs').upload(path, file, {
        contentType: file.type || (isPdf ? 'application/pdf' : 'application/octet-stream'),
        upsert: false,
      });
      if (error) throw error;

      const userName = currentUser?.name ?? 'Sistema';
      const stamp = new Date().toISOString();
      const prevInst = c.refundPlan.installments[r.installmentIndex - 1];
      if (prevInst?.boletoFileUrl) {
        try { await supabase.storage.from('cancellation-docs').remove([prevInst.boletoFileUrl]); } catch { /* noop */ }
      }

      const nextPlan = appendPlanLog(c.refundPlan, {
        action: 'boleto_anexado',
        detail: `Parcela ${r.installmentIndex}/${r.totalInstallments}: ${file.name}`,
      });
      persistInstallment(
        c,
        r.installmentIndex,
        {
          boletoFileUrl: path,
          boletoFileName: file.name,
          boletoUploadedAt: stamp,
          boletoUploadedByNome: userName,
        },
        { planLog: nextPlan.planLog },
      );

      logActivity({
        action: 'estorno.boleto_anexado',
        entity: 'cancellation',
        entityId: c.id,
        entityLabel: r.studentName,
        summary: `${userName} anexou boleto da parcela ${r.installmentIndex}/${r.totalInstallments} de estorno de ${r.studentName} (${formatCurrency(r.value)})`,
        meta: { parcela: r.installmentIndex, arquivo: file.name },
      });
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Falha ao enviar o boleto.');
    } finally {
      setUploadingKey(null);
    }
  };

  const removeBoleto = async (r: RefundRow) => {
    const c = cancellationCases.find((x) => x.id === r.caseId) as CancellationCase | undefined;
    if (!c?.refundPlan || !r.boletoFileUrl) return;
    const userName = currentUser?.name ?? 'Sistema';
    try {
      await supabase.storage.from('cancellation-docs').remove([r.boletoFileUrl]);
    } catch { /* noop */ }

    const nextPlan = appendPlanLog(c.refundPlan, {
      action: 'boleto_removido',
      detail: `Parcela ${r.installmentIndex}/${r.totalInstallments}${r.boletoFileName ? `: ${r.boletoFileName}` : ''}`,
    });
    persistInstallment(
      c,
      r.installmentIndex,
      {
        boletoFileUrl: undefined,
        boletoFileName: undefined,
        boletoUploadedAt: undefined,
        boletoUploadedByNome: undefined,
      },
      { planLog: nextPlan.planLog },
    );
    logActivity({
      action: 'estorno.boleto_removido',
      entity: 'cancellation',
      entityId: c.id,
      entityLabel: r.studentName,
      summary: `${userName} removeu o boleto da parcela ${r.installmentIndex}/${r.totalInstallments} de estorno de ${r.studentName}`,
    });
  };

  const openBoleto = async (r: RefundRow) => {
    if (!r.boletoFileUrl) return;
    try {
      await openCancellationPdf(r.boletoFileUrl, r.boletoFileName);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Não foi possível abrir o boleto.');
    }
  };

  const openEdit = (r: RefundRow) => {
    setEditRow(r);
    setEditForm({
      paymentMethod: r.paymentMethod,
      pixKeyType: (r.pixKeyType as RefundPixKeyType) || 'CPF',
      pixKey: r.pixKey,
    });
    setEditError(null);
  };

  const saveRefundEdit = () => {
    if (!editRow) return;
    const c = cancellationCases.find((x) => x.id === editRow.caseId) as CancellationCase | undefined;
    if (!c?.refundPlan) return;

    if (editForm.paymentMethod === 'pix' && !editForm.pixKey.trim()) {
      setEditError('Informe a chave PIX do aluno.');
      return;
    }

    const prevMethod = resolveRefundPaymentMethod(c.refundPlan);
    const prevType = c.refundPlan.pixKeyType ?? '—';
    const prevKey = c.refundPlan.pixKey ?? '';
    const changes: string[] = [];

    if (prevMethod !== editForm.paymentMethod) {
      changes.push(`Método: ${refundPaymentMethodLabel(prevMethod)} → ${refundPaymentMethodLabel(editForm.paymentMethod)}`);
    }
    if (editForm.paymentMethod === 'pix') {
      if (prevType !== editForm.pixKeyType) {
        changes.push(`Tipo PIX: ${prevType} → ${editForm.pixKeyType}`);
      }
      if (prevKey.trim() !== editForm.pixKey.trim()) {
        changes.push(`Chave PIX: ${prevKey.trim() || '—'} → ${editForm.pixKey.trim()}`);
      }
    }

    if (changes.length === 0) {
      setEditRow(null);
      return;
    }

    const userName = currentUser?.name ?? 'Sistema';
    const userId = currentUser?.authUserId ?? null;
    const stamp = new Date().toISOString();
    const detail = changes.join('; ');

    let nextPlan = appendPlanLog(
      {
        ...c.refundPlan,
        paymentMethod: editForm.paymentMethod,
        pixKeyType: editForm.paymentMethod === 'pix' ? editForm.pixKeyType : c.refundPlan.pixKeyType,
        pixKey: editForm.paymentMethod === 'pix' ? editForm.pixKey.trim() : '',
      },
      { action: 'dados_alterados', detail },
    );

    const logEntry: RefundLogEntry = { action: 'editou_dados', at: stamp, byName: userName, byUserId: userId, detail };
    nextPlan = {
      ...nextPlan,
      installments: nextPlan.installments.map((p, idx) => {
        if (idx !== editRow.installmentIndex - 1) return p;
        const prevLog: RefundLogEntry[] = Array.isArray(p.lancadoLog) ? (p.lancadoLog as RefundLogEntry[]) : [];
        return { ...p, lancadoLog: [...prevLog, logEntry] };
      }),
    };

    updateCancellationCase(c.id, { refundPlan: nextPlan });
    logActivity({
      action: 'estorno.dados_alterados',
      entity: 'cancellation',
      entityId: c.id,
      entityLabel: editRow.studentName,
      summary: `${userName} alterou dados do estorno de ${editRow.studentName}: ${detail}`,
      meta: { parcela: editRow.installmentIndex, alteracoes: changes },
    });
    setEditRow(null);
  };

  const getRowLogEntries = (r: RefundRow): RefundLogEntry[] => {
    const c = cancellationCases.find((x) => x.id === r.caseId) as CancellationCase | undefined;
    const planLog = (c?.refundPlan?.planLog ?? []) as RefundLogEntry[];
    const parcelLog = r.log;
    const merged = [...parcelLog, ...planLog];
    const seen = new Set<string>();
    return merged
      .filter((e) => {
        const key = `${e.at}|${e.action}|${e.byName}|${e.detail ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.at.localeCompare(b.at));
  };

  const toggleLancado = (r: RefundRow) => {
    const c = cancellationCases.find((x) => x.id === r.caseId) as CancellationCase | undefined;
    if (!c?.refundPlan) return;
    const nextVal = !r.lancadoParaPagamento;
    const stamp = new Date().toISOString();
    const userName = currentUser?.name ?? 'Sistema';
    const userId = currentUser?.authUserId ?? null;
    const nextInstallments = c.refundPlan.installments.map((p, idx) => {
      if (idx !== r.installmentIndex - 1) return p;
      const prevLog: RefundLogEntry[] = Array.isArray((p as any).lancadoLog) ? (p as any).lancadoLog : [];
      const log = [...prevLog, { action: nextVal ? 'marcou' : 'desmarcou', at: stamp, byName: userName, byUserId: userId }];
      return nextVal
        ? { ...p, lancadoParaPagamento: true, lancadoAt: stamp, lancadoPorNome: userName, lancadoPorUserId: userId, lancadoLog: log }
        : { ...p, lancadoParaPagamento: false, lancadoAt: undefined, lancadoPorNome: undefined, lancadoPorUserId: undefined, lancadoLog: log };
    });
    updateCancellationCase(c.id, { refundPlan: { ...c.refundPlan, installments: nextInstallments } });
    logActivity({
      action: nextVal ? 'estorno.lancado' : 'estorno.desmarcado',
      entity: 'cancellation',
      entityId: c.id,
      entityLabel: r.studentName,
      summary: `${userName} ${nextVal ? 'marcou' : 'desmarcou'} a parcela ${r.installmentIndex}/${r.totalInstallments} de estorno de ${r.studentName} (${formatCurrency(r.value)}) como lançada para pagamento`,
    });
  };

  const GRID = 'grid grid-cols-[100px_minmax(200px,2fr)_72px_minmax(130px,1.1fr)_minmax(140px,1.1fr)_72px_120px_minmax(300px,2.2fr)_minmax(200px,1.4fr)_130px_70px] gap-2';

  return (
    <div className="p-6 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleBoletoFileSelected}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Wallet size={20} className="text-primary" />
          <h1 className="text-lg font-bold text-foreground">Estornos</h1>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground leading-tight text-right">
          <Target size={13} className="text-primary shrink-0" />
          <span>
            Metas máximas de estornos configuráveis em<br />
            <strong className="text-foreground">Configurações</strong>
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        Lista de estornos gerados a partir de cancelamentos com saldo a devolver. Escolha PIX ou Boleto e anexe o arquivo do boleto quando aplicável.
      </p>

      {uploadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800 flex items-center justify-between gap-2">
          <span>{uploadError}</span>
          <button type="button" onClick={() => setUploadError(null)} className="text-rose-600 hover:text-rose-900 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setOnlyPending((v) => !v)}
          className={`rounded-2xl border p-4 saas-shadow-sm text-left transition-all ${onlyPending ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-border bg-card hover:border-emerald-300'}`}
          title="Clique para filtrar apenas alunos com parcelas ainda não lançadas"
        >
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Alunos com estorno pendente</p>
          <p className="text-xl font-bold text-emerald-700">{alunosComEstornoPendente}</p>
        </button>
        <div className="rounded-2xl border border-border bg-card p-4 saas-shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">PARCELAS PENDENTE DE LANÇAR</p>
          <p className="text-xl font-bold text-amber-700">{rows.filter((r) => !r.lancadoParaPagamento).length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 saas-shadow-sm">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Total de estornos no período</p>
          <p className="text-xl font-bold text-primary">{formatCurrency(totalGeral)}</p>
        </div>
      </div>

      {(() => {
        const metaPeriodo = getMetaForRange(dateFrom, dateTo);
        void goalsTick;
        if (metaPeriodo <= 0) return null;
        const lancadoNoPeriodo = filtered.filter((r) => r.lancadoParaPagamento).reduce((s, r) => s + r.value, 0);
        const pct = metaPeriodo > 0 ? Math.min(100, (lancadoNoPeriodo / metaPeriodo) * 100) : 0;
        const color = pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
        return (
          <div className="rounded-2xl border border-border bg-card p-4 saas-shadow-sm">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-semibold text-foreground flex items-center gap-1.5"><Target size={12} className="text-primary" />Meta máxima no período: {formatCurrency(metaPeriodo)}</span>
              <span className="text-muted-foreground">Lançado: <strong className="text-emerald-700">{formatCurrency(lancadoNoPeriodo)}</strong> · {pct.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })()}

      <PeriodFilter
        mode={periodMode}
        setMode={setPeriodMode}
        anchor={periodAnchor}
        setAnchor={setPeriodAnchor}
        weekIdx={weekIdx}
        setWeekIdx={setWeekIdx}
      />

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Buscar aluno</label>
          <div className="relative mt-1">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome do aluno"
              className="input-field text-xs pl-8 w-full"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-x-auto saas-shadow-sm">
        <div className="min-w-[1680px]">
          <div className={`${GRID} px-4 py-2.5 text-[10px] font-semibold uppercase text-muted-foreground bg-muted/40 border-b border-border`}>
            <span>Pagamento</span>
            <span>Aluno</span>
            <span className="text-center">Inscrições</span>
            <span>Treinamento</span>
            <span>Assessor</span>
            <span className="text-center">Parcela</span>
            <span className="text-right">Valor parcela</span>
            <span>Método de pagamento</span>
            <span className="text-center">Lançado p/ pagamento</span>
            <span className="text-right">Total estorno</span>
            <span className="text-center">Log</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Nenhum estorno registrado no filtro atual.</div>
          ) : paginated.map((r, idx) => {
            const isUploading = uploadingKey === rowKey(r);
            return (
              <div
                key={rowKey(r)}
                className={`${GRID} px-4 py-3 items-start border-b border-border last:border-0 text-xs transition-colors ${r.lancadoParaPagamento ? 'bg-emerald-50/70 hover:bg-emerald-100/60' : 'bg-rose-50/60 hover:bg-rose-100/50'}`}
              >
                <span className="font-semibold text-foreground py-1">{formatDateBR(r.date)}</span>
                <button
                  type="button"
                  onClick={() => setSummaryCaseId(r.caseId)}
                  className="text-left text-primary hover:underline font-medium break-words whitespace-normal leading-tight py-1"
                  title={`Ver resumo do cancelamento de ${r.studentName}`}
                >
                  {r.studentName}
                </button>
                <span className="text-center text-foreground font-semibold py-1">
                  {r.quantidadeInscricoes != null && r.quantidadeInscricoes > 0 ? r.quantidadeInscricoes : '—'}
                </span>
                <span className="py-1">
                  {r.product ? (
                    <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border break-words whitespace-normal">{r.product}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span className="text-muted-foreground break-words whitespace-normal leading-tight py-1">{r.ac ?? '—'}</span>
                <span className="text-center text-muted-foreground py-1">{r.installmentIndex}/{r.totalInstallments}</span>
                <span className="text-right font-semibold text-rose-700 py-1">{formatCurrency(r.value)}</span>

                {/* Método de pagamento — PIX ou Boleto + dados */}
                <div className="space-y-2 py-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <select
                      value={r.paymentMethod}
                      onChange={(e) => updatePaymentMethod(r.caseId, r.studentName, e.target.value as RefundPaymentMethod)}
                      className="input-field text-xs flex-1 font-semibold"
                      title="Escolha PIX ou Boleto"
                    >
                      <option value="pix">PIX</option>
                      <option value="boleto">Boleto</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                      title="Editar dados do estorno (PIX, método de pagamento)"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>

                  {r.paymentMethod === 'pix' ? (
                    <div className="rounded-lg border border-border bg-card p-2 space-y-1">
                      <span className="text-[9px] uppercase font-semibold text-muted-foreground">{r.pixKeyType}</span>
                      <div className="flex items-start gap-1.5">
                        <span className="text-foreground break-all whitespace-normal leading-tight flex-1">{r.pixKey || '— Chave não informada —'}</span>
                        {r.pixKey && (
                          <button onClick={() => copy(r.pixKey, idx)} className="text-muted-foreground hover:text-foreground shrink-0" title="Copiar chave">
                            {copiedIdx === idx ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-sky-200 bg-sky-50/80 p-2 space-y-2">
                      <p className="text-[10px] font-semibold text-sky-900 uppercase">Arquivo do boleto</p>
                      {r.boletoFileUrl ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText size={13} className="text-sky-700 shrink-0" />
                            <span className="text-[11px] text-foreground truncate" title={r.boletoFileName}>{r.boletoFileName ?? 'Boleto anexado'}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => openBoleto(r)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-sky-600 text-white hover:bg-sky-700"
                            >
                              <Eye size={11} /> Ver boleto
                            </button>
                            <button
                              type="button"
                              onClick={() => triggerBoletoUpload(r)}
                              disabled={isUploading}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-sky-300 bg-white text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                            >
                              {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                              Substituir
                            </button>
                            <button
                              type="button"
                              onClick={() => removeBoleto(r)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 size={11} /> Remover
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => triggerBoletoUpload(r)}
                          disabled={isUploading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 w-full justify-center"
                        >
                          {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          {isUploading ? 'Enviando…' : 'Anexar boleto (PDF ou imagem)'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <label className="flex flex-col items-center justify-start gap-0.5 cursor-pointer text-center py-1">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={r.lancadoParaPagamento}
                      onChange={() => toggleLancado(r)}
                      className="h-3.5 w-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500 shrink-0"
                    />
                    <span className="text-[9px] font-medium text-muted-foreground leading-tight">{r.lancadoParaPagamento ? 'Sim' : 'Marcar como lançado'}</span>
                  </div>
                  {r.lancadoParaPagamento && (r.lancadoPorNome || r.lancadoAt) && (
                    <span className="text-[9px] leading-tight text-emerald-700 font-medium break-words whitespace-normal w-full">
                      {r.lancadoPorNome ?? '—'}{r.lancadoAt ? ` · ${formatDateTimeBR(r.lancadoAt)}` : ''}
                    </span>
                  )}
                </label>
                <span className="text-right text-muted-foreground py-1">{formatCurrency(r.totalCase)}</span>
                <span className="flex justify-center py-1">
                  <button
                    type="button"
                    onClick={() => setLogRow(r)}
                    className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Ver log de alterações desta parcela"
                  >
                    <History size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} de {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={12} /> Anterior
            </button>
            <span className="font-semibold text-foreground">Página {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Próxima <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      <EstornoCaseSummaryModal
        open={!!summaryCaseId}
        onClose={() => setSummaryCaseId(null)}
        caseData={cancellationCases.find((c) => c.id === summaryCaseId) ?? null}
      />

      {editRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditRow(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card border border-border saas-shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Editar dados do estorno</p>
                <h3 className="text-sm font-semibold text-foreground break-words">{editRow.studentName}</h3>
                <p className="text-[11px] text-muted-foreground">
                  Parcela {editRow.installmentIndex}/{editRow.totalInstallments}
                </p>
              </div>
              <button onClick={() => setEditRow(null)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Método de pagamento</label>
                <select
                  value={editForm.paymentMethod}
                  onChange={(e) => setEditForm((f) => ({ ...f, paymentMethod: e.target.value as RefundPaymentMethod }))}
                  className="input-field text-xs w-full mt-1"
                >
                  <option value="pix">PIX</option>
                  <option value="boleto">Boleto</option>
                </select>
              </div>

              {editForm.paymentMethod === 'pix' ? (
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">Tipo da chave</label>
                    <select
                      value={editForm.pixKeyType}
                      onChange={(e) => setEditForm((f) => ({ ...f, pixKeyType: e.target.value as RefundPixKeyType }))}
                      className="input-field text-xs w-full mt-1"
                    >
                      <option value="CPF">CPF</option>
                      <option value="CNPJ">CNPJ</option>
                      <option value="Email">Email</option>
                      <option value="Telefone">Telefone</option>
                      <option value="Aleatória">Aleatória</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-muted-foreground">Chave PIX do aluno</label>
                    <input
                      type="text"
                      value={editForm.pixKey}
                      onChange={(e) => setEditForm((f) => ({ ...f, pixKey: e.target.value }))}
                      placeholder="Informe a chave PIX"
                      className={`input-field text-xs w-full mt-1 ${!editForm.pixKey.trim() ? 'border-rose-500 ring-1 ring-rose-500' : ''}`}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
                  Para boleto, anexe o arquivo diretamente na linha da parcela. Alterações de método serão registradas no log.
                </p>
              )}

              {editError && <p className="text-xs text-rose-600 font-medium">{editError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditRow(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveRefundEdit}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Salvar alterações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {logRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => setLogRow(null)}>
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-card border border-border saas-shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card rounded-t-2xl">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Log de alterações</p>
                <h3 className="text-sm font-semibold text-foreground break-words">{logRow.studentName}</h3>
                <p className="text-[11px] text-muted-foreground">
                  Parcela {logRow.installmentIndex}/{logRow.totalInstallments} · {formatCurrency(logRow.value)} · {formatDateBR(logRow.date)}
                </p>
              </div>
              <button onClick={() => setLogRow(null)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-2">
              {(() => {
                const entries = getRowLogEntries(logRow);
                if (entries.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground text-center">
                      {logRow.lancadoPorNome
                        ? `Lançado por ${logRow.lancadoPorNome}${logRow.lancadoAt ? ' em ' + formatDateTimeBR(logRow.lancadoAt) : ''}.`
                        : 'Nenhuma alteração registrada nesta parcela ainda.'}
                    </p>
                  );
                }
                return [...entries].reverse().map((e, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${logEntryBorderClass(e.action)}`}>
                    <p className="text-xs font-semibold text-foreground break-words">{formatLogEntryText(e)}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDateTimeBR(e.at)}</p>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
