import { useEffect, useMemo, useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { Wallet, Search, Copy, Check, ChevronLeft, ChevronRight, Target, History, X } from 'lucide-react';
import type { CancellationCase } from '@/types';
import PeriodFilter, { type PeriodMode } from '@/components/ui/PeriodFilter';
import { getMetaForRange, subscribeGoals, migrateLegacyIfNeeded } from '@/lib/estornosGoals';
import EstornoCaseSummaryModal from '@/components/modals/EstornoCaseSummaryModal';
import { logActivity } from '@/lib/activityLog';


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
}

interface RefundRow {
  caseId: string;
  studentName: string;
  ac?: string;
  product?: string;
  totalCase: number;
  installmentIndex: number;
  totalInstallments: number;
  date: string;
  value: number;
  pixKey: string;
  pixKeyType: string;
  createdAt: string;
  lancadoParaPagamento: boolean;
  lancadoAt?: string;
  lancadoPorNome?: string;
  log: RefundLogEntry[];
}


function formatDateBR(iso: string): string {
  try { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('pt-BR'); } catch { return iso; }
}

function formatDateTimeBR(iso: string): string {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
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

  const [onlyPending, setOnlyPending] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const [goalsTick, setGoalsTick] = useState(0);
  useEffect(() => { migrateLegacyIfNeeded(); }, []);
  useEffect(() => subscribeGoals(() => setGoalsTick((t) => t + 1)), []);

  const { dateFrom, dateTo } = useMemo(() => {
    // Lazy: compute via helper without importing separately
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
      // recompute weeks inline (mon-sun clipped)
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
          totalCase: Number(plan.totalValue ?? 0),
          installmentIndex: idx + 1,
          totalInstallments: plan.installments.length,
          date: p.date,
          value: Number(p.value ?? 0),
          pixKey: plan.pixKey ?? '',
          pixKeyType: plan.pixKeyType ?? '—',
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


  return (
    <div className="p-6 space-y-5">
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
        Lista de estornos gerados a partir de cancelamentos com saldo a devolver. Ordenados por data de pagamento.
      </p>

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
        void goalsTick; // re-render on goal changes
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


      {/* Filtro de período (Mês/Trimestre/Ano/Tudo + Semanas) */}
      <PeriodFilter
        mode={periodMode}
        setMode={setPeriodMode}
        anchor={periodAnchor}
        setAnchor={setPeriodAnchor}
        weekIdx={weekIdx}
        setWeekIdx={setWeekIdx}
      />

      {/* Busca */}
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


      {/* Lista */}
      <div className="rounded-2xl border border-border bg-card overflow-x-auto saas-shadow-sm">
        <div className="min-w-[1560px]">
        <div className="grid grid-cols-[100px_minmax(220px,2fr)_minmax(140px,1.1fr)_minmax(160px,1.2fr)_80px_130px_minmax(200px,1.6fr)_minmax(220px,1.5fr)_140px_70px] gap-2 px-4 py-2.5 text-[10px] font-semibold uppercase text-muted-foreground bg-muted/40 border-b border-border">
          <span>Pagamento</span>
          <span>Aluno</span>
          <span>Treinamento</span>
          <span>Assessor</span>
          <span className="text-center">Parcela</span>
          <span className="text-right">VALOR DA PARCELA</span>
          <span>Chave PIX</span>
          <span className="text-center">Lançado p/ pagamento</span>
          <span className="text-right">VALOR TOTAL DO ESTORNO</span>
          <span className="text-center">Log</span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Nenhum estorno registrado no filtro atual.</div>
        ) : paginated.map((r, idx) => (
          <div key={`${r.caseId}-${r.installmentIndex}`} className={`grid grid-cols-[100px_minmax(220px,2fr)_minmax(140px,1.1fr)_minmax(160px,1.2fr)_80px_130px_minmax(200px,1.6fr)_minmax(220px,1.5fr)_140px_70px] gap-2 px-4 py-2.5 items-start border-b border-border last:border-0 text-xs transition-colors ${r.lancadoParaPagamento ? 'bg-emerald-50/70 hover:bg-emerald-100/60' : 'bg-rose-50/60 hover:bg-rose-100/50'}`}>
            <span className="font-semibold text-foreground py-1">{formatDateBR(r.date)}</span>
            <button
              type="button"
              onClick={() => setSummaryCaseId(r.caseId)}
              className="text-left text-primary hover:underline font-medium break-words whitespace-normal leading-tight py-1"
              title={`Ver resumo do cancelamento de ${r.studentName}`}
            >
              {r.studentName}
            </button>

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
            <span className="flex items-start gap-1.5 min-w-0 py-1">
              <span className="text-[9px] uppercase font-semibold text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0">{r.pixKeyType}</span>
              <span className="text-foreground break-all whitespace-normal leading-tight">{r.pixKey || '—'}</span>
              {r.pixKey && (
                <button onClick={() => copy(r.pixKey, idx)} className="text-muted-foreground hover:text-foreground shrink-0" title="Copiar chave">
                  {copiedIdx === idx ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                </button>
              )}
            </span>
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
        ))}

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

      {logRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => setLogRow(null)}>
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-card border border-border saas-shadow-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card rounded-t-2xl">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Log de lançamento</p>
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
              {logRow.log.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center">
                  {logRow.lancadoPorNome
                    ? `Lançado por ${logRow.lancadoPorNome}${logRow.lancadoAt ? ' em ' + formatDateTimeBR(logRow.lancadoAt) : ''}.`
                    : 'Nenhuma alteração registrada nesta parcela ainda.'}
                </p>
              ) : (
                [...logRow.log].reverse().map((e, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${e.action === 'marcou' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                    <p className="text-xs font-semibold text-foreground break-words">
                      {e.byName} {e.action === 'marcou' ? 'marcou como lançado' : 'desmarcou o lançamento'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDateTimeBR(e.at)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>


  );
}
