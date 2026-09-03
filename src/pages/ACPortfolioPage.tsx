import { useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore, formatCurrency, formatCurrencyCompact, calculateAutoStatus, calculateAutoStatusAt, calcularScoreComportamento, calcularMediaDiasPagamento, calculateChurnRisk, calculateRendaExtraMetrics } from '@/store/useAppStore';
import { Student, StudentStatus, MOTIVOS_CANCELAMENTO, Notification } from '@/types';
import StudentModal from '@/components/modals/StudentModal';
import StudentViewModal from '@/components/modals/StudentViewModal';
import FinancialModal from '@/components/modals/FinancialModal';
import HistoryModal from '@/components/modals/HistoryModal';
import FlowModal from '@/components/modals/FlowModal';
import DeleteModal from '@/components/modals/DeleteModal';
import ChurnRiskCard from '@/components/ui/ChurnRiskCard';
import CancelStudentFlowModal from '@/components/modals/CancelStudentFlowModal';
import RendaExtraMetricsCard from '@/components/ui/RendaExtraMetricsCard';
import DashDateFilter, { AnalysisModeToggle, DashFilterMode, PerfPreset, getPerfRange } from '@/components/ui/DashDateFilter';
import HeaderActions from '@/components/layout/HeaderActions';
import { getCurrentMonthDates } from '@/lib/periodFilter';
import { Search, DollarSign, Clock, Eye, Info, Users, TrendingUp, TrendingDown, CalendarClock, AlertTriangle, Coins, Star, Wallet, X, Tag, ChevronUp, ChevronDown, Download, Pencil } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import {
  cancelamentoOverridesFinancialStatus,
  getHiddenFromAcPortfolioKeys,
  isSolicitacaoCancelamento,
  isStudentHiddenFromAcPortfolio,
  isStudentInAcPortfolio,
  isStudentFullyPaid,
  isVisibleInAcPortfolio,
  hasActiveCancellationCase,
  matchesCancelamentoFilter,
} from '@/lib/acPortfolioVisibility';
import { getCancelamentoBadge, resolveStudentDisplayStatus, isOperationalPendente, sumOperationalPendenteValue } from '@/lib/studentDisplayStatus';
import { countsInAcPortfolioTotals, isInstallmentExcludedFromAcPortfolio, needsIamGcConciliacaoApproval, isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { exportForecastSpreadsheet, type ForecastExportRow } from '@/lib/exportForecastSpreadsheet';
import {
  PAGO_FORMA_FILTER_DEFAULT,
  entradaAvistaCountsInPago,
  installmentCountsInPago,
  type PagoFormaFilter,
} from '@/lib/pagoFormaFilter';
import { PagoFormaToggle } from '@/components/ui/PagoFormaToggle';
import { toast } from 'sonner';
import {
  isCancellationCaseInRange,
  isCancellationCaseRevertido,
  studentIdsFromRevertidosCases,
} from '@/lib/cancellationIndicators';
import { statusColors } from '@/lib/statusColors';
import { NaoSomaBadge } from '@/components/NaoSomaBadge';
import { getTodayBrasilia, calcularDiasVencido, dueDateForDisplay } from '@/lib/brasiliaDate';
import { getDisplayInstallmentValue, normalizeSearch } from '@/lib/utils';
import { getTagStyle } from '@/lib/tagColors';
import {
  computeTagKpis,
  studentMatchesTagKpiGroup,
  applyTagKpiGroupToStudent,
} from '@/lib/tagKpis';
import { studentMatchesTagFilter, applyTagFilterToStudent, getVisibleStudentTagRefs } from '@/lib/tagFilter';
import TagMultiSelect from '@/components/ui/TagMultiSelect';
import StatusBadgeManual from '@/components/ui/StatusBadgeManual';
import MetaTaxaEmDiaGauge from '@/components/ui/MetaTaxaEmDiaGauge';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';

function ScoreStars({ score }: { score: number }) {
  if (score === 0) {
    return (
      <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded" title="Novo Aluno">N</span>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={10} className={s <= score ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'} />
      ))}
    </div>
  );
}

