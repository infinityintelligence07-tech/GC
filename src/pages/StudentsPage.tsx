import { useState, useEffect, useRef } from 'react';
import { Student, StudentStatus, StudentTag, canEditTab } from '@/types';
import { useAppStore, formatCurrency, calculateStudentAutoStatus, calcularScoreComportamento } from '@/store/useAppStore';
import { cancelamentoOverridesFinancialStatus, matchesCancelamentoFilter } from '@/lib/acPortfolioVisibility';
import { getCancelamentoBadge, resolveStudentDisplayStatus, isOperationalPendente } from '@/lib/studentDisplayStatus';
import StudentModal from '@/components/modals/StudentModal';
import FinancialModal from '@/components/modals/FinancialModal';
import HistoryModal from '@/components/modals/HistoryModal';
import FlowModal from '@/components/modals/FlowModal';
import DeleteModal from '@/components/modals/DeleteModal';
import ImportStudentsModal from '@/components/modals/ImportStudentsModal';
import CancelDivergenceEditModal from '@/components/modals/CancelDivergenceEditModal';
import { MOTIVOS_CANCELAMENTO } from '@/types';
import { Plus, Search, DollarSign, Clock, Trash2, Eye, XCircle, ChevronDown, ChevronUp, Star, RotateCcw, Calendar, Upload, Download, Tag, FileText, PencilLine } from 'lucide-react';
import * as XLSX from 'xlsx';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import { statusColors } from '@/lib/statusColors';
import { calcularDiasVencido, dueDateForDisplay } from '@/lib/brasiliaDate';
import { getTagStyle } from '@/lib/tagColors';
import { studentMatchesTagFilter, applyTagFilterToStudent, getVisibleStudentTagRefs } from '@/lib/tagFilter';
import TagMultiSelect from '@/components/ui/TagMultiSelect';
import StatusBadgeManual from '@/components/ui/StatusBadgeManual';
import { getDisplayInstallmentValue, normalizeSearch, toDisplayName } from '@/lib/utils';
import { needsIamGcConciliacaoApproval } from '@/lib/iamPendenteConciliacao';
import { resolveStudentDisplayStatusVinculado, type StatusVinculado } from '@/lib/recompraVinculo';
import { isRecompraFicha } from '@/lib/recompraConciliacao';


// ── Score stars renderer ───────────────────────────────────────────────────────
function ScoreStars({ score }: { score: number }) {
  // Score 0 indica aluno novo (sem histórico de pagamento ainda)
  if (score === 0) {
    return (
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 border border-blue-300 text-[10px] font-bold text-blue-700"
        title="Novo aluno (sem histórico de pagamento)"
      >
        N
      </span>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={10}
          className={s <= score ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'}
        />
      ))}
    </div>
  );
}

function resolveAssignedStudentTags(student: Student, studentTags: StudentTag[], activeTagFilters: string[]) {
  const refs = getVisibleStudentTagRefs(student);
  const refsLower = new Set(refs.map((ref) => ref.toLowerCase()));
  const activeIds = new Set(activeTagFilters);

  return studentTags.filter((tag) =>
    refs.includes(tag.id) ||
    refsLower.has(tag.name.toLowerCase()) ||
    (activeIds.has(tag.id) && studentMatchesTagFilter(student, [tag.id]))
  );
}

// Detecta se o aluno tem parcela ATIVA (não paga) marcada como Recompra.
// Considera tag por ID (studentTags) ou por nome literal ("Recompra" / prefixo __recompra__).
function hasActiveRecompra(student: Student, studentTags: StudentTag[]): boolean {
  const recompraTagIds = new Set(
    studentTags.filter((t) => /recompra/i.test(t.name)).map((t) => t.id)
  );
  return (student.installments || []).some((i) => {
    if (i.paid) return false;
    const tags = i.tags ?? [];
    return tags.some((t) => {
      if (!t) return false;
      if (recompraTagIds.has(t)) return true;
      const lower = t.toLowerCase();
      return lower.startsWith('__recompra__:') || lower.includes('recompra');
    });
  });
}

