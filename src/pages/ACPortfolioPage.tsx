import { useState, useEffect } from 'react';
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
import DashDateFilter, { DashFilterMode, PerfPreset, getPerfRange } from '@/components/ui/DashDateFilter';
import { getCurrentMonthDates } from '@/lib/periodFilter';
import { Search, DollarSign, Clock, Eye, Info, Users, TrendingUp, TrendingDown, CalendarClock, AlertTriangle, Coins, Star, Wallet, X, Tag, ChevronUp, ChevronDown } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import { statusColors } from '@/lib/statusColors';
import { getTodayBrasilia, calcularDiasVencido } from '@/lib/brasiliaDate';
import { getDisplayInstallmentValue, normalizeSearch } from '@/lib/utils';
import { getTagStyle } from '@/lib/tagColors';
import { computeTagKpis } from '@/lib/tagKpis';
import { studentMatchesTagFilter, applyTagFilterToStudent, getVisibleStudentTagRefs } from '@/lib/tagFilter';
import TagMultiSelect from '@/components/ui/TagMultiSelect';
import StatusBadgeManual from '@/components/ui/StatusBadgeManual';
import MetaGauge from '@/components/ui/MetaGauge';
import TagKpiInlineList from '@/components/ui/TagKpiInlineList';
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
const isSolicCancel = (s: Student) =>
  s.statusCancelamento === 'solicitado' || s.status === 'Solicitação Cancelamento';

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
  const { selectedACId, setSelectedACId, acs, students, updateStudent, deleteStudent, cancellationCases, products, cancelStudentToFlow, studentTags, toggleStudentTag, currentUser, rules } = useAppStore();
  const [search, setSearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [productFilter, setProductFilter] = useState('');
  const [statusFilter, setStatusFilterRaw] = useState('');
  const [tagKpiModalOpen, setTagKpiModalOpen] = useState(false);
  const [fundoFilterIds, setFundoFilterIds] = useState<string[]>([]);
  const [forecastIndex, setForecastIndex] = useState(0);
  const [dateBasis, setDateBasis] = useState<'vencimento' | 'pagamento'>('vencimento');
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

  // Trava de carteira: se o usuário tem acId vinculado, ele só enxerga a própria.
  // Se houver tentativa (manual ou estado persistido) de abrir outro AC, força o vínculo.
  const isACScoped = !!currentUser?.acId;
  useEffect(() => {
    if (isACScoped && selectedACId !== currentUser!.acId) {
      setSelectedACId(currentUser!.acId!);
    }
  }, [isACScoped, selectedACId, currentUser, setSelectedACId]);

  const effectiveACId = isACScoped ? currentUser!.acId! : selectedACId;
  const ac = acs.find((g) => g.id === effectiveACId);

  // Bloqueio defensivo: se mesmo assim a página renderizar com AC errado, não mostra dados
  const accessDenied = isACScoped && selectedACId !== null && selectedACId !== currentUser!.acId;

  // Auto-update statuses via useEffect
  useEffect(() => {
    if (!ac) return;
    students
      .filter((s) => s.ac === ac.name)
      .forEach((s) => {
        // Negativado é sempre manual — não rebaixamos por auto-cálculo.
        if (s.status === 'Negativado') return;
        if (s.status === 'Solicitação Cancelamento') return;
        if (s.status === 'Cancelado' || s.statusCancelamento === 'cancelado') return;
        if (s.statusMode === 'Automático') {
          const autoStatus = calculateAutoStatus(s.installments);
          if (autoStatus !== s.status) {
            updateStudent(s.id, { status: autoStatus });
          }
        }
      });
  }, [students, ac, updateStudent]);

  // Alunos com caso na coluna "PROCON ou Judicial" ou "Finalizado" saem da
  // carteira do assessor (continuam visíveis na aba Alunos). Se o card voltar
  // para outra coluna, o aluno reaparece automaticamente.
  // Obs.: a coluna considerada é a EFETIVA do Kanban — cards aguardando
  // conciliação (ou já conciliados) aparecem em "Finalizado" mesmo com o
  // funnelStage salvo em outra etapa (ex.: Formalização).
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const hiddenFromPortfolioKeys = (() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    const pendingCaseIds = new Set<string>();
    const conciliadoCaseIds = new Set<string>();
    for (const it of conciliacaoItems) {
      if ((it.status === 'pendente' || it.status === 'aprovado') && it.relatedCaseId) pendingCaseIds.add(it.relatedCaseId);
      if ((it.tipo === 'cancelamento' || it.tipo === 'reversao') && it.status === 'conciliado' && it.relatedCaseId) conciliadoCaseIds.add(it.relatedCaseId);
    }
    cancellationCases.forEach((c) => {
      const isJudicial = c.funnelStage
        ? c.funnelStage === 'Pendente'
        : c.stage === 'PROCON ou Judicial';
      const total = c.quantidadeInscricoes ?? 1;
      const revertidas = c.inscricoesRevertidas ?? 0;
      const reversaoParcialPendente = total > 1 && revertidas > 0 && revertidas < total;
      const st = c.studentId ? students.find((s) => s.id === c.studentId) : students.find((s) => s.cancellationCaseId === c.id);
      const aguardando = !reversaoParcialPendente && (pendingCaseIds.has(c.id) || st?.statusCancelamento === 'aguardando_conciliacao');
      const conciliado = !reversaoParcialPendente && conciliadoCaseIds.has(c.id) && !pendingCaseIds.has(c.id);
      const isFinalizado = c.funnelStage === 'Finalizado' || aguardando || conciliado;
      if (!isJudicial && !isFinalizado) return;
      if (c.studentId) ids.add(c.studentId);
      if (c.studentName) names.add(c.studentName.trim().toLowerCase());
    });
    return { ids, names };
  })();
  const hiddenIdsKey = [...hiddenFromPortfolioKeys.ids].sort().join(',');
  const hiddenNamesKey = [...hiddenFromPortfolioKeys.names].sort().join(',');

  // Base AC students with auto-status applied + filtro por tag (recalcula
  // installments/status quando tag está marcada apenas em parcelas específicas)
  const [acStudents, setAcStudents] = useState<Student[]>([]);
  useEffect(() => {
    if (!ac) { setAcStudents([]); return; }
    const base = students
      .filter((s) => s.ac === ac.name)
      .filter((s) => !(hiddenFromPortfolioKeys.ids.has(s.id) || hiddenFromPortfolioKeys.names.has((s.name || '').trim().toLowerCase())))
      .filter((s) => studentMatchesTagFilter(s, tagFilters))
      .map((s) => {
        const baseStatus = (s.status === 'Cancelado' || s.statusCancelamento === 'cancelado')
          ? 'Cancelado'
          : s.status === 'Negativado'
          ? 'Negativado'
          : (s.statusMode === 'Automático' ? calculateAutoStatus(s.installments) : s.status);
        const withStatus = { ...s, status: baseStatus } as Student;
        return tagFilters.length > 0 ? applyTagFilterToStudent(withStatus, tagFilters) : withStatus;
      });
    setAcStudents(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, ac, tagFilters, hiddenIdsKey, hiddenNamesKey]);


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
            if (!isSolicCancel(s)) return false;
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
      s.statusCancelamento !== 'cancelado' &&
      !(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')
  );

  const getForecastTotals = () => {
    const range = forecastIndex === 0 ? null : getForecastRange();
    let total = 0, aVencer = 0, pago = 0;
    let totalReal = 0, pagoReal = 0;
    let qtd = 0;
    const qtdAlunosSet = new Set<string>();
    forecastBase.forEach((st) => {
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
          return;
        }
        if (range) {
          const due = new Date(i.dueDate + 'T00:00:00');
          if (due < range.start || due > range.end) return;
        }
        const realValue = i.paid ? (typeof i.paidValue === 'number' ? i.paidValue : i.value) : i.value;
        total += i.value;
        totalReal += realValue;
        if (i.paid) {
          pago += i.value;
          pagoReal += realValue;
        } else {
          aVencer += i.value;
        }
        qtd += 1;
        qtdAlunosSet.add(st.id);
      });
    });
    return { total, aVencer, pago, totalReal, pagoReal, qtd, qtdAlunos: qtdAlunosSet.size };
  };
  const getForecastValue = () => getForecastTotals().aVencer;

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
  const [filteredByDue, setFilteredByDue] = useState<Student[]>([]);
  useEffect(() => {
    if (mode === 'historico') {
      setFilteredByDue(acStudents);
    } else {
      setFilteredByDue(acStudents.filter(hasInstallmentInForecastRange));
    }
  }, [acStudents, mode, forecastIndex, forecastCustomStart, forecastCustomEnd]);

  const filtered = filteredByDue.filter((s) => {
    // Modo "Fundo / TMF / Antecipação": lista restrita aos alunos desse KPI,
    // já filtrados pela data escolhida dentro do próprio card.
    if (tagKpiModalOpen && !fundoFilterIds.includes(s.id)) return false;
    if (!normalizeSearch(s.name).includes(normalizeSearch(search))) return false;
    if (scoreFilter !== null && calcularScoreComportamento(s.installments) !== scoreFilter) return false;
    if (productFilter && s.product !== productFilter) return false;
    // Tag filter já aplicado na base acStudents — não filtra de novo aqui
    if (statusFilter) {
      if (statusFilter === 'cancelado' && s.statusCancelamento !== 'cancelado') return false;
      if (statusFilter === 'cancelamento_solicitado' && !isSolicCancel(s)) return false;
      if (statusFilter === 'Pago' && s.status !== 'Pago') return false;
      if (statusFilter === 'Renda Extra') {
        if (!(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')) return false;
      } else if (!['cancelado', 'cancelamento_solicitado', 'Pago'].includes(statusFilter) && (s.status !== statusFilter || isSolicCancel(s))) return false;
    } else {
      // By default, hide fully canceled, pagos e Renda Extra já conciliada
      if (s.statusCancelamento === 'cancelado') return false;
      if (s.status === 'Pago' && !isSolicCancel(s)) return false;
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
    }
    // Hide pagos unless explicitly filtering for them
    if (statusFilter !== 'Pago' && statusFilter !== 'cancelamento_solicitado' && s.status === 'Pago' && !isSolicCancel(s)) return false;
    return true;
  });

  const sorted = (() => {
    if (!sortBy) return filtered;
    const arr = [...filtered];
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
  const _isSolic = (s: Student) =>
    s.statusCancelamento === 'solicitado' || s.status === 'Solicitação Cancelamento';
  const emDia = kpiStudentsScoped.filter((s) => s.status === 'Em Dia' && !_isSolic(s));
  const alunosNovos = kpiStudentsScoped.filter((s) => s.status === 'Aluno Novo' && !_isSolic(s));
  const vencido1 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 1' && !_isSolic(s));
  const vencido2 = kpiStudentsScoped.filter((s) => s.status === 'Vencido 2' && !_isSolic(s));
  const aNegativar = kpiStudentsScoped.filter((s) => s.status === 'À Negativar' && !_isSolic(s));
  const negativado = kpiStudentsScoped.filter((s) => s.status === 'Negativado' && !_isSolic(s));
  const solicitacaoCancelamento = kpiStudentsScoped.filter(_isSolic);
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
      return acc + s.installments.filter((i) => !i.paid && _instInRange(i)).reduce((a, i) => a + i.value, 0);
    }, 0);

  const _todayMs = (() => { const d = getTodayBrasilia(); d.setHours(0,0,0,0); return d.getTime(); })();
  const sumOverdue = (arr: Student[]) =>
    arr.reduce((acc, s) => {
      if (s.statusCancelamento === 'cancelado') return acc;
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus !== 'Conciliar Exclusão') return acc;
      return acc + s.installments
        .filter((i) => !i.paid && _instInRange(i) && new Date(i.dueDate + 'T00:00:00').getTime() < _todayMs)
        .reduce((a, i) => a + i.value, 0);
    }, 0);

  const totalValue = sumUnpaid(kpiStudentsScoped);
  const emDiaValue = sumUnpaid(emDia);
  const alunosNovosValue = sumUnpaid(alunosNovos);
  const v1Value = sumOverdue(vencido1);
  const v2Value = sumOverdue(vencido2);
  // À Negativar: considera TODO o saldo em aberto (vencidas + a vencer)
  const anValue = sumUnpaid(aNegativar);
  const negValue = sumOverdue(negativado);
  const solicCancValue = sumUnpaid(solicitacaoCancelamento);

  // KPIs por tag (Fundo / TMF / Antecipação) — somente parcelas marcadas.
  const tagKpis = computeTagKpis(kpiStudentsScoped, studentTags, _instInRange);
  const setStatusFilter = (v: string) => { setTagKpiModalOpen(false); setStatusFilterRaw(v); };


  const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
  // Taxa Em Dia (regra item 9): exclui Aluno Novo do numerador e denominador.
  const denominadorEmDia = total - alunosNovos.length;
  const pctEmDia = denominadorEmDia > 0
    ? ((emDia.length / denominadorEmDia) * 100).toFixed(1)
    : '0.0';
  const paidCount = (s: Student) => s.installments.filter((i) => i.paid).length;
  const getStudentsList = (arr: Student[]) => arr.map((s) => s.name).join(', ') || 'Nenhum';

  // Display status for table rows (always current, table is independent)
  const displayStatus = (s: Student): StudentStatus => s.status;

  if (!ac) return <div className="p-12 text-center text-muted-foreground">Selecione um assessor no menu.</div>;


  // ── Score percentages for filter ──────────────────────────────────────────
  // Calculado sobre o MESMO universo que a tabela exibe por padrão
  // (exclui Pago, Cancelado e Renda Extra já conciliada quando não há
  // statusFilter ativo). Sem isso, o % mostrava 5★ mas, ao clicar, a tabela
  // ficava vazia porque os 5★ eram todos Pagos.
  const scoreBaseStudents = (() => {
    if (statusFilter) return acStudents; // usuário escolheu um status: respeita-o
    return acStudents.filter((s) => {
      if (s.statusCancelamento === 'cancelado') return false;
      if (s.status === 'Pago') return false;
      if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
      return true;
    });
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
            <p className="text-[11px] text-muted-foreground">Carteira do Assessor de Conta</p>
          </div>
        </div>

        {/* Velocímetro centralizado no topo (otimização de espaço) */}
        <div className="hidden sm:flex flex-1 justify-center">
          <div className="flex flex-col items-center">
            <MetaGauge
              value={Number(pctEmDia)}
              meta1={rules.meta1}
              meta2={rules.meta2}
              meta3={rules.meta3}
              size={170}
              showLabel={false}
            />
            <div className="flex items-baseline gap-1.5 -mt-12">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Taxa em Dia</span>
              <span className="text-sm font-bold text-foreground tracking-tight">{pctEmDia}%</span>
            </div>
          </div>
        </div>

        <NotificationBell acId={ac.id} onOpenStudent={handleOpenStudentFromNotif} />
      </div>

      {/* ── 1. Modo de Análise ──────────────────────────────────────────────────── */}
      <DashDateFilter
        mode={mode} setMode={setMode}
        perfPreset={perfPreset} setPerfPreset={setPerfPreset}
        perfCustomStart={perfCustomStart} setPerfCustomStart={setPerfCustomStart}
        perfCustomEnd={perfCustomEnd} setPerfCustomEnd={setPerfCustomEnd}
        historicoStart={historicoStart} setHistoricoStart={setHistoricoStart}
        historicoEnd={historicoEnd} setHistoricoEnd={setHistoricoEnd}
        variant="ac"
        hidePerformancePresets
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
            </div>
            {(() => {
              const { total, aVencer, pago, pagoReal, qtd, qtdAlunos } = getForecastTotals();
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
              const pctAV = total > 0 ? ((aVencer / total) * 100).toFixed(1) : '0.0';
              const pctPg = total > 0 ? ((pago / total) * 100).toFixed(1) : '0.0';
              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="kpi-fit rounded-xl border border-border bg-muted/30 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total</p>
                    <p className="kpi-value-fit text-foreground mt-0.5" title={formatCurrency(total)}>
                      {formatCurrency(total)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0">inclui pagas</p>
                  </div>
                  <div className="kpi-fit rounded-xl border border-amber-200/60 bg-amber-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">A Vencer / Vencido</p>
                    <p className="kpi-value-fit text-amber-700 mt-0.5" title={formatCurrency(aVencer)}>
                      {formatCurrency(aVencer)}
                    </p>
                    <p className="text-[10px] font-semibold text-amber-700 mt-0">{pctAV}%</p>
                  </div>
                  <div className="kpi-fit rounded-xl border border-emerald-200/60 bg-emerald-50/60 p-2 min-w-0">
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Pago</p>
                    <p className="kpi-value-fit text-emerald-700 mt-0.5" title={formatCurrency(pago)}>
                      {formatCurrency(pago)}
                    </p>
                    <p className="text-[10px] font-semibold text-emerald-700 mt-0">{pctPg}%</p>
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
          onClick={() => setStatusFilter('')}
          className={`min-w-0 text-left rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-primary transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-primary/30 ${statusFilter === '' ? 'ring-2 ring-primary/50' : ''}`}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Carteira Total</p>
            <Users size={16} className="text-primary/50 shrink-0" />
          </div>
          <p className="kpi-value text-primary" title={formatCurrency(totalValue)}>
            <span className="hidden sm:inline">{formatCurrency(totalValue)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(totalValue)}</span>
          </p>
          <div className="flex items-center justify-between mt-1 gap-2">
            <p className="text-[11px] text-muted-foreground truncate">{total} alunos</p>
            <p className="text-[11px] font-semibold text-primary shrink-0">100%</p>
          </div>
        </button>

        {/* Em Dia + Novos — soma agregada (clicável: aplica filtro "Em Dia" como atalho) */}
        <div className={`min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-teal-500 transition-all hover:-translate-y-0.5 relative cursor-pointer hover:ring-2 hover:ring-teal-500/30 ${statusFilter === 'Em Dia' ? 'ring-2 ring-teal-500/50' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'Em Dia' ? '' : 'Em Dia')}
        >
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Em Dia + Novos</p>
            <button onClick={(e) => { e.stopPropagation(); setInfoStatus(infoStatus === 'emdia_novos' ? null : 'emdia_novos'); }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <Info size={14} />
            </button>
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
          <p className="text-[11px] text-white/60 mt-1 truncate">{emDia.length} de {denominadorEmDia} (excl. novos)</p>
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
          <p className="kpi-value text-white">{pct(inadimplentes)}%</p>
          <p className="text-[11px] text-white/60 mt-1 truncate">{inadimplentes} de {total}</p>
        </div>
      </div>

      {/* ── KPIs: Solicitação Cancelamento + Fundo / TMF / Antecipação ──────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-stretch">
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
            <p className="text-[11px] text-muted-foreground truncate">{solicitacaoCancelamento.length} alunos</p>
            <p className="text-[11px] font-semibold text-fuchsia-600 shrink-0">{pct(solicitacaoCancelamento.length)}%</p>
          </div>
          {infoStatus === 'solic' && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-xl p-3 shadow-xl z-50 text-[11px] text-muted-foreground">
              <p>Alunos deste assessor que solicitaram cancelamento. O valor sai do status anterior (Em Dia/Vencido/etc.) e passa a compor este indicador até reversão ou cancelamento definitivo.</p>
            </div>
          )}
        </div>

        {tagKpis[0] && (
          <div
            onClick={() => { setTagKpiModalOpen(!tagKpiModalOpen); if (!tagKpiModalOpen) setStatusFilterRaw(''); }}
            className={`h-full min-w-0 cursor-pointer rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 ${tagKpis[0].color} transition-all hover:-translate-y-0.5 hover:ring-2 hover:ring-indigo-500/30 ${tagKpiModalOpen ? 'ring-2 ring-indigo-500/40' : ''}`}
          >
            <div className="flex items-start justify-between mb-2 gap-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">{tagKpis[0].label}</p>
              <ChevronDown size={14} className={`shrink-0 text-muted-foreground/60 transition-transform ${tagKpiModalOpen ? 'rotate-180' : ''}`} />
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

      {tagKpiModalOpen && tagKpis[0] && (
        <TagKpiInlineList
          label={tagKpis[0].label}
          students={tagKpis[0].students}
          onFilteredIdsChange={setFundoFilterIds}
          onClose={() => setTagKpiModalOpen(false)}
        />
      )}






      {(() => {
        const pendenteStudents = kpiStudents.filter((s) => s.status === 'Pendente');
        const pendenteCount = pendenteStudents.length;
        const pendenteValue = sumUnpaid(pendenteStudents);
        if (pendenteCount === 0) return null;
        return (
          <div
            className="bg-card border border-border rounded-2xl p-4 saas-shadow cursor-pointer hover:ring-2 hover:ring-yellow-400/40 transition-all"
            onClick={() => setStatusFilter(statusFilter === 'Pendente' ? '' : 'Pendente')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-yellow-100 flex items-center justify-center">
                  <AlertTriangle size={16} className="text-yellow-600" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pendências</p>
                  <p className="text-xl font-bold text-yellow-700">{pendenteCount}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Valor em carteira</p>
                <p className="text-sm font-bold text-yellow-700">{formatCurrency(pendenteValue)}</p>
              </div>
              {statusFilter === 'Pendente' && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-yellow-100 text-yellow-700 border border-yellow-200">
                  Filtro ativo
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 5. Indicadores Menores: Média pgto, Renda Extra, Revertidos ───────── */}
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

        {(() => {
          const acCases = cancellationCases.filter((c) => c.ac === ac?.name);
          const revertidos = acCases.filter((c) => c.stage === 'Recuperado' || c.stage === 'Negativação Retirada');
          const revertPct = acCases.length > 0 ? Math.round((revertidos.length / acCases.length) * 100) : 0;
          return (
            <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 saas-shadow">
              <TrendingUp size={13} className="text-emerald-500" />
              <span className="text-[11px] text-muted-foreground">Revertidos:</span>
              <span className="text-[11px] font-semibold text-emerald-600">{revertidos.length}/{acCases.length} | {revertPct}%</span>
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
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          className="input-field pl-8 w-full"
          placeholder="Buscar aluno..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ── Students Table ────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden saas-shadow">
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
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateBR(nextDueDate(student))}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          {student.statusCancelamento === 'solicitado' ? (
                            /* Solicitação de cancelamento sobrepõe visualmente qualquer outro status */
                            <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200">
                              Solicitação Cancelamento
                            </span>
                          ) : (
                            <>
                              {/* Renda Extra in final stages: show only "Renda Extra" as primary status */}
                              {isRendaExtraAtivo(student) && student.rendaExtraStatus !== 'Conciliar Exclusão' ? (
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-purple-100 text-purple-700 border border-purple-300">
                                  Renda Extra
                                </span>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5">
                                    <StatusBadgeManual student={student} status={tableStatus} />
                                    {tableStatus !== 'Em Dia' && tableStatus !== 'Pago' && (() => {
                                      const dias = calcularDiasVencido(student.installments);
                                      return dias && dias > 0 ? (
                                        <span className="text-[9px] font-bold text-destructive">
                                          {dias}d
                                        </span>
                                      ) : null;
                                    })()}
                                  </div>
                                  {/* Renda Extra in Conciliar stage: show secondary badge */}
                                  {isRendaExtraAtivo(student) && student.rendaExtraStatus === 'Conciliar Exclusão' && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded w-fit bg-slate-200 text-slate-600 border border-slate-300">
                                      Renda Extra
                                    </span>
                                  )}
                                </>
                              )}
                              {student.statusCancelamento && student.statusCancelamento !== 'nenhum' && cancelStatusConfig[student.statusCancelamento] && !(student.statusCancelamento === 'revertido' && student.status === 'Pago') && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded w-fit ${cancelStatusConfig[student.statusCancelamento].color}`}>
                                  {cancelStatusConfig[student.statusCancelamento].label}
                                </span>
                              )}
                            </>
                          )}
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
                          <button
                            onClick={() => { setFinancialBanner(null); setFinancialStudent(student); }}
                            className="action-btn !border-emerald-300 !text-emerald-600 hover:!bg-emerald-50"
                            title="Pagamento"
                          >
                            <DollarSign size={12} />
                          </button>
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
                          {(!student.statusCancelamento || student.statusCancelamento === 'nenhum' || student.statusCancelamento === 'revertido') && (
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
        />
      )}
      {historyStudent && (
        <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />
      )}
      {flowStudent && (
        <FlowModal student={flowStudent} onClose={() => setFlowStudent(null)} />
      )}
      {viewStudent && (
        <StudentViewModal student={viewStudent} onClose={() => setViewStudent(null)} />
      )}
      {deleteId && (
        <DeleteModal
          onConfirm={() => { deleteStudent(deleteId); setDeleteId(null); }}
          onClose={() => setDeleteId(null)}
        />
      )}

      {/* Cancellation Modal — mesma questionário completo da aba Alunos */}
      {cancellationStudent && (
        <CancelStudentFlowModal
          student={cancellationStudent}
          onClose={() => { setCancellationStudent(null); setSelectedMotivo(''); }}
        />

      )}
    </div>
  );
}