// ── Status cancelamento badge ──────────────────────────────────────────────────
const cancelStatusConfig: Record<string, { label: string; color: string }> = {
  solicitado: { label: 'Solicitação Cancelamento', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  aguardando_conciliacao: { label: 'Conciliação Pendente', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  pagamento_multa_pendente: { label: 'Pagamento Multa Pendente', color: 'bg-amber-100 text-amber-700 border border-amber-300' },
  revertido: { label: 'Revertido', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
};

// Critério ÚNICO de "Solicitação de Cancelamento" — usado pelos KPIs e pela
// lista, para que o card e o resultado do clique nunca divirjam.
const isSolicCancel = isSolicitacaoCancelamento;
function MediaDiasTag({ media }: { media: number | null }) {
  if (media === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const color = media < 0 ? 'text-emerald-600' : media <= 5 ? 'text-amber-600' : 'text-red-600';
  const prefix = media < 0 ? '' : '+';
  return <span className={`text-[11px] font-semibold ${color}`}>{prefix}{media}d</span>;
}

function resolveAssignedStudentTags(student: Student, studentTags: ReturnType<typeof useAppStore.getState>['studentTags']) {
  const refs = getVisibleStudentTagRefs(student);
  const refsLower = new Set(refs.map((ref) => ref.toLowerCase()));

  return studentTags.filter((tag) => refs.includes(tag.id) || refsLower.has(tag.name.toLowerCase()));
}

export default function ACPortfolioPage() {
  const { selectedACId, setSelectedACId, acs, students, updateStudent, deleteStudent, cancellationCases, products, cancelStudentToFlow, studentTags, toggleStudentTag, currentUser, rules, updateAC } = useAppStore();
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilterRaw] = useState('');
  const [kpiCardFilter, setKpiCardFilter] = useState<'' | 'revertidos' | 'boletos_antecipados' | 'pendente'>('');
  const [forecastIndex, setForecastIndex] = useState(0);
  const [dateBasis, setDateBasis] = useState<'vencimento' | 'pagamento'>('vencimento');
  // Card Pago: "Somente boleto" (padrão) ou "Geral" (inclui entrada à vista/cartão e PIX/link).
  const [pagoForma, setPagoForma] = useState<PagoFormaFilter>(PAGO_FORMA_FILTER_DEFAULT);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [financialStudent, setFinancialStudent] = useState<Student | null>(null);
  const [financialBanner, setFinancialBanner] = useState<{ title: string; body?: string } | null>(null);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [flowStudent, setFlowStudent] = useState<Student | null>(null);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [infoStatus, setInfoStatus] = useState<string | null>(null);
  const [cancellationStudent, setCancellationStudent] = useState<Student | null>(null);
  const [selectedMotivo, setSelectedMotivo] = useState<typeof MOTIVOS_CANCELAMENTO[number] | ''>('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [tagPopoverStudent, setTagPopoverStudent] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'venc' | 'status' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: 'venc' | 'status') => {
    if (sortBy !== key) { setSortBy(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortBy(null); setSortDir('asc'); }
  };
  const nextDueDate = (s: Student) => {
    const next = [...s.installments].filter((i) => !i.paid).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
    return next?.dueDate ?? '';
  };
  const nextDueDateUi = (s: Student) => dueDateForDisplay(nextDueDate(s));
  const fmtDateBR = (iso: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const toggleTagFilter = (tagId: string) => {
    setTagFilters((prev) => prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]);
  };

  // ── DashDateFilter state ──────────────────────────────────────────────────
  const { firstDay: currentMonthStart, lastDay: currentMonthEnd } = getCurrentMonthDates();
  const [mode, setMode] = useState<DashFilterMode>('performance');
  const [perfPreset, setPerfPreset] = useState<PerfPreset>('todos');
  const [perfCustomStart, setPerfCustomStart] = useState(currentMonthStart);
  const [perfCustomEnd, setPerfCustomEnd] = useState(currentMonthEnd);
  const [historicoStart, setHistoricoStart] = useState(currentMonthStart);
  const [historicoEnd, setHistoricoEnd] = useState(currentMonthEnd);
  // Edição da meta mensal de Taxa em Dia (velocímetro do cabeçalho).
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [metaDraft, setMetaDraft] = useState('');
  const [metaBaseDraft, setMetaBaseDraft] = useState('');

  // AC vinculado: pode abrir qualquer carteira, mas só edita a própria.
  const ownACId = currentUser?.acId ?? null;
  const isACScoped = !!ownACId;
  useEffect(() => {
    // Garante que, ao entrar na aba Equipe, há uma carteira selecionada.
    if (!selectedACId && ownACId) setSelectedACId(ownACId);
  }, [selectedACId, ownACId, setSelectedACId]);

  const effectiveACId = selectedACId ?? ownACId;
  const ac = acs.find((g) => g.id === effectiveACId);
  const isOwnPortfolio = !isACScoped || effectiveACId === ownACId;
  const canMutatePortfolio = isOwnPortfolio;

  // Auto-update statuses via useEffect (somente na própria carteira)
  useEffect(() => {
    if (!ac || !canMutatePortfolio) return;
    students
      .filter((s) => s.ac === ac.name)
      .forEach((s) => {
        // Negativado é sempre manual — não rebaixamos por auto-cálculo.
        if (s.status === 'Negativado') return;
        // Pendência IAM: restaura Pendente/Manual até aprovação na Conciliação GC.
        if (needsIamGcConciliacaoApproval(s)) {
          if (s.status !== 'Pendente' || s.statusMode !== 'Manual') {
            updateStudent(s.id, { status: 'Pendente', statusMode: 'Manual' });
          }
          return;
        }
        if (s.status === 'Pendente') return;
        if (cancelamentoOverridesFinancialStatus(s)) return;
        if (s.statusMode === 'Automático') {
          const autoStatus = calculateAutoStatus(s.installments);
          if (autoStatus !== s.status) {
            updateStudent(s.id, { status: autoStatus });
          }
        }
      });
  }, [students, ac, updateStudent, canMutatePortfolio]);

  // Alunos com caso na coluna "PROCON ou Judicial" ou "Finalizado" saem da
  // carteira do assessor (continuam visíveis na aba Alunos).
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const hiddenFromPortfolioKeys = getHiddenFromAcPortfolioKeys(
    cancellationCases,
    conciliacaoItems,
    students,
  );
  const hiddenIdsKey = [...hiddenFromPortfolioKeys.ids].sort().join(',');
  const hiddenNamesKey = [...hiddenFromPortfolioKeys.names].sort().join(',');

  // ── Revertidos / Boletos Antecipados / Pendências (filtros de card) ───────
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
    if (c.ac !== ac?.name) return false;
    return isCancellationCaseInRange(c, cancellationDateRange);
  });
  const revertidos = acCases.filter(isCancellationCaseRevertido);
  const revertidosStudentIds = useMemo(
    () => studentIdsFromRevertidosCases(revertidos, students, ac?.name),
    [revertidos, students, ac?.name],
  );
  const studentsTableRef = useRef<HTMLDivElement>(null);
  const scrollToStudentsTable = () => {
    window.setTimeout(() => {
      studentsTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  // Base AC students with auto-status applied + filtro por tag (recalcula
  // installments/status quando tag está marcada apenas em parcelas específicas)
  const revertidosIdsKey = useMemo(
    () => [...revertidosStudentIds].sort().join(','),
    [revertidosStudentIds],
  );
  const acStudents = useMemo(() => {
    if (!ac) return [];
    const revertidosMode = kpiCardFilter === 'revertidos';
    const searching = search.trim().length > 0;
    return students
      .filter((s) => s.ac === ac.name)
      .filter((s) => {
        if (revertidosMode && revertidosStudentIds.has(s.id)) return true;
        return !isStudentHiddenFromAcPortfolio(s, hiddenFromPortfolioKeys, students);
      })
      .filter((s) => {
        // Carteira ativa exclui quitados; busca ou filtro "Pago" inclui para achar o aluno.
        if (statusFilter === 'Pago' || searching || isStudentInAcPortfolio(s)) return true;
        if (revertidosMode && revertidosStudentIds.has(s.id)) return true;
        return false;
      })
      .filter((s) => studentMatchesTagFilter(s, tagFilters))
      .map((s) => {
        const withStatus = { ...s, status: resolveStudentDisplayStatus(s) } as Student;
        return tagFilters.length > 0 ? applyTagFilterToStudent(withStatus, tagFilters) : withStatus;
      });
  }, [students, ac, tagFilters, hiddenIdsKey, hiddenNamesKey, statusFilter, search, kpiCardFilter, revertidosIdsKey, revertidosStudentIds]);


  // ── KPI students (mode-dependent) ─────────────────────────────────────────
  // Aplica TODOS os filtros (produto, status, score, tags) — KPIs e tabela
  // refletem exatamente o mesmo conjunto de alunos.
  const [kpiStudents, setKpiStudents] = useState<Student[]>([]);
  useEffect(() => {
    const stripCancelados = (arr: Student[]) =>
      statusFilter === 'cancelado' ? arr : arr.filter((s) => s.statusCancelamento !== 'cancelado');
    const stripRendaExtraConciliada = (arr: Student[]) =>
      statusFilter === 'Renda Extra'
        ? arr
        : arr.filter((s) => !(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão'));

    const applyLocalFilters = (arr: Student[]) =>
      arr.filter((s) => {
        if (productFilter && s.product !== productFilter) return false;
        if (scoreFilter !== null && calcularScoreComportamento(s.installments) !== scoreFilter) return false;
        if (statusFilter) {
          if (statusFilter === 'cancelado') {
            if (s.statusCancelamento !== 'cancelado') return false;
          } else if (statusFilter === 'cancelamento_solicitado') {
            if (!matchesCancelamentoFilter(s, cancellationCases)) return false;
          } else if (statusFilter === 'Renda Extra') {
            if (!(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')) return false;
          } else if (statusFilter === 'Pago') {
            if (s.status !== 'Pago') return false;
          } else if (s.status !== statusFilter || isSolicCancel(s)) return false;
        } else {
          if (s.status === 'Pago' && !isSolicCancel(s)) return false;
        }
        return true;
      });

    if (mode === 'historico') {
      if (!historicoEnd) { setKpiStudents([]); return; }
      const refDate = new Date(historicoEnd + 'T23:59:59');
      const base = acStudents.filter((s) => new Date(s.enrollmentDate) <= refDate);
      const remapped = base.map((s) => {
        if (s.status === 'Negativado') return s;
        if (s.statusMode === 'Automático') {
          return { ...s, status: calculateAutoStatusAt(s.installments, refDate) as StudentStatus };
        }
        return s;
      });
      setKpiStudents(applyLocalFilters(stripRendaExtraConciliada(stripCancelados(remapped))));
    } else {
      setKpiStudents(applyLocalFilters(stripRendaExtraConciliada(stripCancelados(acStudents))));
    }
  }, [mode, historicoEnd, acStudents, statusFilter, productFilter, scoreFilter]);

  // ── Performance mode: installment-level KPIs ─────────────────────────────
  const [perfKpis, setPerfKpis] = useState({ toReceiveCount: 0, toReceiveValue: 0, overdueValue: 0 });
  useEffect(() => {
    if (mode !== 'performance') return;
    const { start, end } = getPerfRange(perfPreset, perfCustomStart, perfCustomEnd);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const today = getTodayBrasilia();

    let toReceiveCount = 0, toReceiveValue = 0, overdueValue = 0;
    acStudents.forEach((s) => {
      s.installments.forEach((i) => {
        if (!i.paid) {
          const dueMs = new Date(i.dueDate + 'T00:00:00').getTime();
          if (dueMs >= startMs && dueMs <= endMs) {
            toReceiveCount++;
            toReceiveValue += i.value;
            if (new Date(i.dueDate + 'T00:00:00') < today) {
              overdueValue += i.value;
            }
          }
        }
      });
    });
    setPerfKpis({ toReceiveCount, toReceiveValue, overdueValue });
  }, [mode, perfPreset, perfCustomStart, perfCustomEnd, acStudents]);

  // ── Forecast custom dates ──────────────────────────────────────────────────
  const [forecastCustomStart, setForecastCustomStart] = useState(currentMonthStart);
  const [forecastCustomEnd, setForecastCustomEnd] = useState(currentMonthEnd);

  // ── Forecast helpers (Brasília) ───────────────────────────────────────────
  // Índices: 0=Todos, 1=Hoje, 2=Amanhã, 3=2Dias, 4=3Dias, 5=7Dias, 6=Personalizado
  const getForecastRange = (): { start: Date; end: Date } | null => {
    const today = getTodayBrasilia();
    if (forecastIndex === 0) return null; // Todos
    if (forecastIndex === 6) { // Personalizado
      if (!forecastCustomStart || !forecastCustomEnd) return null;
      return {
        start: new Date(forecastCustomStart + 'T00:00:00'),
        end: new Date(forecastCustomEnd + 'T23:59:59'),
      };
    }
    const offsetMap: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 };
    const offset = offsetMap[forecastIndex] ?? 0;
    const target = new Date(today);
    target.setDate(target.getDate() + offset);
    const end = new Date(target);
    end.setHours(23, 59, 59, 999);
    return { start: target, end };
  };

  // Exclui Renda Extra (já saída da carteira) e Cancelados conciliados
  // para que o card "Data de Vencimento" reflita só carteira ativa.
  const forecastBase = acStudents.filter(
    (s) =>
      isStudentInAcPortfolio(s) &&
      s.statusCancelamento !== 'cancelado' &&
      countsInAcPortfolioTotals(s) &&
      !(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')
  );

  const getForecastTotals = () => {
    const range = forecastIndex === 0 ? null : getForecastRange();
    let total = 0, aVencer = 0, pago = 0;
    let totalReal = 0, pagoReal = 0;
    let qtd = 0;
    const qtdAlunosSet = new Set<string>();
    const qtdAlunosAVencerSet = new Set<string>();
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
      // Contrato IAM Control conciliado e quitado à vista/cartão de crédito:
      // entra DIRETO no Pago (inclusive a entrada, que não vira parcela)
      // e nunca soma no A Vencer/Vencido.
      const quitadoAvista = isIamConciliadoQuitadoAvista(st);
      if (quitadoAvista && !range && dateBasis === 'vencimento' && entradaAvistaCountsInPago(pagoForma)) {
        const entrada = Number(st.downPayment ?? 0);
        if (entrada > 0) {
          total += entrada;
          totalReal += entrada;
          pago += entrada;
          pagoReal += entrada;
          qtd += 1;
          qtdAlunosSet.add(st.id);
          pushDetail(st, {
            bucket: 'pago',
            installmentNumber: 0,
            dueDate: st.enrollmentDate || '',
            value: entrada,
            paidValue: entrada,
            paidDate: st.enrollmentDate || undefined,
          });
        }
      }
      st.installments.forEach((i) => {
        if (dateBasis === 'pagamento') {
          if (!i.paid || !i.paidDate) return;
          if (!installmentCountsInPago(pagoForma, i)) return;
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
          if (!installmentCountsInPago(pagoForma, i)) return;
          if (!i.paidDate) {
            // Sem data de pagamento: só entra em "Todos".
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

        if (isInstallmentExcludedFromAcPortfolio(st, i)) return;
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
    return { total, aVencer, pago, totalReal, pagoReal, qtd, qtdAlunos: qtdAlunosSet.size, qtdAlunosAVencer: qtdAlunosAVencerSet.size, details };
  };
  const getForecastValue = () => getForecastTotals().aVencer;
  // Carteira Total = A Vencer / Vencido da projeção (mesmo valor do card laranja).
  const carteiraTotais = getForecastTotals();
  const carteiraTotalValue = carteiraTotais.aVencer;
  const carteiraTotalAlunos = carteiraTotais.qtdAlunosAVencer;

  const hasInstallmentInForecastRange = (student: Student): boolean => {
    if (forecastIndex === 0) return true;
    const range = getForecastRange();
    if (!range) return true;
    return student.installments.some((i) => {
      if (i.paid) return false;
      const due = new Date(i.dueDate + 'T00:00:00');
      return due >= range.start && due <= range.end;
    });
  };

  // ── Due filter for table ─────────────────────────────────────────────────
  // Performance mode: filtra alunos com parcelas no período selecionado
  // "Todos" (index 0) mostra todos; Hoje/Amanhã/etc filtra a lista
  const filteredByDue = useMemo(() => {
    if (
      mode === 'historico' ||
      kpiCardFilter === 'revertidos' ||
      kpiCardFilter === 'boletos_antecipados' ||
      kpiCardFilter === 'pendente'
    ) {
      return acStudents;
    }
    return acStudents.filter(hasInstallmentInForecastRange);
  }, [acStudents, mode, forecastIndex, forecastCustomStart, forecastCustomEnd, kpiCardFilter]);

  const setStatusFilter = (v: string) => {
    setStatusFilterRaw(v);
    if (v) {
      setKpiCardFilter('');
      setTagFilters([]);
    }
  };

  const pagosOcultosCount = useMemo(() => {
    if (!ac || statusFilter === 'Pago' || search.trim()) return 0;
    return students.filter(
      (s) =>
        s.ac === ac.name &&
        s.status === 'Pago' &&
        !isSolicCancel(s) &&
        !isStudentHiddenFromAcPortfolio(s, hiddenFromPortfolioKeys, students),
    ).length;
  }, [ac, students, statusFilter, search, hiddenIdsKey, hiddenNamesKey]);

  const filtered = filteredByDue.filter((s) => {
    if (search.trim()) {
      const q = normalizeSearch(search);
      const qDigits = search.replace(/\D/g, '');
      const nameHit = normalizeSearch(s.name).includes(q);
      const cpfDigits = (s.cpf || '').replace(/\D/g, '');
      const cpfHit = qDigits.length >= 3 && cpfDigits.includes(qDigits);
      if (!nameHit && !cpfHit) return false;
    }
    if (scoreFilter !== null && calcularScoreComportamento(s.installments) !== scoreFilter) return false;
    if (productFilter && s.product !== productFilter) return false;

    if (kpiCardFilter === 'revertidos') {
      return revertidosStudentIds.has(s.id);
    }
    if (kpiCardFilter === 'pendente') {
      return isOperationalPendente(s) && !isSolicCancel(s);
    }
    if (kpiCardFilter === 'boletos_antecipados') {
      return studentMatchesTagKpiGroup(s, studentTags, 'fundo_tmf_antecipacao');
    }

    // Tag filter já aplicado na base acStudents — não filtra de novo aqui
    if (statusFilter) {
      if (statusFilter === 'cancelado' && s.statusCancelamento !== 'cancelado') return false;
      if (statusFilter === 'cancelamento_solicitado' && !matchesCancelamentoFilter(s, cancellationCases)) return false;
      if (statusFilter === 'Pago' && s.status !== 'Pago') return false;
      if (statusFilter === 'Renda Extra') {
        if (!(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')) return false;
      } else if (!['cancelado', 'cancelamento_solicitado', 'Pago'].includes(statusFilter) && (s.status !== statusFilter || isSolicCancel(s))) return false;
    } else if (!search.trim()) {
      // Sem busca: carteira ativa oculta quitados / cancelados / renda extra conciliada
      if (s.statusCancelamento === 'cancelado') return false;
      if (s.status === 'Pago' && !isSolicCancel(s)) return false;
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
    }
    // Com busca ativa, Pagos aparecem no resultado para o AC localizar o aluno
    if (
      !search.trim() &&
      statusFilter !== 'Pago' &&
      statusFilter !== 'cancelamento_solicitado' &&
      s.status === 'Pago' &&
      !isSolicCancel(s)
    ) {
      return false;
    }
    return true;
  });

  const sorted = (() => {
    const base =
      kpiCardFilter === 'boletos_antecipados'
        ? filtered.map((s) => applyTagKpiGroupToStudent(s, studentTags, 'fundo_tmf_antecipacao'))
        : filtered;
    if (!sortBy) return base;
    const arr = [...base];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'venc') {
        const da = nextDueDate(a), db = nextDueDate(b);
        if (!da && !db) cmp = 0;
        else if (!da) cmp = 1;
        else if (!db) cmp = -1;
        else cmp = da.localeCompare(db);
      } else {
        cmp = (a.status ?? '').localeCompare(b.status ?? '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  })();

  // ── Média dias da carteira (para KPI compacto) ────────────────────────────
  const allPaidInstallments = acStudents.flatMap((s) => s.installments);
  const mediaCarteira = calcularMediaDiasPagamento(allPaidInstallments);

  // ── KPI derivations ───────────────────────────────────────────────────────
  // Filtro "Data de Vencimento" (forecastIndex) também aplicado aos KPIs de status.
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
  const kpiStudentsScoped = _fcRange
    ? kpiStudents.filter((s) => s.installments.some(_instInRange))
    : kpiStudents;
  const total = kpiStudentsScoped.length;
  // Solicitação de cancelamento sobrepõe visualmente qualquer outro status (dados preservados)
  const _isSolic = isSolicitacaoCancelamento;
  const emDia = kpiStudentsScoped.filter((s) => s.status === 'Em Dia' && !_isSolic(s));
  const alunosNovos = kpiStudentsScoped.filter((s) => s.status === 'Aluno Novo' && !_isSolic(s));
  const vencido1 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 1' && !_isSolic(s));
  const vencido2 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 2' && !_isSolic(s));
  const aNegativar = kpiStudentsScoped.filter((s) => s.status === 'À Negativar' && !_isSolic(s));
  const negativado = kpiStudentsScoped.filter((s) => s.status === 'Negativado' && !_isSolic(s));
  // Pedido de cancelamento: não depende do filtro de vencimento.
  const solicitacaoCancelamento = kpiStudents.filter(_isSolic);
  const inadimplentes = vencido1.length + vencido2.length + aNegativar.length + negativado.length;
  const aNegativarStale = aNegativar.some((s) => {
    const dias = calcularDiasVencido(s.installments);
    return dias !== null && dias > 65;
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
        .filter((i) => !i.paid && _instInRange(i) && !isInstallmentExcludedFromAcPortfolio(s, i))
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
  // Quitado no funil de cancelamento continua neste card mas some da Carteira
  // Total, que só conta quem tem parcela em aberto. É a diferença entre a soma
  // dos cards e o total.
  const solicCancQuitados = solicitacaoCancelamento.filter(isStudentFullyPaid).length;

  // KPIs por tag (Fundo / TMF / Antecipação) — somente parcelas marcadas.
  const tagKpis = computeTagKpis(kpiStudentsScoped, studentTags, _instInRange);

  // Novos + Em Dia + Inadimplentes usam a mesma base para as % fecharem em 100%.
  // Cancelamento/Pendência ficam nos cards próprios e não entram nesta conta.
  const totalComposicao = alunosNovos.length + emDia.length + inadimplentes;
  const pct = (n: number) => totalComposicao > 0 ? ((n / totalComposicao) * 100).toFixed(1) : '0.0';
  const pctCarteira = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
  const pctSolic = kpiStudents.length > 0
    ? ((solicitacaoCancelamento.length / kpiStudents.length) * 100).toFixed(1)
    : '0.0';
  const pctEmDia = pct(emDia.length);
  const pctInadimplente = pct(inadimplentes);
  const paidCount = (s: Student) => s.installments.filter((i) => i.paid).length;

  const revertPct = acCases.length > 0 ? Math.round((revertidos.length / acCases.length) * 100) : 0;
  const revertidosValue = revertidos.reduce((acc, c) => acc + (c.value ?? 0), 0);
  const pendentes = kpiStudentsScoped.filter((s) => isOperationalPendente(s) && !isSolicCancel(s));
  const pendenteValue = pendentes.reduce((acc, s) => acc + sumOperationalPendenteValue(s), 0);

  // Display status for table rows (always current, table is independent)
  const displayStatus = (s: Student): StudentStatus => resolveStudentDisplayStatus(s);

  if (!ac) return <div className="p-12 text-center text-muted-foreground">Selecione um assessor no menu.</div>;


  // ── Score percentages for filter ──────────────────────────────────────────
  // Calculado sobre o MESMO universo que a tabela exibe por padrão
  // (exclui Pago, Cancelado e Renda Extra já conciliada quando não há
  // statusFilter ativo). Sem isso, o % mostrava 5★ mas, ao clicar, a tabela
  // ficava vazia porque os 5★ eram todos Pagos.
  const scoreBaseStudents = (() => {
    if (statusFilter) return acStudents;
    return acStudents.filter((s) => isStudentInAcPortfolio(s));
  })();
  const scoreDistribution = (() => {
    const counts: Record<string, number> = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    scoreBaseStudents.forEach((s) => {
      const sc = calcularScoreComportamento(s.installments);
      counts[String(sc)] = (counts[String(sc)] || 0) + 1;
    });
    const t = scoreBaseStudents.length;
    return (v: number) => t > 0 ? Math.round((counts[String(v)] / t) * 100) : 0;
  })();

  // Handler do clique em notificação: abre Gestão Financeira do aluno
  const handleOpenStudentFromNotif = (studentId: string, notif?: Notification) => {
    const st = students.find((s) => s.id === studentId);
    if (st) {
      setFinancialStudent(st);
      if (notif && notif.type === 'conciliacao_reprovada') {
        setFinancialBanner({ title: notif.title, body: notif.body });
      } else {
        setFinancialBanner(null);
      }
    }
  };

  return (
    <div className="space-y-3">

      {/* ── 0. Header com nome do AC, velocímetro e sino de notificações ─────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {ac.photo ? (
            <img src={ac.photo} alt={ac.name} className="w-10 h-10 rounded-full object-cover border border-border" />
          ) : (
            <div className="w-10 h-10 rounded-full iam-gradient text-primary-foreground flex items-center justify-center font-bold text-sm">
              {ac.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground truncate">{ac.name}</h1>
            <p className="text-[11px] text-muted-foreground">
              {canMutatePortfolio ? 'Carteira do Assessor de Conta' : 'Somente visualização — carteira de outro assessor'}
            </p>
          </div>
        </div>

        {/* Velocímetro da meta mensal de Taxa em Dia (centralizado no topo) */}
        <div className="hidden sm:flex flex-1 justify-center">
          {(() => {
            const taxaAtual = Number(pctEmDia);
            const metaTaxa = ac.metaTaxaEmDia ?? rules.meta1;
            const baseTaxa = ac.metaTaxaEmDiaBase ?? taxaAtual;
            const isAdmin = currentUser?.role === 'admin';
            const fmtPct = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
            const abrirEdicao = () => {
              setMetaDraft(fmtPct(metaTaxa));
              setMetaBaseDraft(fmtPct(taxaAtual));
              setEditMetaOpen(true);
            };
            const salvarMeta = () => {
              const meta = Number(metaDraft.replace(',', '.'));
              if (!Number.isFinite(meta) || meta <= 0 || meta > 100) {
                toast.error('Meta inválida — informe um percentual entre 0 e 100.');
                return;
              }
              const baseRaw = metaBaseDraft.trim() ? Number(metaBaseDraft.replace(',', '.')) : taxaAtual;
              const base = Number.isFinite(baseRaw) ? Math.max(0, Math.min(100, baseRaw)) : taxaAtual;
              updateAC(ac.id, {
                metaTaxaEmDia: Math.round(meta * 10) / 10,
                metaTaxaEmDiaBase: Math.round(base * 10) / 10,
                metaTaxaEmDiaEm: new Date().toISOString(),
              });
              setEditMetaOpen(false);
              toast.success(`Meta de Taxa em Dia de ${ac.name}: ${fmtPct(meta)}% (partida ${fmtPct(base)}%).`);
            };
            return (
              <div className="relative flex flex-col items-center">
                <MetaTaxaEmDiaGauge value={taxaAtual} base={baseTaxa} meta={metaTaxa} size={170} />
                <div className="flex items-center gap-1.5 -mt-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Taxa em Dia</span>
                  <span className="text-sm font-bold text-foreground tracking-tight">{pctEmDia}%</span>
                  <span
                    className="text-[9px] text-muted-foreground"
                    title={ac.metaTaxaEmDiaEm
                      ? `Meta definida em ${new Date(ac.metaTaxaEmDiaEm).toLocaleDateString('pt-BR')}`
                      : 'Meta padrão (Configurações → Meta 1). Defina uma meta própria para este assessor.'}
                  >
                    · Meta {fmtPct(metaTaxa)}%
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => (editMetaOpen ? setEditMetaOpen(false) : abrirEdicao())}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                      title="Editar meta de Taxa em Dia"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                </div>

                {editMetaOpen && (
                  <div className="absolute top-full z-30 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left">
                    <p className="text-[11px] font-semibold text-foreground mb-2">Meta de Taxa em Dia — {ac.name}</p>
                    <label className="block text-[10px] text-muted-foreground">
                      Meta do mês (%)
                      <input
                        type="number" step="0.1" min={0} max={100}
                        className="input-field w-full mt-1"
                        value={metaDraft}
                        autoFocus
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setMetaDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvarMeta(); if (e.key === 'Escape') setEditMetaOpen(false); }}
                      />
                    </label>
                    <label className="block text-[10px] text-muted-foreground mt-2">
                      Ponto de partida (%) — início do velocímetro
                      <input
                        type="number" step="0.1" min={0} max={100}
                        className="input-field w-full mt-1"
                        value={metaBaseDraft}
                        placeholder={fmtPct(taxaAtual)}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setMetaBaseDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvarMeta(); if (e.key === 'Escape') setEditMetaOpen(false); }}
                      />
                    </label>
                    <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
                      Pré-preenchido com a taxa atual. A escala vai da partida até o dobro da meta; o amarelo marca o meio do caminho.
                    </p>
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setEditMetaOpen(false)}
                        className="px-3 py-1.5 rounded-lg text-[11px] bg-muted hover:bg-muted/70"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={salvarMeta}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground"
                      >
                        Salvar meta
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {canMutatePortfolio ? (
          <NotificationBell acId={ac.id} onOpenStudent={handleOpenStudentFromNotif} />
        ) : (
          <div className="shrink-0 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-800">
            Somente leitura
          </div>
        )}
      </div>

      {!canMutatePortfolio && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
          <Eye size={14} className="shrink-0" />
          <span>
            Você está visualizando a carteira de <strong>{ac.name}</strong>. Alterações só são permitidas na sua própria carteira.
          </span>
        </div>
      )}

      {/* ── 1. Modo de Análise ──────────────────────────────────────────────────── */}
      {/* No desktop os botões ficam no cabeçalho, ao lado do seletor de empresa. */}
      <HeaderActions>
        <AnalysisModeToggle mode={mode} setMode={setMode} />
      </HeaderActions>
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

      {/* ── 2. Previsão de Recebimento + Filtros (Performance) ──────────────── */}
      {mode === 'performance' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Previsão de Recebimento */}
          <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
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
                  Pagamento
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {dateBasis === 'vencimento'
                ? 'Projeção financeira por período (carteira do assessor)'
                : 'Títulos pagos no período (carteira do assessor)'}
            </p>
            <div className="flex gap-1 mb-4 flex-wrap items-center">
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
                  const rows = carteiraTotais.details;
                  if (!rows.length) {
                    toast.message('Nenhum registro para exportar no período selecionado.');
                    return;
                  }
                  try {
                    exportForecastSpreadsheet(rows, {
                      dateBasis,
                      periodLabel,
                      filePrefix: 'carteira-ac-projecao',
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
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <PagoFormaToggle value={pagoForma} onChange={setPagoForma} />
              <span className="text-[10px] text-muted-foreground">
                {pagoForma === 'boleto' ? 'Pago considera só títulos (boletos)' : 'Pago inclui à vista, cartão e PIX/link'}
              </span>
            </div>
            {(() => {
              const { total, aVencer, pago, pagoReal, qtd, qtdAlunos } = carteiraTotais;
              if (dateBasis === 'pagamento') {
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0">
                      <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Total Pago</p>
                      <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pago)}>
                        {formatCurrency(pago)}
                      </p>
                      <p className="text-[10px] text-emerald-700/80 mt-0">valor original</p>
                    </div>
                    <div className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0">
                      <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Valor Recebido</p>
                      <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pagoReal)}>
                        {formatCurrency(pagoReal)}
                      </p>
                      <p className="text-[10px] text-emerald-700/80 mt-0">valor efetivamente pago</p>
                    </div>
                    <div className="kpi-fit rounded-xl border border-border bg-muted/30 p-2 min-w-0">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Qtd Títulos</p>
                      <p className="kpi-value-fit text-foreground mt-0.5">{qtd}</p>
                      <p className="text-[10px] text-muted-foreground mt-0">
                        {qtdAlunos} {qtdAlunos === 1 ? 'aluno' : 'alunos'} · {qtd} parcelas
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="kpi-fit rounded-xl border border-amber-200/60 bg-amber-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">A Vencer / Vencido</p>
                    <p className="kpi-value-fit text-amber-700 mt-0.5" title={formatCurrency(aVencer)}>
                      {formatCurrency(aVencer)}
                    </p>
                  </div>
                  <div className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Pago no período</p>
                    <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pago)}>
                      {formatCurrency(pago)}
                    </p>
                    <p className="text-[10px] font-semibold text-emerald-700 mt-0">
                      por data de pagamento · {pagoForma === 'boleto' ? 'somente boleto' : 'geral'}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Filtros: Produto, Status, Score */}
          <div className="bg-card border border-border rounded-2xl p-6 saas-shadow flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Filtros</h3>
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
              <select className="input-field text-xs py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">Todos</option>
                {(['Aluno Novo', 'Em Dia', 'Vencido 1', 'Vencido 2', 'À Negativar', 'Negativado', 'Pendente', 'Pago'] as StudentStatus[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="cancelamento_solicitado">Cancelamento solicitado</option>
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
          <span>Selecione um período de referência para reconstruir a carteira deste assessor.</span>
        </div>
      )}

      {/* Filtros no modo Histórico (mantém como estava - fora do grid) */}
      {mode === 'historico' && (
        <div className="flex items-center gap-3 flex-wrap">
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
            <select className="input-field text-xs py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              {(['Aluno Novo', 'Em Dia', 'Vencido 1', 'Vencido 2', 'À Negativar', 'Negativado', 'Pendente'] as StudentStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="cancelamento_solicitado">Cancelamento solicitado</option>
              <option value="cancelado">Cancelado</option>
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
          <div className="bg-card border border-border rounded-xl px-3 py-2 saas-shadow">
            <TagMultiSelect studentTags={studentTags} tagFilters={tagFilters} setTagFilters={setTagFilters} />
          </div>
        </div>
      )}

      {/* ── 4. Indicadores (KPIs Row 1) ──────────────────────────────────────── */}
      {/* Ordem: Carteira Total → Em Dia + Novos → Em Dia → Alunos Novos → Taxa Em Dia */}
      {/* Cards clicáveis — ao clicar aplicam o filtro de status correspondente na lista de alunos abaixo */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => { setStatusFilter(''); setKpiCardFilter(''); setTagFilters([]); }}
          className={`min-w-0 text-left rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-primary transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/30 ${statusFilter === '' && !kpiCardFilter ? 'ring-2 ring-primary/50' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Carteira Total</p>
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
          <div className="mt-2 pt-2 border-t border-border/60 space-y-0.5">
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="text-amber-700 font-medium truncate">A vencer / vencido</span>
              <span className="tabular-nums font-semibold text-amber-700 shrink-0">
                {formatCurrencyCompact(carteiraTotais.aVencer)}
                {carteiraTotais.aVencer + carteiraTotais.pago > 0
                  ? ` · ${((carteiraTotais.aVencer / (carteiraTotais.aVencer + carteiraTotais.pago)) * 100).toFixed(1)}%`
                  : ''}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <span className="text-emerald-700 font-medium truncate">Pago no período</span>
              <span className="tabular-nums font-semibold text-emerald-700 shrink-0">
                {formatCurrencyCompact(carteiraTotais.pago)}
                {carteiraTotais.aVencer + carteiraTotais.pago > 0
                  ? ` · ${((carteiraTotais.pago / (carteiraTotais.aVencer + carteiraTotais.pago)) * 100).toFixed(1)}%`
                  : ''}
              </span>
            </div>
          </div>
        </button>

        {/* Em Dia + Novos — soma agregada (clicável: aplica filtro "Em Dia" como atalho) */}
        <div className={`min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-teal-500 transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-teal-500/30 ${statusFilter === 'Em Dia' ? 'ring-2 ring-teal-500/50' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'Em Dia' ? '' : 'Em Dia')}
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
              <p>Soma de "Em Dia" + "Alunos Novos": alunos adimplentes da carteira (sem parcelas vencidas).</p>
            </div>
          )}
        </div>

        <div className={`min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-emerald-500 transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-emerald-500/30 ${statusFilter === 'Em Dia' ? 'ring-2 ring-emerald-500/50' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'Em Dia' ? '' : 'Em Dia')}
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

        <div className={`min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-sky-500 transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-sky-500/30 ${statusFilter === 'Aluno Novo' ? 'ring-2 ring-sky-500/50' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'Aluno Novo' ? '' : 'Aluno Novo')}
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

        <div className="min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-emerald-500 border border-emerald-600 transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-white/70 uppercase truncate">Taxa Em Dia</p>
            <TrendingUp size={16} className="text-white/50 shrink-0" />
          </div>
          <p className="kpi-value text-white">{pctEmDia}%</p>
          <p className="text-[11px] text-white/60 mt-1 truncate">{emDia.length} de {totalComposicao}</p>
        </div>
      </div>

      {/* ── Indicadores Row 2 ────────────────────────────────────────────────── */}
      {/* Ordem: Vencido 1 → Vencido 2 → À Negativar → Negativado → Taxa Inadimplente */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {[
          { key: 'v1', label: 'Vencido 1', value: v1Value, count: vencido1.length, color: 'amber-500', text: 'text-amber-600', desc: 'Alunos com parcelas vencidas entre 1 e 30 dias. Representa o primeiro estágio de inadimplência, onde ações de cobrança preventiva podem evitar a evolução do atraso.', filter: 'Vencido 1' as StudentStatus },
          { key: 'v2', label: 'Vencido 2', value: v2Value, count: vencido2.length, color: 'red-500', text: 'text-red-600', desc: 'Alunos com parcelas vencidas entre 31 e 60 dias. Neste estágio a inadimplência é mais crítica e requer ações de cobrança mais intensivas para recuperação do valor.', filter: 'Vencido 2' as StudentStatus },
          { key: 'an', label: 'À Negativar', value: anValue, count: aNegativar.length, color: 'slate-400', text: 'text-slate-500', desc: 'Alunos com inadimplência prolongada que estão próximos de serem negativados nos órgãos de proteção ao crédito. Última oportunidade de negociação antes da negativação.', filter: 'À Negativar' as StudentStatus },
          { key: 'neg', label: 'Negativado', value: negValue, count: negativado.length, color: 'slate-400', text: 'text-slate-500', desc: 'Alunos que já foram negativados nos órgãos de proteção ao crédito. Requer acompanhamento para eventual acordo e retirada da negativação.', filter: 'Negativado' as StudentStatus },
        ].map(({ key, label, value, count, color, text, desc, filter }) => {
          const isStaleAN = key === 'an' && aNegativarStale;
          const cardCls = isStaleAN
            ? `min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-red-500 border border-red-600 transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-red-400/40 ${statusFilter === filter ? 'ring-2 ring-white/50' : ''}`
            : `min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-${color} transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-foreground/20 ${statusFilter === filter ? 'ring-2 ring-foreground/40' : ''}`;
          const labelCls = isStaleAN ? 'text-[10px] font-semibold text-white/80 uppercase truncate' : 'text-[10px] font-semibold text-muted-foreground uppercase truncate';
          const valueCls = isStaleAN ? 'kpi-value text-white' : `kpi-value ${text}`;
          const subCls = isStaleAN ? 'text-[11px] text-white/80 truncate' : 'text-[11px] text-muted-foreground truncate';
          const pctCls = isStaleAN ? 'text-[11px] font-semibold text-white shrink-0' : `text-[11px] font-semibold ${text} shrink-0`;
          return (
            <div
              key={key}
              onClick={() => setStatusFilter(statusFilter === filter ? '' : filter)}
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
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl p-3 shadow-lg z-10 text-[11px] text-muted-foreground max-h-40 overflow-y-auto">
                  <p>{desc}</p>
                </div>
              )}
            </div>
          );
        })}

        {/* Taxa Inadimplente — mesmo tamanho dos outros (full red) */}
        <div className="min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-red-500 border border-red-600 transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-white/70 uppercase truncate">Taxa Inadimplente</p>
            <TrendingDown size={16} className="text-white/50 shrink-0" />
          </div>
          <p className="kpi-value text-white">{pctInadimplente}%</p>
          <p className="text-[11px] text-white/60 mt-1 truncate">{inadimplentes} de {totalComposicao}</p>
        </div>
      </div>

      {/* ── KPIs: Solicitação + Pendências + Revertidos + Boletos Antecipados ─ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch">
        <div
          onClick={() => setStatusFilter(statusFilter === 'cancelamento_solicitado' ? '' : 'cancelamento_solicitado')}
          className={`h-full min-w-0 cursor-pointer rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-fuchsia-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-fuchsia-500/30 ${statusFilter === 'cancelamento_solicitado' ? 'ring-2 ring-fuchsia-500/40' : ''}`}
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
            <p className="text-[11px] font-semibold text-fuchsia-600 shrink-0">{pctSolic}%</p>
          </div>
          {infoStatus === 'solic' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>
                Alunos deste assessor que solicitaram cancelamento. O valor sai do status anterior (Em Dia/Vencido/etc.) e passa a compor este indicador até reversão ou cancelamento definitivo.
                {solicCancQuitados > 0 && ` ${solicCancQuitados} já estão com o contrato quitado: seguem aqui até o caso fechar, somam R$ 0,00 no valor e não entram na Carteira Total.`}
              </p>
            </div>
          )}
        </div>

        <div
          onClick={() => {
            if (kpiCardFilter === 'pendente') {
              setKpiCardFilter('');
            } else {
              setKpiCardFilter('pendente');
              setStatusFilterRaw('');
              setTagFilters([]);
              scrollToStudentsTable();
            }
          }}
          className={`h-full min-w-0 cursor-pointer rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-yellow-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-yellow-500/30 ${kpiCardFilter === 'pendente' ? 'ring-2 ring-yellow-500/40' : ''}`}
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
                Pagamentos de boleto não entram neste indicador.
              </p>
            </div>
          )}
        </div>

        <div
          onClick={() => {
            if (kpiCardFilter === 'revertidos') {
              setKpiCardFilter('');
            } else {
              setKpiCardFilter('revertidos');
              setStatusFilterRaw('');
              setTagFilters([]);
              scrollToStudentsTable();
            }
          }}
          className={`h-full min-w-0 cursor-pointer rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-emerald-500 transition-all hover:-translate-y-0.5 relative hover:ring-2 hover:ring-emerald-500/30 ${kpiCardFilter === 'revertidos' ? 'ring-2 ring-emerald-500/40' : ''}`}
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
                Pedidos de cancelamento revertidos no período selecionado.
                Taxa = revertidos ÷ pedidos criados no período.
              </p>
            </div>
          )}
        </div>

        {tagKpis[0] && (
          <div
            onClick={() => {
              if (kpiCardFilter === 'boletos_antecipados') {
                setKpiCardFilter('');
              } else {
                setKpiCardFilter('boletos_antecipados');
                setStatusFilterRaw('');
                setTagFilters([]);
                scrollToStudentsTable();
              }
            }}
            className={`h-full min-w-0 cursor-pointer rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 ${tagKpis[0].color} transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-indigo-500/30 ${kpiCardFilter === 'boletos_antecipados' ? 'ring-2 ring-indigo-500/40' : ''}`}
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






      {/* ── 5. Indicadores Menores: Média pgto, Renda Extra ─────────────────── */}
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

        {(() => {
          const reStudents = acStudents.filter((s) => isRendaExtraAtivo(s));
          const reAcordo = reStudents.filter((s) => s.rendaExtraStatus === 'Acordo Feito');
          const rePct = reStudents.length > 0 ? Math.round((reAcordo.length / reStudents.length) * 100) : 0;
          return (
            <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 saas-shadow">
              <Coins size={13} className="text-purple-500" />
              <span className="text-[11px] text-muted-foreground">Renda Extra:</span>
              <span className="text-[11px] font-semibold text-purple-600">{reAcordo.length}/{reStudents.length} | {rePct}%</span>
            </div>
          );
        })()}

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

      {/* ── 6. Filtro Buscar Aluno ────────────────────────────────────────────── */}
      {kpiCardFilter && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
          <p className="text-[11px] text-emerald-800">
            <span className="font-semibold">Filtro ativo:</span>{' '}
            {kpiCardFilter === 'revertidos'
              ? 'Revertidos'
              : kpiCardFilter === 'pendente'
                ? 'Pendências'
                : (tagKpis[0]?.label ?? 'Boletos Antecipados')}
            {' · '}
            <span className="font-semibold">{sorted.length}</span> aluno{sorted.length === 1 ? '' : 's'}
            {kpiCardFilter === 'revertidos' && sorted.length === 0 && revertidos.length > 0 && (
              <span className="text-amber-700">
                {' '}
                — {revertidos.length} pedido{revertidos.length === 1 ? '' : 's'} no período sem aluno vinculado nesta carteira
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => { setKpiCardFilter(''); setTagFilters([]); }}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-100"
          >
            Limpar filtro
          </button>
        </div>
      )}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input-field pl-8 w-full"
          placeholder="Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {pagosOcultosCount > 0 && (
        <p className="text-[11px] text-muted-foreground -mt-2">
          {pagosOcultosCount} aluno(s) com status <strong>Pago</strong> ficam ocultos na carteira ativa.
          Busque pelo nome/CPF ou filtre por status <button type="button" className="underline font-semibold text-foreground" onClick={() => setStatusFilter('Pago')}>Pago</button>.
        </p>
      )}

      {/* ── Students Table ────────────────────────────────────────────────────── */}
      <div ref={studentsTableRef} className="bg-card border border-border rounded-2xl overflow-hidden saas-shadow scroll-mt-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => toggleSort('venc')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Data Vencimento
                    {sortBy === 'venc' ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronDown size={11} className="opacity-30" />}
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <button onClick={() => toggleSort('status')} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    Status
                    {sortBy === 'status' ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronDown size={11} className="opacity-30" />}
                  </button>
                </th>
                {['Score', 'Parcelas', 'Pagamento', 'Ações'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Nenhum aluno nesta carteira.
                  </td>
                </tr>
              ) : (
                sorted.map((student) => {
                  const tableStatus = displayStatus(student);
                  return (
                    <tr key={student.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{student.name}</span>
                            {student.ciclo && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 border border-indigo-300 whitespace-nowrap" title={`Ciclo do contrato: ${student.ciclo}`}>
                                {student.ciclo}
                              </span>
                            )}
                          </div>
                          {student.product && (
                            <span className="text-[9px] font-normal text-muted-foreground leading-none" title={student.product}>
                              {student.product}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {(() => {
                          const due = nextDueDateUi(student);
                          if (!due.displayIso) return '—';
                          return (
                            <span
                              title={due.rolledFromWeekend
                                ? `Contrato ${fmtDateBR(due.originalIso)} (fim de semana) — vencimento efetivo ${fmtDateBR(due.displayIso)}`
                                : undefined}
                            >
                              {fmtDateBR(due.displayIso)}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 max-w-[12rem]">
                        <div className="flex flex-col gap-1 items-start min-w-0">
                          {(() => {
                            const cancelBadge = getCancelamentoBadge(student);
                            const cancelOverrides = cancelamentoOverridesFinancialStatus(student);
                            if (cancelOverrides) {
                              if (cancelBadge) {
                                return (
                                  <span
                                    className={`text-[10px] font-semibold px-2 py-1 rounded-lg max-w-full whitespace-normal break-words leading-snug ${cancelBadge.color}`}
                                    title={cancelBadge.label}
                                  >
                                    {cancelBadge.label}
                                  </span>
                                );
                              }
                              return (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg max-w-full whitespace-normal break-words leading-snug ${statusColors[tableStatus] ?? 'bg-muted'}`}
                                  title={tableStatus}
                                >
                                  {tableStatus}
                                </span>
                              );
                            }
                            return (
                            <>
                              {isRendaExtraAtivo(student) && student.rendaExtraStatus !== 'Conciliar Exclusão' ? (
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-purple-100 text-purple-700 border border-purple-300">
                                  Renda Extra
                                </span>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    <StatusBadgeManual student={student} status={tableStatus} readOnly={!canMutatePortfolio} />
                                    {tableStatus !== 'Em Dia' && tableStatus !== 'Pago' && tableStatus !== 'Pendente' && tableStatus !== 'Solicitação Cancelamento' && (() => {
                                      const dias = calcularDiasVencido(student.installments);
                                      const due = nextDueDateUi(student);
                                      return dias && dias > 0 ? (
                                        <span
                                          className="text-[9px] font-bold text-destructive shrink-0"
                                          title={due.rolledFromWeekend
                                            ? `${dias} dia(s) desde o vencimento efetivo (${fmtDateBR(due.displayIso)}). Contrato: ${fmtDateBR(due.originalIso)}.`
                                            : `${dias} dia(s) em atraso`}
                                        >
                                          {dias}d
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                  {isRendaExtraAtivo(student) && student.rendaExtraStatus === 'Conciliar Exclusão' && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded w-fit bg-slate-200 text-slate-600 border border-slate-300">
                                      Renda Extra
                                    </span>
                                  )}
                                </>
                              )}
                              {student.statusCancelamento === 'revertido' && student.status !== 'Pago' && cancelStatusConfig.revertido && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded w-fit ${cancelStatusConfig.revertido.color}`}>
                                  {cancelStatusConfig.revertido.label}
                                </span>
                              )}
                            </>
                            );
                          })()}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <ScoreStars score={calcularScoreComportamento(student.installments)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {paidCount(student)}/{student.totalInstallments}
                          </span>
                          <button
                            onClick={() => setFlowStudent(student)}
                            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                            title="Ver fluxo de pagamento"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-foreground">
                        {(() => {
                          const { value, varied } = getDisplayInstallmentValue(student);
                          return (
                            <span className="whitespace-nowrap">
                              {formatCurrency(value)}
                              {varied && <span className="ml-1 text-[9px] font-medium text-muted-foreground">(varia)</span>}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setViewStudent(student)}
                            className="action-btn !border-primary/40 !text-primary hover:!bg-primary/10"
                            title="Ver ficha do aluno"
                          >
                            <Info size={12} />
                          </button>
                          {canMutatePortfolio ? (
                            <button
                              onClick={() => { setFinancialBanner(null); setFinancialStudent(student); }}
                              className="action-btn !border-emerald-300 !text-emerald-600 hover:!bg-emerald-50"
                              title="Pagamento"
                            >
                              <DollarSign size={12} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setFinancialBanner(null); setFinancialStudent(student); }}
                              className="action-btn !border-muted-foreground/30 !text-muted-foreground hover:!bg-muted"
                              title="Ver financeiro (somente visualização)"
                            >
                              <DollarSign size={12} />
                            </button>
                          )}
                          <button onClick={() => setHistoryStudent(student)} className="action-btn" title="Histórico">
                            <Clock size={12} />
                          </button>
                          {studentTags.length > 0 && (
                            <div className="relative">
                              <button
                                onClick={() => setTagPopoverStudent(tagPopoverStudent === student.id ? null : student.id)}
                                className="action-btn !border-primary/30 !text-primary hover:!bg-primary/10"
                                title="Ver tags do aluno"
                              >
                                <Tag size={12} />
                              </button>
                              {tagPopoverStudent === student.id && (
                                <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-lg p-2 min-w-[160px] space-y-1">
                                  <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground px-1 pb-1 border-b border-border/60 mb-1">
                                    Tags do aluno
                                  </p>
                                  {(() => {
                                    const original = students.find((s) => s.id === student.id) ?? student;
                                    const ativas = resolveAssignedStudentTags(original, studentTags);
                                    if (ativas.length === 0) {
                                      return (
                                        <p className="text-[10px] text-muted-foreground px-1 py-1.5 italic">
                                          Nenhuma tag atribuída
                                        </p>
                                      );
                                    }
                                    return ativas.map((tag) => {
                                      const inStudent = (original.tags || []).some((ref) => ref === tag.id || ref.toLowerCase() === tag.name.toLowerCase());
                                      const parcelaCount = (original.installments || []).filter(
                                        (inst) => (inst.tags || []).some((ref) => ref === tag.id || ref.toLowerCase() === tag.name.toLowerCase())
                                      ).length;
                                      return (
                                        <div
                                          key={tag.id}
                                          className="w-full text-left text-[10px] font-semibold px-2 py-1 rounded-lg border flex items-center justify-between gap-2"
                                          style={getTagStyle(tag.color)}
                                        >
                                          <span className="truncate">{tag.name}</span>
                                          {!inStudent && parcelaCount > 0 && (
                                            <span className="text-[9px] opacity-80 font-normal whitespace-nowrap">
                                              {parcelaCount} parc.
                                            </span>
                                          )}
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              )}
                            </div>
                          )}
                          {canMutatePortfolio && (!student.statusCancelamento || student.statusCancelamento === 'nenhum') && (
                            <button onClick={() => setCancellationStudent(student)} className="action-btn text-amber-600" title="Cancelar">
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {showStudentModal && (
        <StudentModal student={editingStudent} onClose={() => setShowStudentModal(false)} />
      )}
      {financialStudent && (
        <FinancialModal
          student={financialStudent}
          onClose={() => { setFinancialStudent(null); setFinancialBanner(null); }}
          banner={financialBanner ?? undefined}
          readOnly={!canMutatePortfolio}
        />
      )}
      {historyStudent && (
        <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />
      )}
      {flowStudent && (
        <FlowModal student={flowStudent} onClose={() => setFlowStudent(null)} />
      )}
      {viewStudent && (
        <StudentViewModal student={viewStudent} onClose={() => setViewStudent(null)} readOnly={!canMutatePortfolio} />
      )}
      {deleteId && canMutatePortfolio && (
        <DeleteModal
          onConfirm={() => { deleteStudent(deleteId); setDeleteId(null); }}
          onClose={() => setDeleteId(null)}
        />
      )}

      {/* Cancellation Modal — mesma questionário completo da aba Alunos */}
      {cancellationStudent && canMutatePortfolio && (
        <CancelStudentFlowModal
          student={cancellationStudent}
          onClose={() => { setCancellationStudent(null); setSelectedMotivo(''); }}
        />

      )}
    </div>
  );
}