// ── Status cancelamento badge (legado — preferir studentDisplayStatus) ────────
const cancelStatusConfig: Record<string, { label: string; color: string }> = {
  solicitado: { label: 'Solicitação Cancelamento', color: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200' },
  em_tratamento: { label: 'Em Tratamento', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  juridico: { label: 'Solicitação Cancelamento', color: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200' },
  aguardando_conciliacao: { label: 'Conciliação Pendente', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  pagamento_multa_pendente: { label: 'Pagamento Multa Pendente', color: 'bg-amber-100 text-amber-700 border border-amber-300' },
  revertido: { label: 'Revertido', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
};

export default function StudentsPage() {
  const { students: allStudents, deleteStudent, updateStudent, cancelStudentToFlow, studentTags, toggleStudentTag, currentUser, acs, rules, cancellationCases } = useAppStore();
  // Scope by AC for ac/acn2 roles
  const myACName = (currentUser?.role === 'ac' || currentUser?.role === 'acn2') && currentUser.acId
    ? acs.find((a) => a.id === currentUser.acId)?.name
    : undefined;
  const students = myACName ? allStudents.filter((s) => s.ac === myACName) : allStudents;

  const [search, setSearch] = useState('');
  const [acFilter, setAcFilter] = useState<string>('');
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StudentStatus | 'cancelado' | 'cancelamento_solicitado' | 'renda_extra' | 'pendente' | ''>('');
  const [dueDateStart, setDueDateStart] = useState('');
  const [dueDateEnd, setDueDateEnd] = useState('');
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);
  const historyFileRef = useRef<HTMLInputElement>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [financialStudent, setFinancialStudent] = useState<Student | null>(null);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [flowStudent, setFlowStudent] = useState<Student | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [actionStudentId, setActionStudentId] = useState<string | null>(null);
  const [selectedMotivo, setSelectedMotivo] = useState<typeof MOTIVOS_CANCELAMENTO[number] | ''>('');
  const [cancelDentro7Dias, setCancelDentro7Dias] = useState<boolean | null>(null);
  const [cancelCom30Dias, setCancelCom30Dias] = useState<boolean | null>(null);
  const [cancelDataEvento, setCancelDataEvento] = useState('');
  const [cancelDescricao, setCancelDescricao] = useState('');
  const [cancelTotalPago, setCancelTotalPago] = useState('');
  const [cancelQtdInscricoes, setCancelQtdInscricoes] = useState('');
  const [cancelDataSolicitacao, setCancelDataSolicitacao] = useState(() => new Date().toISOString().slice(0, 10));
  const [showDivergenciaModal, setShowDivergenciaModal] = useState(false);
  const [showDivergenciaEdit, setShowDivergenciaEdit] = useState(false);
  const [divergenciaAjusteTag, setDivergenciaAjusteTag] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [recompraFilter, setRecompraFilter] = useState(false);
  const [tagPopoverStudent, setTagPopoverStudent] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'venc' | 'status' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (key: 'venc' | 'status') => {
    if (sortBy !== key) { setSortBy(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else { setSortBy(null); setSortDir('asc'); }
  };
  const nextDueDate = (s: Student) => {
    const insts = Array.isArray(s.installments) ? s.installments : [];
    const next = [...insts].filter((i) => !i.paid).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
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


  // Auto-update statuses
  useEffect(() => {
    students.forEach((s) => {
      // "Negativado" é um estado exclusivamente manual: uma vez definido, só
      // sai via ação explícita do usuário (badge → "Voltar para Em Dia",
      // Admin → "Reverter para À Negativar", ou migração automática p/ Renda
      // Extra >180d). NÃO rebaixamos por auto-cálculo aqui, sob nenhuma
      // condição — nem quando statusMode='Automático' (pois pode ter ficado
      // inconsistente após um toggle acidental na ficha).
      // "Revertido" é um lembrete que acompanha o status normal (Em Dia,
      // Vencido 1/2 etc.) até o contrato ser quitado — aí o lembrete some.
      // Uma nova solicitação de cancelamento também substitui esse estado.
      if (
        s.statusCancelamento === 'revertido' &&
        s.installments.length > 0 &&
        s.installments.every((i) => i.paid)
      ) {
        updateStudent(s.id, { statusCancelamento: null });
      }
      if (s.status === 'Negativado') return;
      // Pendência IAM: restaura Pendente/Manual até aprovação na Conciliação GC.
      if (needsIamGcConciliacaoApproval(s)) {
        if (s.status !== 'Pendente' || s.statusMode !== 'Manual') {
          updateStudent(s.id, { status: 'Pendente', statusMode: 'Manual' });
        }
        return;
      }
      if (s.status === 'Pendente') return;
      // Cancelamento ativo: não recalcula Vencido; mantém status de solicitação na ficha.
      if (cancelamentoOverridesFinancialStatus(s)) {
        if (
          s.status !== 'Solicitação Cancelamento' &&
          s.status !== 'Cancelado' &&
          s.statusCancelamento !== 'cancelado'
        ) {
          updateStudent(s.id, {
            status: 'Solicitação Cancelamento',
            statusMode: 'Manual',
          });
        }
        return;
      }
      if (s.statusMode === 'Automático') {
        const autoStatus = calculateStudentAutoStatus(s);
        if (autoStatus !== s.status) updateStudent(s.id, { status: autoStatus });
      } else {
        // Safety net: se foi marcado manualmente como não-vencido (ex.: "Em Dia")
        // mas surgiu parcela vencida depois, reverte p/ Automático apontando vencido.
        // Não aplica a Pendente (pagamento fora de boleto / IAM).
        if (s.status === 'Pendente') return;
        const autoStatus = calculateStudentAutoStatus(s);
        const isOverdueNow = autoStatus === 'Vencido 1' || autoStatus === 'Vencido 2';
        const manualSaysNotOverdue = s.status !== 'Vencido 1' && s.status !== 'Vencido 2';
        if (isOverdueNow && manualSaysNotOverdue) {
          updateStudent(s.id, { statusMode: 'Automático', status: autoStatus });
        }
      }
    });
  }, [students, updateStudent]);

  // ── Espelhos de cancelamentos cadastrados manualmente ("Cadastrar Cancelamento") ──
  // Casos importados via botão externo não têm aluno cadastrado. Criamos um
  // registro virtual (somente visualização) apenas na aba Alunos — nunca na
  // carteira do assessor.
  const mirrorStudents = (() => {
    if (myACName) return [];
    return cancellationCases
      .filter((c) => c.externalImport && !c.studentId)
      .map((c) => {
        const revertido = c.acao === 'Revertido';
        const cancelado = !revertido && (c.acao === 'Cancelado' || c.funnelStage === 'Finalizado');
        const status: StudentStatus = revertido ? 'Pago' : cancelado ? 'Cancelado' : 'Solicitação Cancelamento';
        const mirror = {
          id: `mirror-case-${c.id}`,
          name: c.studentName,
          whatsapp: c.studentWhatsapp ?? '',
          email: '',
          cpf: '',
          status,
          statusMode: 'Manual',
          statusCancelamento: revertido ? 'revertido' : cancelado ? 'cancelado' : 'solicitado',
          ac: c.ac ?? '',
          product: c.treinamento ?? '',
          enrollmentDate: (c.createdAt || '').slice(0, 10),
          dueDay: 1,
          saleValue: c.value ?? 0,
          downPayment: 0,
          totalInstallments: 0,
          paidInstallments: 0,
          installmentValue: 0,
          installments: [],
          history: [],
          isRendaExtra: false,
          tags: [],
          createdAt: c.createdAt,
          updatedAt: c.createdAt,
        } as unknown as Student;
        return { ...mirror, _score: 0, _mirrorCaseId: c.id };
      });
  })();

  const processedStudents = [...students.map((s) => {
    // Garante shape mínimo para evitar "tela branca" caso o backend devolva
    // um aluno sem installments/tags/name/ac (ex.: importações parciais).
    const safe: Student = {
      ...s,
      name: s.name ?? '',
      ac: s.ac ?? '',
      tags: Array.isArray(s.tags) ? s.tags : [],
      installments: Array.isArray(s.installments) ? s.installments : [],
    };
    // "Negativado" é sempre preservado, mesmo quando statusMode='Automático'
    // (evita rebaixamento visual durante a janela até o safety-net corrigir).
    // Recompra vinculada ↔ contrato original leem o mesmo status (união das
    // parcelas dos dois lados): devendo em um, devendo nos dois.
    const vinculo = resolveStudentDisplayStatusVinculado(safe, students);
    const withStatus = { ...safe, status: vinculo.status };
    const filtered = tagFilters.length > 0 ? applyTagFilterToStudent(withStatus, tagFilters) : withStatus;
    return {
      ...filtered,
      _score: calcularScoreComportamento(safe.installments),
      _mirrorCaseId: undefined as string | undefined,
      _vinculo: vinculo as StatusVinculado | undefined,
    };
  }), ...mirrorStudents.map((m) => ({ ...m, _vinculo: undefined as StatusVinculado | undefined }))];


  const filtered = processedStudents.filter((s) => {
    // Busca por nome ou CPF (com/sem máscara)
    if (search) {
      const q = normalizeSearch(search);
      const qDigits = search.replace(/\D/g, '');
      const nameHit = normalizeSearch(s.name).includes(q);
      const cpfDigits = (s.cpf || '').replace(/\D/g, '');
      const cpfHit = qDigits.length >= 3 && cpfDigits.includes(qDigits);
      if (!nameHit && !cpfHit) return false;
    }

    // Assessor filter: apenas AC
    if (acFilter && (s.ac || '') !== acFilter) return false;

    // Score filter
    if (scoreFilter !== null && s._score !== scoreFilter) return false;

    // Status filter (financial status + special statuses)
    if (statusFilter) {
      if (statusFilter === 'cancelamento_solicitado' && !matchesCancelamentoFilter(s, cancellationCases)) return false;
      if (statusFilter === 'cancelado' && s.statusCancelamento !== 'cancelado') return false;
      if (statusFilter === 'renda_extra') {
        // Filtro "Renda Extra" mostra APENAS alunos já conciliados (saíram de "Conciliar Exclusão")
        if (!(isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão')) return false;
      }
      if (statusFilter === 'Pago' && s.status !== 'Pago') return false;
      if (statusFilter === 'Pendente' && !isOperationalPendente(s)) return false;
      if (!['cancelamento_solicitado', 'cancelado', 'renda_extra', 'Pago', 'Pendente'].includes(statusFilter) && s.status !== statusFilter) return false;
    }

    // Tag filter — usa helper (suporta tags por aluno OU por parcela)
    if (!studentMatchesTagFilter(s, tagFilters)) return false;

    // Due date filter (vencimento)
    if (dueDateStart || dueDateEnd) {
      const unpaid = s.installments.filter((i) => !i.paid);
      if (unpaid.length === 0) return false;
      const hasDueInRange = unpaid.some((inst) => {
        const dueDate = inst.dueDate;
        if (dueDateStart && dueDate < dueDateStart) return false;
        if (dueDateEnd && dueDate > dueDateEnd) return false;
        return true;
      });
      if (!hasDueInRange) return false;
    }

    // Filtro Recompra Ativa
    if (recompraFilter && !hasActiveRecompra(s, studentTags)) return false;

    return true;
  });

  // Contagem de alunos com Recompra Ativa (sobre a base pré-filtro, para KPI real)
  const recompraAtivaCount = processedStudents.filter((s) => hasActiveRecompra(s, studentTags)).length;

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

  const paidCount = (s: Student) => (s.installments || []).filter((i) => i.paid).length;
  // Contrato quitado à vista / cartão integral: sync IAM entrega a venda inteira
  // como entrada e zero parcelas. Sem este caso a linha mostra "0/0" e "R$ 0,00".
  const isQuitadoAvistaSemParcelas = (s: Student) =>
    (s.installments || []).length === 0 &&
    (s.totalInstallments || 0) === 0 &&
    (s.saleValue || 0) > 0 &&
    (s.downPayment || 0) >= (s.saleValue || 0) - 0.01;

  // Detecta se algum filtro está ativo. Quando nenhum filtro está ativo,
  // exporta TODOS os alunos (inclusive Pagos / Cancelados / Renda Extra).
  const hasActiveFilter = Boolean(
    search || acFilter || scoreFilter !== null || statusFilter || tagFilters.length > 0 || dueDateStart || dueDateEnd || recompraFilter
  );

  const fmtBR = (iso?: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    if (!y || !m || !d) return '';
    return `${d}/${m}/${y}`;
  };

  const handleExportKamino = () => {
    // Sem filtro: usa lista completa (já escopada por AC quando aplicável),
    // incluindo Pagos, Cancelados e Renda Extra. Com filtro: usa lista filtrada.
    const source: Student[] = hasActiveFilter ? sorted : students;
    const rows: Record<string, string | number>[] = [];
    source.forEach((s) => {
      const insts = (s.installments || []).slice().sort((a, b) => a.number - b.number);
      const baseCentroCusto = s.ac ? `IAM - GC (${s.ac})` : 'IAM - GC';
      if (insts.length === 0) {
        rows.push({
          'Pessoa': s.name,
          'Telefone': s.whatsapp || '',
          'E-mail': s.email || '',
          'Classificação': s.product || '',
          'Centro de Custo': baseCentroCusto,
          'Conta de Recebimento': '',
          'Forma de Recebimento': '',
          'Detalhe': '',
          'Valor a Receber (R$)': '',
          'Valor Recebido (R$)': '',
          'Vencimento': '',
          'Recebimento': '',
          'Competência': fmtBR(s.enrollmentDate),
        });
        return;
      }
      insts.forEach((inst, idx) => {
        const isPaid = inst.paid;
        const valor = Number(inst.value || 0);
        const valorRecebido = isPaid ? Number(inst.paidValue ?? inst.value ?? 0) : '';
        rows.push({
          'Pessoa': idx === 0 ? s.name : '',
          'Telefone': idx === 0 ? (s.whatsapp || '') : '',
          'E-mail': idx === 0 ? (s.email || '') : '',
          'Classificação': idx === 0 ? (s.product || '') : '',
          'Centro de Custo': baseCentroCusto,
          'Conta de Recebimento': '',
          'Forma de Recebimento': '',
          'Detalhe': `Parcela ${inst.number}/${insts.length}`,
          'Valor a Receber (R$)': valor,
          'Valor Recebido (R$)': valorRecebido,
          'Vencimento': fmtBR(inst.dueDate),
          'Recebimento': isPaid ? fmtBR(inst.paidDate) : '',
          'Competência': idx === 0 ? fmtBR(s.enrollmentDate) : '',
        });
      });
    });

    const header = [
      'Pessoa', 'Telefone', 'E-mail', 'Classificação', 'Centro de Custo',
      'Conta de Recebimento', 'Forma de Recebimento', 'Detalhe',
      'Valor a Receber (R$)', 'Valor Recebido (R$)', 'Vencimento', 'Recebimento', 'Competência',
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kamino');
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const suffix = hasActiveFilter ? 'filtrado' : 'completo';
    XLSX.writeFile(wb, `alunos-kamino-${suffix}-${stamp}.xlsx`);
  };

  // ── Histórico: exporta / importa (chave: cpf → fallback nome) ─────────────
  const normalizeName = (n: string) => (n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizeCpf = (c: string) => (c || '').replace(/\D/g, '');

  const handleExportHistory = () => {
    const payload = students
      .filter((s) => Array.isArray(s.history) && s.history.length > 0)
      .map((s) => ({ nome: s.name, cpf: s.cpf || '', history: s.history }));
    if (payload.length === 0) {
      alert('Nenhum aluno com histórico para exportar.');
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `historico-alunos-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportHistory = async (file: File) => {
    try {
      const text = await file.text();
      const rows = JSON.parse(text);
      if (!Array.isArray(rows)) throw new Error('Arquivo JSON deve ser uma lista de alunos.');
      const byCpf = new Map<string, Student>();
      const byName = new Map<string, Student>();
      students.forEach((s) => {
        const cpf = normalizeCpf(s.cpf || '');
        if (cpf) byCpf.set(cpf, s);
        byName.set(normalizeName(s.name), s);
      });
      let matched = 0, notFound = 0, mergedEntries = 0;
      for (const row of rows) {
        if (!row || !Array.isArray(row.history)) continue;
        const cpf = normalizeCpf(row.cpf || '');
        const nameKey = normalizeName(row.nome || row.name || '');
        const target = (cpf && byCpf.get(cpf)) || (nameKey && byName.get(nameKey));
        if (!target) { notFound++; continue; }
        matched++;
        const existing = target.history || [];
        const seen = new Set(existing.map((h: any) => `${h.date}||${h.type}||${h.text}`));
        const additions = row.history.filter((h: any) => h && !seen.has(`${h.date}||${h.type}||${h.text}`));
        if (additions.length === 0) continue;
        const combined = [...existing, ...additions].sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
        updateStudent(target.id, { history: combined });
        mergedEntries += additions.length;
      }
      alert(`Histórico importado.\n\nAlunos encontrados: ${matched}\nNão encontrados: ${notFound}\nEntradas adicionadas: ${mergedEntries}`);
    } catch (e: any) {
      alert(`Falha ao importar histórico: ${e?.message || e}`);
    } finally {
      if (historyFileRef.current) historyFileRef.current.value = '';
    }
  };


  return (
    <div className="space-y-4">
      {/* Search + filters row */}
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <div className="relative min-w-[180px] flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="input-field pl-8 w-full"
              placeholder="Buscar por nome ou CPF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Assessor filter */}
          <select
            className="input-field text-xs py-1"
            value={acFilter}
            onChange={(e) => setAcFilter(e.target.value)}
          >
            <option value="">Todos (Assessor)</option>
            {acs.map((ac) => (
              <option key={ac.id} value={ac.name}>{ac.name}</option>
            ))}
          </select>

          {/* Score filter */}
          <div className="flex items-center gap-1 bg-muted/60 rounded-lg px-2 py-1">
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
                {v === null ? 'Todos' : v === 0 ? 'N' : `${v}★`}
              </button>
            ))}
          </div>

          {/* Financial status filter */}
          <select
            className="input-field text-xs py-1"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StudentStatus | 'cancelado' | 'cancelamento_solicitado' | 'renda_extra' | 'pendente' | '')}
          >
            <option value="">Todos (Status)</option>
            <option value="Em Dia">Em dia</option>
            <option value="Vencido 1">Vencido 1</option>
            <option value="Vencido 2">Vencido 2</option>
            <option value="À Negativar">À negativar</option>
            <option value="Negativado">Negativado</option>
            <option value="Pendente">Pendente</option>
            <option value="cancelamento_solicitado">Cancelamento solicitado</option>
            <option value="Pago">Pago</option>
            <option value="cancelado">Cancelado</option>
            <option value="renda_extra">Renda extra</option>
          </select>

          {/* Tag filter (multi-select dropdown) */}
          <TagMultiSelect studentTags={studentTags} tagFilters={tagFilters} setTagFilters={setTagFilters} />

          {/* Recompra Ativa — indicador pequeno com filtro */}
          {recompraAtivaCount > 0 && (
            <button
              type="button"
              onClick={() => setRecompraFilter((v) => !v)}
              title="Alunos com parcela reaberta por Recompra (cobrança direta ativa)"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all ${
                recompraFilter
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <RotateCcw size={11} />
              Recompra Ativa
              <span className={`px-1.5 rounded-md font-bold ${recompraFilter ? 'bg-white/20' : 'bg-amber-200/70'}`}>
                {recompraAtivaCount}
              </span>
            </button>
          )}

          {/* Due date filter */}
          <div className="flex items-center gap-1">
            <Calendar size={13} className="text-muted-foreground" />
            <input
              type="date"
              className="input-field text-xs py-1"
              placeholder="Início"
              value={dueDateStart}
              onChange={(e) => setDueDateStart(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">até</span>
            <input
              type="date"
              className="input-field text-xs py-1"
              placeholder="Fim"
              value={dueDateEnd}
              onChange={(e) => setDueDateEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowDataMenu((v) => !v)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-muted/60 text-foreground border border-border hover:bg-muted transition-colors"
              title="Importar e exportar dados"
            >
              <FileText size={14} /> Dados <ChevronDown size={12} className="opacity-60" />
            </button>
            {showDataMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDataMenu(false)} />
                <div className="absolute right-0 mt-1 w-64 bg-card border border-border rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Alunos (Kamino)</div>
                  <button
                    onClick={() => { handleExportKamino(); setShowDataMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                    title={hasActiveFilter ? 'Exportar alunos filtrados' : 'Exportar TODOS os alunos'}
                  >
                    <Download size={13} className="text-emerald-600" /> Exportar Kamino
                  </button>
                  <button
                    onClick={() => { setShowImportModal(true); setShowDataMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Upload size={13} className="text-blue-600" /> Importar Alunos
                  </button>
                  <div className="my-1 border-t border-border" />
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Histórico (JSON)</div>
                  <button
                    onClick={() => { handleExportHistory(); setShowDataMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                    title="Baixa o histórico de todos os alunos em JSON (chave: CPF, fallback nome)"
                  >
                    <Download size={13} className="text-slate-600" /> Exportar Histórico
                  </button>
                  <button
                    onClick={() => { historyFileRef.current?.click(); setShowDataMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                    title="Restaura o histórico a partir de um JSON, casando por CPF (fallback nome)"
                  >
                    <Upload size={13} className="text-slate-600" /> Importar Histórico
                  </button>
                </div>
              </>
            )}
            <input
              ref={historyFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportHistory(f); }}
            />
          </div>
          <button
            onClick={() => { setEditingStudent(null); setShowStudentModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all"
          >
            <Plus size={14} /> Novo Aluno
          </button>
        </div>
      </div>

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
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">AC</th>
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
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Nenhum aluno encontrado.
                  </td>
                </tr>
              ) : (
                sorted.map((student) => {
                  const sc = student.statusCancelamento;
                  const isMirrorRow = !!student._mirrorCaseId;
                  return (
                    <tr key={student.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${sc === 'cancelado' ? 'opacity-60' : ''} ${isMirrorRow ? 'bg-sky-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground normal-case">{toDisplayName(student.name)}</span>
                            {student.ciclo && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 border border-indigo-300 whitespace-nowrap" title={`Ciclo do contrato: ${student.ciclo}`}>
                                {student.ciclo}
                              </span>
                            )}
                            {isMirrorRow && (
                              <span
                                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 border border-sky-300 whitespace-nowrap"
                                title="Espelho de um cancelamento cadastrado manualmente — somente para visualização. Não compõe carteira."
                              >
                                <Eye size={9} /> Somente visualização
                              </span>
                            )}
                          </div>
                          {student.product && (
                            <span className="text-[9px] font-normal text-muted-foreground leading-none" title={student.product}>
                              {student.product}
                            </span>
                          )}
                          {(() => {
                            const grp = student._vinculo?.group;
                            if (!grp) return null;
                            if (isRecompraFicha(student)) {
                              return (
                                <span
                                  className="inline-flex items-center gap-1 w-fit text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 leading-none"
                                  title={`Recompra vinculada ao contrato "${grp.original.product}". Status lido em conjunto com o contrato original: devendo em um, devendo nos dois.`}
                                >
                                  <RotateCcw size={9} /> Vinculada a {grp.original.product}
                                </span>
                              );
                            }
                            return (
                              <span
                                className="inline-flex items-center gap-1 w-fit text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 leading-none"
                                title={`${grp.recompras.length} recompra(s) vinculada(s) a este contrato. Status lido em conjunto: devendo em um, devendo nos dois.`}
                              >
                                <RotateCcw size={9} /> {grp.recompras.length === 1 ? '1 recompra vinculada' : `${grp.recompras.length} recompras vinculadas`}
                              </span>
                            );
                          })()}
                          {isMirrorRow && (
                            <span className="text-[9px] text-sky-700/80 leading-none">Espelho do caso em Cancelamentos</span>
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
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {student.ac?.trim() ? student.ac : (
                          <span className="italic text-muted-foreground/60" title="Ficha sem assessor vinculado">— sem assessor —</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[12rem]">
                        <div className="flex flex-col gap-1 items-start min-w-0">
                          {(() => {
                            const cancelBadge = getCancelamentoBadge(student);
                            const cancelOverrides = cancelamentoOverridesFinancialStatus(student);
                            // Cancelamento ativo: só o badge de cancelamento (sem Vencido/Em Dia por baixo).
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
                              const display = student._vinculo?.status ?? resolveStudentDisplayStatus(student);
                              return (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg max-w-full whitespace-normal break-words leading-snug ${statusColors[display] ?? 'bg-muted'}`}
                                  title={display}
                                >
                                  {display}
                                </span>
                              );
                            }
                            // Sem cancelamento ativo: status financeiro (+ lembrete Revertido, se houver).
                            return (
                            <>
                              {isRendaExtraAtivo(student) && student.rendaExtraStatus !== 'Conciliar Exclusão' ? (
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-purple-100 text-purple-700 border border-purple-300">
                                  Renda Extra
                                </span>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    <StatusBadgeManual student={student} status={student._vinculo?.status ?? resolveStudentDisplayStatus(student)} />
                                    {student.status !== 'Em Dia' && student.status !== 'Pago' && student.status !== 'Pendente' && student.status !== 'Solicitação Cancelamento' && (() => {
                                      // Com vínculo recompra ↔ original, o atraso é o do conjunto.
                                      const instsAtraso = student._vinculo?.group ? student._vinculo.installments : student.installments;
                                      const dias = calcularDiasVencido(instsAtraso);
                                      const due = nextDueDateUi(student);
                                      const viaVinculo = !!student._vinculo?.group && (calcularDiasVencido(student.installments) ?? 0) < (dias ?? 0);
                                      return dias && dias > 0 ? (
                                        <span
                                          className="text-[9px] font-bold text-destructive shrink-0"
                                          title={viaVinculo
                                            ? `${dias} dia(s) em atraso no contrato vinculado (${isRecompraFicha(student) ? 'contrato original' : 'recompra'}).`
                                            : due.rolledFromWeekend
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
                              {/* Só "Revertido" como sub-badge — cancelamento ativo nunca empilha com Vencido */}
                              {sc === 'revertido' && student.status !== 'Pago' && cancelStatusConfig.revertido && (
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
                        {isMirrorRow ? <span className="text-xs text-muted-foreground">—</span> : <ScoreStars score={student._score} />}
                      </td>
                      <td className="px-4 py-3">
                        {isMirrorRow ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : isQuitadoAvistaSemParcelas(student) ? (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap"
                            title="Contrato quitado à vista / cartão integral — sem parcelas a receber"
                          >
                            À vista
                          </span>
                        ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{paidCount(student)}/{student.totalInstallments}</span>
                          <button
                            onClick={() => setFlowStudent(student)}
                            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                            title="Ver fluxo de pagamento"
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-foreground">
                        {isMirrorRow ? (
                          <span className="whitespace-nowrap text-muted-foreground">{formatCurrency(student.saleValue || 0)}</span>
                        ) : isQuitadoAvistaSemParcelas(student) ? (
                          <span className="whitespace-nowrap" title="Valor pago à vista (entrada = valor da venda)">
                            {formatCurrency(student.downPayment || 0)}
                            <span className="ml-1 text-[9px] font-medium text-muted-foreground">(pago)</span>
                          </span>
                        ) : (() => {
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
                        {isMirrorRow ? (
                          <span className="text-[10px] text-muted-foreground italic">Gerenciado na aba Cancelamentos</span>
                        ) : (
                        <div className="flex items-center gap-1.5">

                          <button
                            onClick={() => { setEditingStudent(student); setShowStudentModal(true); }}
                            className="action-btn" title="Editar"
                          >✏️</button>
                          <button
                            onClick={() => setFinancialStudent(student)}
                            className="action-btn !border-emerald-300 !text-emerald-600 hover:!bg-emerald-50"
                            title="Pagamento"
                          >
                            <DollarSign size={12} />
                          </button>
                          <button onClick={() => setHistoryStudent(student)} className="action-btn" title="Histórico">
                            <Clock size={12} />
                          </button>

                          {/* Tag popover — somente visualização (edição pelo modal do aluno) */}
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
                                    // IMPORTANTE: ler do aluno ORIGINAL (allStudents),
                                    // não da versão recalculada por filtro de tag —
                                    // senão tags em parcelas excluídas pelo filtro somem.
                                    const original = allStudents.find((s) => s.id === student.id) ?? student;
                                    const ativas = resolveAssignedStudentTags(original, studentTags, tagFilters);
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

                          {/* X button:
                              - Admin sempre vê (pode excluir mesmo com caso ativo).
                              - Demais perfis só veem quando ainda dá para solicitar cancelamento
                                pela aba Alunos (sem caso ativo e sem Revertido — Revertido usa
                                "REATIVAR CASO" no Finalizado). */}
                          {(currentUser?.role === 'admin' ||
                            !student.statusCancelamento ||
                            student.statusCancelamento === 'nenhum') && (
                            <button
                              onClick={() => setActionStudentId(student.id)}
                              className="action-btn text-destructive hover:!bg-destructive/10"
                              title="Mais ações"
                            >
                              <XCircle size={12} />
                            </button>
                          )}
                        </div>
                        )}
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
      {showStudentModal && <StudentModal student={editingStudent} onClose={() => setShowStudentModal(false)} />}
      <ImportStudentsModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} />
      {financialStudent && (
        <FinancialModal
          student={financialStudent}
          onClose={() => setFinancialStudent(null)}
          // Regra: só admin e usuários com função de Conciliação editam a
          // partir da aba Alunos — nesses casos o ajuste é conciliado
          // automaticamente. Para qualquer outro perfil (ACs etc.) que
          // eventualmente acesse este modal, o ajuste vai para a aba
          // Conciliação aguardando aprovação.
          immediateApply={currentUser?.role === 'admin' || currentUser?.role === 'conciliacao'}
        />
      )}
      {historyStudent && <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />}
      {flowStudent && <FlowModal student={flowStudent} onClose={() => setFlowStudent(null)} />}
      {deleteId && (
        <DeleteModal
          onConfirm={() => { deleteStudent(deleteId); setDeleteId(null); }}
          onClose={() => setDeleteId(null)}
        />
      )}

      {/* Action Modal — Cancelar ou Excluir */}
      {actionStudentId && (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
          <div className="bg-card rounded-2xl w-full max-w-sm p-6 shadow-2xl border border-border space-y-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <XCircle size={20} className="text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">O que deseja fazer?</h3>
                <p className="text-xs text-muted-foreground">Escolha uma ação para este aluno</p>
              </div>
            </div>

            {/* Option 1: Cancel — escondida com caso ativo OU Revertido
                (Revertido reabre só pelo botão REATIVAR CASO no Finalizado). */}
            {(() => {
              const s = allStudents.find((x) => x.id === actionStudentId);
              const sc = s?.statusCancelamento;
              const bloqueado =
                !!sc && sc !== 'nenhum'; // inclui revertido, solicitado, cancelado, etc.
              if (bloqueado) {
                if (sc === 'revertido') {
                  return (
                    <div className="w-full p-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 text-[11px] text-fuchsia-800">
                      Aluno <strong>Revertido</strong>. Para cancelar de novo, use{' '}
                      <strong>REATIVAR CASO</strong> no card em Cancelamentos → Finalizado (abre em Em Tratativas).
                    </div>
                  );
                }
                return null;
              }
              return (
                <button
                  onClick={() => { setCancelId(actionStudentId); setActionStudentId(null); }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100/50 transition-all text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                    <XCircle size={16} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-900">Solicitar Cancelamento</p>
                    <p className="text-[10px] text-amber-700 mt-0.5">Abre um caso em Cancelamentos</p>
                  </div>
                </button>
              );
            })()}

            {/* Option 2: Delete */}
            <button
              onClick={() => { setDeleteId(actionStudentId); setActionStudentId(null); }}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-all text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-destructive/20 flex items-center justify-center shrink-0">
                <Trash2 size={16} className="text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-destructive">Excluir Aluno</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Remove permanentemente</p>
              </div>
            </button>

            <button
              onClick={() => setActionStudentId(null)}
              className="w-full px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Cancelar aluno confirmation modal */}
      {cancelId && (() => {
        const cancelStudent = allStudents.find((s) => s.id === cancelId);
        const contractValue = cancelStudent?.saleValue ?? 0;
        const fluxoPago =
          (cancelStudent?.downPayment ?? 0) +
          (cancelStudent?.installments ?? [])
            .filter((i) => i.paid)
            .reduce((acc, i) => acc + (typeof i.paidValue === 'number' ? i.paidValue : i.value), 0);
        const totalPagoNumLive = cancelTotalPago
          ? parseFloat(cancelTotalPago.replace(/\./g, '').replace(',', '.'))
          : NaN;
        const hasDivergencia =
          Number.isFinite(totalPagoNumLive) && Math.abs(totalPagoNumLive - fluxoPago) > 0.01;
        const multaPercent =
          cancelDentro7Dias === true
            ? 0
            : cancelCom30Dias === true
              ? rules.multaCancelamentoComAntecedencia
              : cancelCom30Dias === false
                ? rules.multaCancelamentoSemAntecedencia
                : null;
        const multaValue = multaPercent != null ? (contractValue * multaPercent) / 100 : null;
        const canConfirm = !!selectedMotivo && cancelDentro7Dias !== null && cancelCom30Dias !== null && !!cancelQtdInscricoes && parseInt(cancelQtdInscricoes, 10) > 0 && !!cancelDataSolicitacao && (!hasDivergencia || !!divergenciaAjusteTag) && Number.isFinite(totalPagoNumLive);

        const resetAndClose = () => {
          setCancelId(null);
          setSelectedMotivo('');
          setCancelDentro7Dias(null);
          setCancelCom30Dias(null);
          setCancelDataEvento('');
          setCancelDescricao('');
          setCancelTotalPago('');
          setCancelQtdInscricoes('');
          setCancelDataSolicitacao(new Date().toISOString().slice(0, 10));
          setShowDivergenciaModal(false);
          setShowDivergenciaEdit(false);
          setDivergenciaAjusteTag(null);
        };

        return (
          <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4">
            <div className="bg-card rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-border space-y-4 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <XCircle size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Cancelar Aluno</h3>
                  <p className="text-xs text-muted-foreground">Responda as perguntas para abrir o caso.</p>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                O aluno <strong>permanece na carteira</strong> com tag "Cancelamento solicitado". Um caso espelho será aberto em <strong>Cancelamentos → Entrada</strong>.
              </p>

              {/* 1 — Motivo */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  1. Qual o motivo de cancelamento? <span className="text-destructive">*</span>
                </label>
                <select
                  className="input-field w-full text-xs"
                  value={selectedMotivo}
                  onChange={(e) => setSelectedMotivo(e.target.value as typeof MOTIVOS_CANCELAMENTO[number])}
                >
                  <option value="">Selecione o motivo...</option>
                  {MOTIVOS_CANCELAMENTO.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <textarea
                  className="input-field w-full text-xs mt-2 resize-none"
                  rows={2}
                  placeholder="Descrição do motivo (opcional)"
                  value={cancelDescricao}
                  onChange={(e) => setCancelDescricao(e.target.value)}
                />
              </div>

              {/* Total pago até o momento (informado pelo AC, do Kamino) */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  Total pago até o momento (Kamino) <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={`input-field w-full text-xs ${hasDivergencia && !divergenciaAjusteTag ? 'border-rose-400 focus:border-rose-500' : ''}`}
                  placeholder="R$ 0,00"
                  value={cancelTotalPago}
                  onChange={(e) => setCancelTotalPago(e.target.value.replace(/[^\d,\.]/g, ''))}
                  onBlur={() => {
                    if (hasDivergencia && !divergenciaAjusteTag) setShowDivergenciaModal(true);
                  }}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Deve corresponder à soma <strong>Entrada + Total Pago</strong> do fluxo de pagamento.
                  {' '}Fluxo atual: <strong>{formatCurrency(fluxoPago)}</strong>.
                </p>
                {hasDivergencia && !divergenciaAjusteTag && (
                  <p className="text-[10px] text-rose-600 mt-1 font-semibold">
                    ⚠ Divergência de {formatCurrency(Math.abs(totalPagoNumLive - fluxoPago))} — atualize o fluxo de pagamento antes de prosseguir.
                  </p>
                )}
                {divergenciaAjusteTag && (
                  <p className="text-[10px] text-amber-700 mt-1 font-semibold">
                    ⚠ O caso seguirá com a tag <strong>"{divergenciaAjusteTag}"</strong> para double-check da Conciliação.
                  </p>
                )}
              </div>

              {/* Quantidade de inscrições do contrato */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  Quantidade de inscrições do contrato <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input-field w-full text-xs"
                  placeholder="Ex.: 1, 2, 3..."
                  value={cancelQtdInscricoes}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setCancelQtdInscricoes(e.target.value.replace(/[^\d]/g, ''))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Número de <strong>inscrições</strong> que compõem este contrato.</p>
              </div>

              {/* Data da solicitação no chat */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  Data em que o aluno solicitou o cancelamento pela primeira vez no chat <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  className="input-field w-full text-xs"
                  max={new Date().toISOString().slice(0, 10)}
                  value={cancelDataSolicitacao}
                  onChange={(e) => setCancelDataSolicitacao(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Se diferente de hoje, esta será a data considerada em <strong>"Solicitado"</strong> no card de cancelamentos.
                </p>
              </div>



              {/* 2 — 7 dias */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  2. O cancelamento está dentro dos 7 dias de contrato? <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCancelDentro7Dias(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      cancelDentro7Dias === true
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelDentro7Dias(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      cancelDentro7Dias === false
                        ? 'bg-rose-500 text-white border-rose-500'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Não
                  </button>
                </div>
                {cancelDentro7Dias === true && (
                  <p className="text-[10px] text-emerald-700 mt-1">
                    Direito de arrependimento (CDC art. 49) — <strong>sem multa</strong>.
                  </p>
                )}
              </div>

              {/* 3 — 30 dias de antecedência */}
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  3. Pediu o cancelamento com mais de 30 dias de antecedência da data do evento? <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCancelCom30Dias(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      cancelCom30Dias === true
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Sim, mais de 30D
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelCom30Dias(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                      cancelCom30Dias === false
                        ? 'bg-rose-500 text-white border-rose-500'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Não, menos de 30D
                  </button>
                </div>
              </div>

              {/* Preview da Multa */}
              {multaValue != null && contractValue > 0 && (
                <div className={`rounded-lg border px-3 py-2.5 text-xs ${
                  multaPercent === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Multa calculada</span>
                    <span className="font-bold">{multaPercent}%</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span>Valor do contrato:</span>
                    <span>{formatCurrency(contractValue)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 pt-1 border-t border-current/20">
                    <span className="font-semibold">Multa a cobrar:</span>
                    <span className="font-bold text-base">{formatCurrency(multaValue)}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700">
                <RotateCcw size={12} />
                <span>Pode ser <strong>revertido</strong> a qualquer momento pelo time de cancelamentos.</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={resetAndClose}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                >
                  Voltar
                </button>
                <button
                  onClick={() => {
                    if (!canConfirm) return;
                    const sid = cancelId;
                    const totalPagoNum = cancelTotalPago
                      ? parseFloat(cancelTotalPago.replace(/\./g, '').replace(',', '.'))
                      : undefined;
                    const qtdInscricoesNum = cancelQtdInscricoes
                      ? parseInt(cancelQtdInscricoes, 10)
                      : undefined;
                    const today = new Date().toISOString().slice(0, 10);
                    let createdAtOverride: string | undefined;
                    if (cancelDataSolicitacao && cancelDataSolicitacao !== today) {
                      const now = new Date();
                      const [y, m, d] = cancelDataSolicitacao.split('-').map(Number);
                      const dt = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds());
                      if (!isNaN(dt.getTime())) createdAtOverride = dt.toISOString();
                    }
                    cancelStudentToFlow(sid, selectedMotivo as string, {
                      dentro7Dias: cancelDentro7Dias!,
                      com30DiasAntecedencia: cancelCom30Dias!,
                      dataEvento: cancelDataEvento || undefined,
                      multaPercent: multaPercent ?? undefined,
                      multaValue: multaValue ?? undefined,
                      totalPagoAteMomento: Number.isFinite(totalPagoNum as number) ? totalPagoNum : undefined,
                      quantidadeInscricoes: Number.isFinite(qtdInscricoesNum as number) && (qtdInscricoesNum ?? 0) > 0 ? qtdInscricoesNum : undefined,
                      descricaoCancelamento: cancelDescricao || (selectedMotivo as string),
                      ...(createdAtOverride ? { createdAt: createdAtOverride } : {}),
                    });
                    resetAndClose();
                    const stu = allStudents.find((s) => s.id === sid);
                    if (stu) setFinancialStudent(stu);
                  }}
                  disabled={!canConfirm}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Confirmar e Ajustar Parcelas
                </button>
              </div>
            </div>

            {showDivergenciaModal && (
              <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[60] fade-in p-4" onClick={() => setShowDivergenciaModal(false)}>
                <div className="bg-card rounded-2xl w-full max-w-md p-5 shadow-2xl border border-rose-200 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                      <XCircle size={20} className="text-rose-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Divergência de valores</h3>
                      <p className="text-[11px] text-muted-foreground">O total informado não bate com o fluxo de pagamento.</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800 space-y-1">
                    <div className="flex justify-between"><span>Kamino (informado):</span><strong>{formatCurrency(totalPagoNumLive || 0)}</strong></div>
                    <div className="flex justify-between"><span>Entrada + Pago (fluxo):</span><strong>{formatCurrency(fluxoPago)}</strong></div>
                    <div className="flex justify-between pt-1 border-t border-rose-200"><span>Diferença:</span><strong>{formatCurrency(Math.abs((totalPagoNumLive || 0) - fluxoPago))}</strong></div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Ajuste o fluxo de pagamento para bater com o Kamino. Você pode editar
                    os campos financeiros do contrato agora — a alteração será enviada
                    para <strong>double-check da Conciliação</strong>.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowDivergenciaModal(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={() => {
                        setShowDivergenciaModal(false);
                        setShowDivergenciaEdit(true);
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all inline-flex items-center gap-1.5"
                    >
                      <PencilLine size={12} /> Ajustar dados do contrato
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showDivergenciaEdit && cancelStudent && (
              <CancelDivergenceEditModal
                student={cancelStudent}
                onClose={() => setShowDivergenciaEdit(false)}
                onSaved={({ ajusteTag }) => {
                  setDivergenciaAjusteTag(ajusteTag);
                  const st = useAppStore.getState().students.find((s) => s.id === cancelStudent.id);
                  const novoFluxo =
                    (st?.downPayment ?? 0) +
                    (st?.installments ?? [])
                      .filter((i) => i.paid)
                      .reduce((acc, i) => acc + (typeof i.paidValue === 'number' ? i.paidValue : i.value), 0);
                  setCancelTotalPago(
                    novoFluxo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  );
                  setShowDivergenciaEdit(false);
                }}
              />
            )}
          </div>
        );
      })()}
    </div>
  );
}
