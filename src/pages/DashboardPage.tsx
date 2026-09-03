import { useAppStore, formatCurrency, formatCurrencyCompact, calculateAutoStatus, calculateAutoStatusAt, calcularScoreComportamento, calcularMediaDiasPagamento, getInstallmentFinancialValueExport } from '@/store/useAppStore';
import ACRankingCard from '@/components/ui/ACRankingCard';
import { NaoSomaBadge } from '@/components/NaoSomaBadge';
import ReversalRankingMirror from '@/components/ui/ReversalRankingMirror';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import DashDateFilter, { AnalysisModeToggle, DashFilterMode, PerfPreset, getPerfRange } from '@/components/ui/DashDateFilter';
import HeaderActions from '@/components/layout/HeaderActions';
import { getCurrentMonthDates } from '@/lib/periodFilter';
import { Wallet, TrendingUp, TrendingDown, Clock, Coins, Star, Info, Users, Tag, Camera, Activity, FileText, AlertTriangle, Download } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import MetaTaxaEmDiaHeader from '@/components/ui/MetaTaxaEmDiaHeader';
import RibbonGauge from '@/components/ui/RibbonGauge';
import { Student, StudentStatus } from '@/types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { getTodayBrasilia, getTodayStringBrasilia } from '@/lib/brasiliaDate';
import { getTagStyle } from '@/lib/tagColors';
import { computeTagKpis } from '@/lib/tagKpis';
import { studentMatchesTagFilter, applyTagFilterToStudent } from '@/lib/tagFilter';
import TagMultiSelect from '@/components/ui/TagMultiSelect';
import { supabase } from '@/integrations/supabase/client';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import KpiStudentsModal, { KpiValueMode } from '@/components/ui/KpiStudentsModal';
import { getHiddenFromAcPortfolioKeys, studentsForAcRanking, isSolicitacaoCancelamento, filterCarteiraActiveStudents, cancelamentoOverridesFinancialStatus, matchesCancelamentoFilter, isStudentFullyPaid } from '@/lib/acPortfolioVisibility';
import { resolveStudentDisplayStatus, isOperationalPendente, sumOperationalPendenteValue } from '@/lib/studentDisplayStatus';
import { countsInFinancialTotals, isInstallmentExcludedFromFinancialTotals, isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { fetchKaminoDashboardForecastTotals, type KaminoDashboardForecastTotals } from '@/lib/kaminoDashboardTotals';
import { upsertCarteiraCardSnapshot } from '@/lib/carteiraCardExtrato';
import { useCompanyStore } from '@/store/useCompanyStore';
import {
  isCancellationCaseInRange,
  isCancellationCaseRevertido,
} from '@/lib/cancellationIndicators';
import CancellationCasesModal from '@/components/ui/CancellationCasesModal';
import DashboardReportModal, { type DashboardReportSection } from '@/components/ui/DashboardReportModal';
import { exportForecastSpreadsheet, type ForecastExportRow } from '@/lib/exportForecastSpreadsheet';
import { entradaForaDasParcelas, entradaNoPeriodo, entradaPaidDate } from '@/lib/pagoFormaFilter';
import { toast } from 'sonner';

type KpiModalKey = 'total' | 'emdia_novos' | 'emdia' | 'novos' | 'v1' | 'v2' | 'an' | 'neg' | 'solic' | 'pendente' | 'tag' | 'revertidos';

function MediaDiasTag({ media }: { media: number | null }) {
  if (media === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const color = media < 0 ? 'text-emerald-600' : media <= 5 ? 'text-amber-600' : 'text-red-600';
  const prefix = media < 0 ? '' : '+';
  return <span className={`text-[11px] font-semibold ${color}`}>{prefix}{media}d</span>;
}

const STATUS_COLORS: Record<string, string> = {
  'Em Dia': '#10b981',
  'Vencido 1': '#f59e0b',
  'Vencido 2': '#f97316',
  'À Negativar': '#ef4444',
  'Negativado': '#9f1239',
  'Pago': '#14b8a6',
};

function BotaoRelatorio({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border border-border bg-card hover:bg-muted saas-shadow transition-colors shrink-0 ${className}`}
    >
      <FileText size={14} className="text-primary" />
      Relatório
    </button>
  );
}

export default function DashboardPage() {
  const { students, acs, products, cancellationCases, studentTags, kaminoPortfolioTotals, rules, setRules, currentUser } = useAppStore();
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const [forecastIndex, setForecastIndex] = useState(0);
  const [dateBasis, setDateBasis] = useState<'vencimento' | 'pagamento'>('vencimento');
  const [acFilter, setAcFilter] = useState('');
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StudentStatus | 'cancelamento_solicitado' | ''>('');
  const [infoStatus, setInfoStatus] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [paymentDetailModal, setPaymentDetailModal] = useState<null | 'pago' | 'recebido'>(null);
  const [kpiModalKey, setKpiModalKey] = useState<KpiModalKey | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const lastCardSnapshotRef = useRef<string | null>(null);

  // ── Evolução Mensal (filtro exclusivo do bloco) ───────────────────────────
  // Presets: 3m, 6m (default), 12m, custom (datepickers de mês)
  type EvolPreset = '3m' | '6m' | '12m' | 'custom';
  const [evolPreset, setEvolPreset] = useState<EvolPreset>('6m');
  const _evolToday = getTodayBrasilia();
  const _evolDefStart = new Date(_evolToday.getFullYear(), _evolToday.getMonth() - 5, 1);
  const fmtMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const [evolCustomStart, setEvolCustomStart] = useState<string>(fmtMonthKey(_evolDefStart));
  const [evolCustomEnd, setEvolCustomEnd] = useState<string>(fmtMonthKey(_evolToday));


  // ── DashDateFilter state ──────────────────────────────────────────────────
  const { firstDay: currentMonthStart, lastDay: currentMonthEnd } = getCurrentMonthDates();
  const [mode, setMode] = useState<DashFilterMode>('performance');
  const [perfPreset, setPerfPreset] = useState<PerfPreset>('todos');
  const [perfCustomStart, setPerfCustomStart] = useState(currentMonthStart);
  const [perfCustomEnd, setPerfCustomEnd] = useState(currentMonthEnd);
  // Histórico: por padrão o "fim" é ontem — dia já fechado com foto congelada.
  const yesterdayISO = (() => {
    const d = getTodayBrasilia();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const [historicoStart, setHistoricoStart] = useState(currentMonthStart);
  const [historicoEnd, setHistoricoEnd] = useState(yesterdayISO);

  // Quantidade de alunos distintos transferidos via Renegociação por AC.
  const renegByAc = (() => {
    const sets: Record<string, Set<string>> = {};
    const start = mode === 'historico' && historicoStart ? new Date(historicoStart + 'T00:00:00') : null;
    const end = mode === 'historico' && historicoEnd ? new Date(historicoEnd + 'T23:59:59') : null;
    conciliacaoItems.forEach((it) => {
      if (it.tipo !== 'parcela_quantidade' || !it.ac) return;
      if (start || end) {
        const c = new Date(it.createdAt);
        if (start && c < start) return;
        if (end && c > end) return;
      }
      const key = it.studentId || it.studentName;
      if (!key) return;
      (sets[it.ac!] ??= new Set()).add(key);
    });
    const map: Record<string, number> = {};
    Object.entries(sets).forEach(([k, v]) => (map[k] = v.size));
    return map;
  })();

  // ── Forecast custom dates ─────────────────────────────────────────────────
  const [forecastCustomStart, setForecastCustomStart] = useState(currentMonthStart);
  const [forecastCustomEnd, setForecastCustomEnd] = useState(currentMonthEnd);
  const [kaminoForecastTotals, setKaminoForecastTotals] = useState<KaminoDashboardForecastTotals | null>(null);

  // No IAM, a fonte dos valores é a carteira GC (alunos importados/aprovados):
  // a planilha cadastra os contratos, cancelamento conciliado debita e contrato
  // IAM aprovado na Conciliação passa a contar. O espelho Kamino permanece como
  // fonte autoritativa somente na empresa Liberty.
  const { companies, activeCompanyId } = useCompanyStore();
  const isLibertyCompany =
    (companies.find((c) => c.id === activeCompanyId)?.slug ?? '').toLowerCase() === 'liberty';

  const usesKaminoAuthoritativeForecast =
    isLibertyCompany &&
    mode === 'performance' &&
    forecastIndex === 0 &&
    dateBasis === 'vencimento' &&
    tagFilters.length === 0 &&
    scoreFilter === null;

  useEffect(() => {
    if (!usesKaminoAuthoritativeForecast) {
      setKaminoForecastTotals(null);
      return;
    }
    let cancelled = false;
    void fetchKaminoDashboardForecastTotals(acFilter || undefined, productFilter || undefined).then((totals) => {
      if (!cancelled) setKaminoForecastTotals(totals);
    });
    return () => {
      cancelled = true;
    };
  }, [usesKaminoAuthoritativeForecast, acFilter, productFilter, conciliacaoItems]);
  // ── Base dataset: filter by AC + Produto (Score aplicado depois) ─────────
  // Mantemos dois estágios para que a distribuição de Score continue refletindo
  // a carteira filtrada por AC+Produto (sem se auto-zerar quando o próprio
  // filtro de Score está ativo).
  const acProductFilteredRaw = students.filter((s) => {
    if (!countsInFinancialTotals(s)) return false;
    if (acFilter && s.ac !== acFilter) return false;
    if (productFilter && s.product !== productFilter) return false;
    if (!studentMatchesTagFilter(s, tagFilters)) return false;
    return true;
  });
  // Quando filtro de tag está ativo, recalculamos installments/status/value
  // para refletir SOMENTE as parcelas marcadas com a tag.
  const acProductFiltered = tagFilters.length > 0
    ? acProductFilteredRaw.map((s) => applyTagFilterToStudent(s, tagFilters))
    : acProductFilteredRaw;

  const baseStudents = scoreFilter !== null
    ? acProductFiltered.filter((s) => calcularScoreComportamento(s.installments) === scoreFilter)
    : acProductFiltered;

  // ── KPI students (mode-dependent) ─────────────────────────────────────────
  // Regra: Pagos NÃO entram na carteira/KPIs. Aparecem somente quando o
  // usuário filtra explicitamente por "Pago" (consulta).
  const [kpiStudents, setKpiStudents] = useState<Student[]>([]);

  // Snapshot histórico congelado (uma foto por dia por empresa). Quando o
  // usuário consulta uma data passada, lemos a foto salva na tabela
  // dashboard_snapshots em vez de recalcular a partir do estado atual.
  const [snapshotStudents, setSnapshotStudents] = useState<Student[] | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  /** frozen = foto do dia; missing = dia passado sem foto; live = hoje / performance */
  const [snapshotKind, setSnapshotKind] = useState<'frozen' | 'missing' | 'live'>('live');

  // Garante a foto de ontem (se o cron não rodou): gera uma vez por sessão.
  useEffect(() => {
    const key = `gc_snap_ensure_${yesterdayISO}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    void supabase.functions
      .invoke('snapshot-daily', { body: { date: yesterdayISO } })
      .then(({ error }) => {
        if (error) console.warn('[dashboard] snapshot-daily ontem:', error);
      })
      .catch((err) => console.warn('[dashboard] snapshot-daily ontem:', err));
  }, [yesterdayISO]);

  useEffect(() => {
    if (mode !== 'historico' || !historicoEnd) {
      setSnapshotStudents(null);
      setSnapshotDate(null);
      setSnapshotKind('live');
      return;
    }
    const todayISO = getTodayBrasilia().toISOString().slice(0, 10);
    if (historicoEnd >= todayISO) {
      setSnapshotStudents(null);
      setSnapshotDate(null);
      setSnapshotKind('live');
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    (async () => {
      try {
        const { data: activeCompany } = await supabase
          .from('user_active_company')
          .select('company_id')
          .maybeSingle();
        const companyId = activeCompany?.company_id;
        if (!companyId) {
          if (!cancelled) {
            setSnapshotStudents(null);
            setSnapshotDate(null);
            setSnapshotKind('missing');
          }
          return;
        }
        const { data: snap } = await supabase
          .from('dashboard_snapshots')
          .select('snapshot_date, payload')
          .eq('company_id', companyId)
          .eq('snapshot_date', historicoEnd)
          .maybeSingle();
        if (cancelled) return;
        if (!snap) {
          setSnapshotStudents(null);
          setSnapshotDate(null);
          setSnapshotKind('missing');
          return;
        }
        // Monta o aluno 100% a partir da foto — não misturar cadastro ao vivo
        // (AC/produto/tags mudam depois e quebrariam o número do dia).
        const byId = new Map(students.map((s) => [s.id, s]));
        const arr = (snap.payload as any[]).map((p) => {
          const cur = byId.get(p.id);
          const frozenInst = Array.isArray(p.installments) ? p.installments : [];
          return {
            id: p.id,
            name: p.name ?? cur?.name ?? '',
            whatsapp: cur?.whatsapp ?? '',
            cpf: cur?.cpf ?? '',
            address: cur?.address ?? '',
            numero: cur?.numero ?? '',
            cidade: cur?.cidade ?? '',
            estado: cur?.estado ?? '',
            cep: cur?.cep ?? '',
            status: p.status as StudentStatus,
            statusMode: (p.status_mode ?? cur?.statusMode ?? 'Automático') as Student['statusMode'],
            ac: p.ac_id ?? cur?.ac ?? '',
            product: p.product ?? cur?.product ?? '',
            enrollmentDate: p.enrollment_date ?? cur?.enrollmentDate ?? '',
            dueDay: cur?.dueDay ?? 1,
            saleValue: Number(p.total_open ?? 0) + Number(p.total_paid ?? 0) || cur?.saleValue || 0,
            downPayment: cur?.downPayment ?? 0,
            totalInstallments: frozenInst.length || cur?.totalInstallments || 0,
            paidInstallments: frozenInst.filter((i: { paid?: boolean }) => i.paid).length,
            installmentValue: cur?.installmentValue ?? 0,
            installments: frozenInst,
            history: cur?.history ?? [],
            tags: p.tags ?? cur?.tags ?? [],
            isRendaExtra: p.is_renda_extra ?? cur?.isRendaExtra,
            rendaExtraStatus: p.renda_extra_status ?? cur?.rendaExtraStatus,
            statusCancelamento: p.status_cancelamento ?? cur?.statusCancelamento,
          } as Student;
        });
        setSnapshotStudents(arr);
        setSnapshotDate(snap.snapshot_date);
        setSnapshotKind('frozen');
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, historicoEnd, students]);

  useEffect(() => {
    // Cancelados conciliados (statusCancelamento === 'cancelado') NÃO entram na carteira/KPIs.
    // Exceção: quando o filtro é "cancelamento_solicitado", exibimos apenas os
    // alunos com solicitação em aberto (statusCancelamento='solicitado').
    const stripCancelados = (arr: Student[]) =>
      statusFilter === 'cancelamento_solicitado'
        ? arr.filter((s) => matchesCancelamentoFilter(s, cancellationCases))
        : arr.filter((s) => s.statusCancelamento !== 'cancelado');
    // Renda Extra já conciliada (saiu de "Conciliar Exclusão") NÃO entra na carteira/KPIs;
    // só aparece quando o usuário filtrar explicitamente por status "Renda Extra".
    const stripRendaExtraConciliada = (arr: Student[]) =>
      statusFilter === 'Renda Extra'
        ? arr
        : arr.filter((s) => !(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão'));
    if (mode === 'historico') {
      if (!historicoEnd) { setKpiStudents([]); return; }
      const refDate = new Date(historicoEnd + 'T23:59:59');
      const todayEnd = getTodayBrasilia(); todayEnd.setHours(23, 59, 59, 999);
      const isTodaySnapshot = refDate.getTime() >= todayEnd.getTime();

      // 🎯 Foto congelada disponível: usa direto sem recalcular.
      if (!isTodaySnapshot && snapshotStudents && snapshotDate === historicoEnd) {
        const filteredByFront = snapshotStudents.filter((s) => {
          if (acFilter && s.ac !== acFilter) return false;
          if (productFilter && s.product !== productFilter) return false;
          if (!studentMatchesTagFilter(s, tagFilters)) return false;
          if (scoreFilter !== null && calcularScoreComportamento(s.installments) !== scoreFilter) return false;
          return true;
        });
        const withoutPagos = filterCarteiraActiveStudents(filteredByFront, statusFilter);
        const withoutCancelados = stripCancelados(withoutPagos);
        const withoutREConciliada = stripRendaExtraConciliada(withoutCancelados);
        const filtered = statusFilter
          ? (statusFilter === 'Renda Extra'
              ? withoutREConciliada.filter((s) => isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')
              : statusFilter === 'cancelamento_solicitado'
                ? withoutREConciliada
                : withoutREConciliada.filter((s) => s.status === statusFilter))
          : withoutREConciliada;
        setKpiStudents(filtered);
        return;
      }

      // Fallback: sem foto salva para a data → reconstrução como antes.
      const base = isTodaySnapshot
        ? baseStudents
        : baseStudents.filter((s) => new Date(s.enrollmentDate) <= refDate);
      const remapped = base.map((s) => {
        // "Negativado" é preservado sempre — nunca rebaixado por auto-cálculo.
        if (s.status === 'Negativado' || cancelamentoOverridesFinancialStatus(s) || isOperationalPendente(s)) {
          return cancelamentoOverridesFinancialStatus(s) && s.status !== 'Cancelado'
            ? ({ ...s, status: 'Solicitação Cancelamento' as StudentStatus })
            : isOperationalPendente(s)
              ? ({ ...s, status: 'Pendente' as StudentStatus })
              : s;
        }
        if (s.statusMode === 'Automático') {
          const st = isTodaySnapshot
            ? calculateAutoStatus(s.installments)
            : calculateAutoStatusAt(s.installments, refDate);
          return { ...s, status: st as StudentStatus };
        }
        return s;
      });
      const withoutPagos = filterCarteiraActiveStudents(remapped, statusFilter);
      const withoutCancelados = stripCancelados(withoutPagos);
      const withoutREConciliada = stripRendaExtraConciliada(withoutCancelados);
      const filtered = statusFilter
        ? (statusFilter === 'Renda Extra'
            ? withoutREConciliada.filter((s) => isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')
            : statusFilter === 'cancelamento_solicitado'
              ? withoutREConciliada
              : withoutREConciliada.filter((s) => s.status === statusFilter))
        : withoutREConciliada;
      setKpiStudents(filtered);
    } else {
      const mapped = baseStudents.map((s) => {
        if (s.status === 'Negativado' || cancelamentoOverridesFinancialStatus(s) || isOperationalPendente(s)) {
          return cancelamentoOverridesFinancialStatus(s) && s.status !== 'Cancelado'
            ? ({ ...s, status: 'Solicitação Cancelamento' } as Student)
            : isOperationalPendente(s)
              ? ({ ...s, status: 'Pendente' } as Student)
              : s;
        }
        if (s.statusMode === 'Automático') {
          return { ...s, status: calculateAutoStatus(s.installments) } as Student;
        }
        return s;
      });
      const withoutPagos = filterCarteiraActiveStudents(mapped, statusFilter);
      const withoutCancelados = stripCancelados(withoutPagos);
      const withoutREConciliada = stripRendaExtraConciliada(withoutCancelados);
      const filtered = statusFilter
        ? (statusFilter === 'Renda Extra'
            ? withoutREConciliada.filter((s) => isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')
            : statusFilter === 'cancelamento_solicitado'
              ? withoutREConciliada
              : withoutREConciliada.filter((s) => s.status === statusFilter))
        : withoutREConciliada;
      setKpiStudents(filtered);
    }
  }, [mode, historicoEnd, baseStudents.length, acFilter, productFilter, scoreFilter, statusFilter, tagFilters, students, snapshotStudents, snapshotDate, cancellationCases]);

  const cancellationDateRange = (() => {
    if (mode === 'historico') {
      if (!historicoEnd) return null;
      const start = historicoStart
        ? new Date(historicoStart + 'T00:00:00')
        : new Date(historicoEnd + 'T00:00:00');
      const end = new Date(historicoEnd + 'T23:59:59');
      return { start, end };
    }
    if (perfPreset === 'todos') return null;
    return getPerfRange(perfPreset, perfCustomStart, perfCustomEnd);
  })();

  const acCases = cancellationCases.filter((c) => {
    if (acFilter && c.ac !== acFilter) return false;
    if (!isCancellationCaseInRange(c, cancellationDateRange)) return false;
    if (!productFilter && scoreFilter === null) return true;
    const st = c.studentId ? students.find((s) => s.id === c.studentId) : undefined;
    if (!st) return false;
    if (productFilter && st.product !== productFilter) return false;
    if (scoreFilter !== null && calcularScoreComportamento(st.installments) !== scoreFilter) return false;
    return true;
  });
  const revertidos = acCases.filter(isCancellationCaseRevertido);

  // ── Média dias ────────────────────────────────────────────────────────────
  const allPaidInstallments = baseStudents.flatMap((s) => s.installments);
  const mediaCarteira = calcularMediaDiasPagamento(allPaidInstallments);

  // ── KPI derivations ───────────────────────────────────────────────────────
  // Aplica o filtro "Data de Vencimento" (forecastIndex) também aos KPIs de status:
  // só conta alunos que possuem ao menos uma parcela com dueDate dentro do range.
  const _fcRange = (() => {
    const today = getTodayBrasilia();
    if (forecastIndex === 0) return null;
    if (forecastIndex === 6) {
      if (!forecastCustomStart || !forecastCustomEnd) return null;
      return { start: new Date(forecastCustomStart + 'T00:00:00'), end: new Date(forecastCustomEnd + 'T23:59:59') };
    }
    const offsetMap: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
    const offset = offsetMap[forecastIndex] ?? 0;
    const target = new Date(today); target.setDate(target.getDate() + offset);
    const end = new Date(target); end.setHours(23, 59, 59, 999);
    return { start: target, end };
  })();
  const _instInRange = (i: { dueDate: string }) => {
    if (!_fcRange) return true;
    const due = new Date(i.dueDate + 'T00:00:00');
    return due >= _fcRange.start && due <= _fcRange.end;
  };
  // Quando há filtro de período (modo de pesquisa), a carteira mostra somente
  // alunos com parcelas EM ABERTO (vencidas ou a vencer) dentro do intervalo —
  // parcelas já pagas no período não devem inflar o contador de alunos, já que
  // o valor da carteira (sumUnpaid) também ignora pagas. Isso alinha o
  // "Carteira Total" com a aba Alunos.
  const kpiStudentsScoped = _fcRange
    ? kpiStudents.filter((s) => s.installments.some((i) => !i.paid && _instInRange(i)))
    : kpiStudents;
  const total = kpiStudentsScoped.length;
  const _isSolic = (s: Student) => matchesCancelamentoFilter(s, cancellationCases);
  const emDia = kpiStudentsScoped.filter((s) => s.status === 'Em Dia' && !_isSolic(s));
  const alunosNovos = kpiStudentsScoped.filter((s) => s.status === 'Aluno Novo' && !_isSolic(s));
  const vencido1 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 1' && !_isSolic(s));
  const vencido2 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 2' && !_isSolic(s));
  const aNegativar = kpiStudentsScoped.filter((s) => s.status === 'À Negativar' && !_isSolic(s));
  const negativado = kpiStudentsScoped.filter((s) => s.status === 'Negativado' && !_isSolic(s));
  // Pedido de cancelamento: critério unificado (status OU statusCancelamento).
  // Não depende do filtro de vencimento — o pedido existe independente da parcela.
  const solicitacaoCancelamento = kpiStudents.filter(_isSolic);
  // Pendência = pagamento aguardando fora de boleto (PIX, link, cartão, etc.).
  // Boleto NÃO entra neste status — segue Em Dia / Vencido / etc.
  const pendentes = kpiStudentsScoped.filter((s) => isOperationalPendente(s) && !_isSolic(s));
  const inadimplentes = vencido1.length + vencido2.length + aNegativar.length + negativado.length;

  // Dia de referência dos KPIs: no Histórico é o "fim" escolhido; senão, hoje.
  const _refDayMs = (() => {
    if (mode === 'historico' && historicoEnd) {
      return new Date(historicoEnd + 'T00:00:00').getTime();
    }
    const d = getTodayBrasilia();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();

  // À Negativar "estagnado" = oldestOverdue > 65 dias (na data de referência do modo).
  const aNegativarStale = aNegativar.some((s) => {
    let oldest: number | null = null;
    for (const inst of s.installments) {
      if (inst.paid) continue;
      const due = new Date(inst.dueDate + 'T00:00:00').getTime();
      if (due >= _refDayMs) continue;
      const diffDays = Math.floor((_refDayMs - due) / 86400000);
      if (oldest === null || diffDays > oldest) oldest = diffDays;
    }
    return oldest !== null && oldest > 65;
  });

  const sumUnpaid = (arr: Student[]) =>
    arr.reduce((acc, s) => {
      if (s.statusCancelamento === 'cancelado') {
        return acc + s.installments
          .filter((i) => !i.paid && _instInRange(i) && (i.tags ?? []).includes('multa-cancelamento'))
          .reduce((a, i) => a + i.value, 0);
      }
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus !== 'Conciliar Exclusão') return acc;
      return acc + s.installments
        .filter((i) => !i.paid && _instInRange(i) && !isInstallmentExcludedFromFinancialTotals(s, i))
        .reduce((a, i) => a + i.value, 0);
    }, 0);

  // Todo card de status soma o saldo em aberto inteiro (vencido + a vencer),
  // na mesma régua da Carteira Total. Enquanto Vencido 1/2 e Negativado
  // mostravam só a fatia já vencida, as parcelas futuras desses alunos
  // entravam no total e não apareciam em card nenhum.
  const emDiaValue = sumUnpaid(emDia);
  const alunosNovosValue = sumUnpaid(alunosNovos);
  const v1Value = sumUnpaid(vencido1);
  const v2Value = sumUnpaid(vencido2);
  const anValue = sumUnpaid(aNegativar);
  const negValue = sumUnpaid(negativado);
  const solicCancValue = sumUnpaid(solicitacaoCancelamento);
  // Quitado no funil de cancelamento continua neste card (regra de
  // filterCarteiraActiveStudents) mas some da Carteira Total, que só conta quem
  // tem parcela em aberto. É a diferença entre a soma dos cards e o total.
  const solicCancQuitados = solicitacaoCancelamento.filter(isStudentFullyPaid).length;
  const pendenteValue = pendentes.reduce((acc, s) => acc + sumOperationalPendenteValue(s), 0);

  // Mesma base do card "Carteira Total" — pendência IAM excluída por parcela, não por aluno.
  const forecastBase = baseStudents.filter(
    (s) =>
      s.statusCancelamento !== 'cancelado' &&
      countsInFinancialTotals(s) &&
      !(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão'),
  );
  const carteiraModalStudents = forecastBase.filter((s) =>
    s.installments.some((i) => !i.paid && _instInRange(i) && !isInstallmentExcludedFromFinancialTotals(s, i)),
  );

  // KPIs por tag (Fundo / TMF / Antecipação) — somente parcelas marcadas.
  const tagKpis = computeTagKpis(kpiStudentsScoped, studentTags, _instInRange);

  const kpiModalConfig: { title: string; students: Student[]; valueMode: KpiValueMode } | null = (() => {
    switch (kpiModalKey) {
      case 'total':
        return { title: 'Carteira Total', students: carteiraModalStudents, valueMode: 'unpaid' };
      case 'emdia_novos':
        return { title: 'Em Dia + Novos', students: [...emDia, ...alunosNovos], valueMode: 'unpaid' };
      case 'emdia':
        return { title: 'Em Dia', students: emDia, valueMode: 'unpaid' };
      case 'novos':
        return { title: 'Alunos Novos', students: alunosNovos, valueMode: 'unpaid' };
      case 'v1':
        return { title: 'Vencido 1', students: vencido1, valueMode: 'unpaid' };
      case 'v2':
        return { title: 'Vencido 2', students: vencido2, valueMode: 'unpaid' };
      case 'an':
        return { title: 'À Negativar', students: aNegativar, valueMode: 'unpaid' };
      case 'neg':
        return { title: 'Negativado', students: negativado, valueMode: 'unpaid' };
      case 'solic':
        return { title: 'Solicitação Cancelamento', students: solicitacaoCancelamento, valueMode: 'unpaid' };
      case 'pendente':
        return { title: 'Pendências', students: pendentes, valueMode: 'operational_pendente' };
      case 'tag':
        return tagKpis[0]
          ? { title: tagKpis[0].label, students: tagKpis[0].students, valueMode: 'unpaid' as KpiValueMode }
          : null;
      case 'revertidos':
      case null:
        return null;
      default: {
        const _exhaustive: never = kpiModalKey;
        void _exhaustive;
        return null;
      }
    }
  })();

  // Novos + Em Dia + Inadimplentes usam a mesma base para as % fecharem em 100%.
  // Cancelamento/Pendência ficam nos cards próprios e não entram nesta conta.
  const totalComposicao = alunosNovos.length + emDia.length + inadimplentes;
  const pct = (n: number) => totalComposicao > 0 ? ((n / totalComposicao) * 100).toFixed(1) : '0.0';
  const pctCarteira = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
  const pctEmDia = pct(emDia.length);
  const pctInadimplente = pct(inadimplentes);
  const pctEmDiaNovos = pct(emDia.length + alunosNovos.length);

  // ── Fita "Em Dia + Novos": marca do início do mês ─────────────────────────
  // O ponteiro segue o valor ao vivo; a marca de partida é a participação
  // registrada na primeira visualização de cada mês (Brasília). Quando o mês
  // vira, a marca é refeita com o valor daquele momento — gravada em
  // financial_rules para todos os usuários da empresa verem a mesma referência.
  const mesAtualKey = getTodayStringBrasilia().slice(0, 7); // YYYY-MM
  const mesAtualLabel = (() => {
    const [y, m] = mesAtualKey.split('-').map(Number);
    const nome = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${y}`;
  })();
  const emDiaNovosBaseAtual =
    rules.emDiaNovosBaseMes === mesAtualKey ? rules.emDiaNovosBase : undefined;
  const fixarBaseEmDiaNovos =
    currentUser?.role === 'admin' && totalComposicao > 0 && rules.emDiaNovosBaseMes !== mesAtualKey;
  useEffect(() => {
    if (!fixarBaseEmDiaNovos) return;
    setRules({
      emDiaNovosBase: Math.round(Number(pctEmDiaNovos) * 10) / 10,
      emDiaNovosBaseMes: mesAtualKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixarBaseEmDiaNovos, mesAtualKey]);

  // ── Forecast (filtro isolado: só afeta este card) ─────────────────────────
  // Índices: 0=Todos, 1=Hoje, 2=Amanhã, 3=2Dias, 4=3Dias, 5=7Dias, 6=Personalizado
  // Regras — cada botão mostra APENAS o dia exato:
  //   Todos      → toda a carteira de parcelas não pagas
  //   Hoje       → parcelas com dueDate = hoje (Brasília)
  //   Amanhã     → parcelas com dueDate = amanhã (dia único)
  //   2 Dias     → parcelas com dueDate = daqui 2 dias (dia único)
  //   3 Dias     → parcelas com dueDate = daqui 3 dias (dia único)
  //   7 Dias     → parcelas com dueDate = daqui 7 dias (dia único)
  //   Personal.  → intervalo entre as datas escolhidas
  const getForecastRange = (): { start: Date; end: Date } | null => {
    const today = getTodayBrasilia();
    // Todos
    if (forecastIndex === 0) return null;
    // Personalizado
    if (forecastIndex === 6) {
      if (!forecastCustomStart || !forecastCustomEnd) return null;
      return {
        start: new Date(forecastCustomStart + 'T00:00:00'),
        end: new Date(forecastCustomEnd + 'T23:59:59'),
      };
    }
    // Hoje / Amanhã / 2 Dias / 3 Dias / 7 Dias → dia único
    const offsetMap: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
    const offset = offsetMap[forecastIndex] ?? 0;
    const target = new Date(today);
    target.setDate(target.getDate() + offset);
    const end = new Date(target);
    end.setHours(23, 59, 59, 999);
    return { start: target, end };
  };

  // Exclui Renda Extra (saída de Conciliar Exclusão) e Cancelados conciliados
  // do bloco "Data de Vencimento" — forecastBase definido acima (alinhado ao modal).
  // Retorna totais da projeção: A Vencer/Vencido (não pagas), Pago (pagas) e soma (total).
  // "Todos" → toda a carteira; demais → filtrado por dueDate dentro do range.
  const getForecastTotals = () => {
    const range = forecastIndex === 0 ? null : getForecastRange();
    let total = 0, aVencer = 0, pago = 0;
    let totalReal = 0, pagoReal = 0;
    let qtd = 0;
    const qtdAlunosSet = new Set<string>();
    const qtdAlunosAVencerSet = new Set<string>();
    // Breakdown por Assessor (usado no modo Pagamento)
    const perAc: Record<string, { pago: number; pagoReal: number; qtd: number; alunos: Set<string> }> = {};
    const bumpAc = (acName: string, valor: number, real: number, studentId: string) => {
      const key = acName || 'Sem Assessor';
      const b = perAc[key] ?? (perAc[key] = { pago: 0, pagoReal: 0, qtd: 0, alunos: new Set() });
      b.pago += valor;
      b.pagoReal += real;
      b.qtd += 1;
      b.alunos.add(studentId);
    };
    // Detalhes por parcela (popup + exportação em planilha)
    const details: ForecastExportRow[] = [];
    const pushDetail = (
      st: Student,
      partial: Omit<ForecastExportRow, 'studentId' | 'studentName' | 'ac' | 'product' | 'whatsapp' | 'email' | 'status' | 'saleValue'>,
    ) => {
      details.push({
        studentId: st.id,
        studentName: st.name,
        ac: st.ac || 'Sem Assessor',
        product: st.product || '',
        whatsapp: st.whatsapp || '',
        email: st.email || '',
        displayStatus: resolveStudentDisplayStatus(st),
        saleValue: Number(st.saleValue ?? 0),
        ...partial,
      });
    };
    forecastBase.forEach((st) => {
      // Entrada recebida que não virou parcela (IAM à vista/cartão, cadastro
      // manual, importação Kamino, IAM parcelado com entrada) entra DIRETO no
      // card Pago em qualquer base (vencimento/pagamento), com a data da
      // matrícula como data de recebimento para o filtro de período. Contrato
      // IAM quitado à vista/cartão além disso nunca soma no A Vencer/Vencido.
      const quitadoAvista = isIamConciliadoQuitadoAvista(st);
      if (entradaNoPeriodo(st, range)) {
        const entrada = entradaForaDasParcelas(st, quitadoAvista);
        if (entrada > 0) {
          total += entrada;
          totalReal += entrada;
          pago += entrada;
          pagoReal += entrada;
          qtd += 1;
          qtdAlunosSet.add(st.id);
          bumpAc(st.ac, entrada, entrada, st.id);
          pushDetail(st, {
            bucket: 'pago',
            installmentNumber: 0,
            dueDate: entradaPaidDate(st),
            value: entrada,
            paidValue: entrada,
            paidDate: entradaPaidDate(st) || undefined,
          });
        }
      }
      st.installments.forEach((i) => {
        if (dateBasis === 'pagamento') {
          if (!i.paid || !i.paidDate) return;
          if (range) {
            const pd = new Date(i.paidDate + 'T00:00:00');
            if (pd < range.start || pd > range.end) return;
          }
          const realValue = typeof i.paidValue === 'number' ? i.paidValue : i.value;
          total += i.value;
          totalReal += realValue;
          pago += i.value;
          pagoReal += realValue;
          qtd += 1;
          qtdAlunosSet.add(st.id);
          bumpAc(st.ac, i.value, realValue, st.id);
          pushDetail(st, {
            bucket: 'pago',
            installmentNumber: i.number,
            dueDate: i.dueDate,
            value: i.value,
            paidValue: realValue,
            paidDate: i.paidDate,
          });
          return;
        }

        // Vencimento: em aberto pelo dueDate; pago somente se paidDate estiver no período.
        if (i.paid) {
          if (!i.paidDate) {
            if (range) return;
          } else if (range) {
            const pd = new Date(i.paidDate + 'T00:00:00');
            if (pd < range.start || pd > range.end) return;
          }
          const realValue = typeof i.paidValue === 'number' ? i.paidValue : i.value;
          total += i.value;
          totalReal += realValue;
          pago += i.value;
          pagoReal += realValue;
          qtd += 1;
          qtdAlunosSet.add(st.id);
          bumpAc(st.ac, i.value, realValue, st.id);
          pushDetail(st, {
            bucket: 'pago',
            installmentNumber: i.number,
            dueDate: i.dueDate,
            value: i.value,
            paidValue: realValue,
            paidDate: i.paidDate,
          });
          return;
        }

        if (isInstallmentExcludedFromFinancialTotals(st, i)) return;
        // Contrato quitado à vista/cartão nunca contribui para o A Vencer,
        // mesmo que alguma parcela conste em aberto por inconsistência.
        if (quitadoAvista) return;

        if (range) {
          const due = new Date(i.dueDate + 'T00:00:00');
          if (due < range.start || due > range.end) return;
        }
        total += i.value;
        totalReal += i.value;
        aVencer += i.value;
        qtd += 1;
        qtdAlunosSet.add(st.id);
        qtdAlunosAVencerSet.add(st.id);
        pushDetail(st, {
          bucket: 'a_vencer',
          installmentNumber: i.number,
          dueDate: i.dueDate,
          value: i.value,
          paidValue: 0,
        });
      });
    });
    const perAcList = Object.entries(perAc)
      .map(([name, b]) => ({ name, pago: b.pago, pagoReal: b.pagoReal, qtd: b.qtd, qtdAlunos: b.alunos.size }))
      .sort((a, b) => b.pagoReal - a.pagoReal);
    return { total, aVencer, pago, totalReal, pagoReal, qtd, qtdAlunos: qtdAlunosSet.size, qtdAlunosAVencer: qtdAlunosAVencerSet.size, perAcList, details };
  };

  // Carteira Total (card azul) = A Vencer / Vencido da projeção (mesmo valor do card laranja).
  const forecastTotaisBase = getForecastTotals();
  // No Liberty, o espelho Kamino segue autoritativo para preservar contratos
  // que ainda não estão completos no GC (a RPC incorpora as baixas do GC como
  // overlay). No IAM, forecastTotaisBase (carteira GC) é a fonte única.
  const activeKaminoTotals = (acFilter || productFilter)
    ? kaminoForecastTotals
    : (kaminoForecastTotals ?? kaminoPortfolioTotals);
  const kaminoTotalsPending = usesKaminoAuthoritativeForecast && !activeKaminoTotals;
  const forecastTotais =
    usesKaminoAuthoritativeForecast && activeKaminoTotals
      ? {
          ...forecastTotaisBase,
          aVencer: activeKaminoTotals.aVencer,
          pago: activeKaminoTotals.pago,
          pagoReal: activeKaminoTotals.pagoReal,
          total: activeKaminoTotals.total,
          totalReal: activeKaminoTotals.aVencer + activeKaminoTotals.pagoReal,
        }
      : forecastTotaisBase;
  const carteiraTotalValue = forecastTotais.aVencer;
  const carteiraTotalAlunos = forecastTotais.qtdAlunosAVencer;

  // ── Leitura diária do card (Extrato do Card) ──────────────────────────────
  // Grava o valor do card "A Vencer / Vencido" uma vez por dia por empresa
  // (atualizando o fechamento a cada leitura), SOMENTE quando o card está na
  // visão canônica: Todos, base vencimento, sem filtros. Alimenta a aba
  // "Extrato do Card" na página Extrato de Conferência.
  const isCanonicalCardView =
    mode === 'performance' &&
    forecastIndex === 0 &&
    dateBasis === 'vencimento' &&
    !acFilter &&
    !productFilter &&
    tagFilters.length === 0 &&
    scoreFilter === null;

  useEffect(() => {
    if (!activeCompanyId || !isCanonicalCardView || kaminoTotalsPending) return;
    if (students.length === 0) return;
    const today = getTodayBrasilia().toISOString().slice(0, 10);
    const key = `${activeCompanyId}|${today}|${carteiraTotalValue.toFixed(2)}|${forecastTotais.pago.toFixed(2)}`;
    if (lastCardSnapshotRef.current === key) return;
    lastCardSnapshotRef.current = key;
    // Detalhamento por aluno (carteira GC): mesmas regras do A Vencer do card.
    // Alimenta o comparativo "O que mudou" na aba Extrato do Card.
    const payload = forecastBase.flatMap((st) => {
      if (isIamConciliadoQuitadoAvista(st)) return [];
      let open = 0;
      st.installments.forEach((i) => {
        if (i.paid) return;
        if (isInstallmentExcludedFromFinancialTotals(st, i)) return;
        open += i.value;
      });
      if (open <= 0.005) return [];
      return [{ id: st.id, name: st.name, open: Math.round(open * 100) / 100 }];
    });
    void upsertCarteiraCardSnapshot({
      companyId: activeCompanyId,
      snapshotDate: today,
      aVencer: carteiraTotalValue,
      pago: forecastTotais.pago,
      qtdAlunos: carteiraTotalAlunos,
      payload,
    }).catch((err) => console.warn('[extrato-card] snapshot:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, isCanonicalCardView, kaminoTotalsPending, carteiraTotalValue, forecastTotais.pago, carteiraTotalAlunos, students.length]);

  // ── Score distribution ────────────────────────────────────────────────────
  // Calculado sobre o MESMO universo que os KPIs/tabela exibem por padrão
  // (exclui Pago, Cancelado e Renda Extra já conciliada quando não há
  // statusFilter ativo). Sem isso, o % mostrava 5★ mas, ao clicar, a carteira
  // ficava vazia porque os 5★ eram todos Pagos.
  const scoreBaseDistribution = (() => {
    if (statusFilter) return acProductFiltered;
    return acProductFiltered.filter((s) => {
      if (s.statusCancelamento === 'cancelado') return false;
      const autoSt = resolveStudentDisplayStatus(s);
      if (autoSt === 'Pago') return false;
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
      return true;
    });
  })();
  const scoreDistribution = (() => {
    const counts: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    scoreBaseDistribution.forEach((s) => {
      const sc = calcularScoreComportamento(s.installments);
      counts[String(sc)] = (counts[String(sc)] || 0) + 1;
    });
    const t = scoreBaseDistribution.length;
    return (v: number) => t > 0 ? Math.round((counts[String(v)] / t) * 100) : 0;
  })();

  // ── Renda Extra metrics ───────────────────────────────────────────────────
  const reStudents = kpiStudents.filter((s) => isRendaExtraAtivo(s));
  const reAcordo = reStudents.filter((s) => s.rendaExtraStatus === 'Acordo Feito');
  const rePct = reStudents.length > 0 ? Math.round((reAcordo.length / reStudents.length) * 100) : 0;

  // Pedidos do período × revertidos entre eles (mesma lógica da aba Cancelamentos).
  const revertPct = acCases.length > 0 ? Math.round((revertidos.length / acCases.length) * 100) : 0;
  const revertidosValue = revertidos.reduce((acc, c) => acc + (c.value ?? 0), 0);

  // ── Pie chart ─────────────────────────────────────────────────────────────
  const pago = kpiStudents.filter((s) => s.status === 'Pago');
  const pagoValue = sumUnpaid(pago);
  const pieRaw = [
    { name: 'Em Dia', value: emDia.length, valor: emDiaValue },
    { name: 'Vencido 1', value: vencido1.length, valor: v1Value },
    { name: 'Vencido 2', value: vencido2.length, valor: v2Value },
    { name: 'À Negativar', value: aNegativar.length, valor: anValue },
    { name: 'Negativado', value: negativado.length, valor: negValue },
    { name: 'Pago', value: pago.length, valor: pagoValue },
  ].filter((d) => d.value > 0);
  const pieTotal = pieRaw.reduce((a, b) => a + b.value, 0);
  const pieData = pieRaw.map((d) => ({
    ...d,
    percent: pieTotal > 0 ? (d.value / pieTotal) * 100 : 0,
  }));

  // ── Cartesian chart (evolution) ───────────────────────────────────────────
  const [cartesianData, setCartesianData] = useState<any[]>([]);
  useEffect(() => {
    // Determina range de meses (start..end inclusivos) com base no filtro do bloco
    const today = getTodayBrasilia();
    let startDate: Date;
    let endDate: Date;
    if (evolPreset === 'custom' && evolCustomStart && evolCustomEnd) {
      const [sy, sm] = evolCustomStart.split('-').map(Number);
      const [ey, em] = evolCustomEnd.split('-').map(Number);
      startDate = new Date(sy, sm - 1, 1);
      endDate = new Date(ey, em - 1, 1);
      if (endDate < startDate) endDate = startDate;
    } else {
      const monthsBack = evolPreset === '3m' ? 3 : evolPreset === '12m' ? 12 : 6;
      endDate = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = new Date(today.getFullYear(), today.getMonth() - (monthsBack - 1), 1);
    }
    const months: any[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const label = cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      const entry: any = { month: label, 'Em Dia': 0, 'Vencido 1': 0, 'Vencido 2': 0, 'À Negativar': 0, 'Negativado': 0 };
      baseStudents.forEach((s) => {
        s.installments.forEach((inst) => {
          if (inst.dueDate.startsWith(monthKey)) {
            const finVal = getInstallmentFinancialValueExport(inst);
            if (inst.paid) entry['Em Dia'] += finVal;
            else entry[s.status] = (entry[s.status] || 0) + finVal;
          }
        });
      });
      months.push(entry);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    setCartesianData(months);
  }, [baseStudents.length, acFilter, productFilter, scoreFilter, tagFilters, students, evolPreset, evolCustomStart, evolCustomEnd]);

  // ── Relatório (snapshot dos KPIs importantes) ─────────────────────────────
  const reportContextLines = (() => {
    const lines: string[] = [];
    lines.push(`Modo: ${mode === 'historico' ? 'Histórico' : 'Performance'}`);
    if (mode === 'historico') {
      lines.push(`Período: ${historicoStart || '—'} → ${historicoEnd || '—'}`);
    } else if (perfPreset !== 'todos') {
      const r = getPerfRange(perfPreset, perfCustomStart, perfCustomEnd);
      lines.push(
        `Filtro Performance: ${perfPreset} (${r.start.toLocaleDateString('pt-BR')} – ${r.end.toLocaleDateString('pt-BR')})`,
      );
    } else {
      lines.push('Período: todos (carteira ao vivo)');
    }
    if (acFilter) lines.push(`Assessor: ${acFilter}`);
    if (productFilter) lines.push(`Produto: ${productFilter}`);
    if (scoreFilter !== null) lines.push(`Score: ${scoreFilter === 0 ? 'Novo' : `${scoreFilter}★`}`);
    if (tagFilters.length > 0) {
      const names = tagFilters
        .map((id) => studentTags.find((t) => t.id === id)?.name ?? id)
        .join(', ');
      lines.push(`Tags: ${names}`);
    }
    return lines;
  })();

  const reportSections: DashboardReportSection[] = [
    {
      title: 'Carteira',
      kpis: [
        {
          label: 'Carteira Total',
          value: formatCurrency(carteiraTotalValue),
          detail: `${carteiraTotalAlunos} alunos · a vencer / vencido no período`,
          tone: 'default',
        },
        {
          label: 'Em Dia + Novos',
          value: formatCurrency(emDiaValue + alunosNovosValue),
          detail: `${emDia.length + alunosNovos.length} alunos · ${pct(emDia.length + alunosNovos.length)}%`,
          tone: 'good',
        },
        {
          label: 'Em Dia',
          value: formatCurrency(emDiaValue),
          detail: `${emDia.length} alunos · Taxa ${pctEmDia}%`,
          tone: 'good',
        },
        {
          label: 'Alunos Novos',
          value: formatCurrency(alunosNovosValue),
          detail: `${alunosNovos.length} alunos · ${pct(alunosNovos.length)}%`,
        },
        {
          label: 'Taxa Em Dia',
          value: `${pctEmDia}%`,
          detail: `${emDia.length} de ${totalComposicao}`,
          tone: 'good',
        },
        {
          label: 'Taxa Inadimplente',
          value: `${pctInadimplente}%`,
          detail: `${inadimplentes} de ${totalComposicao}`,
          tone: 'bad',
        },
      ],
    },
    {
      title: 'Inadimplência',
      kpis: [
        {
          label: 'Vencido 1',
          value: formatCurrency(v1Value),
          detail: `${vencido1.length} alunos · ${pct(vencido1.length)}%`,
          tone: 'warn',
        },
        {
          label: 'Vencido 2',
          value: formatCurrency(v2Value),
          detail: `${vencido2.length} alunos · ${pct(vencido2.length)}%`,
          tone: 'warn',
        },
        {
          label: 'À Negativar',
          value: formatCurrency(anValue),
          detail: `${aNegativar.length} alunos · ${pct(aNegativar.length)}%`,
          tone: 'bad',
        },
        {
          label: 'Negativado',
          value: formatCurrency(negValue),
          detail: `${negativado.length} alunos · ${pct(negativado.length)}%`,
          tone: 'bad',
        },
      ],
    },
    {
      title: 'Cancelamentos & Extra',
      kpis: [
        {
          label: 'Solicitação Cancelamento',
          value: formatCurrency(solicCancValue),
          detail: `${solicitacaoCancelamento.length} alunos · ${
            kpiStudents.length > 0
              ? ((solicitacaoCancelamento.length / kpiStudents.length) * 100).toFixed(1)
              : '0.0'
          }%`,
          tone: 'accent',
        },
        {
          label: 'Revertidos',
          value: `${revertPct}%`,
          detail: `${revertidos.length}/${acCases.length} pedidos · ${formatCurrency(revertidosValue)}`,
          tone: 'good',
        },
        {
          label: 'Pendências',
          value: formatCurrency(pendenteValue),
          detail: `${pendentes.length} alunos · pagamento fora boleto`,
          tone: 'warn',
        },
        {
          label: 'Renda Extra',
          value: `${rePct}%`,
          detail: `${reAcordo.length}/${reStudents.length} com acordo`,
          tone: 'accent',
        },
        {
          label: 'Média pagamento',
          value: mediaCarteira === null ? '—' : `${mediaCarteira < 0 ? '' : '+'}${mediaCarteira}d`,
          detail:
            mediaCarteira === null
              ? 'Sem dados'
              : mediaCarteira < 0
                ? 'antecipado'
                : mediaCarteira === 0
                  ? 'no prazo'
                  : 'de atraso',
        },
      ],
    },
  ];

  if (tagKpis.length > 0) {
    reportSections.push({
      title: 'Tags (parcelas)',
      kpis: tagKpis.map((t) => ({
        label: t.label,
        value: formatCurrency(t.value),
        detail: `${t.count} alunos${t.overdueValue > 0 ? ` · Vencido ${formatCurrency(t.overdueValue)}` : ''}`,
      })),
    });
  }

  // Ranking liquidez (top 5) — mesmo universo do card
  const rankingStudents = studentsForAcRanking(
    kpiStudents,
    getHiddenFromAcPortfolioKeys(cancellationCases, conciliacaoItems, students),
    students,
  );
  const rankingRows = acs
    .filter((ac) => ac.active)
    .map((ac) => {
      const list = rankingStudents.filter((s) => s.ac === ac.name);
      const novos = list.filter((s) => s.status === 'Aluno Novo' && !isSolicitacaoCancelamento(s)).length;
      const emDiaAc = list.filter((s) => s.status === 'Em Dia' && !isSolicitacaoCancelamento(s)).length;
      const inadAc = list.filter(
        (s) =>
          !isSolicitacaoCancelamento(s) &&
          (s.status === 'Vencido 1' ||
            s.status === 'Vencido 2' ||
            s.status === 'À Negativar' ||
            s.status === 'Negativado'),
      ).length;
      const denom = novos + emDiaAc + inadAc;
      const rate = denom > 0 ? (emDiaAc / denom) * 100 : 0;
      return { name: ac.name, emDia: emDiaAc, denom, rate };
    })
    .filter((r) => r.denom > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  if (rankingRows.length > 0) {
    reportSections.push({
      title: 'Ranking Taxa Em Dia (Top 5)',
      kpis: rankingRows.map((r, i) => ({
        label: `${i + 1}º ${r.name}`,
        value: `${r.rate.toFixed(1).replace('.', ',')}%`,
        detail: `${r.emDia} / ${r.denom} alunos`,
        tone: i === 0 ? 'good' : 'default',
      })),
    });
  }

  const reportGeneratedAt = new Date().toLocaleString('pt-BR');

  return (
    <div className="space-y-3">

      {/* ── 1. Modo de Análise + Relatório ──────────────────────────────────── */}
      {/* No desktop estes controles ficam no cabeçalho, ao lado do seletor de
          empresa; abaixo de sm eles seguem aqui, onde há espaço. */}
      <HeaderActions>
        <AnalysisModeToggle mode={mode} setMode={setMode} />
        <BotaoRelatorio onClick={() => setReportOpen(true)} />
      </HeaderActions>

      {/* ── 0. Cabeçalho de saúde da carteira ───────────────────────────────── */}
      {/* Esquerda: velocímetro da meta mensal de Taxa em Dia (mesmo componente
          da Carteira do Assessor, com a meta gravada em financial_rules).
          Centro: card "Em Dia + Novos" do MÊS ATUAL, com fita (ponteiro = agora;
          marca = início do mês, refeita quando o mês vira). O card homônimo da
          linha de KPIs abaixo continua igual.
          Direita: Taxa Em Dia e Taxa Inadimplente empilhados. */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_minmax(180px,220px)] gap-2.5 sm:gap-3 items-stretch">
        <div className="hidden sm:flex items-center justify-center rounded-2xl bg-card border border-border saas-shadow-md px-3 py-2">
          <MetaTaxaEmDiaHeader
            taxaAtual={Number(pctEmDia)}
            meta={rules.metaTaxaEmDia}
            metaPadrao={rules.meta1}
            base={rules.metaTaxaEmDiaBase}
            definidaEm={rules.metaTaxaEmDiaEm}
            titulo="Dashboard geral"
            canEdit={currentUser?.role === 'admin'}
            temDados={totalComposicao > 0}
            onSave={({ meta, base, definidaEm }) =>
              setRules({
                ...(meta != null ? { metaTaxaEmDia: meta } : {}),
                metaTaxaEmDiaBase: base,
                metaTaxaEmDiaEm: definidaEm,
              })}
          />
        </div>

        <div
          onClick={() => setKpiModalKey('emdia_novos')}
          className="min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-teal-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-teal-500/30 flex flex-col"
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">
              Em Dia + Novos · {mesAtualLabel}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <NaoSomaBadge title='Mesma composição do card "Em Dia + Novos" abaixo (Em Dia + Alunos Novos). Este card só acompanha a evolução no mês.' />
              <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'emdia_novos_mes' ? null : 'emdia_novos_mes'); }} className="text-muted-foreground/50 hover:text-muted-foreground">
                <Info size={14} />
              </button>
            </div>
          </div>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="kpi-value text-teal-600" title={formatCurrency(emDiaValue + alunosNovosValue)}>
                <span className="hidden sm:inline">{formatCurrency(emDiaValue + alunosNovosValue)}</span>
                <span className="sm:hidden">{formatCurrencyCompact(emDiaValue + alunosNovosValue)}</span>
              </p>
              <p className="text-[11px] text-muted-foreground truncate mt-1">{emDia.length + alunosNovos.length} alunos</p>
            </div>
            <p className="text-sm font-bold text-teal-600 shrink-0">{pctEmDiaNovos}%</p>
          </div>
          <div className="mt-auto pt-2">
            <RibbonGauge
              value={Number(pctEmDiaNovos)}
              baseline={emDiaNovosBaseAtual}
              baselineLabel="Início do mês"
              ticks={[0, 25, 50, 75, 100]}
              pointerColor="#0d9488"
            />
          </div>
          {infoStatus === 'emdia_novos_mes' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Participação de "Em Dia + Novos" na carteira ao longo de {mesAtualLabel}. O ponteiro mostra o valor
                de agora; a marca tracejada é o valor registrado no início do mês
                {emDiaNovosBaseAtual != null ? ` (${emDiaNovosBaseAtual.toFixed(1).replace('.', ',')}%)` : ''}.
                Quando o mês vira, a marca é refeita automaticamente.
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 sm:gap-3">
          <div className="min-w-0 rounded-2xl p-3 sm:p-4 saas-shadow-md bg-emerald-500 border border-emerald-600 transition-transform hover:-translate-y-0.5">
            <div className="flex items-start justify-between mb-2 gap-2">
              <p className="text-[10px] font-semibold text-white/70 uppercase truncate">Taxa Em Dia</p>
              <TrendingUp size={16} className="text-white/50 shrink-0" />
            </div>
            <p className="kpi-value text-white">{pctEmDia}%</p>
            <p className="text-[11px] text-white/60 mt-1 truncate">{emDia.length} de {totalComposicao}</p>
          </div>
          <div className="min-w-0 rounded-2xl p-3 sm:p-4 saas-shadow-md bg-red-500 border border-red-600 transition-transform hover:-translate-y-0.5">
            <div className="flex items-start justify-between mb-2 gap-2">
              <p className="text-[10px] font-semibold text-white/70 uppercase truncate">Taxa Inadimplente</p>
              <TrendingDown size={16} className="text-white/50 shrink-0" />
            </div>
            <p className="kpi-value text-white">{pctInadimplente}%</p>
            <p className="text-[11px] text-white/60 mt-1 truncate">{inadimplentes} de {totalComposicao}</p>
          </div>
        </div>
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${mode === 'performance' ? 'sm:hidden' : ''}`}>
        <div className="flex-1 min-w-[260px]">
          <DashDateFilter
            mode={mode} setMode={setMode}
            perfPreset={perfPreset} setPerfPreset={setPerfPreset}
            perfCustomStart={perfCustomStart} setPerfCustomStart={setPerfCustomStart}
            perfCustomEnd={perfCustomEnd} setPerfCustomEnd={setPerfCustomEnd}
            historicoStart={historicoStart} setHistoricoStart={setHistoricoStart}
            historicoEnd={historicoEnd} setHistoricoEnd={setHistoricoEnd}
            variant="ac"
            hidePerformancePresets
            moveModeToHeader
          />
        </div>
        <BotaoRelatorio onClick={() => setReportOpen(true)} className="sm:hidden" />
      </div>
      {/* ── 2. Previsão de Recebimento + Filtros (Performance) ──────────────── */}
      {mode === 'performance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Previsão de Recebimento */}
          <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Wallet size={15} className="text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  {dateBasis === 'vencimento' ? 'Data de Vencimento' : 'Data de Pagamento'}
                </h3>
              </div>
              <div className="inline-flex rounded-lg bg-muted p-0.5">
                <button
                  onClick={() => { setDateBasis('vencimento'); setForecastIndex(0); }}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                    dateBasis === 'vencimento' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Vencimento
                </button>
                <button
                  onClick={() => { setDateBasis('pagamento'); setForecastIndex(6); }}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                    dateBasis === 'pagamento' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  DATA DE PAGAMENTO
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {dateBasis === 'vencimento'
                ? `Projeção financeira por período ${acFilter ? `(${acFilter})` : usesKaminoAuthoritativeForecast ? '(fonte Kamino + baixas GC)' : '(carteira GC)'}`
                : `Títulos pagos no período ${acFilter ? `(${acFilter})` : '(carteira GC)'}`}
            </p>
            <div className="flex gap-1 mb-2 flex-wrap items-center">
              {dateBasis === 'vencimento' &&
                ['Todos', 'Hoje', 'Amanhã', '2 Dias', '3 Dias', '5 Dias', 'Personalizado'].map((p, i) => (
                  <button
                    key={p}
                    onClick={() => setForecastIndex(i)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                      forecastIndex === i
                        ? 'iam-gradient text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              {(forecastIndex === 6 || dateBasis === 'pagamento') && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-[10px] text-muted-foreground">Início:</span>
                  <input type="date" value={forecastCustomStart} onChange={(e) => setForecastCustomStart(e.target.value)} className="input-field text-xs py-1 px-2 w-32" />
                  <span className="text-[10px] text-muted-foreground ml-1">Fim:</span>
                  <input type="date" value={forecastCustomEnd} onChange={(e) => setForecastCustomEnd(e.target.value)} className="input-field text-xs py-1 px-2 w-32" />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  const periodLabels = ['Todos', 'Hoje', 'Amanhã', '2 Dias', '3 Dias', '5 Dias', 'Personalizado'];
                  const periodLabel =
                    dateBasis === 'pagamento' || forecastIndex === 6
                      ? `Personalizado ${forecastCustomStart || '…'} a ${forecastCustomEnd || '…'}`
                      : periodLabels[forecastIndex] || 'Todos';
                  const rows = forecastTotaisBase.details;
                  if (!rows.length) {
                    toast.message('Nenhum registro para exportar no período selecionado.');
                    return;
                  }
                  try {
                    exportForecastSpreadsheet(rows, {
                      dateBasis,
                      periodLabel,
                      filePrefix: 'dashboard-projecao',
                    });
                    toast.success('Planilha exportada com sucesso.');
                  } catch (err) {
                    console.error(err);
                    toast.error('Não foi possível exportar a planilha.');
                  }
                }}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold border border-border bg-card text-foreground hover:bg-muted transition-colors"
                title="Exportar A Vencer/Vencido e Pago em planilha"
              >
                <Download size={12} />
                Exportar planilha
              </button>
            </div>
            {(() => {
              const { total, aVencer, pago, pagoReal, qtd, qtdAlunos, perAcList, details } = forecastTotais;
              if (dateBasis === 'pagamento') {
                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentDetailModal('pago')}
                        className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0 text-left hover:bg-emerald-100/60 hover:border-emerald-300 transition-all cursor-pointer"
                      >
                        <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Total Pago</p>
                        <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pago)}>
                          {formatCurrency(pago)}
                        </p>
                        <p className="text-[10px] text-emerald-700/80 mt-0">valor original · clique p/ detalhes</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentDetailModal('recebido')}
                        className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0 text-left hover:bg-emerald-100/60 hover:border-emerald-300 transition-all cursor-pointer"
                      >
                        <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Valor Recebido</p>
                        <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pagoReal)}>
                          {formatCurrency(pagoReal)}
                        </p>
                        <p className="text-[10px] text-emerald-700/80 mt-0">valor efetivamente pago · clique p/ detalhes</p>
                      </button>
                      <div className="kpi-fit rounded-xl border border-border bg-muted/30 p-2 min-w-0">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Qtd Títulos</p>
                        <p className="kpi-value-fit text-foreground mt-0.5">{qtd}</p>
                        <p className="text-[10px] text-muted-foreground mt-0">
                          {qtdAlunos} {qtdAlunos === 1 ? 'aluno' : 'alunos'} · {qtd} parcelas
                        </p>
                      </div>
                    </div>
                    {paymentDetailModal && (
                      <PaymentDetailsModal
                        mode={paymentDetailModal}
                        details={details}
                        totalPago={pago}
                        totalRecebido={pagoReal}
                        onClose={() => setPaymentDetailModal(null)}
                      />
                    )}
                    {perAcList.length > 0 && (
                      <div className="mt-3 rounded-xl border border-border bg-muted/20 overflow-hidden">
                        <div className="px-3 py-2 border-b border-border bg-muted/40">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Por Assessor
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                <th className="text-left font-semibold px-3 py-1.5">Assessor</th>
                                <th className="text-right font-semibold px-3 py-1.5">Total Pago</th>
                                <th className="text-right font-semibold px-3 py-1.5">Valor Recebido</th>
                                <th className="text-right font-semibold px-3 py-1.5">Alunos</th>
                                <th className="text-right font-semibold px-3 py-1.5">Parcelas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {perAcList.map((row) => (
                                <tr key={row.name} className="border-t border-border/60">
                                  <td className="px-3 py-1.5 font-medium text-foreground">{row.name}</td>
                                  <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold tabular-nums">{formatCurrency(row.pago)}</td>
                                  <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold tabular-nums">{formatCurrency(row.pagoReal)}</td>
                                  <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">{row.qtdAlunos}</td>
                                  <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">{row.qtd}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                );
              }

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="kpi-fit rounded-xl border border-amber-200/60 bg-amber-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">A Vencer / Vencido</p>
                    <p className="kpi-value-fit text-amber-700 mt-0.5" title={kaminoTotalsPending ? 'Carregando totais Kamino…' : formatCurrency(aVencer)}>
                      {kaminoTotalsPending ? '…' : formatCurrency(aVencer)}
                    </p>
                  </div>
                  <div className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Pago</p>
                    <p className="kpi-value-fit text-emerald-700 mt-0.5" title={kaminoTotalsPending ? 'Carregando totais Kamino…' : formatCurrency(pago)}>
                      {kaminoTotalsPending ? '…' : formatCurrency(pago)}
                    </p>
                    <p className="text-[10px] font-semibold text-emerald-700 mt-0">
                      boletos, entradas e demais recebimentos
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Filtros: AC, Produto, Status, Score */}
          <div className="bg-card border border-border rounded-2xl p-4 saas-shadow flex flex-col gap-2">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Filtros</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Assessor:</span>
              <select className="input-field text-xs py-1.5" value={acFilter} onChange={(e) => setAcFilter(e.target.value)}>
                <option value="">Todos</option>
                {acs.filter((g) => g.active).map((g) => (
                  <option key={g.id} value={g.name}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Produto:</span>
              <select className="input-field text-xs py-1.5" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
                <option value="">Todos</option>
                {products.map((p) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">Status:</span>
              <select className="input-field text-xs py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StudentStatus | 'cancelamento_solicitado' | '')}>
                <option value="">Todos</option>
                <option value="Aluno Novo">Aluno Novo</option>
                <option value="Em Dia">Em Dia</option>
                <option value="Vencido 1">Vencido 1</option>
                <option value="Vencido 2">Vencido 2</option>
                <option value="À Negativar">À Negativar</option>
                <option value="Negativado">Negativado</option>
                <option value="Em Negociação">Em Negociação</option>
                <option value="cancelamento_solicitado">Cancelamento solicitado</option>
                <option value="Pago">Pago</option>
                <option value="Excluído">Excluído</option>
                <option value="Pendente">Pendente</option>
              </select>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Star size={11} className="text-amber-400 fill-amber-400" />
              <span className="text-[10px] text-muted-foreground mr-1">Score:</span>
              {[null, 0, 1, 2, 3, 4, 5].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setScoreFilter(v)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                    scoreFilter === v ? 'bg-amber-400 text-white font-semibold' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {v === null ? 'Todos' : v === 0 ? `N ${scoreDistribution(0)}%` : `${v}★ ${scoreDistribution(v)}%`}
                </button>
              ))}
            </div>
            <TagMultiSelect studentTags={studentTags} tagFilters={tagFilters} setTagFilters={setTagFilters} />
          </div>
        </div>
      )}

      {/* Histórico banner */}
      {mode === 'historico' && !historicoEnd && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <Clock size={14} className="text-amber-600 shrink-0" />
          <span>Selecione um período de referência para reconstruir a carteira.</span>
        </div>
      )}
      {mode === 'historico' && historicoEnd && snapshotKind === 'frozen' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <Camera size={14} className="text-emerald-600 shrink-0" />
          <span>
            Foto congelada de{' '}
            <strong>{new Date(historicoEnd + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
            {snapshotLoading ? ' (carregando…)' : ' — os números deste dia não mudam ao reabrir.'}
          </span>
        </div>
      )}
      {mode === 'historico' && historicoEnd && snapshotKind === 'missing' && !snapshotLoading && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <Clock size={14} className="text-amber-600 shrink-0" />
          <span>
            Sem foto salva para{' '}
            <strong>{new Date(historicoEnd + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
            . Exibindo estimativa a partir dos dados atuais — pode diferir do que apareceu naquele dia.
          </span>
        </div>
      )}
      {mode === 'historico' && historicoEnd && snapshotKind === 'live' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800">
          <Activity size={14} className="text-sky-600 shrink-0" />
          <span>
            Dia em aberto (hoje ou futuro): números ao vivo. A foto deste dia só fecha após a meia-noite.
          </span>
        </div>
      )}

      {/* Filtros no modo Histórico */}
      {mode === 'historico' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Assessor:</span>
            <select className="input-field text-xs py-1.5" value={acFilter} onChange={(e) => setAcFilter(e.target.value)}>
              <option value="">Todos</option>
              {acs.filter((g) => g.active).map((g) => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Produto:</span>
            <select className="input-field text-xs py-1.5" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">Todos</option>
              {products.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Status:</span>
            <select className="input-field text-xs py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StudentStatus | 'cancelamento_solicitado' | '')}>
              <option value="">Todos</option>
              <option value="Aluno Novo">Aluno Novo</option>
              <option value="Em Dia">Em Dia</option>
              <option value="Vencido 1">Vencido 1</option>
              <option value="Vencido 2">Vencido 2</option>
              <option value="À Negativar">À Negativar</option>
              <option value="Negativado">Negativado</option>
              <option value="Em Negociação">Em Negociação</option>
              <option value="cancelamento_solicitado">Cancelamento solicitado</option>
              <option value="Pago">Pago</option>
              <option value="Excluído">Excluído</option>
              <option value="Pendente">Pendente</option>
            </select>
          </div>
          <div className="flex items-center gap-1 bg-card border border-border rounded-xl px-3 py-2 saas-shadow">
            <Star size={11} className="text-amber-400 fill-amber-400" />
            <span className="text-[10px] text-muted-foreground mr-1">Score:</span>
            {[null, 0, 1, 2, 3, 4, 5].map((v) => (
              <button
                key={String(v)}
                onClick={() => setScoreFilter(v)}
                className={`text-[10px] px-2 py-0.5 rounded transition-all ${
                  scoreFilter === v ? 'bg-amber-400 text-white font-semibold' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {v === null ? 'Todos' : v === 0 ? `N ${scoreDistribution(0)}%` : `${v}★ ${scoreDistribution(v)}%`}
              </button>
            ))}
          </div>
          <TagMultiSelect studentTags={studentTags} tagFilters={tagFilters} setTagFilters={setTagFilters} />
        </div>
      )}

      {/* ── 3. Indicadores (KPIs Row 1) ──────────────────────────────────────── */}
      {/* Cards clicáveis: abrem a lista detalhada de alunos/parcelas em popup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        <div
          onClick={() => setKpiModalKey('total')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-primary transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/30 ${statusFilter === '' ? 'ring-2 ring-primary/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase">Carteira Total</p>
            <Users size={16} className="text-primary/50 shrink-0" />
          </div>
          <p className="kpi-value text-primary" title={formatCurrency(carteiraTotalValue)}>
            <span className="hidden sm:inline">{formatCurrency(carteiraTotalValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(carteiraTotalValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p
              className="text-[11px] text-muted-foreground truncate"
              title={
                solicCancQuitados > 0
                  ? `${carteiraTotalAlunos} alunos com parcela em aberto + ${solicCancQuitados} com contrato quitado aguardando fechamento do cancelamento (R$ 0,00). Soma dos cards de status: ${carteiraTotalAlunos + solicCancQuitados}.`
                  : undefined
              }
            >
              {carteiraTotalAlunos} alunos
              {solicCancQuitados > 0 && (
                <span className="text-muted-foreground/80"> + {solicCancQuitados} quitados em cancelamento</span>
              )}
            </p>
            <p className="text-[11px] font-semibold text-primary shrink-0">100%</p>
          </div>
        </div>

        {/* Em Dia + Novos — soma agregada */}
        <div
          onClick={() => setKpiModalKey('emdia_novos')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-teal-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-teal-500/30 ${statusFilter === 'Em Dia' ? 'ring-2 ring-teal-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Em Dia + Novos</p>
            <div className="flex items-center gap-1 shrink-0">
              <NaoSomaBadge title='Composição dos cards "Em Dia" e "Alunos Novos" ao lado. Somar os três conta os mesmos alunos duas vezes.' />
              <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'emdia_novos' ? null : 'emdia_novos'); }} className="text-muted-foreground/50 hover:text-muted-foreground">
                <Info size={14} />
              </button>
            </div>
          </div>
          <p className="kpi-value text-teal-600" title={formatCurrency(emDiaValue + alunosNovosValue)}>
            <span className="hidden sm:inline">{formatCurrency(emDiaValue + alunosNovosValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(emDiaValue + alunosNovosValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">{emDia.length + alunosNovos.length} alunos</p>
            <p className="text-[11px] font-semibold text-teal-600 shrink-0">{pct(emDia.length + alunosNovos.length)}%</p>
          </div>
          {infoStatus === 'emdia_novos' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Soma de "Em Dia" + "Alunos Novos": alunos adimplentes da carteira (sem parcelas vencidas).
                É a composição dos dois cards ao lado — não deve ser somada junto com eles.
              </p>
            </div>
          )}
        </div>

        <div
          onClick={() => setKpiModalKey('emdia')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-emerald-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-emerald-500/30 ${statusFilter === 'Em Dia' ? 'ring-2 ring-emerald-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Em Dia</p>
            <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'emdia' ? null : 'emdia'); }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <Info size={14} />
            </button>
          </div>
          <p className="kpi-value text-emerald-600" title={formatCurrency(emDiaValue)}>
            <span className="hidden sm:inline">{formatCurrency(emDiaValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(emDiaValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">{emDia.length} alunos</p>
            <p className="text-[11px] font-semibold text-emerald-600 shrink-0">{pctEmDia}%</p>
          </div>
          {infoStatus === 'emdia' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>Alunos com todas as parcelas em dia, sem nenhum vencimento pendente.</p>
            </div>
          )}
        </div>

        <div
          onClick={() => setKpiModalKey('novos')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-sky-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-sky-500/30 ${statusFilter === 'Aluno Novo' ? 'ring-2 ring-sky-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Alunos Novos</p>
            <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'novos' ? null : 'novos'); }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <Info size={14} />
            </button>
          </div>
          <p className="kpi-value text-sky-600" title={formatCurrency(alunosNovosValue)}>
            <span className="hidden sm:inline">{formatCurrency(alunosNovosValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(alunosNovosValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">{alunosNovos.length} alunos</p>
            <p className="text-[11px] font-semibold text-sky-600 shrink-0">{pct(alunosNovos.length)}%</p>
          </div>
          {infoStatus === 'novos' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>Alunos recém cadastrados que ainda não possuem parcelas vencidas.</p>
            </div>
          )}
        </div>

      </div>

      {/* ── Indicadores Row 2 ────────────────────────────────────────────────── */}
      {/* Ordem: Vencido 1 → Vencido 2 → À Negativar → Negativado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        {[
          { key: 'v1', label: 'Vencido 1', value: v1Value, count: vencido1.length, color: 'amber-500', text: 'text-amber-600', desc: 'Alunos com parcelas vencidas entre 1 e 30 dias.', filter: 'Vencido 1' as StudentStatus },
          { key: 'v2', label: 'Vencido 2', value: v2Value, count: vencido2.length, color: 'red-500', text: 'text-red-600', desc: 'Alunos com parcelas vencidas entre 31 e 60 dias.', filter: 'Vencido 2' as StudentStatus },
          { key: 'an', label: 'À Negativar', value: anValue, count: aNegativar.length, color: 'slate-400', text: 'text-slate-500', desc: 'Alunos que precisam ser negativados manualmente nos órgãos de crédito. Após realizar a negativação manual, mude o status do aluno manualmente para "Negativado".', filter: 'À Negativar' as StudentStatus },
          { key: 'neg', label: 'Negativado', value: negValue, count: negativado.length, color: 'slate-400', text: 'text-slate-500', desc: 'Alunos já negativados nos órgãos de crédito.', filter: 'Negativado' as StudentStatus },
        ].map(({ key, label, value, count, color, text, desc, filter }) => {
          const isStaleAN = key === 'an' && aNegativarStale;
          const cardCls = isStaleAN
            ? `min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-red-500 border border-red-600 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-red-400/40 ${statusFilter === filter ? 'ring-2 ring-white/50' : ''}`
            : `min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-${color} transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-foreground/20 ${statusFilter === filter ? 'ring-2 ring-foreground/40' : ''}`;
          const labelCls = isStaleAN ? 'text-[10px] font-semibold text-white/80 uppercase truncate' : 'text-[10px] font-semibold text-muted-foreground uppercase truncate';
          const valueCls = isStaleAN ? 'kpi-value text-white' : `kpi-value ${text}`;
          const subCls = isStaleAN ? 'text-[11px] text-white/80 truncate' : 'text-[11px] text-muted-foreground truncate';
          const pctCls = isStaleAN ? 'text-[11px] font-semibold text-white shrink-0' : `text-[11px] font-semibold ${text} shrink-0`;
          return (
            <div
              key={key}
              onClick={() => setKpiModalKey(key as KpiModalKey)}
              className={cardCls}
            >
              <div className="flex items-start justify-between mb-2 gap-2">
                <p className={labelCls}>{label}{isStaleAN ? ' • +5d' : ''}</p>
                <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === key ? null : key); }} className={isStaleAN ? 'text-white/70 hover:text-white shrink-0' : 'text-muted-foreground/50 hover:text-muted-foreground shrink-0'}>
                  <Info size={14} />
                </button>
              </div>
              <p className={valueCls} title={formatCurrency(value)}>
                <span className="hidden sm:inline">{formatCurrency(value)}</span>
                <span className="sm:hidden">{formatCurrencyCompact(value)}</span>
              </p>
              <div className="flex items-center justify-between mt-1 gap-2">
                <p className={subCls}>{count} alunos</p>
                <p className={pctCls}>{pct(count)}%</p>
              </div>
              {infoStatus === key && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
                  <p>{desc}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── KPIs: Solicitação + Pendências + Revertidos + Fundo/TMF ─────────── */}
      {/* Colunas = nº de cards da linha, para preencher a largura sem sobra à direita. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 ${tagKpis[0] ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        <div
          onClick={() => setKpiModalKey('solic')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-fuchsia-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-fuchsia-500/30 ${kpiModalKey === 'solic' || statusFilter === 'cancelamento_solicitado' ? 'ring-2 ring-fuchsia-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Solicitação Cancelamento</p>
            <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'solic' ? null : 'solic'); }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <Info size={14} />
            </button>
          </div>
          <p className="kpi-value text-fuchsia-600" title={formatCurrency(solicCancValue)}>
            <span className="hidden sm:inline">{formatCurrency(solicCancValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(solicCancValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">
              {solicitacaoCancelamento.length} alunos
              {solicCancQuitados > 0 && ` · ${solicCancQuitados} quitados`}
            </p>
            <p className="text-[11px] font-semibold text-fuchsia-600 shrink-0">
              {kpiStudents.length > 0
                ? ((solicitacaoCancelamento.length / kpiStudents.length) * 100).toFixed(1)
                : '0.0'}%
            </p>
          </div>
          {infoStatus === 'solic' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Alunos que solicitaram cancelamento e estão em tratativa no funil. O valor sai do status anterior (Em Dia/Vencido/etc.) e passa a compor este indicador até reversão ou cancelamento definitivo.
                {solicCancQuitados > 0 && ` ${solicCancQuitados} já estão com o contrato quitado: seguem aqui até o caso fechar, somam R$ 0,00 no valor e não entram na Carteira Total.`}
              </p>
            </div>
          )}
        </div>

        <div
          onClick={() => setKpiModalKey('pendente')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-yellow-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-yellow-500/30 ${kpiModalKey === 'pendente' || statusFilter === 'Pendente' ? 'ring-2 ring-yellow-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Pendências</p>
            <div className="flex items-center gap-1 shrink-0">
              <AlertTriangle size={14} className="text-yellow-600/70" />
              <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'pendente' ? null : 'pendente'); }} className="text-muted-foreground/50 hover:text-muted-foreground">
                <Info size={14} />
              </button>
            </div>
          </div>
          <p className="kpi-value text-yellow-700" title={formatCurrency(pendenteValue)}>
            <span className="hidden sm:inline">{formatCurrency(pendenteValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(pendenteValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">{pendentes.length} alunos</p>
            <p className="text-[11px] font-semibold text-yellow-700 shrink-0">{pctCarteira(pendentes.length)}%</p>
          </div>
          {infoStatus === 'pendente' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Pendência de pagamento fora de boleto (PIX, link, cartão, etc.).
                Pagamentos de boleto não entram neste indicador — permanecem em Em Dia / Vencido / À Negativar.
              </p>
            </div>
          )}
        </div>

        <div
          onClick={() => setKpiModalKey(kpiModalKey === 'revertidos' ? null : 'revertidos')}
          className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 border-l-emerald-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-emerald-500/30 ${kpiModalKey === 'revertidos' ? 'ring-2 ring-emerald-500/40' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Revertidos</p>
            <div className="flex items-center gap-1 shrink-0">
              <NaoSomaBadge title="Conta pedidos de cancelamento revertidos, não alunos da carteira. Unidade diferente dos demais cards." />
              <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'revertidos' ? null : 'revertidos'); }} className="text-muted-foreground/50 hover:text-muted-foreground">
                <Info size={14} />
              </button>
            </div>
          </div>
          <p className="kpi-value text-emerald-600" title={formatCurrency(revertidosValue)}>
            <span className="hidden sm:inline">{formatCurrency(revertidosValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(revertidosValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">
              {revertidos.length}/{acCases.length} pedidos
            </p>
            <p className="text-[11px] font-semibold text-emerald-600 shrink-0">{revertPct}%</p>
          </div>
          {infoStatus === 'revertidos' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Pedidos de cancelamento revertidos no período selecionado (Performance / Histórico).
                Taxa = revertidos ÷ pedidos criados no período.
                Conta pedidos, não alunos — não entra na soma da Carteira Total.
              </p>
            </div>
          )}
        </div>

        {tagKpis[0] && (
          <div
            onClick={() => setKpiModalKey('tag')}
            className={`min-w-0 cursor-pointer rounded-2xl p-3 sm:p-4 saas-shadow-md bg-card border border-border border-l-4 ${tagKpis[0].color} transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-indigo-500/30`}
          >
            <div className="flex items-start justify-between mb-2 gap-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">{tagKpis[0].label}</p>
              <NaoSomaBadge title="Recorte por tag: estes alunos e valores já estão contados nos cards de status (Em Dia, Vencido, À Negativar)." />
            </div>
            <p className={`kpi-value ${tagKpis[0].text}`} title={formatCurrency(tagKpis[0].value)}>
              <span className="hidden sm:inline">{formatCurrency(tagKpis[0].value)}</span>
              <span className="sm:hidden">{formatCurrencyCompact(tagKpis[0].value)}</span>
            </p>
            <div className="flex items-center justify-between mt-1 gap-2">
              <p className="text-[11px] text-muted-foreground truncate">{tagKpis[0].count} alunos</p>
              {tagKpis[0].overdueValue > 0 && (
                <p className="text-[11px] font-semibold text-red-600 shrink-0">Vencido: {formatCurrency(tagKpis[0].overdueValue)}</p>
              )}
            </div>
          </div>
        )}
      </div>







      {/* ── 4. Indicadores Menores: Média pgto, Renda Extra, Revertidos ───────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 saas-shadow">
          <Clock size={13} className="text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">Média pgto:</span>
          <MediaDiasTag media={mediaCarteira} />
          {mediaCarteira !== null && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {mediaCarteira < 0 ? 'antecipado' : mediaCarteira === 0 ? 'no prazo' : 'de atraso'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 saas-shadow">
          <Coins size={13} className="text-purple-500" />
          <span className="text-[11px] text-muted-foreground">Renda Extra:</span>
          <span className="text-[11px] font-semibold text-purple-600">{reAcordo.length}/{reStudents.length} | {rePct}%</span>
        </div>

        {/* Tag quantity indicators */}
        {tagFilters.length > 0 && tagFilters.map((tid) => {
          const tag = studentTags.find((t) => t.id === tid);
          if (!tag) return null;
          const count = kpiStudents.filter((s) => (s.tags || []).includes(tid)).length;
          return (
            <div key={tid} className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 saas-shadow">
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded border"
                style={getTagStyle(tag.color)}
              >
                {tag.name}
              </span>
              <span className="text-[11px] font-semibold text-foreground">{count}</span>
            </div>
          );
        })}
      </div>

      {/* ── 5. Distribuição de Status (Pizza) + Evolução Mensal ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Pie Chart */}
        <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
          <h3 className="text-sm font-semibold text-foreground mb-1">Distribuição de Status</h3>
          <p className="text-xs text-muted-foreground mb-2">
            {mode === 'historico' && historicoEnd
              ? snapshotKind === 'frozen'
                ? `Foto congelada em ${new Date(historicoEnd + 'T12:00:00').toLocaleDateString('pt-BR')}`
                : `Carteira na data ${new Date(historicoEnd + 'T12:00:00').toLocaleDateString('pt-BR')}${snapshotKind === 'missing' ? ' (estimativa)' : ''}`
              : 'Volume da Carteira (estado atual)'}
          </p>
          {pieData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12">Sem dados para exibir.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" stroke="none">
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 12, fontSize: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '8px 10px' }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div style={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 12, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4, color: STATUS_COLORS[p.name] }}>{p.name}</div>
                        <div style={{ display: 'grid', gap: 2, color: 'hsl(var(--foreground))' }}>
                          <div>Quantidade: <strong>{p.value} aluno(s)</strong></div>
                          <div>Valor: <strong>{formatCurrency(p.valor)}</strong></div>
                          <div>Percentual: <strong>{p.percent.toFixed(1)}%</strong></div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Evolução Mensal */}
        <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
          <h3 className="text-sm font-semibold text-foreground mb-1">Evolução Mensal por Status</h3>
          <p className="text-xs text-muted-foreground mb-2">Valor (R$) mês a mês {acFilter ? `— ${acFilter}` : '— carteira completa'}</p>

          {/* Filtro exclusivo do bloco — período em meses */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {([
              { key: '3m', label: '3 Meses' },
              { key: '6m', label: '6 Meses' },
              { key: '12m', label: '12 Meses' },
              { key: 'custom', label: 'Personalizado' },
            ] as { key: EvolPreset; label: string }[]).map((p) => (
              <button
                key={p.key}
                onClick={() => setEvolPreset(p.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                  evolPreset === p.key
                    ? 'iam-gradient text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            ))}
            {evolPreset === 'custom' && (() => {
              const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
              const currentYear = new Date().getFullYear();
              const ANOS = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
              const [sy, sm] = evolCustomStart.split('-').map(Number);
              const [ey, em] = evolCustomEnd.split('-').map(Number);
              return (
                <div className="flex items-center gap-2 ml-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">Início:</span>
                  <select
                    value={sm}
                    onChange={(e) => setEvolCustomStart(`${sy}-${String(Number(e.target.value)).padStart(2, '0')}`)}
                    className="input-field text-xs py-1 px-2"
                  >
                    {MESES.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={sy}
                    onChange={(e) => setEvolCustomStart(`${e.target.value}-${String(sm).padStart(2, '0')}`)}
                    className="input-field text-xs py-1 px-2"
                  >
                    {ANOS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>

                  <span className="text-[10px] text-muted-foreground ml-1">Fim:</span>
                  <select
                    value={em}
                    onChange={(e) => setEvolCustomEnd(`${ey}-${String(Number(e.target.value)).padStart(2, '0')}`)}
                    className="input-field text-xs py-1 px-2"
                  >
                    {MESES.map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={ey}
                    onChange={(e) => setEvolCustomEnd(`${e.target.value}-${String(em).padStart(2, '0')}`)}
                    className="input-field text-xs py-1 px-2"
                  >
                    {ANOS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>

          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cartesianData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ borderRadius: 12, fontSize: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                formatter={(value: number) => [formatCurrency(value)]}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {Object.entries(STATUS_COLORS).map(([status, color]) => (
                <Line key={status} type="monotone" dataKey={status} stroke={color} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Popup: Lista de Alunos + Parcelas ao clicar num indicador ───────── */}
      {kpiModalConfig && (
        <KpiStudentsModal
          title={`Alunos — ${kpiModalConfig.title}`}
          students={kpiModalConfig.students}
          instInRange={_instInRange}
          valueMode={kpiModalConfig.valueMode}
          todayMs={_refDayMs}
          onClose={() => setKpiModalKey(null)}
        />
      )}

      {kpiModalKey === 'revertidos' && (
        <CancellationCasesModal
          title="Casos revertidos"
          subtitle={`${revertidos.length} de ${acCases.length} pedidos${cancellationDateRange ? ' no período' : ''} · ${revertPct}%`}
          cases={revertidos}
          onClose={() => setKpiModalKey(null)}
        />
      )}

      {reportOpen && (
        <DashboardReportModal
          generatedAt={reportGeneratedAt}
          contextLines={reportContextLines}
          sections={reportSections}
          onClose={() => setReportOpen(false)}
        />
      )}
      {/* ── 6. Ranking AC ────────────────────────────────────────────────────── */}
      <ACRankingCard
        acs={acs}
        students={studentsForAcRanking(
          kpiStudents,
          getHiddenFromAcPortfolioKeys(cancellationCases, conciliacaoItems, students),
          students,
        )}
        renegByAc={renegByAc}
        referenceDate={mode === 'historico' && historicoEnd ? new Date(historicoEnd + 'T23:59:59') : undefined}
      />

      {/* ── 7. Espelho: Ranking de Reversões (aba Comissões) ─────────────────── */}
      <ReversalRankingMirror />
    </div>
  );
}

interface PaymentDetail {
  studentId: string;
  studentName: string;
  ac: string;
  installmentNumber: number;
  dueDate: string;
  value: number;
  paidValue: number;
  paidDate?: string;
  bucket?: 'pago' | 'a_vencer';
}

function PaymentDetailsModal({
  mode,
  details,
  totalPago,
  totalRecebido,
  onClose,
}: {
  mode: 'pago' | 'recebido';
  details: PaymentDetail[];
  totalPago: number;
  totalRecebido: number;
  onClose: () => void;
}) {
  const isRecebido = mode === 'recebido';
  const title = isRecebido ? 'Valor Recebido — Detalhes' : 'Total Pago — Detalhes';
  const totalLabel = isRecebido ? 'Total Recebido' : 'Total Pago';
  const totalValue = isRecebido ? totalRecebido : totalPago;
  const sorted = [...details].sort((a, b) => a.studentName.localeCompare(b.studentName));
  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl border border-border flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sorted.length} {sorted.length === 1 ? 'parcela' : 'parcelas'} · {totalLabel}: <span className="font-semibold text-emerald-700">{formatCurrency(totalValue)}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground" aria-label="Fechar">✕</button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2">Cliente</th>
                <th className="text-center font-semibold px-4 py-2">Parc.</th>
                <th className="text-left font-semibold px-4 py-2">Vencimento</th>
                <th className="text-left font-semibold px-4 py-2">Pagamento</th>
                <th className="text-right font-semibold px-4 py-2">{isRecebido ? 'Valor Recebido' : 'Valor Parcela'}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum registro no período.</td>
                </tr>
              ) : (
                sorted.map((d, idx) => (
                  <tr key={`${d.studentId}-${d.installmentNumber}-${idx}`} className="border-t border-border/60">
                    <td className="px-4 py-2 text-foreground">{d.studentName}</td>
                    <td className="px-4 py-2 text-center text-xs text-muted-foreground tabular-nums">{d.installmentNumber}</td>
                    <td className="px-4 py-2 text-xs text-foreground tabular-nums">{fmtDate(d.dueDate)}</td>
                    <td className="px-4 py-2 text-xs text-foreground tabular-nums">{fmtDate(d.paidDate)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-emerald-700 tabular-nums">
                      {formatCurrency(isRecebido ? d.paidValue : d.value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
