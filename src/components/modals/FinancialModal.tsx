import { useState, useMemo, useEffect } from 'react';
import { Student, Installment, canConfirmarPagamento, canEditTab } from '@/types';
import { useAppStore, formatCurrency, generateInstallments, isRecompraOuFundoParcela } from '@/store/useAppStore';
import { registrarConciliacao, useConciliacaoStore, buildStudentSnapshot } from '@/store/useConciliacaoStore';
import { X, ToggleLeft, ToggleRight, Edit2, Check, Zap, DollarSign, ArrowLeft, FileText, CheckCircle2, Lock, Copy, Trash2, AlertOctagon, BadgeCheck, Clock } from 'lucide-react';
import { useConfirm } from '@/hooks/useConfirm';
import { toast } from 'sonner';
import TermoAditivoModal from './TermoAditivoModal';
import CurrencyInput from '@/components/ui/CurrencyInput';
import StudentDraftBanner from '@/components/ui/StudentDraftBanner';
import { getTagStyle } from '@/lib/tagColors';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import { getInstallmentCreditApplied, getInstallmentOutstanding, getStudentCreditAppliedTotal } from '@/lib/utils';
import { isEntradaPendenciaInstallment, sumEntradaPendenteValue } from '@/lib/studentDisplayStatus';

interface Props {
  student: Student;
  onClose: () => void;
  // Tarja temporária exibida no topo (ex.: motivo da reprovação de conciliação)
  banner?: { title: string; body?: string };
  // Quando true, alterações são conciliadas automaticamente sem passar pela
  // aba Conciliação. Usado na aba Alunos quando o usuário é admin ou tem
  // permissão de edição em Conciliação.
  immediateApply?: boolean;
  // Reversão parcial COM ajuste: total sugerido para o somatório de parcelas
  // pendentes (saldo remanescente + multa contratual + encargos). Ao abrir o
  // modal, as parcelas pendentes existentes são redistribuídas igualmente para
  // que sua soma bata com este valor. O AC pode reajustar em seguida.
  suggestedPendingTotal?: number;
}

type RenegMode = 'none' | 'initial' | 'detailed' | 'confirm';

/** Rascunho local da renegociação — permite retomar se fechar o modal no meio. */
type RenegStandbyDraft = {
  version: 1;
  studentId: string;
  mode: Exclude<RenegMode, 'none'>;
  renegMultaPercent: number;
  renegJurosPercent: number;
  applyJurosReneg: boolean;
  applyMultaReneg: boolean;
  newInstallments: number;
  novaEntrada: number;
  renegFirstDueDate: string;
  renegDueScope: 'primeira' | 'todas';
  entradaMode: 'valor' | 'percent';
  entradaPercent: number;
  renegSelected: number[];
  savedAt: string;
};

function renegStandbyKey(studentId: string) {
  return `gc:reneg-standby:${studentId}`;
}

function loadRenegStandby(studentId: string): RenegStandbyDraft | null {
  try {
    const raw = localStorage.getItem(renegStandbyKey(studentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RenegStandbyDraft;
    if (!parsed || parsed.version !== 1 || parsed.studentId !== studentId) return null;
    if (parsed.mode !== 'initial' && parsed.mode !== 'detailed' && parsed.mode !== 'confirm') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRenegStandby(draft: RenegStandbyDraft) {
  try {
    localStorage.setItem(renegStandbyKey(draft.studentId), JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

function clearRenegStandby(studentId: string) {
  try {
    localStorage.removeItem(renegStandbyKey(studentId));
  } catch {
    /* ignore */
  }
}

// Parser de data local (evita o bug de UTC que mostra o dia anterior)
function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDateBR(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  return d.toLocaleDateString('pt-BR');
}

function cloneInstallments(installments: Installment[]): Installment[] {
  return installments.map((i) => ({ ...i, tags: i.tags ? [...i.tags] : undefined }));
}

// ─── Error Boundary local ─────────────────────────────────────────────────
// Evita que um erro de render dentro do modal "branque" toda a tela.
// Mostra uma mensagem amigável e um botão para fechar.
import { Component, type ErrorInfo, type ReactNode } from 'react';
class FinancialModalErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[FinancialModal] render crash', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl max-w-md p-6 shadow-2xl border border-border space-y-3">
            <h3 className="text-base font-semibold text-rose-700">Ocorreu um erro ao renderizar a Gestão Financeira</h3>
            <p className="text-xs text-muted-foreground">
              Feche e abra novamente. Se persistir, recarregue a página. Detalhe técnico no console.
            </p>
            <p className="text-[10px] text-rose-600/80 font-mono break-all">{String(this.state.error.message || this.state.error)}</p>
            <div className="flex justify-end">
              <button onClick={this.props.onClose} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground">Fechar</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children as JSX.Element;
  }
}

function FinancialModalInner({ student: studentProp, onClose, banner, immediateApply, suggestedPendingTotal }: Props) {
  const { updateStudent, rules, currentUser, studentTags } = useAppStore();
  const confirm = useConfirm();

  // Tarja informativa (resumo da reversão / motivo de reprovação) — permanece
  // visível enquanto o modal estiver aberto; usuário pode fechar manualmente.
  const [bannerVisible, setBannerVisible] = useState<boolean>(!!banner);
  useEffect(() => {
    setBannerVisible(!!banner);
  }, [banner]);
  // Sempre lê a versão fresca do store, mas mantém alterações de parcelas em rascunho
  // até o usuário clicar em "Confirmar Ajuste Financeiro".
  const studentFromStore = useAppStore((s) => s.students.find((st) => st.id === studentProp.id));
  const baseStudent = studentFromStore ?? studentProp;
  const [draftInstallments, setDraftInstallments] = useState<Installment[]>(() => cloneInstallments(baseStudent.installments));

  // ─── Sugestão automática de redistribuição (reversão parcial COM ajuste) ──
  // Quando `suggestedPendingTotal` é informado, redistribuímos igualmente as
  // parcelas pendentes (não pagas) para que a soma bata com o valor sugerido.
  // Executa uma única vez ao montar — depois o AC pode ajustar manualmente.
  useEffect(() => {
    if (suggestedPendingTotal == null || suggestedPendingTotal <= 0) return;
    setDraftInstallments((prev) => {
      const pendentes = prev.filter((i) => !i.paid);
      if (pendentes.length === 0) return prev;
      const baseValor = Math.floor((suggestedPendingTotal * 100) / pendentes.length) / 100;
      const somaBase = Math.round(baseValor * pendentes.length * 100) / 100;
      const resto = Math.round((suggestedPendingTotal - somaBase) * 100) / 100;
      let restoAplicado = false;
      return prev.map((i) => {
        if (i.paid) return i;
        const isLast = !restoAplicado && i.number === pendentes[pendentes.length - 1].number;
        if (isLast) {
          restoAplicado = true;
          return { ...i, value: Math.round((baseValor + resto) * 100) / 100 };
        }
        return { ...i, value: baseValor };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const student = useMemo(
    () => ({
      ...baseStudent,
      installments: draftInstallments,
      totalInstallments: draftInstallments.length,
      paidInstallments: draftInstallments.filter((i) => i.paid).length,
    }),
    [baseStudent, draftInstallments],
  );
  const podeConfirmarPagto = canConfirmarPagamento(currentUser);
  // Confirmar Ajuste Financeiro (data/valor) — liberado para qualquer usuário
  // que tenha permissão de edição nas abas de Alunos ou Equipe (assessores
  // inclusos). Pagamentos efetivos continuam restritos a podeConfirmarPagto.
  const podeAjustarFinanceiro =
    canEditTab(currentUser, 'alunos') || canEditTab(currentUser, 'equipe');

  // Wrapper local: quando o modal é aberto em modo `immediateApply` (aba
  // Alunos por admin / setor de conciliação), o usuário escolhe entre
  // "Aprovar com Conciliação Total" (efetiva na hora) e "Aprovar e enviar
  // para Conciliação" (gera pendência). A escolha vale para TODAS as
  // ações dentro desta abertura do modal.
  const canChooseMode = !!immediateApply;
  const [approvalMode, setApprovalMode] = useState<'total' | 'send'>('total');
  const isImmediate = canChooseMode && approvalMode === 'total';
  const registrarConc = (input: Parameters<typeof registrarConciliacao>[0]) =>
    registrarConciliacao({
      ...input,
      executaImediatamente: canChooseMode ? isImmediate : input.executaImediatamente,
    });

  // Defaults solicitados: 10% multa, 1% juros a.m.
  const DEFAULT_MULTA = 10;
  const DEFAULT_JUROS = 1;

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  // Snapshot ORIGINAL das parcelas (capturado na abertura). Usada como
  // referência tanto para o "Check de Valor" quanto para o diff de
  // alterações que vai para a Conciliação no momento do "Confirmar Ajuste
  // Financeiro" — assim, ações que o usuário desfez no meio do caminho NÃO
  // viram pendências de conciliação.
  // Snapshot inicial — mutável via desconciliação (parcelas pagas que voltam
  // para "pendente" passam a contar no Check de Valor e no saldo original).
  const [originalInstallmentsRef, setOriginalInstallmentsRef] = useState<Installment[]>(
    () => cloneInstallments(baseStudent.installments),
  );
  const saldoOriginalRef = useMemo(
    () => {
      // Em reversão parcial COM ajuste, o saldo esperado é o valor sugerido
      // (saldo remanescente + multa + encargos), não a soma das parcelas
      // originais. Isso evita que o Check de Valor acuse divergência falsa.
      if (suggestedPendingTotal != null && suggestedPendingTotal > 0) return suggestedPendingTotal;
      return originalInstallmentsRef.filter((i) => !i.paid).reduce((acc, i) => acc + i.value, 0);
    },
    [originalInstallmentsRef, suggestedPendingTotal],
  );

  const unpaidInstallments = student.installments.filter((i) => !i.paid);
  // Recompra/Fundo não contam como "vencido" (data antiga da parcela reaberta).
  const hasOverdue = unpaidInstallments.some(
    (i) => !isRecompraOuFundoParcela(i, studentTags) && parseDateLocal(i.dueDate) < today,
  );

  // Encargos: aplicados automaticamente se há vencidas; toggle "Excluir Encargos" desliga
  const [showCharges, setShowCharges] = useState<boolean>(hasOverdue);
  const [multaPercent, setMultaPercent] = useState(DEFAULT_MULTA);
  const [jurosPercent, setJurosPercent] = useState(DEFAULT_JUROS);
  // (Encargo "valor específico" foi movido para dentro da edição de cada parcela —
  // ver `extraValues`/`getExtra`, atribuição manual por parcela via ícone de lápis.)
  // Controla a expansão do detalhamento de "Encargos Atribuídos" no topo.
  const [showEncargosBreakdown, setShowEncargosBreakdown] = useState(false);
  // Valor de encargo sendo editado em conjunto com valor/data dentro da edição da parcela.
  const [editExtra, setEditExtra] = useState(0);


  const [renegMode, setRenegMode] = useState<RenegMode>('none');
  const [selectedParcels, setSelectedParcels] = useState<number[]>([]);
  const [editingInstallment, setEditingInstallment] = useState<number | null>(null);
  const [editValue, setEditValue] = useState(0);
  const [editDueDate, setEditDueDate] = useState('');

  // Renegotiation state — defaults: 10% multa / 1% juros a.m., ambos aplicados
  const [renegMultaPercent, setRenegMultaPercent] = useState(DEFAULT_MULTA);
  const [renegJurosPercent, setRenegJurosPercent] = useState(DEFAULT_JUROS);
  const [applyJurosReneg, setApplyJurosReneg] = useState(true);
  const [applyMultaReneg, setApplyMultaReneg] = useState(true);
  const [newInstallments, setNewInstallments] = useState(
    Math.max(1, unpaidInstallments.length || 1)
  );
  const [novaEntrada, setNovaEntrada] = useState(0);
  // Data do 1º vencimento das novas parcelas (editável pelo assessor)
  const [renegFirstDueDate, setRenegFirstDueDate] = useState<string>(() => {
    const base = getTodayBrasilia();
    const d = new Date(base.getFullYear(), base.getMonth() + 1, student.dueDay || base.getDate());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  // Escopo da alteração de vencimento: só a 1ª parcela ou todas
  const [renegDueScope, setRenegDueScope] = useState<'primeira' | 'todas'>('todas');
  const [entradaMode, setEntradaMode] = useState<'valor' | 'percent'>('valor');
  const [entradaPercent, setEntradaPercent] = useState<number>(0);

  // Parcelas selecionadas para renegociação (números). Permite incluir parcelas
  // já conciliadas como pagas — útil para alunos de antecipação (Sicoob/TMF/Fundo)
  // em que o GC registra a parcela como paga, mas a dívida real com o aluno persiste.
  const [renegSelected, setRenegSelected] = useState<number[]>([]);
  const toggleRenegParcel = (n: number) =>
    setRenegSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  const [termoModal, setTermoModal] = useState(false);

  // Rascunho/stand-by da renegociação (localStorage) — retomar de onde parou
  const [standbyDraft, setStandbyDraft] = useState<RenegStandbyDraft | null>(() =>
    loadRenegStandby(studentProp.id),
  );

  const buildRenegStandby = (mode: Exclude<RenegMode, 'none'>): RenegStandbyDraft => ({
    version: 1,
    studentId: student.id,
    mode,
    renegMultaPercent,
    renegJurosPercent,
    applyJurosReneg,
    applyMultaReneg,
    newInstallments,
    novaEntrada,
    renegFirstDueDate,
    renegDueScope,
    entradaMode,
    entradaPercent,
    renegSelected,
    savedAt: new Date().toISOString(),
  });

  const persistRenegStandby = (mode?: Exclude<RenegMode, 'none'>) => {
    const m = mode ?? (renegMode !== 'none' ? renegMode : null);
    if (!m) return;
    const draft = buildRenegStandby(m);
    saveRenegStandby(draft);
    setStandbyDraft(draft);
  };

  const applyRenegStandby = (draft: RenegStandbyDraft) => {
    setRenegMultaPercent(draft.renegMultaPercent);
    setRenegJurosPercent(draft.renegJurosPercent);
    setApplyJurosReneg(draft.applyJurosReneg);
    setApplyMultaReneg(draft.applyMultaReneg);
    setNewInstallments(Math.max(1, draft.newInstallments || 1));
    setNovaEntrada(draft.novaEntrada || 0);
    setRenegFirstDueDate(draft.renegFirstDueDate);
    setRenegDueScope(draft.renegDueScope);
    setEntradaMode(draft.entradaMode);
    setEntradaPercent(draft.entradaPercent || 0);
    setRenegSelected(Array.isArray(draft.renegSelected) ? draft.renegSelected : []);
    setQuitacaoMode(false);
    setQuitParcelasMode(false);
    setRenegMode(draft.mode);
    toast.success('Renegociação restaurada — continue de onde parou.');
  };

  const discardRenegStandby = () => {
    clearRenegStandby(student.id);
    setStandbyDraft(null);
    setRenegMode('none');
    toast.message('Rascunho de renegociação descartado.');
  };

  // Quitação mode
  const [quitacaoMode, setQuitacaoMode] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'value'>('percent');
  const [discountInput, setDiscountInput] = useState<number>(0);

  // Quitação de Parcelas (selecionadas) — sempre vai como rascunho para a aba Conciliação,
  // mesmo quando o usuário tem permissão de aplicar imediato. Permite editar o valor
  // de cada parcela selecionada antes de enviar.
  const [quitParcelasMode, setQuitParcelasMode] = useState(false);
  const [quitParcSel, setQuitParcSel] = useState<number[]>([]);
  const [quitParcVal, setQuitParcVal] = useState<Record<number, number>>({});
  const toggleQuitParc = (n: number) =>
    setQuitParcSel((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));


  // Observação livre p/ a Conciliação — preenchida ANTES de qualquer ajuste
  // financeiro. É anexada a TODOS os itens criados nesta sessão do modal.
  const [obsConciliacao, setObsConciliacao] = useState('');

  // ─── Trava de Saldo do Contrato ────────────────────────────────────────────
  // Quando a soma das parcelas pendentes (após edições) diverge do saldo REAL
  // do contrato (`saleValue − totalPago`), o AC precisa classificar a
  // diferença ANTES de confirmar: encargo (multa/juros embutido) ou correção
  // de erro. Cada caso atualiza o saleValue e gera item dedicado na Conciliação.
  const [deltaClassif, setDeltaClassif] = useState<'none' | 'encargo' | 'correcao'>('none');
  const [encargoValor, setEncargoValor] = useState<number>(0);
  const [correcaoJustif, setCorrecaoJustif] = useState<string>('');

  // Valor extra (acréscimo manual) por parcela vencida — disponível quando os
  // encargos estão excluídos. NÃO entra no Check de Valor (que confere apenas
  // a soma das parcelas), mas soma no valor cobrado/baixado da parcela.
  const [extraValues, setExtraValues] = useState<Record<number, number>>({});
  const getExtra = (num: number) => extraValues[num] || 0;

  const _overdueList = unpaidInstallments.filter(
    (i) => !isRecompraOuFundoParcela(i, studentTags) && parseDateLocal(i.dueDate) < today,
  );
  const _overdueBaseSum = _overdueList.reduce((a, i) => a + i.value, 0);

  const calculateCharges = (value: number, dueDate: string, instNumber?: number) => {
    const due = parseDateLocal(dueDate);
    // Encargo manual atribuído por parcela (via edição com lápis) — soma direto no total.
    const manual = instNumber != null ? (extraValues[instNumber] || 0) : 0;
    if (due >= today) return { multa: manual, juros: 0, total: value + manual };
    const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const multa = value * (multaPercent / 100);
    const juros = value * (jurosPercent / 100) * (diffDays / 30);
    return { multa: multa + manual, juros, total: value + multa + juros + manual };
  };


  const totalPending = unpaidInstallments.reduce((acc, i) => {
    const base = getInstallmentOutstanding(i);
    const charges = calculateCharges(base, i.dueDate, i.number);
    const extra = !showCharges ? getExtra(i.number) : 0;
    return acc + (showCharges ? charges.total : base + extra);
  }, 0);

  const overdueInstallments = unpaidInstallments.filter(
    (i) => !isRecompraOuFundoParcela(i, studentTags) && parseDateLocal(i.dueDate) < today,
  );
  const totalOverdue = overdueInstallments.reduce((acc, i) => {
    const base = getInstallmentOutstanding(i);
    const charges = calculateCharges(base, i.dueDate, i.number);
    const extra = !showCharges ? getExtra(i.number) : 0;
    return acc + (showCharges ? charges.total : base + extra);
  }, 0);

  const valorContrato = student.saleValue ?? 0;

  // Soma A Vencer + Vencido (sem encargos) — usada no novo KPI e no "Check de Valor"
  const totalAberto = unpaidInstallments.reduce((acc, i) => acc + getInstallmentOutstanding(i), 0);
  const totalAVencer = unpaidInstallments
    .filter((i) => parseDateLocal(i.dueDate) >= today)
    .reduce((a, i) => a + getInstallmentOutstanding(i), 0);
  const totalOverdueSemEncargos = overdueInstallments.reduce((a, i) => a + getInstallmentOutstanding(i), 0);
  // Check de Valor: deve dar 0. Diferença entre saldo original e soma atual (sem encargos).
  const checkDiff = saldoOriginalRef - totalAberto;
  const checkOk = Math.abs(checkDiff) <= 0.01;

  // ─── Saldo REAL do contrato (saleValue − total pago) ──────────────────────
  // Diferentemente do Check de Valor (snapshot da abertura), esta verificação
  // é absoluta: compara contra o `saleValue` registrado. Detecta encargos
  // embutidos ou erros que o Check de Valor (intra-sessão) não pegou.
  // Inclui a entrada (down payment) como já paga do contrato — afinal, a
  // entrada faz parte do valor total da venda e foi quitada no ato.
  const totalCreditoAbatimento = useMemo(
    () => getStudentCreditAppliedTotal(student.installments),
    [student.installments],
  );
  const totalPagoContrato = useMemo(
    () => (student.downPayment ?? 0)
      + student.installments
        .filter((i) => i.paid)
        .reduce((acc, i) => acc + ((i as { paidValue?: number }).paidValue ?? i.value), 0)
      + totalCreditoAbatimento,
    [student.installments, student.downPayment, totalCreditoAbatimento],
  );
  /** Parcelas quitadas — a entrada tem card próprio e não entra aqui. */
  const totalPagoParcelas = useMemo(
    () => student.installments
      .filter((i) => i.paid)
      .reduce((acc, i) => acc + ((i as { paidValue?: number }).paidValue ?? i.value), 0),
    [student.installments],
  );
  const entradaValor = student.downPayment ?? 0;
  const hasEntrada = entradaValor > 0.0049;
  const entradaPendenteValor = useMemo(
    () => sumEntradaPendenteValue(student),
    [student.installments],
  );
  const hasEntradaPendente = entradaPendenteValor > 0.0049;
  const displayParcelLabel = (instNumber: number) => (hasEntrada ? instNumber + 1 : instNumber);
  const saldoContratoReal = (student.saleValue ?? 0) - totalPagoContrato;
  const deltaContrato = totalAberto - saldoContratoReal; // >0 sobra (encargo/erro), <0 falta
  const hasDelta = Math.abs(deltaContrato) > 0.01;
  // Toda diferença é tratada automaticamente como Encargo (sem precisar
  // classificar/justificar). Sincroniza valor e classificação com o delta.
  useEffect(() => {
    if (hasDelta) {
      setDeltaClassif('encargo');
      // Preserva o sinal do delta: negativo reduz o valor do contrato,
      // positivo embute encargo (multa/juros) elevando o contrato.
      setEncargoValor(Number(deltaContrato.toFixed(2)));
    } else if (deltaClassif !== 'none') {
      setDeltaClassif('none');
      setEncargoValor(0);
      setCorrecaoJustif('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDelta, deltaContrato]);

  const deltaResolvido = !hasDelta || (deltaClassif === 'encargo' && Math.abs(encargoValor) > 0.01);

  // Total de encargos já aplicados em alterações anteriores (somatório do
  // histórico do aluno). Usado para sinalizar no Fluxo de Pagamento.
  const encargosHistoricoTotal = useMemo(() => {
    let soma = 0;
    for (const h of student.history ?? []) {
      const m = /Encargo declarado:\s*R\$\s*([\d.]+,\d{2}|\d+)/i.exec(h.text || '');
      if (m) {
        const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
        if (Number.isFinite(n)) soma += n;
      }
    }
    return soma;
  }, [student.history]);

  // Tags do aluno (resolvidas a partir do store)
  const allTags = useAppStore((s) => s.studentTags);
  const studentTagObjs = useMemo(() => {
    const ids = new Set<string>();
    (student.tags || []).forEach((t) => t && ids.add(t));
    (student.installments || []).forEach((i) => (i.tags || []).forEach((t) => t && ids.add(t)));
    return Array.from(ids)
      .map((id) => allTags.find((t) => t.id === id) || { id, name: id, color: 'slate' })
      .filter(Boolean);
  }, [student.tags, student.installments, allTags]);

  // Parcelas com pagamento aguardando conciliação (badge "Conciliação Pendente")
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const pendingPaymentParcels = useMemo(() => {
    const set = new Set<number>();
    for (const it of conciliacaoItems) {
      if (
        it.status === 'pendente' &&
        it.tipo === 'pagamento_parcela' &&
        it.studentId === student.id
      ) {
        const n = Number((it.depois as Record<string, unknown>)?.parcela);
        if (Number.isFinite(n)) set.add(n);
      }
    }
    return set;
  }, [conciliacaoItems, student.id]);

  // Renegociação em rascunho aguardando conciliação (banner amarelo)
  const pendingRenegociacao = useMemo(
    () => conciliacaoItems.find(
      (it) => it.studentId === student.id && it.tipo === 'renegociacao' && (it.status === 'pendente' || it.status === 'aprovado')
    ),
    [conciliacaoItems, student.id]
  );

  const toggleParcel = (num: number) => {
    setSelectedParcels((prev) =>
      prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]
    );
  };

  const addHistoryEntry = (text: string) => ({
    date: new Date().toISOString(),
    type: 'Sistema' as const,
    text,
  });

  // Atalho admin/conciliação: marca UMA parcela como paga imediatamente,
  // sem precisar usar o fluxo de "Confirmar Ajuste Financeiro". Vai direto
  // por registrarConc (executaImediatamente=true via wrapper local), que
  // aplica `paid: true` no aluno e grava item já conciliado p/ auditoria.
  const handleQuickMarkPaid = async (inst: Installment) => {
    if (!immediateApply || !isImmediate) return;
    const charges = calculateCharges(inst.value, inst.dueDate, inst.number);
    const extra = !showCharges ? getExtra(inst.number) : 0;
    const paidAmount = showCharges ? charges.total : inst.value + extra;
    const ok = await confirm({
      title: `Marcar parcela ${inst.number} como paga?`,
      description: `Valor: ${formatCurrency(paidAmount)} • Vencimento: ${formatDateBR(inst.dueDate)}.\n\nA baixa será aplicada agora (conciliada automaticamente).`,
      confirmText: 'Marcar como paga',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    registrarConc({
      tipo: 'pagamento_parcela',
      studentSnapshot: buildStudentSnapshot(baseStudent),
      studentId: student.id,
      studentName: student.name,
      ac: student.ac,
      resumo: `Pagamento parcela ${inst.number} — ${formatCurrency(paidAmount)}${showCharges ? ' (com encargos)' : ''}${extra > 0 ? ` (+ extra ${formatCurrency(extra)})` : ''}`,
      antes: { parcela: inst.number, valor: inst.value, paid: false },
      depois: {
        parcela: inst.number,
        valor: paidAmount,
        valorExtra: extra || undefined,
        paid: true,
        paidDate: today.toISOString().split('T')[0],
        comEncargos: showCharges,
      },
      autorObservacao: obsConciliacao.trim() || undefined,
    });
    // Reflete localmente no rascunho p/ que a UI atualize imediatamente.
    setDraftInstallments((prev) =>
      prev.map((i) =>
        i.number === inst.number
          ? {
              ...i,
              paid: true,
              paidDate: today.toISOString().split('T')[0],
              ...(Math.abs(paidAmount - i.value) > 0.01 ? { paidValue: paidAmount } : {}),
            }
          : i,
      ),
    );
    setOriginalInstallmentsRef((prev) =>
      prev.map((i) =>
        i.number === inst.number
          ? { ...i, paid: true, paidDate: today.toISOString().split('T')[0] }
          : i,
      ),
    );
    setSelectedParcels((prev) => prev.filter((n) => n !== inst.number));
    toast.success(`Parcela ${inst.number} marcada como paga (${formatCurrency(paidAmount)}).`);
  };


  const handlePaySelected = async () => {
    // ─── Validação no momento do "Confirmar Ajuste Financeiro":
    // a soma das parcelas pendentes atuais (sem encargos) deve bater com o
    // saldo ORIGINAL capturado na abertura do modal. Isso garante que ajustes
    // manuais (duplicar/editar/excluir + redistribuir) não percam nem
    // adicionem valor por engano. Encargos ficam fora desta conta.
    const somaPendentesAtual = student.installments
      .filter((i) => !i.paid)
      .reduce((acc, i) => acc + i.value, 0);
    const diff = saldoOriginalRef - somaPendentesAtual; // >0 falta; <0 sobra
    if (Math.abs(diff) > 0.01) {
      const diffMsg =
        diff > 0
          ? `Faltam ${formatCurrency(diff)} no ajuste. Soma das parcelas pendentes (vencidas + a vencer, sem encargos) = ${formatCurrency(somaPendentesAtual)}, mas o saldo original é ${formatCurrency(saldoOriginalRef)}. Acrescente ${formatCurrency(diff)} em alguma parcela antes de confirmar.`
          : `Sobra de ${formatCurrency(-diff)} no ajuste. Soma das parcelas (${formatCurrency(somaPendentesAtual)}) ficou maior que o saldo original (${formatCurrency(saldoOriginalRef)}). Reduza ${formatCurrency(-diff)} em alguma parcela antes de confirmar.`;
      const ok = await confirm({
        title: 'Diferença de saldo detectada',
        description: diffMsg + '\n\nDeseja confirmar mesmo assim? O ajuste será enviado para Conciliação.',
        confirmText: 'Confirmar mesmo assim',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
    }

    // ─── Trava do Saldo do Contrato ─────────────────────────────────────────
    // Se a soma das parcelas pendentes diverge do saldo real do contrato
    // (`saleValue − total pago`), o AC tem que classificar antes de salvar.
    if (hasDelta && !deltaResolvido) {
      toast.error(
        deltaClassif === 'none'
          ? `Há R$ ${Math.abs(deltaContrato).toFixed(2).replace('.', ',')} de diferença vs. o contrato. Classifique como Encargo ou Correção antes de confirmar.`
          : deltaClassif === 'encargo'
            ? 'Informe o valor do encargo aplicado.'
            : 'A correção exige uma justificativa de pelo menos 10 caracteres.'
      );
      return;
    }
    // ⚠️ Pagamento manual de parcela NÃO baixa direto na carteira.
    // Cada parcela selecionada vira uma pendência "pagamento_parcela" na
    // Conciliação. A baixa (paid:true) só ocorre quando o setor aprovar.
    const paidValues: string[] = [];
    const pendingPayments: Array<{ inst: Installment; paidAmount: number; extra: number }> = [];
    for (const i of student.installments) {
      if (selectedParcels.includes(i.number)) {
        const charges = calculateCharges(i.value, i.dueDate, i.number);
        const extra = !showCharges ? getExtra(i.number) : 0;
        const paidAmount = showCharges ? charges.total : i.value + extra;
        paidValues.push(`Parcela ${i.number}: ${formatCurrency(paidAmount)}${extra > 0 ? ` (extra ${formatCurrency(extra)})` : ''}`);
        pendingPayments.push({ inst: i, paidAmount, extra });
      }
    }
    // Mantém installments como estão (sem alterar paid). Apenas adiciona histórico.
    const updated = student.installments;

    // Ajuste de saleValue se houve encargo declarado ou correção
    const previousSaleValue = baseStudent.saleValue ?? 0;
    const ajusteSaleValue =
      deltaClassif === 'encargo' ? encargoValor :
      deltaClassif === 'correcao' ? deltaContrato : 0;
    const novoSaleValue = previousSaleValue + ajusteSaleValue;

    const totalManualEncargos = Object.values(extraValues).reduce((a, b) => a + (b || 0), 0);
    const historyText = paidValues.length > 0
      ? `Solicitação de pagamento de ${paidValues.length} parcela(s) enviada para Conciliação: ${paidValues.join('; ')}. ${
          showCharges
            ? `Encargos aplicados (Multa ${multaPercent}% + Juros ${jurosPercent}% a.m.).`
            : 'Sem encargos automáticos.'
        }${totalManualEncargos > 0.0049 ? ` Encargos atribuídos manualmente: ${formatCurrency(totalManualEncargos)}.` : ''}`
      : `Ajuste financeiro confirmado — saldo redistribuído entre as parcelas. Soma final: ${formatCurrency(somaPendentesAtual)}.${totalManualEncargos > 0.0049 ? ` Encargos atribuídos manualmente: ${formatCurrency(totalManualEncargos)}.` : ''}`;

    const historyEncargo =
      deltaClassif === 'encargo'
        ? (encargoValor < 0
            ? `Redução de contrato: ${formatCurrency(encargoValor)} deduzido das parcelas. Valor do contrato: ${formatCurrency(previousSaleValue)} → ${formatCurrency(novoSaleValue)}.`
            : `Encargo declarado: ${formatCurrency(encargoValor)} embutido nas parcelas. Valor do contrato: ${formatCurrency(previousSaleValue)} → ${formatCurrency(novoSaleValue)}.`)
        : deltaClassif === 'correcao'
          ? `Correção de contrato: ${formatCurrency(previousSaleValue)} → ${formatCurrency(novoSaleValue)} (delta ${formatCurrency(deltaContrato)}). Justificativa: ${correcaoJustif.trim()}.`
          : null;
    const historyEntries = [addHistoryEntry(historyText)];
    if (historyEncargo) historyEntries.push(addHistoryEntry(historyEncargo));

    // ⚠️ RASCUNHO: as alterações de parcelas/valor de contrato NÃO são
    // aplicadas no aluno aqui. Apenas o histórico é gravado. As mudanças
    // financeiras ficam pendentes na aba Conciliação e só viram efetivas
    // quando o setor de Conciliação clicar em "Conciliar".
    updateStudent(student.id, {
      history: [...student.history, ...historyEntries],
    });

    // Estado proposto que será aplicado no aluno SOMENTE após conciliar.
    const draftAfter: Record<string, unknown> = {
      installments: updated,
      totalInstallments: updated.length,
      ...(ajusteSaleValue !== 0 ? { saleValue: novoSaleValue } : {}),
    };

    // ─── Espelho para a Conciliação (DIFF FINAL) ─────────────────────────
    // Compara a snapshot original (abertura do modal) com o estado salvo
    // (`updated`). Apenas alterações REAIS viram pendência — se o usuário
    // criou e excluiu uma parcela antes de salvar, nada é registrado.
    const obs = obsConciliacao.trim() || undefined;
    const newByNum = new Map(updated.map((i) => [i.number, i]));

    // 1) Quantidade total de parcelas mudou?
    if (originalInstallmentsRef.length !== updated.length) {
      registrarConc({
        tipo: 'parcela_quantidade',
        studentSnapshot: buildStudentSnapshot(baseStudent),
        draftAfter,
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: `Quantidade de parcelas: ${originalInstallmentsRef.length} → ${updated.length}`,
        antes: { totalParcelas: originalInstallmentsRef.length },
        depois: { totalParcelas: updated.length },
        autorObservacao: obs,
      });
    }

    // 2) Valor / vencimento de parcelas EXISTENTES alteradas
    for (const orig of originalInstallmentsRef) {
      const curr = newByNum.get(orig.number);
      if (!curr) continue; // parcela removida — já contabilizada no item de quantidade
      const valorMudou = Math.abs((curr.value ?? 0) - (orig.value ?? 0)) > 0.001;
      const vencMudou = curr.dueDate !== orig.dueDate;
      if (valorMudou) {
        registrarConc({
          tipo: 'parcela_valor',
          studentSnapshot: buildStudentSnapshot(baseStudent),
          draftAfter,
          studentId: student.id,
          studentName: student.name,
          ac: student.ac,
          resumo: `Parcela ${orig.number} — valor: ${formatCurrency(orig.value)} → ${formatCurrency(curr.value)}`,
          antes: { parcela: orig.number, valor: orig.value },
          depois: { parcela: orig.number, valor: curr.value },
          autorObservacao: obs,
        });
      }
      if (vencMudou) {
        registrarConc({
          tipo: 'parcela_vencimento',
          studentSnapshot: buildStudentSnapshot(baseStudent),
          draftAfter,
          studentId: student.id,
          studentName: student.name,
          ac: student.ac,
          resumo: `Parcela ${orig.number} — vencimento: ${formatDateBR(orig.dueDate)} → ${formatDateBR(curr.dueDate)}`,
          antes: { parcela: orig.number, vencimento: orig.dueDate },
          depois: { parcela: orig.number, vencimento: curr.dueDate },
          autorObservacao: obs,
        });
      }
    }

    // 2.5) Encargo declarado OU correção de contrato → item dedicado
    if (deltaClassif === 'encargo' && Math.abs(encargoValor) > 0.01) {
      registrarConc({
        tipo: 'encargo_aplicado',
        studentSnapshot: buildStudentSnapshot(baseStudent),
        draftAfter,
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: encargoValor < 0
          ? `Redução de contrato: ${formatCurrency(encargoValor)} (contrato ${formatCurrency(previousSaleValue)} → ${formatCurrency(novoSaleValue)})`
          : `Encargo aplicado: ${formatCurrency(encargoValor)} (embutido nas parcelas)`,
        antes: { saleValue: previousSaleValue },
        depois: { saleValue: novoSaleValue, encargo: encargoValor, deltaDetectado: deltaContrato },
        autorObservacao: obs,
      });
    } else if (deltaClassif === 'correcao' && Math.abs(deltaContrato) > 0.01) {
      registrarConc({
        tipo: 'correcao_contrato',
        studentSnapshot: buildStudentSnapshot(baseStudent),
        draftAfter,
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: `Correção de contrato: ${formatCurrency(previousSaleValue)} → ${formatCurrency(novoSaleValue)} (${formatCurrency(deltaContrato)})`,
        antes: { saleValue: previousSaleValue },
        depois: { saleValue: novoSaleValue, delta: deltaContrato, justificativa: correcaoJustif.trim() },
        autorObservacao: obs ? `${obs}\n\nJustificativa da correção: ${correcaoJustif.trim()}` : `Justificativa da correção: ${correcaoJustif.trim()}`,
      });
    }


    // 3) Pagamentos manuais selecionados → uma pendência por parcela
    for (const { inst, paidAmount, extra } of pendingPayments) {
      const extraNote = extra > 0 ? ` (+ extra ${formatCurrency(extra)})` : '';
      registrarConc({
        tipo: 'pagamento_parcela',
        studentSnapshot: buildStudentSnapshot(baseStudent),
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: `Pagamento parcela ${inst.number} — ${formatCurrency(paidAmount)}${showCharges ? ' (com encargos)' : ''}${extraNote}`,
        antes: { parcela: inst.number, valor: inst.value, paid: false },
        depois: {
          parcela: inst.number,
          valor: paidAmount,
          valorExtra: extra || undefined,
          paid: true,
          paidDate: today.toISOString().split('T')[0],
          comEncargos: showCharges,
        },
        autorObservacao: obs,
      });
    }

    if (paidValues.length > 0) {
      toast.success(`${paidValues.length} pagamento(s) enviado(s) para Conciliação.`);
    } else {
      toast.success('Ajuste financeiro salvo.');
    }
    setSelectedParcels([]);
    onClose();
  };

  // ─── Renegociação ──────────────────────────────────────────────────────────
  // Regra: dívida total (vencido + a vencer) com encargos − entrada opcional,
  // dividido pelo nº de novas parcelas. As parcelas já pagas permanecem no fluxo.
  const calculateRenegValues = () => {
    // Parcelas selecionadas (incluem pagas se o AC marcar). Fallback: todas em aberto.
    const selectedInst = renegSelected.length > 0
      ? student.installments.filter((i) => renegSelected.includes(i.number))
      : unpaidInstallments;
    const remaining = selectedInst.reduce((acc, i) => acc + i.value, 0);
    const paidIncluded = selectedInst.filter((i) => i.paid);
    const multaValue = applyMultaReneg ? remaining * (renegMultaPercent / 100) : 0;

    // Tabela Price: PMT = PV * i / (1 - (1 + i)^-n)
    // PV = saldo + multa - entrada (financiado). Juros = PMT * n - PV.
    const pv = Math.max(0, remaining + multaValue - novaEntrada);
    const i = renegJurosPercent / 100;
    let newValue = 0;
    let totalJuros = 0;
    if (newInstallments > 0) {
      if (applyJurosReneg && i > 0) {
        newValue = (pv * i) / (1 - Math.pow(1 + i, -newInstallments));
        totalJuros = newValue * newInstallments - pv;
      } else {
        newValue = pv / newInstallments;
        totalJuros = 0;
      }
    }

    const totalWithCharges = remaining + multaValue + totalJuros;
    const remainingAfterEntrada = Math.max(0, totalWithCharges - novaEntrada);

    return {
      remaining,
      multaValue,
      totalJuros,
      totalWithCharges,
      remainingAfterEntrada,
      newValue,
      selectedInst,
      paidIncluded,
    };
  };

  const renegValues = calculateRenegValues();
  // Recalcula entrada quando em modo percentual e o total muda
  useEffect(() => {
    if (entradaMode === 'percent') {
      const base = renegValues.totalWithCharges || 0;
      setNovaEntrada(Math.round(base * entradaPercent) / 100);
    }
  }, [entradaMode, entradaPercent, renegValues.totalWithCharges]);
  const descontoValor = discountType === 'percent'
    ? totalPending * (Math.max(0, Math.min(100, discountInput)) / 100)
    : Math.max(0, Math.min(totalPending, discountInput));
  const quitacaoValue = Math.max(0, totalPending - descontoValor);

  const handleConfirmRenegotiate = () => {
    // ⚠️ Renegociação agora vira RASCUNHO: NÃO altera o aluno aqui.
    // Apenas envia o novo plano para a aba Conciliação. As alterações só
    // são efetivadas quando o setor de Conciliação aprovar+conciliar.
    const selectedNums = renegValues.selectedInst.map((i) => i.number);
    const keptInst = student.installments.filter((i) => !selectedNums.includes(i.number));
    const keptPaid = keptInst.filter((i) => i.paid);
    const previousTotal = student.totalInstallments;
    const previousValue = student.installmentValue;
    const paidIncludedCount = renegValues.paidIncluded.length;
    const firstDue = renegFirstDueDate || undefined;
    const aplicaTodas = renegDueScope === 'todas';
    const renegDueDay = firstDue && aplicaTodas
      ? new Date(firstDue + 'T00:00:00').getDate()
      : student.dueDay;
    let newInst = generateInstallments(
      renegDueDay,
      newInstallments,
      renegValues.newValue,
      0,
      today.toISOString().split('T')[0],
      aplicaTodas ? firstDue : undefined
    );
    // Apenas a 1ª parcela recebe a data escolhida; as demais mantêm o dia
    // de vencimento original do aluno.
    if (firstDue && !aplicaTodas) {
      newInst = newInst.map((i) => (i.number === 1 ? { ...i, dueDate: firstDue } : i));
    }
    // Plano proposto (mantidas + novas). Será aplicado ao aluno na conciliação.
    const proposedInst = [...keptInst, ...newInst].map((i, idx) => ({ ...i, number: idx + 1 }));
    const newTotal = proposedInst.length;
    const novoSaleValue = student.saleValue + renegValues.multaValue + renegValues.totalJuros;

    updateStudent(student.id, {
      history: [
        ...student.history,
        addHistoryEntry(
          `Renegociação enviada para Conciliação (rascunho — alterações ainda não efetivas). ` +
            `Saldo devedor (parcelas selecionadas): ${formatCurrency(renegValues.remaining)}` +
            (paidIncludedCount > 0 ? ` (inclui ${paidIncludedCount} parcela(s) conciliada(s) como paga(s))` : '') + `. ` +
            `${applyMultaReneg ? `Multa ${renegMultaPercent}% (${formatCurrency(renegValues.multaValue)}). ` : 'Sem multa. '}` +
            `${applyJurosReneg ? `Juros ${renegJurosPercent}% a.m. (${formatCurrency(renegValues.totalJuros)}). ` : 'Sem juros. '}` +
            `Entrada: ${formatCurrency(novaEntrada)}. ` +
            `Plano proposto: ${newInstallments}x de ${formatCurrency(renegValues.newValue)}` +
            (renegFirstDueDate ? ` com vencimento em ${new Date(renegFirstDueDate + 'T00:00:00').toLocaleDateString('pt-BR')} (${renegDueScope === 'todas' ? 'aplicado a todas as parcelas' : 'somente a 1ª parcela'})` : '') + `. ` +
            `Fluxo total proposto: ${newTotal} parcelas (${keptPaid.length} pagas mantidas + ${newInstallments} novas).`
        ),
      ],
    });
    registrarConc({
      tipo: 'renegociacao',
      studentSnapshot: buildStudentSnapshot(baseStudent),
      studentId: student.id,
      studentName: student.name,
      ac: student.ac,
      resumo: `Renegociação (rascunho) — ${previousTotal}x ${formatCurrency(previousValue)} → ${newTotal}x (${keptPaid.length} pagas mantidas + ${newInstallments} novas de ${formatCurrency(renegValues.newValue)})` +
        (paidIncludedCount > 0 ? ` — ${paidIncludedCount} parcela(s) antes conciliada(s) como paga(s) foram incluídas` : ''),
      antes: {
        totalParcelas: previousTotal,
        valorParcela: previousValue,
        saleValue: student.saleValue,
      },
      depois: {
        totalParcelas: newTotal,
        novasParcelas: proposedInst,
        valorParcela: renegValues.newValue,
        entrada: novaEntrada,
        multa: renegValues.multaValue,
        juros: renegValues.totalJuros,
        saleValue: novoSaleValue,
        parcelasSelecionadas: renegValues.selectedInst.map((i) => i.number),
        parcelasPagasIncluidas: renegValues.paidIncluded.map((i) => i.number),
      },
      autorObservacao: obsConciliacao.trim() || undefined,
    });
    toast.success('Renegociação enviada para Conciliação. As alterações só ficam efetivas após a aprovação.');
    clearRenegStandby(student.id);
    setStandbyDraft(null);
    setRenegMode('none');
    onClose();
  };


  const handleQuitacao = () => {
    // ⚠️ NÃO baixa o pagamento na carteira aqui. Apenas registra a SOLICITAÇÃO
    // de quitação como pendência na aba Conciliação. A baixa só ocorre quando
    // o setor de Conciliação aprovar o item (ver ConciliacaoPage).
    const descricaoDesconto = discountType === 'percent'
      ? `${discountInput}% (${formatCurrency(descontoValor)})`
      : formatCurrency(descontoValor);

    updateStudent(student.id, {
      history: [
        ...student.history,
        addHistoryEntry(
          `Solicitação de quitação enviada para Conciliação. Valor original: ${formatCurrency(totalPending)}. Desconto: ${descricaoDesconto}. Valor para quitação: ${formatCurrency(quitacaoValue)}.`
        ),
      ],
    });
    registrarConc({
      tipo: 'quitacao',
      studentSnapshot: buildStudentSnapshot(baseStudent),
      studentId: student.id,
      studentName: student.name,
      ac: student.ac,
      resumo: `Solicitação de quitação — ${formatCurrency(totalPending)} → ${formatCurrency(quitacaoValue)} (desc. ${descricaoDesconto})`,
      antes: { parcelasPendentes: unpaidInstallments.length, valorPendente: totalPending },
      depois: {
        parcelasPendentes: 0,
        valorPago: quitacaoValue,
        desconto: descontoValor,
        descontoTipo: discountType,
        descontoEntrada: discountInput,
        status: 'Pago',
      },
      autorObservacao: obsConciliacao.trim() || undefined,
    });
    toast.success('Solicitação de quitação enviada para Conciliação.');
    setQuitacaoMode(false);
    setDiscountInput(0);
    onClose();
  };

  // ─── Quitação de Parcelas (selecionadas) ─────────────────────────────────
  // Envia cada parcela selecionada como solicitação de baixa (`pagamento_parcela`)
  // SEMPRE como rascunho para a aba Conciliação — nunca aplica direto, mesmo
  // quando o usuário tem permissão de imediato. O AC pode editar o valor pago
  // (ex.: desconto pontual) antes de enviar; o sistema avisa se diverge.
  const handleQuitacaoParcelas = async () => {
    if (quitParcSel.length === 0) {
      toast.error('Selecione pelo menos uma parcela.');
      return;
    }
    const itens = student.installments
      .filter((i) => quitParcSel.includes(i.number) && !i.paid)
      .map((i) => {
        const valorOriginal = i.value;
        const valorPago = quitParcVal[i.number] ?? valorOriginal;
        const diverge = Math.abs(valorPago - valorOriginal) > 0.01;
        return { inst: i, valorOriginal, valorPago, diverge };
      });

    if (itens.length === 0) {
      toast.error('Nenhuma parcela em aberto selecionada.');
      return;
    }

    const divergentes = itens.filter((x) => x.diverge);
    if (divergentes.length > 0) {
      const resumo = divergentes
        .map((x) => `Parcela ${x.inst.number}: ${formatCurrency(x.valorOriginal)} → ${formatCurrency(x.valorPago)}`)
        .join('\n');
      const ok = await confirm({
        title: 'Valor divergente detectado',
        description:
          `Algumas parcelas estão com valor diferente do registrado:\n\n${resumo}\n\n` +
          'Deseja enviar mesmo assim para a aba Conciliação?',
        confirmText: 'Confirmar mesmo assim',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
    }

    const obs = obsConciliacao.trim() || undefined;
    const hoje = today.toISOString().split('T')[0];

    for (const { inst, valorOriginal, valorPago, diverge } of itens) {
      // Força executaImediatamente=false: esta ação SEMPRE vai para a aba
      // Conciliação, mesmo quando o usuário é admin/conciliação.
      registrarConciliacao({
        tipo: 'pagamento_parcela',
        studentSnapshot: buildStudentSnapshot(baseStudent),
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo:
          `Quitação parcela ${inst.number} — ${formatCurrency(valorPago)}` +
          (diverge ? ` (divergente do registrado ${formatCurrency(valorOriginal)})` : ''),
        antes: { parcela: inst.number, valor: valorOriginal, paid: false },
        depois: {
          parcela: inst.number,
          valor: valorPago,
          paid: true,
          paidDate: hoje,
          valorDivergente: diverge || undefined,
        },
        autorObservacao: obs,
        executaImediatamente: false,
      });
    }

    updateStudent(student.id, {
      history: [
        ...student.history,
        addHistoryEntry(
          `Solicitação de quitação de ${itens.length} parcela(s) enviada para Conciliação: ` +
            itens
              .map((x) => `Parcela ${x.inst.number} (${formatCurrency(x.valorPago)}${x.diverge ? ' — divergente' : ''})`)
              .join('; ') + '.'
        ),
      ],
    });

    toast.success(
      `${itens.length} parcela(s) enviada(s) para Conciliação${divergentes.length > 0 ? ' (com divergência)' : ''}.`
    );
    setQuitParcelasMode(false);
    setQuitParcSel([]);
    setQuitParcVal({});
    onClose();
  };



  const handleEditInstallment = (inst: Installment) => {
    setEditingInstallment(inst.number);
    setEditValue(inst.value);
    setEditDueDate(inst.dueDate);
    setEditExtra(extraValues[inst.number] || 0);
  };


  // ─── Duplicar parcela ─────────────────────────────────────────────────────
  // Cria uma nova parcela ao final do cronograma copiando o valor/vencimento
  // de uma existente (vencimento +30 dias). Respeita o limite máximo definido
  // em Configurações (maxParcelasCadastro) e o aluno fica com uma parcela
  // a mais para ajustar manualmente os valores depois.
  const handleDuplicateInstallment = (inst: Installment) => {
    const limite = Math.max(
      rules.maxParcelasRenegociacao ?? 24,
      rules.maxParcelasCadastro ?? 24,
    );
    if (student.installments.length >= limite) {
      toast.error(`Limite máximo de ${limite} parcelas atingido (Configurações).`);
      return;
    }
    // Próximo número
    const maxNum = student.installments.reduce((m, i) => Math.max(m, i.number), 0);
    // Próximo vencimento: +30 dias a partir da última parcela do cronograma
    const lastInst = [...student.installments].sort((a, b) => a.number - b.number).slice(-1)[0];
    const baseDate = lastInst ? parseDateLocal(lastInst.dueDate) : parseDateLocal(inst.dueDate);
    const nextDate = new Date(baseDate.getTime());
    nextDate.setMonth(nextDate.getMonth() + 1);
    const yyyy = nextDate.getFullYear();
    const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
    const dd = String(nextDate.getDate()).padStart(2, '0');
    const newDueDate = `${yyyy}-${mm}-${dd}`;
    // ⚠️ Regra: o saldo total (vencidos + a vencer, fora encargos) NÃO pode
    // aumentar ao duplicar. Por isso a nova parcela nasce com valor 0 — o
    // usuário ajusta manualmente os valores das parcelas pendentes para
    // redistribuir o saldo. A validação em handleSaveInstallmentEdit garante
    // que a soma final não fique abaixo do saldo atual.
    const newInst: Installment = {
      number: maxNum + 1,
      dueDate: newDueDate,
      value: 0,
      paid: false,
      tags: inst.tags ? [...inst.tags] : undefined,
    };
    const updated = [...student.installments, newInst];
    setDraftInstallments(updated);
    // Conciliação será registrada no diff final do "Confirmar Ajuste Financeiro"
    // (ou no prompt de confirmação ao fechar o modal com alterações pendentes).
    toast.success(`Parcela ${newInst.number} criada em rascunho. Confirme o ajuste financeiro para salvar.`);
  };

  // ─── Excluir parcela ──────────────────────────────────────────────────────
  // Remove a parcela selecionada, renumera as restantes e espelha em
  // Conciliação. A validação final em "Confirmar Ajuste Financeiro" garante
  // que o saldo total não seja perdido — se sobrar valor, o sistema acusa.
  const handleDeleteInstallment = async (inst: Installment) => {
    const ok = await confirm({
      title: `Excluir parcela ${inst.number}?`,
      description: `Vencimento: ${formatDateBR(inst.dueDate)} • Valor: ${formatCurrency(inst.value)}\n\nO valor será removido do fluxo. Lembre-se de redistribuir o saldo entre as outras parcelas para não perder valor — o sistema acusa se sobrar diferença na hora de confirmar.`,
      variant: 'destructive',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    const filtered = student.installments
      .filter((i) => i.number !== inst.number)
      .sort((a, b) => a.number - b.number)
      .map((i, idx) => ({ ...i, number: idx + 1 }));
    setDraftInstallments(filtered);
    // Conciliação será registrada no diff final do "Confirmar Ajuste Financeiro"
    // (ou no prompt de confirmação ao fechar o modal com alterações pendentes).
    toast.success(`Parcela ${inst.number} excluída em rascunho. Confirme o ajuste financeiro para salvar.`);
  };

  const handleSaveInstallmentEdit = () => {
    if (editingInstallment === null) return;
    const updated = student.installments.map((i) =>
      i.number === editingInstallment ? { ...i, value: editValue, dueDate: editDueDate } : i
    );
    setDraftInstallments(updated);
    // Persiste/limpa o encargo atribuído manualmente nessa parcela
    setExtraValues((prev) => {
      const next = { ...prev };
      if (editExtra > 0) next[editingInstallment] = editExtra;
      else delete next[editingInstallment];
      return next;
    });
    setEditingInstallment(null);
  };


  // ─── Detecção de alterações pendentes (não confirmadas) ───────────────────
  // Compara estado atual vs snapshot original. Usado pelo prompt ao fechar.
  const buildPendingSummary = (): string[] => {
    const lines: string[] = [];
    const currByNum = new Map(student.installments.map((i) => [i.number, i]));
    if (originalInstallmentsRef.length !== student.installments.length) {
      lines.push(
        `Quantidade de parcelas: ${originalInstallmentsRef.length} → ${student.installments.length}`,
      );
    }
    for (const orig of originalInstallmentsRef) {
      const curr = currByNum.get(orig.number);
      if (!curr) continue;
      if (Math.abs((curr.value ?? 0) - (orig.value ?? 0)) > 0.001) {
        lines.push(
          `Parcela ${orig.number} — valor: ${formatCurrency(orig.value)} → ${formatCurrency(curr.value)}`,
        );
      }
      if (curr.dueDate !== orig.dueDate) {
        lines.push(
          `Parcela ${orig.number} — vencimento: ${formatDateBR(orig.dueDate)} → ${formatDateBR(curr.dueDate)}`,
        );
      }
    }
    return lines;
  };

  const handleAttemptClose = async () => {
    // Renegociação em andamento → oferece rascunho (stand-by) em vez de perder o progresso
    if (renegMode !== 'none') {
      const ok = await confirm({
        title: 'Sair da renegociação?',
        description:
          'Salvar como rascunho para continuar depois de onde parou, ou descartar o que foi configurado?',
        confirmText: 'Salvar rascunho',
        cancelText: 'Descartar e fechar',
      });
      if (ok) {
        persistRenegStandby();
        toast.success('Renegociação em rascunho. Abra de novo este aluno para continuar.');
      } else {
        clearRenegStandby(student.id);
        setStandbyDraft(null);
      }
      onClose();
      return;
    }

    const pending = buildPendingSummary();
    if (pending.length === 0) {
      onClose();
      return;
    }
    const ok = await confirm({
      title: 'Confirmar ajustes que foram feitos?',
      description:
        'As alterações abaixo ainda não foram confirmadas e enviadas para conciliação:\n\n' +
        pending.map((l) => `• ${l}`).join('\n') +
        '\n\nDeseja confirmar agora? "Descartar" fecha o modal sem salvar nem enviar para conciliação.',
      confirmText: 'Confirmar ajustes',
      cancelText: 'Descartar e fechar',
    });
    if (ok) {
      await handlePaySelected();
    } else {
      onClose();
    }
  };

  const paidCountStudent = student.installments.filter((i) => i.paid).length;

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-start justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold text-foreground leading-tight">Gestão Financeira</h2>
            <p className="text-sm text-foreground font-semibold">{student.name}</p>
            {student.product && (
              <p className="text-xs text-muted-foreground">{student.product}</p>
            )}
            {studentTagObjs.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {studentTagObjs.map((t) => (
                  <span
                    key={t.id}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-foreground/70 border border-border"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleAttemptClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        {banner && bannerVisible && (
          <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 fade-in shadow-sm">
            <AlertOctagon size={16} className="text-rose-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-rose-700 leading-snug">{banner.title}</p>
              {banner.body && (
                <p className="text-[11px] text-rose-700/90 leading-snug mt-1 whitespace-pre-wrap break-words">{banner.body}</p>
              )}
            </div>
            <button
              onClick={() => setBannerVisible(false)}
              className="p-1 rounded-md hover:bg-rose-100 text-rose-600 shrink-0"
              title="Fechar aviso"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {standbyDraft && renegMode === 'none' && (
          <div className="mx-6 mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 flex items-start gap-2.5 fade-in shadow-sm">
            <Clock size={16} className="text-sky-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-sky-800 leading-snug">Renegociação em rascunho</p>
              <p className="text-[11px] text-sky-800/90 leading-snug mt-1">
                Você saiu no meio do fluxo
                {standbyDraft.savedAt
                  ? ` (${new Date(standbyDraft.savedAt).toLocaleString('pt-BR')})`
                  : ''}
                . Pode continuar de onde parou.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => applyRenegStandby(standbyDraft)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-600 text-white hover:bg-sky-700 transition-colors"
                >
                  Continuar de onde parei
                </button>
                <button
                  type="button"
                  onClick={discardRenegStandby}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white border border-sky-200 text-sky-800 hover:bg-sky-100 transition-colors"
                >
                  Descartar rascunho
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 space-y-4">
          {canChooseMode && (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-[11px] font-semibold text-foreground/80 mb-2">
                Modo de aprovação
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalMode('total')}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors text-xs ${
                    approvalMode === 'total'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm'
                      : 'bg-card border-border text-foreground/70 hover:bg-muted'
                  }`}
                  title="Aplica as alterações imediatamente e já registra como conciliadas (auditoria)."
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={12} /> Aprovar com Conciliação Total
                  </div>
                  <div className="text-[10px] font-normal text-foreground/60 mt-0.5">
                    Efetiva na hora, sem pendência.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalMode('send')}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors text-xs ${
                    approvalMode === 'send'
                      ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-sm'
                      : 'bg-card border-border text-foreground/70 hover:bg-muted'
                  }`}
                  title="Registra a alteração como pendência na aba Conciliação, para revisão."
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <FileText size={12} /> Aprovar e enviar para Conciliação
                  </div>
                  <div className="text-[10px] font-normal text-foreground/60 mt-0.5">
                    Vai para a fila de conciliação.
                  </div>
                </button>
              </div>
            </div>
          )}
          <StudentDraftBanner studentId={student.id} />
          {pendingRenegociacao && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-2.5">
              <AlertOctagon size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800 leading-snug">
                  Renegociação aguardando conciliação
                </p>
                <p className="text-[11px] text-amber-800/90 leading-snug mt-1">
                  As alterações ficam como <strong>rascunho</strong> e só serão efetivadas após aprovação na aba Conciliação. {pendingRenegociacao.resumo}
                </p>
              </div>
            </div>
          )}
          {/* ─── Fluxo de Pagamento (timeline horizontal no topo) ─── */}
          <div className="border border-border rounded-xl p-4 bg-muted/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fluxo de Pagamento</h3>
              <span className="text-[10px] text-muted-foreground">
                {student.installments.length + (hasEntrada ? 1 : 0) + (hasEntradaPendente ? 1 : 0)} parcelas
                {hasEntrada || hasEntradaPendente ? ' (incl. entrada)' : ''}
              </span>
            </div>
            {(() => {
              const encargosAtribuidosTotal = Object.values(extraValues).reduce((a, b) => a + (b || 0), 0);
              const hasAtribuidos = encargosAtribuidosTotal > 0.0049;
              const encargosAtribuidosList = Object.entries(extraValues)
                .map(([num, val]) => ({ num: Number(num), val: Number(val) || 0 }))
                .filter((e) => e.val > 0.0049)
                .sort((a, b) => a.num - b.num);
              const cols = 5
                + ((student.downPayment ?? 0) > 0 ? 1 : 0)
                + (hasEntradaPendente ? 1 : 0)
                + (encargosHistoricoTotal > 0.0049 ? 1 : 0)
                + (hasAtribuidos ? 1 : 0);
              const colsClass =
                cols >= 8 ? 'grid-cols-8'
                : cols >= 7 ? 'grid-cols-7'
                : cols === 6 ? 'grid-cols-6'
                : cols === 5 ? 'grid-cols-5'
                : 'grid-cols-4';
              return (
            <div className={`grid ${colsClass} gap-2 mb-3`}>
              <div className="p-2 bg-card border border-border rounded-lg">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Contrato</p>
                <p className="text-xs font-bold text-foreground">{formatCurrency(valorContrato)}</p>
                {encargosHistoricoTotal > 0.0049 && (
                  <p className="text-[9px] text-amber-700 font-medium mt-0.5">
                    + {formatCurrency(encargosHistoricoTotal)} encargos
                  </p>
                )}
              </div>
              {(student.downPayment ?? 0) > 0 && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-[9px] text-emerald-700 uppercase tracking-wide">Entrada Paga</p>
                  <p className="text-xs font-bold text-emerald-700">{formatCurrency(student.downPayment ?? 0)}</p>
                </div>
              )}
              {hasEntradaPendente && (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded-lg">
                  <p className="text-[9px] text-amber-700 uppercase tracking-wide">Entrada Pendente</p>
                  <p className="text-xs font-bold text-amber-800">{formatCurrency(entradaPendenteValor)}</p>
                </div>
              )}
              {encargosHistoricoTotal > 0.0049 && (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded-lg">
                  <p className="text-[9px] text-amber-700 uppercase tracking-wide">Encargos Aplicados</p>
                  <p className="text-xs font-bold text-amber-700">{formatCurrency(encargosHistoricoTotal)}</p>
                </div>
              )}
              {hasAtribuidos && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowEncargosBreakdown((v) => !v)}
                    className="w-full p-2 bg-amber-50 border border-amber-300 rounded-lg text-left hover:bg-amber-100 transition"
                    title="Clique para ver a quais parcelas os encargos foram atribuídos"
                  >
                    <p className="text-[9px] text-amber-700 uppercase tracking-wide flex items-center justify-between">
                      Encargos Atribuídos
                      <span className="text-[8px]">{showEncargosBreakdown ? '▲' : '▼'}</span>
                    </p>
                    <p className="text-xs font-bold text-amber-800">{formatCurrency(encargosAtribuidosTotal)}</p>
                  </button>
                  {showEncargosBreakdown && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-amber-200 rounded-lg shadow-lg p-2 space-y-1 max-h-48 overflow-auto">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold pb-1 border-b border-border">
                        Atribuído por parcela
                      </p>
                      {encargosAtribuidosList.map((e) => {
                        const inst = student.installments.find((i) => i.number === e.num);
                        return (
                          <div key={e.num} className="flex items-center justify-between text-[10px]">
                            <span className="text-foreground">
                              Parcela {displayParcelLabel(e.num)}{inst ? ` • ${formatDateBR(inst.dueDate)}` : ''}
                            </span>
                            <span className="font-semibold text-amber-700">{formatCurrency(e.val)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-[9px] text-amber-700 uppercase tracking-wide">À Vencer</p>
                <p className="text-xs font-bold text-amber-700">
                  {formatCurrency(totalAVencer)}
                </p>
              </div>
              <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg">
                <p className="text-[9px] text-rose-700 uppercase tracking-wide">Vencido</p>
                <p className="text-xs font-bold text-rose-700">
                  {formatCurrency(totalOverdueSemEncargos)}
                </p>
              </div>
              <div
                className="p-2 bg-violet-50 border border-violet-300 rounded-lg"
                title="Parcelas já pagas + créditos de abatimento recebidos de outros contratos (a entrada não entra neste saldo)"
              >
                <p className="text-[9px] text-violet-700 uppercase tracking-wide">Saldo p/ Abater</p>
                <p className="text-xs font-bold text-violet-800">
                  {formatCurrency(totalPagoParcelas + totalCreditoAbatimento)}
                </p>
                {totalCreditoAbatimento > 0.0049 && (
                  <p className="text-[8px] text-violet-700/90 mt-0.5 leading-tight">
                    incl. {formatCurrency(totalCreditoAbatimento)} de abatimento
                  </p>
                )}
              </div>
              <div className="p-2 bg-slate-100 border border-slate-300 rounded-lg">
                <p className="text-[9px] text-slate-700 uppercase tracking-wide">Total Aberto</p>
                <p className="text-xs font-bold text-slate-800">
                  {formatCurrency(totalAberto)}
                </p>
              </div>
            </div>
              );
            })()}

            <div className="overflow-x-auto no-scrollbar">
              <div className="flex gap-1.5 min-w-max py-1">
                {hasEntrada && (
                  <div
                    className="flex flex-col items-center px-2 py-1.5 rounded-lg border min-w-[80px] border-emerald-300 bg-emerald-50"
                    title={`Entrada — ${formatCurrency(entradaValor)} — quitada na matrícula`}
                  >
                    <span className="text-[9px] font-bold text-emerald-800">P1</span>
                    <span className="text-[8px] font-semibold text-emerald-700 mt-0.5">Entrada</span>
                    <span className="text-[10px] font-bold mt-0.5 text-emerald-700">
                      {formatCurrency(entradaValor)}
                    </span>
                    <span className="text-[8px] text-muted-foreground mt-0.5 leading-tight text-center">
                      {student.enrollmentDate
                        ? `Matrícula: ${formatDateBR(student.enrollmentDate)}`
                        : 'Na matrícula'}
                    </span>
                    <span className="mt-0.5 text-[8px] font-semibold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      ✓ Pago
                    </span>
                  </div>
                )}
                {hasEntradaPendente && student.installments.filter((i) => isEntradaPendenciaInstallment(i)).map((inst) => {
                  const isOverdue = !inst.paid && parseDateLocal(inst.dueDate) < today;
                  return (
                    <div
                      key={`entrada-pend-${inst.number}`}
                      className={`flex flex-col items-center px-2 py-1.5 rounded-lg border min-w-[80px] ${
                        isOverdue ? 'border-amber-400 bg-amber-50' : 'border-amber-300 bg-amber-50/80'
                      }`}
                      title={`Entrada pendente — ${formatCurrency(inst.value)} — Venc. ${formatDateBR(inst.dueDate)}`}
                    >
                      <span className="text-[9px] font-bold text-amber-800">Entrada</span>
                      <span className="text-[8px] font-semibold text-amber-700 mt-0.5">Pendente</span>
                      <span className="text-[10px] font-bold mt-0.5 text-amber-800">{formatCurrency(inst.value)}</span>
                      <span className="text-[8px] text-muted-foreground mt-0.5 leading-tight text-center">
                        Venc: {formatDateBR(inst.dueDate)}
                      </span>
                      <span className={`mt-0.5 text-[8px] font-semibold px-1 py-0.5 rounded ${isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isOverdue ? 'Vencido' : 'Aguardando'}
                      </span>
                    </div>
                  );
                })}
                {[...student.installments].sort((a, b) => parseDateLocal(a.dueDate).getTime() - parseDateLocal(b.dueDate).getTime() || a.number - b.number).map((inst) => {
                  const isEntradaPendente = isEntradaPendenciaInstallment(inst);
                  const isRecompraFundo = isRecompraOuFundoParcela(inst, studentTags);
                  const isOverdue = !inst.paid && !isRecompraFundo && parseDateLocal(inst.dueDate) < today;
                  if (isEntradaPendente) return null;
                  return (
                    <div
                      key={inst.number}
                      className={`flex flex-col items-center px-2 py-1.5 rounded-lg border min-w-[80px] ${
                        inst.paid
                          ? 'border-emerald-300 bg-emerald-50'
                          : isOverdue
                            ? 'border-rose-300 bg-rose-50'
                            : 'border-border bg-card'
                      }`}
                      title={`Parcela ${displayParcelLabel(inst.number)} — Venc. ${formatDateBR(inst.dueDate)}${inst.paid && inst.paidDate ? ` — Pago em ${formatDateBR(inst.paidDate)}` : ''}`}
                    >
                      <span className="text-[9px] font-bold text-muted-foreground">
                        P{displayParcelLabel(inst.number)}
                      </span>
                      {(() => {
                        const credit = getInstallmentCreditApplied(inst);
                        const outstanding = getInstallmentOutstanding(inst);
                        const hasDiff = inst.paid && typeof inst.paidValue === 'number' && Math.abs((inst.paidValue ?? inst.value) - inst.value) > 0.01;
                        const isJuros = hasDiff && (inst.paidValue as number) > inst.value;
                        if (!inst.paid && credit > 0.0049) {
                          return (
                            <div className="flex flex-col items-center mt-0.5 gap-0.5">
                              <span className="text-[8px] font-medium text-muted-foreground line-through leading-tight">
                                {formatCurrency(inst.value)}
                              </span>
                              <span className="text-[10px] font-bold leading-tight text-violet-700">
                                {formatCurrency(outstanding)}
                              </span>
                              <span className="text-[7px] text-violet-600 leading-tight text-center">
                                −{formatCurrency(credit)} abat.
                              </span>
                            </div>
                          );
                        }
                        if (hasDiff) {
                          return (
                            <div className="flex flex-col items-center mt-0.5 gap-0.5">
                              <span className="text-[8px] font-medium text-muted-foreground line-through leading-tight">
                                {formatCurrency(inst.value)}
                              </span>
                              <span className={`text-[10px] font-bold leading-tight ${isJuros ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {formatCurrency(inst.paidValue as number)}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <span className={`text-[10px] font-bold mt-0.5 ${
                            inst.paid ? 'text-emerald-700' : isOverdue ? 'text-rose-700' : 'text-foreground'
                          }`}>
                            {formatCurrency(inst.value)}
                          </span>
                        );
                      })()}
                      <span className="text-[8px] text-muted-foreground mt-0.5 leading-tight text-center">
                        Venc: {formatDateBR(inst.dueDate)}
                      </span>
                      {inst.paid && inst.paidDate && (
                        <span className="text-[8px] text-emerald-700 font-semibold mt-0.5 leading-tight text-center">
                          Pago: {formatDateBR(inst.paidDate)}
                        </span>
                      )}
                      <span className={`mt-0.5 text-[8px] font-semibold px-1 py-0.5 rounded ${
                        inst.paid ? 'bg-emerald-100 text-emerald-700' : isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {inst.paid ? '✓ Pago' : isOverdue ? 'Vencido' : 'Pendente'}
                      </span>
                      {/* Tags da parcela — minimalistas, no rodapé do card */}
                      {(() => {
                        const tagObjs = (inst.tags || [])
                          .map((tid) => allTags.find((t) => t.id === tid))
                          .filter((t): t is NonNullable<typeof t> => !!t);
                        if (tagObjs.length === 0) return null;
                        return (
                          <div className="mt-1 flex flex-wrap gap-0.5 justify-center max-w-[88px]">
                            {tagObjs.map((tag) => (
                              <span
                                key={tag.id}
                                title={tag.name}
                                className="text-[7px] font-semibold px-1 py-px rounded border leading-tight truncate max-w-[80px]"
                                style={getTagStyle(tag.color)}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tags por parcela (Sicoob 2 / Antecipação / TMF e demais) */}
            {(() => {
              const TAG_KEYS = ['sicoob 2', 'sicoob2', 'antecipacao', 'antecipação', 'tmf'];
              const sorted = [...student.installments].sort(
                (a, b) => parseDateLocal(a.dueDate).getTime() - parseDateLocal(b.dueDate).getTime() || a.number - b.number
              );
              const byTag = new Map<string, { name: string; color: string; parcels: number[] }>();
              for (const inst of sorted) {
                for (const tid of inst.tags || []) {
                  const tagObj = allTags.find((t) => t.id === tid);
                  const name = tagObj?.name || tid;
                  const norm = name.trim().toLowerCase();
                  if (!TAG_KEYS.some((k) => norm.includes(k))) continue;
                  const cur = byTag.get(tid) || { name, color: tagObj?.color || 'slate', parcels: [] };
                  cur.parcels.push(inst.number);
                  byTag.set(tid, cur);
                }
              }
              if (byTag.size === 0) return null;
              return (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from(byTag.values()).map((g) => (
                    <div
                      key={g.name}
                      className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border bg-muted/40 border-border"
                    >
                      <span className="font-semibold text-foreground">{g.name}:</span>
                      <span className="text-muted-foreground">
                        {g.parcels.map((n) => `P${displayParcelLabel(n)}`).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Encargos sobre Atraso */}
          <div className="border border-border rounded-xl p-4 bg-muted/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Encargos sobre Atraso</h3>
              {hasOverdue && (
                <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  Aplicados automaticamente
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Multa Contratual (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={multaPercent}
                  onChange={(e) => setMultaPercent(Number(e.target.value))}
                  className="input-field mt-1 w-full text-xs py-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium">Juros ao Mês (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={jurosPercent}
                  onChange={(e) => setJurosPercent(Number(e.target.value))}
                  className="input-field mt-1 w-full text-xs py-1"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Pré-preenchidos em 10% (multa) e 1% a.m. (juros). Aplicam-se apenas a parcelas vencidas — você pode editar antes de confirmar.
              Para atribuir um <strong>encargo em valor (R$)</strong> a uma parcela específica, use o ícone de lápis na parcela.
            </p>

          </div>

          {/* Toggle Excluir/Incluir Encargos */}
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parcelas Pendentes</h3>
            {hasOverdue && (
              <button
                onClick={() => setShowCharges(!showCharges)}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  showCharges ? 'text-destructive' : 'text-primary'
                }`}
                title={showCharges ? 'Remover multa e juros do cálculo' : 'Aplicar multa e juros nas parcelas vencidas'}
              >
                {showCharges ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                {showCharges ? 'Excluir Encargos' : 'Incluir Encargos'}
              </button>
            )}
          </div>

          {/* Lista de parcelas */}
          <div className="space-y-2 max-h-48 overflow-auto no-scrollbar">
            {unpaidInstallments.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma parcela pendente.</p>
            ) : (
              unpaidInstallments.map((inst) => {
                const charges = calculateCharges(inst.value, inst.dueDate, inst.number);
                const isOverdue =
                  !isRecompraOuFundoParcela(inst, studentTags) && parseDateLocal(inst.dueDate) < today;
                const isEditing = editingInstallment === inst.number;
                return (
                  <div
                    key={inst.number}
                    className={`p-3 rounded-xl border transition-all ${
                      selectedParcels.includes(inst.number)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                    <div
                      onClick={() => toggleParcel(inst.number)}
                      className={`w-4 h-4 rounded-md border-2 flex items-center justify-center cursor-pointer ${
                        selectedParcels.includes(inst.number) ? 'border-primary bg-primary' : 'border-border'
                      }`}
                    >
                      {selectedParcels.includes(inst.number) && <span className="text-primary-foreground text-[10px]">✓</span>}
                    </div>
                    <div className="flex-1" onClick={() => !isEditing && toggleParcel(inst.number)}>
                      <span className="text-xs font-medium text-foreground cursor-pointer">Parcela {displayParcelLabel(inst.number)}</span>
                      <span className={`ml-2 text-[10px] ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        {formatDateBR(inst.dueDate)}
                      </span>
                      {pendingPaymentParcels.has(inst.number) && (
                        <span className="ml-2 inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          Conciliação Pendente
                        </span>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            className="input-field text-xs py-1"
                            style={{ width: '7.5rem' }}
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            title="Data de vencimento"
                          />
                          <div className="w-28">
                            <CurrencyInput
                              value={editValue}
                              onChange={(v) => setEditValue(v)}
                              className="text-xs py-1"
                              showPrefix={false}
                              title="Valor"
                            />
                          </div>
                          <button onClick={handleSaveInstallmentEdit} className="action-btn !w-6 !h-6 text-emerald-600" title="Salvar edição"><Check size={10} /></button>
                        </div>
                        {/* Encargo atribuído manualmente à parcela */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground" title="Encargo manual atribuído a esta parcela. Não altera o Valor do Contrato; aparece no indicador de Encargos Atribuídos do topo.">
                            + Encargo
                          </span>
                          <div className="w-24">
                            <CurrencyInput
                              value={editExtra}
                              onChange={(v) => setEditExtra(v)}
                              className="text-xs py-1"
                              showPrefix
                              placeholder="0,00"
                              title="Encargo atribuído a esta parcela"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-foreground">
                          {formatCurrency(showCharges ? charges.total : inst.value + getExtra(inst.number))}
                        </span>
                        {getExtra(inst.number) > 0 && (
                          <span
                            className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                            title={`Encargo atribuído: ${formatCurrency(getExtra(inst.number))}`}
                          >
                            +{formatCurrency(getExtra(inst.number))}
                          </span>
                        )}
                        {immediateApply && isImmediate && (
                          <button
                            onClick={() => handleQuickMarkPaid(inst)}
                            className="action-btn !w-5 !h-5 text-emerald-600 hover:text-emerald-700"
                            title="Marcar como paga (conciliação imediata)"
                          >
                            <BadgeCheck size={10} />
                          </button>
                        )}
                        <button onClick={() => handleEditInstallment(inst)} className="action-btn !w-5 !h-5" title="Editar valor, vencimento e encargo">
                          <Edit2 size={9} />
                        </button>
                        <button
                          onClick={() => handleDuplicateInstallment(inst)}
                          className="action-btn !w-5 !h-5 text-blue-600 hover:text-blue-700"
                          title="Duplicar parcela (prorrogar) — cria nova parcela ao final do cronograma"
                        >
                          <Copy size={9} />
                        </button>
                        <button
                          onClick={() => handleDeleteInstallment(inst)}
                          className="action-btn !w-5 !h-5 text-rose-600 hover:text-rose-700"
                          title="Excluir parcela — lembre-se de redistribuir o saldo"
                        >
                          <Trash2 size={9} />
                        </button>
                      </div>
                    )}
                    </div>

                  </div>
                );
              })
            )}
          </div>

          {/* Parcelas Pagas — possibilidade de desconciliar (somente admin/conciliação) */}
          {student.installments.some((i) => i.paid) && (currentUser?.role === 'admin' || currentUser?.role === 'conciliacao') && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parcelas Pagas</h3>
              <div className="space-y-2 max-h-40 overflow-auto no-scrollbar">
                {student.installments.filter((i) => i.paid).map((inst) => (
                  <div key={inst.number} className="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                    <div className="flex-1">
                      <span className="text-xs font-medium text-foreground">Parcela {displayParcelLabel(inst.number)}</span>
                      <span className="ml-2 text-[10px] text-emerald-700">
                        Pago em {inst.paidDate ? formatDateBR(inst.paidDate) : '—'} • Venc. {formatDateBR(inst.dueDate)}
                      </span>
                    </div>
                    {(() => {
                      const hasDiff = typeof inst.paidValue === 'number' && Math.abs((inst.paidValue ?? inst.value) - inst.value) > 0.01;
                      const isJuros = hasDiff && (inst.paidValue as number) > inst.value;
                      if (!hasDiff) {
                        return <span className="text-xs font-semibold text-emerald-700">{formatCurrency(inst.value)}</span>;
                      }
                      return (
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-[10px] text-muted-foreground line-through">{formatCurrency(inst.value)}</span>
                          <span className={`text-xs font-semibold ${isJuros ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(inst.paidValue as number)}</span>
                          <span className={`text-[9px] font-medium ${isJuros ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {isJuros ? `+${formatCurrency((inst.paidValue as number) - inst.value)} juros` : `−${formatCurrency(inst.value - (inst.paidValue as number))} desc.`}
                          </span>
                        </div>
                      );
                    })()}
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Desconciliar pagamento da parcela ${inst.number}?`,
                          description: `A parcela voltará para "Pendente". Valor: ${formatCurrency(inst.value)}.`,
                          variant: 'destructive',
                          confirmText: 'Desconciliar',
                        });
                        if (!ok) return;
                        const updated = student.installments.map((i) =>
                          i.number === inst.number ? { ...i, paid: false, paidDate: undefined } : i
                        );
                        const paidCount = updated.filter((i) => i.paid).length;
                        updateStudent(student.id, {
                          installments: updated,
                          paidInstallments: paidCount,
                          history: [
                            ...student.history,
                            addHistoryEntry(`Pagamento da parcela ${inst.number} desconciliado (${formatCurrency(inst.value)}). Voltou para pendente.`),
                          ],
                        });
                        registrarConc({
                          tipo: 'parcela_valor',
                          studentSnapshot: buildStudentSnapshot(baseStudent),
                          studentId: student.id,
                          studentName: student.name,
                          ac: student.ac,
                          resumo: `Parcela ${inst.number} — pagamento desconciliado (${formatCurrency(inst.value)})`,
                          antes: { parcela: inst.number, valor: inst.value, paid: true, paidDate: inst.paidDate },
                          depois: { parcela: inst.number, valor: inst.value, paid: false },
                          autorObservacao: obsConciliacao.trim() || undefined,
                        });
                        // Atualiza snapshot original p/ que a parcela desconciliada
                        // entre no Check de Valor e aumente a carteira pendente.
                        setOriginalInstallmentsRef((prev) =>
                          prev.map((i) => (i.number === inst.number ? { ...i, paid: false, paidDate: undefined } : i)),
                        );
                        toast.success(`Parcela ${inst.number} marcada como pendente.`);
                      }}
                      className="px-2 py-1 rounded-lg text-[10px] font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors"
                      title="Reverter pagamento (marcar como não pago)"
                    >
                      Desconciliar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saldo */}
          {(() => {
            const encargosAplicados = Math.max(0, totalPending - totalAberto);
            const totalMulta = overdueInstallments.reduce((acc, i) => acc + calculateCharges(i.value, i.dueDate, i.number).multa, 0);
            const totalJurosCalc = overdueInstallments.reduce((acc, i) => acc + calculateCharges(i.value, i.dueDate, i.number).juros, 0);
            return (
              <div className="p-4 bg-muted rounded-xl space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Valor Contrato</p>
                    <p className="text-xs font-semibold text-foreground">{formatCurrency(valorContrato)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Valor Pendente {showCharges ? '(c/ Encargos)' : ''}</p>
                    <p className="text-xs font-semibold text-foreground">{formatCurrency(totalPending)}</p>
                  </div>
                </div>
                {showCharges && encargosAplicados > 0.0049 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-800 flex items-center gap-1">
                        <AlertOctagon size={11} /> Encargos aplicados
                      </p>
                      <p className="text-[10px] text-amber-700 mt-0.5">
                        Multa {formatCurrency(totalMulta)} • Juros {formatCurrency(totalJurosCalc)}
                      </p>
                    </div>
                    <p className="text-base font-extrabold text-amber-700 whitespace-nowrap">
                      +{formatCurrency(encargosAplicados)}
                    </p>
                  </div>
                )}
                <div className="border-t border-border/50 pt-2">
                  <p className="text-[11px] text-rose-700 font-bold uppercase tracking-wider">Valor Vencido</p>
                  <p className="text-3xl font-extrabold text-rose-600">{formatCurrency(totalOverdue)}</p>
                  <p className="text-[10px] text-rose-500 mt-0.5">
                    {overdueInstallments.length} parcela{overdueInstallments.length !== 1 ? 's' : ''} vencida{overdueInstallments.length !== 1 ? 's' : ''}
                    {showCharges && encargosAplicados > 0.0049 && (
                      <> • <span className="text-amber-700 font-semibold">inclui {formatCurrency(encargosAplicados)} de encargos</span></>
                    )}
                  </p>
                </div>
            {/* Check de Valor — soma das parcelas (sem encargos) deve bater com o saldo original */}
            <div className={`mt-2 rounded-lg p-3 border ${
              checkOk
                ? 'bg-slate-800 border-slate-700 text-emerald-300'
                : 'bg-slate-800 border-rose-500 text-rose-300'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">Check de Valor</p>
                  <p className="text-[10px] opacity-70 mt-0.5">
                    Soma vencidos + a vencer (sem encargos) vs. saldo original
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-extrabold ${checkOk ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {checkOk ? 'R$ 0,00 ✓' : formatCurrency(checkDiff)}
                  </p>
                  <p className="text-[10px] opacity-70 mt-0.5">
                    Atual {formatCurrency(totalAberto)} • Original {formatCurrency(saldoOriginalRef)}
                  </p>
                </div>
              </div>
              {!checkOk && (
                <p className="text-[10px] mt-2 text-rose-200/90">
                  {checkDiff > 0
                    ? `Faltam ${formatCurrency(checkDiff)} — acrescente em alguma parcela.`
                    : `Sobra ${formatCurrency(-checkDiff)} — reduza em alguma parcela.`}
                </p>
              )}
            </div>

            {/* Saldo do Contrato — comparação absoluta com saleValue (detecta encargo/correção) */}
            {hasDelta && (() => {
              const isNegativo = deltaContrato < 0;
              const novoContrato = (baseStudent.saleValue ?? 0) + encargoValor;
              const painelCls = isNegativo
                ? 'mt-2 rounded-lg p-3 border bg-rose-50 border-rose-300'
                : 'mt-2 rounded-lg p-3 border bg-amber-50 border-amber-300';
              const tituloCls = isNegativo ? 'text-rose-900' : 'text-amber-900';
              const subCls = isNegativo ? 'text-rose-800/90' : 'text-amber-800/90';
              const valorCls = isNegativo ? 'text-rose-700' : 'text-amber-700';
              const boxCls = isNegativo
                ? 'p-2 rounded-lg border border-rose-400 bg-rose-100/80'
                : 'p-2 rounded-lg border border-amber-400 bg-amber-100/80';
              return (
              <div className={painelCls}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className={`text-[11px] uppercase tracking-wider font-bold ${tituloCls} flex items-center gap-1`}>
                      <AlertOctagon size={12} /> Saldo divergente do contrato
                    </p>
                    <p className={`text-[10px] ${subCls} mt-0.5`}>
                      Parcelas pendentes <strong>{formatCurrency(totalAberto)}</strong> vs. saldo do contrato (Valor − Pago) <strong>{formatCurrency(saldoContratoReal)}</strong>
                    </p>
                  </div>
                  <p className={`text-lg font-extrabold ${valorCls}`}>
                    {deltaContrato > 0 ? '+' : ''}{formatCurrency(deltaContrato)}
                  </p>
                </div>
                <p className={`text-[11px] ${tituloCls} mb-2 font-semibold`}>
                  {isNegativo
                    ? <>Diferença registrada automaticamente como <span className="uppercase tracking-wide">Redução do Contrato</span> (valor do contrato diminui).</>
                    : <>Diferença registrada automaticamente como <span className="uppercase tracking-wide">Encargo</span> (multa/juros embutido).</>}
                </p>
                <div className={boxCls}>
                  <p className={`text-[10px] ${subCls} mb-1.5`}>
                    Valor do contrato {isNegativo ? 'reduz' : 'sobe'} para <strong>{formatCurrency(novoContrato)}</strong>.
                  </p>
                  <div className="relative w-full">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={encargoValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const neg = raw.startsWith('-');
                        const digits = raw.replace(/[^\d,\.]/g, '').replace(/\./g, '').replace(',', '.');
                        const n = Number(digits);
                        if (Number.isFinite(n)) setEncargoValor(neg ? -n : n);
                      }}
                      className={`input-field w-full pl-9 px-2 py-1 text-xs rounded-md border ${isNegativo ? 'border-rose-300' : 'border-amber-300'} bg-white`}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Use sinal negativo (ex.: -8000,00) para reduzir o valor do contrato.
                  </p>
                </div>
                {!deltaResolvido && (
                  <p className="text-[10px] mt-2 text-rose-700 font-medium">
                    Informe um valor diferente de zero.
                  </p>
                )}
              </div>
              );
            })()}
          </div>
            );
          })()}




          {/* Botões de ação principais */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <button
                onClick={() => { setQuitacaoMode(!quitacaoMode); setQuitParcelasMode(false); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:shadow-lg hover:-translate-y-0.5 border border-amber-600/20"
              >
                <DollarSign size={16} />
                Quitação Total

              </button>
            </div>

          <div>
              <button
                onClick={() => {
                  const next = !quitParcelasMode;
                  setQuitParcelasMode(next);
                  setQuitacaoMode(false);
                  if (next) {
                    // Pré-seleciona vencidas e pré-preenche valores com o registrado
                    setQuitParcSel(overdueInstallments.map((i) => i.number));
                    const vals: Record<number, number> = {};
                    unpaidInstallments.forEach((i) => { vals[i.number] = i.value; });
                    setQuitParcVal(vals);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-emerald-400 to-teal-500 text-white hover:shadow-lg hover:-translate-y-0.5 border border-emerald-600/20"
              >
                <CheckCircle2 size={16} />
                Quitação Parcelas
              </button>
            </div>

          <div>

              <button
                onClick={() => {
                  if (renegMode === 'none') {
                    // Default: seleciona todas as parcelas em aberto (vencidas + futuras)
                    setRenegSelected(unpaidInstallments.map((i) => i.number));
                    setRenegMode('initial');
                  } else {
                    setRenegMode('none');
                  }
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:shadow-lg hover:-translate-y-0.5 border border-blue-600/20"
              >
                <Zap size={16} />
                Renegociar Contrato
              </button>
            </div>
          </div>

          {/* Painel de Quitação Total */}
          {quitacaoMode && (
            <div className="border border-border rounded-xl p-4 bg-amber-50 space-y-4">
              <h3 className="text-sm font-semibold text-amber-700">Fluxo de Quitação Total</h3>

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-amber-900">Aplicar desconto</span>
                <div className="inline-flex rounded-lg overflow-hidden border border-amber-300">
                  <button
                    type="button"
                    onClick={() => { setDiscountType('percent'); setDiscountInput(0); }}
                    className={`px-3 py-1 text-xs font-semibold transition-colors ${discountType === 'percent' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
                  >%</button>
                  <button
                    type="button"
                    onClick={() => { setDiscountType('value'); setDiscountInput(0); }}
                    className={`px-3 py-1 text-xs font-semibold transition-colors ${discountType === 'value' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
                  >R$</button>
                </div>
              </div>

              {discountType === 'percent' ? (
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={discountInput || ''}
                    onChange={(e) => setDiscountInput(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-3 py-2 pr-8 rounded-lg border border-amber-300 bg-white text-sm text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-amber-700 font-semibold">%</span>
                </div>
              ) : (
                <CurrencyInput value={discountInput} onChange={(v) => setDiscountInput(v)} />
              )}

              <div className="space-y-1 pt-1 border-t border-amber-200">
                <p className="text-xs text-amber-800">Valor Original: <span className="font-bold">{formatCurrency(totalPending)}</span></p>
                <p className="text-xs text-amber-800">Desconto: <span className="font-bold">- {formatCurrency(descontoValor)}</span></p>
                <p className="text-sm font-bold text-amber-700">Valor para Quitação: {formatCurrency(quitacaoValue)}</p>
              </div>

              <p className="text-[10px] text-amber-700/80 leading-snug">
                A baixa na carteira ocorrerá apenas após a aprovação na aba Conciliação.
              </p>

              <div className="flex gap-2">
                <button onClick={() => { setQuitacaoMode(false); setDiscountInput(0); }} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                <button
                  onClick={handleQuitacao}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5"
                >
                  Confirmar Quitação
                </button>
              </div>
            </div>
          )}

          {/* Painel de Quitação de Parcelas */}
          {quitParcelasMode && (
            <div className="border border-border rounded-xl p-4 bg-emerald-50 space-y-4">
              <h3 className="text-sm font-semibold text-emerald-700">Fluxo de Quitação de Parcelas</h3>

              <p className="text-[11px] text-emerald-800 leading-snug">
                Selecione as parcelas a baixar. Edite o valor pago se necessário. Esta ação <strong>não baixa automaticamente</strong> — vai como rascunho para a aba <strong>Conciliação</strong>.
              </p>
              {unpaidInstallments.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhuma parcela em aberto.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                  {unpaidInstallments.map((i) => {
                    const selected = quitParcSel.includes(i.number);
                    const valorAtual = quitParcVal[i.number] ?? i.value;
                    const diverge = selected && Math.abs(valorAtual - i.value) > 0.01;
                    return (
                      <div
                        key={i.number}
                        className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                          selected ? 'bg-white border-emerald-300' : 'bg-white/50 border-emerald-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleQuitParc(i.number)}
                          className="accent-emerald-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-emerald-900">
                            Parcela {i.number} · venc. {formatDateBR(i.dueDate)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Registrado: {formatCurrency(i.value)}
                            {diverge && (
                              <span className="ml-1 text-amber-700 font-semibold">
                                · divergente ({valorAtual > i.value ? '+' : ''}{formatCurrency(valorAtual - i.value)})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="w-32">
                          <CurrencyInput
                            value={valorAtual}
                            onChange={(v) => setQuitParcVal((prev) => ({ ...prev, [i.number]: v }))}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {quitParcSel.length > 0 && (() => {
                const sumOriginal = unpaidInstallments
                  .filter((i) => quitParcSel.includes(i.number))
                  .reduce((a, i) => a + i.value, 0);
                const sumPago = quitParcSel.reduce(
                  (a, n) => a + (quitParcVal[n] ?? unpaidInstallments.find((i) => i.number === n)?.value ?? 0),
                  0,
                );
                const diff = sumPago - sumOriginal;
                const hasDiff = Math.abs(diff) > 0.01;
                return (
                  <div className={`text-[11px] p-2 rounded-lg border ${hasDiff ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-100/60 border-emerald-200 text-emerald-800'}`}>
                    <div>Selecionadas: <strong>{quitParcSel.length}</strong></div>
                    <div>Registrado: <strong>{formatCurrency(sumOriginal)}</strong> · Pago: <strong>{formatCurrency(sumPago)}</strong></div>
                    {hasDiff && (
                      <div className="mt-1 font-semibold">
                        ⚠ Divergência de {formatCurrency(Math.abs(diff))} ({diff > 0 ? 'a mais' : 'a menos'}). Será confirmado antes do envio.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex gap-2">
                <button
                  onClick={() => { setQuitParcelasMode(false); setQuitParcSel([]); setQuitParcVal({}); }}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >Cancelar</button>
                <button
                  onClick={handleQuitacaoParcelas}
                  disabled={quitParcSel.length === 0}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                >
                  Enviar para Conciliação
                </button>
              </div>
            </div>
          )}

          {/* Painel de Renegociação */}
          {renegMode !== 'none' && (
            <div className="border border-border rounded-xl p-4 bg-blue-50 space-y-4">
              <h3 className="text-sm font-semibold text-primary">Fluxo de Renegociação</h3>

              {renegMode === 'initial' && (
                <div className="space-y-3">
                  <p className="text-xs text-blue-700">
                    Configure os encargos da renegociação. Pré-preenchidos: <strong>Multa 10%</strong> e <strong>Juros 1% a.m.</strong> — você pode editar.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Multa Renegociação (%)</label>
                      <input
                        type="number" min="0" max="100" step="0.1"
                        value={renegMultaPercent}
                        onChange={(e) => setRenegMultaPercent(Number(e.target.value))}
                        className="input-field mt-1 w-full text-xs py-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Juros Renegociação (% a.m.)</label>
                      <input
                        type="number" min="0" max="100" step="0.1"
                        value={renegJurosPercent}
                        onChange={(e) => setRenegJurosPercent(Number(e.target.value))}
                        className="input-field mt-1 w-full text-xs py-1"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 p-3 bg-white rounded-lg border border-blue-200">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={applyMultaReneg} onChange={(e) => setApplyMultaReneg(e.target.checked)} className="rounded" />
                      <span className="text-xs text-foreground">Aplicar Multa</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={applyJurosReneg} onChange={(e) => setApplyJurosReneg(e.target.checked)} className="rounded" />
                      <span className="text-xs text-foreground">Aplicar Juros</span>
                    </label>
                  </div>

                  {/* Seleção de parcelas a renegociar — inclui pagas conciliadas
                      (útil para alunos de antecipação Sicoob/TMF/Fundo) */}
                  {(() => {
                    const overdue = student.installments.filter(
                      (i) =>
                        !i.paid &&
                        !isRecompraOuFundoParcela(i, studentTags) &&
                        parseDateLocal(i.dueDate) < today,
                    );
                    const futuras = student.installments.filter((i) => !i.paid && parseDateLocal(i.dueDate) >= today);
                    const pagas = student.installments.filter((i) => i.paid);
                    const allUnpaidNums = [...overdue, ...futuras].map((i) => i.number);
                    const allPaidNums = pagas.map((i) => i.number);
                    const allOpenSelected = allUnpaidNums.length > 0 && allUnpaidNums.every((n) => renegSelected.includes(n));
                    const allPaidSelected = allPaidNums.length > 0 && allPaidNums.every((n) => renegSelected.includes(n));
                    const renderGroup = (title: string, list: Installment[], badgeClass: string) => (
                      list.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">{title}</p>
                          <div className="space-y-1 max-h-40 overflow-auto pr-1">
                            {list.map((i) => (
                              <label key={i.number} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
                                <input
                                  type="checkbox"
                                  checked={renegSelected.includes(i.number)}
                                  onChange={() => toggleRenegParcel(i.number)}
                                  className="rounded"
                                />
                                <span className="flex-1">Parcela {i.number} • {parseDateLocal(i.dueDate).toLocaleDateString('pt-BR')}</span>
                                <span className="font-semibold">{formatCurrency(i.value)}</span>
                                {i.paid && <span className={`text-[9px] px-1.5 py-0.5 rounded ${badgeClass}`}>Conciliada paga</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    );
                    return (
                      <div className="p-3 bg-white rounded-lg border border-blue-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-foreground">Parcelas a renegociar</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setRenegSelected(allUnpaidNums)}
                              className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/70"
                            >
                              Só em aberto
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenegSelected([...allUnpaidNums, ...allPaidNums])}
                              className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/70"
                            >
                              Todas
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenegSelected([])}
                              className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/70"
                            >
                              Limpar
                            </button>
                          </div>
                        </div>
                        {renderGroup('Vencidas', overdue, 'bg-red-100 text-red-700')}
                        {renderGroup('A vencer', futuras, 'bg-blue-100 text-blue-700')}
                        {renderGroup('Conciliadas como pagas (antecipação)', pagas, 'bg-emerald-100 text-emerald-700')}
                        <p className="text-[10px] text-muted-foreground border-t pt-2">
                          Total selecionado: <strong>{formatCurrency(renegValues.remaining)}</strong>
                          {renegValues.paidIncluded.length > 0 && (
                            <> • <span className="text-emerald-700">{renegValues.paidIncluded.length} paga(s) incluída(s)</span></>
                          )}
                        </p>
                      </div>
                    );
                  })()}

                  <button
                    onClick={() => {
                      setRenegMode('detailed');
                      // Salva já no passo de cálculo para retomar no lugar certo
                      const draft = buildRenegStandby('detailed');
                      saveRenegStandby(draft);
                      setStandbyDraft(draft);
                    }}
                    disabled={renegSelected.length === 0}
                    className="w-full px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    Próximo: Calcular Parcelas
                  </button>
                </div>
              )}

              {renegMode === 'detailed' && (
                <div className="space-y-4">
                  <div className="p-3 bg-white rounded-lg border border-blue-200 space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">Resumo da Renegociação</p>
                    <div className="text-xs space-y-1">
                      <p>Saldo Devedor (vencido + a vencer): <span className="font-bold">{formatCurrency(renegValues.remaining)}</span></p>
                      {applyMultaReneg && <p>Multa ({renegMultaPercent}%): <span className="font-bold text-destructive">{formatCurrency(renegValues.multaValue)}</span></p>}
                      {applyJurosReneg && <p>Juros ({renegJurosPercent}% a.m.): <span className="font-bold text-destructive">{formatCurrency(renegValues.totalJuros)}</span></p>}
                      <p className="border-t pt-1">Total c/ Encargos: <span className="font-bold text-primary">{formatCurrency(renegValues.totalWithCharges)}</span></p>
                    </div>

                    {/* Ajuste de juros/multa no próprio passo — recalcula na hora */}
                    <div className="mt-2 pt-2 border-t border-blue-100 space-y-2">
                      <p className="text-[10px] font-semibold text-blue-800 uppercase tracking-wider">
                        Testar juros / multa
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        Altere aqui e o valor da parcela recalcula na hora — sem voltar ao passo anterior.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground font-medium">Multa (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={renegMultaPercent}
                            onChange={(e) => setRenegMultaPercent(Number(e.target.value))}
                            disabled={!applyMultaReneg}
                            className="input-field mt-1 w-full text-xs py-1 disabled:opacity-50"
                          />
                          <label className="mt-1 flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={applyMultaReneg}
                              onChange={(e) => setApplyMultaReneg(e.target.checked)}
                              className="rounded"
                            />
                            <span className="text-[10px] text-foreground">Aplicar multa</span>
                          </label>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground font-medium">Juros (% a.m.)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={renegJurosPercent}
                            onChange={(e) => setRenegJurosPercent(Number(e.target.value))}
                            disabled={!applyJurosReneg}
                            className="input-field mt-1 w-full text-xs py-1 disabled:opacity-50"
                          />
                          <label className="mt-1 flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={applyJurosReneg}
                              onChange={(e) => setApplyJurosReneg(e.target.checked)}
                              className="rounded"
                            />
                            <span className="text-[10px] text-foreground">Aplicar juros</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-muted-foreground font-medium">Entrada (Opcional)</label>
                        <div className="inline-flex rounded-md border border-border overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setEntradaMode('valor')}
                            className={`px-2 py-0.5 text-[9px] font-semibold ${entradaMode === 'valor' ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`}
                          >
                            R$
                          </button>
                          <button
                            type="button"
                            onClick={() => setEntradaMode('percent')}
                            className={`px-2 py-0.5 text-[9px] font-semibold border-l border-border ${entradaMode === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`}
                          >
                            %
                          </button>
                        </div>
                      </div>
                      <div className="mt-1">
                        {entradaMode === 'valor' ? (
                          <CurrencyInput
                            value={novaEntrada || 0}
                            onChange={(v) => { setNovaEntrada(v); }}
                            className="text-xs py-1"
                          />
                        ) : (
                          <div className="relative">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={entradaPercent || ''}
                              placeholder="0"
                              onChange={(e) => {
                                const p = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                setEntradaPercent(p);
                                const base = renegValues.totalWithCharges || 0;
                                setNovaEntrada(Math.round(base * p) / 100);
                              }}
                              className="input-field w-full text-xs py-1 pr-7"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {entradaMode === 'percent'
                          ? `${entradaPercent || 0}% de ${formatCurrency(renegValues.totalWithCharges)} = ${formatCurrency(novaEntrada)}`
                          : 'Será abatida do total'}
                      </p>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium">Nº Parcelas</label>
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={newInstallments || ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            setNewInstallments(0);
                            return;
                          }
                          const v = parseInt(raw, 10);
                          if (!Number.isFinite(v) || v < 0) return;
                          setNewInstallments(v);
                        }}
                        className="input-field mt-1 w-full text-xs py-1"
                      />
                      <p className="text-[9px] text-muted-foreground mt-1">Digite a quantidade desejada</p>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground font-medium">Data de Vencimento</label>
                      <input
                        type="date"
                        value={renegFirstDueDate}
                        onChange={(e) => setRenegFirstDueDate(e.target.value)}
                        className="input-field mt-1 w-full text-xs py-1"
                      />
                      <p className="text-[10px] text-foreground font-medium mt-2">
                        Deseja alterar somente o vencimento da 1ª parcela ou de todas?
                      </p>
                      <div className="inline-flex rounded-md border border-border overflow-hidden mt-1">
                        <button
                          type="button"
                          onClick={() => setRenegDueScope('primeira')}
                          className={`px-2 py-1 text-[10px] font-semibold ${renegDueScope === 'primeira' ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`}
                        >
                          Somente a 1ª parcela
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenegDueScope('todas')}
                          className={`px-2 py-1 text-[10px] font-semibold border-l border-border ${renegDueScope === 'todas' ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground hover:bg-muted'}`}
                        >
                          Todas as parcelas
                        </button>
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {renegDueScope === 'todas'
                          ? `Todas as parcelas vencem mensalmente no dia ${renegFirstDueDate ? new Date(renegFirstDueDate + 'T00:00:00').getDate() : student.dueDay}.`
                          : `Apenas a 1ª parcela usa essa data; as demais mantêm o dia ${student.dueDay}.`}
                      </p>
                    </div>
                  </div>


                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-[10px] text-green-700 font-medium mb-2">Resultado Final</p>
                    <div className="space-y-1 text-xs">
                      <p>Saldo após Entrada: <span className="font-bold">{formatCurrency(renegValues.remainingAfterEntrada)}</span></p>
                      <p className="text-sm font-bold text-green-700">Novo Valor da Parcela: {formatCurrency(renegValues.newValue)}</p>
                      <p className="text-[10px] text-green-600">{newInstallments}x de {formatCurrency(renegValues.newValue)}</p>
                      <p className="text-[10px] text-emerald-700 mt-1 pt-1 border-t border-green-200">
                        Fluxo total do aluno: <strong>{paidCountStudent + newInstallments} parcelas</strong> ({paidCountStudent} pagas + {newInstallments} novas)
                      </p>
                    </div>
                  </div>

                  {/* 3 Botões: Voltar / Confirmar / Gerar Termo */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setRenegMode('initial')}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Voltar para configuração de parcelas e encargos"
                    >
                      <ArrowLeft size={12} /> Voltar
                    </button>
                    <button
                      onClick={() => {
                        const draft = buildRenegStandby('confirm');
                        saveRenegStandby(draft);
                        setStandbyDraft(draft);
                        setRenegMode('confirm');
                      }}
                      disabled={newInstallments < 1}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors"
                    >
                      <CheckCircle2 size={12} /> Confirmar
                    </button>
                    <button
                      onClick={() => {
                        persistRenegStandby('detailed');
                        toast.success('Rascunho salvo. Você pode fechar e continuar depois.');
                      }}
                      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium bg-sky-50 border border-sky-200 text-sky-800 hover:bg-sky-100 transition-colors"
                      title="Salva o progresso e permite retomar depois"
                    >
                      <Clock size={12} /> Rascunho
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTermoModal(true)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium text-purple-700 hover:bg-purple-50 border border-purple-200 transition-colors"
                    title="Gerar termo aditivo (PDF ou ZapSign)"
                  >
                    <FileText size={12} /> Gerar Termo Aditivo
                  </button>
                </div>
              )}

              {/* Confirmação dupla */}
              {renegMode === 'confirm' && (
                <div className="space-y-4">
                  <div className="p-4 bg-white rounded-xl border-2 border-emerald-300 space-y-3">
                    <h4 className="text-sm font-bold text-emerald-700">Confirme as informações do novo acordo</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between border-b border-border/40 pb-1">
                        <span className="text-muted-foreground">Aluno:</span>
                        <span className="font-semibold text-foreground">{student.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Saldo Devedor:</span>
                        <span className="font-medium">{formatCurrency(renegValues.remaining)}</span>
                      </div>
                      {applyMultaReneg && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Multa ({renegMultaPercent}%):</span>
                          <span className="font-medium text-destructive">+ {formatCurrency(renegValues.multaValue)}</span>
                        </div>
                      )}
                      {applyJurosReneg && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Juros ({renegJurosPercent}% a.m.):</span>
                          <span className="font-medium text-destructive">+ {formatCurrency(renegValues.totalJuros)}</span>
                        </div>
                      )}
                      {novaEntrada > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Entrada:</span>
                          <span className="font-medium text-emerald-600">− {formatCurrency(novaEntrada)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border/40 pt-2">
                        <span className="text-muted-foreground">Novo plano:</span>
                        <span className="font-bold text-primary">{newInstallments}x de {formatCurrency(renegValues.newValue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Vencimento:</span>
                        <span className="font-medium">
                          {renegFirstDueDate ? new Date(renegFirstDueDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                          {renegDueScope === 'todas' ? ' (todas as parcelas)' : ' (somente a 1ª parcela)'}
                        </span>
                      </div>

                      <div className="flex justify-between text-emerald-700">
                        <span>Fluxo total do aluno:</span>
                        <span className="font-bold">{paidCountStudent + newInstallments} parcelas</span>
                      </div>
                    </div>

                    {/* Ajuste fino de juros na confirmação */}
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 space-y-2">
                      <p className="text-[10px] font-semibold text-emerald-900 uppercase tracking-wider">
                        Ajustar juros / multa e recalcular
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground font-medium">Multa (%)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={renegMultaPercent}
                            onChange={(e) => setRenegMultaPercent(Number(e.target.value))}
                            disabled={!applyMultaReneg}
                            className="input-field mt-0.5 w-full text-xs py-1 disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground font-medium">Juros (% a.m.)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={renegJurosPercent}
                            onChange={(e) => setRenegJurosPercent(Number(e.target.value))}
                            disabled={!applyJurosReneg}
                            className="input-field mt-0.5 w-full text-xs py-1 disabled:opacity-50"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-emerald-800/80">
                        Novo valor da parcela atualiza automaticamente: <strong>{formatCurrency(renegValues.newValue)}</strong>
                      </p>
                    </div>
                  </div>

                  <p className="text-center text-sm font-medium text-foreground">Confirma as informações?</p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setRenegMode('detailed')}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Não, revisar
                    </button>
                    <button
                      onClick={handleConfirmRenegotiate}
                      className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                    >
                      Sim, confirmo!
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Observação para a Conciliação — fica anexada a TODO ajuste feito nesta sessão */}
        <div className="px-6 pb-4 -mt-2">
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-3">
            <label htmlFor="conc-obs" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 mb-1.5">
              <FileText size={12} /> Observação para a Conciliação
              <span className="text-[10px] font-normal text-amber-700/80 normal-case tracking-normal">(opcional — visível para quem vai conciliar)</span>
            </label>
            <textarea
              id="conc-obs"
              value={obsConciliacao}
              onChange={(e) => setObsConciliacao(e.target.value)}
              placeholder="Ex: Aluno renegociou via WhatsApp; conferir comprovante anexo no histórico."
              rows={2}
              className="w-full rounded-xl border border-amber-200 bg-white/95 px-3 py-2 text-xs text-amber-950 placeholder:text-amber-700/50 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
            />
            {obsConciliacao.trim() && (
              <p className="mt-1.5 text-[10px] text-amber-700/90">
                ✓ Será anexada a cada ajuste registrado nesta sessão.
              </p>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-border flex gap-3 justify-end">
          <button onClick={handleAttemptClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Sair
          </button>
          {renegMode === 'none' && !quitacaoMode && !quitParcelasMode && (
            <button
              onClick={handlePaySelected}
              disabled={!podeAjustarFinanceiro || !deltaResolvido}
              title={
                !podeAjustarFinanceiro
                  ? 'Você não tem permissão para ajustar financeiro deste aluno'
                  : !deltaResolvido
                    ? 'Classifique a diferença de saldo (encargo ou correção) antes de confirmar.'
                    : !checkOk
                      ? 'Valor divergente — você poderá confirmar mesmo assim na próxima tela.'
                      : undefined
              }
              className={`px-4 py-2 rounded-lg text-sm font-medium shadow-md transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed text-white ${
                !checkOk && podeAjustarFinanceiro && deltaResolvido
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : 'bg-emerald-500 hover:bg-emerald-600'
              }`}
            >
              {(!podeAjustarFinanceiro || !deltaResolvido) && <Lock size={13} />}
              {!checkOk && podeAjustarFinanceiro && deltaResolvido ? 'Confirmar Ajuste (divergente)' : 'Confirmar Ajuste Financeiro'}
            </button>
          )}

        </div>
      </div>

      {termoModal && (
        <TermoAditivoModal
          student={student}
          originalValues={{
            valorVenda: student.saleValue,
            entrada: student.downPayment,
            parcelasOriginais: student.totalInstallments,
          }}
          newValues={{
            novoSaldo: renegValues.remaining,
            multaAplicada: renegValues.multaValue,
            jurosAplicados: renegValues.totalJuros,
            novaEntrada: novaEntrada,
            novasParcelas: newInstallments,
            novoValorParcela: renegValues.newValue,
            saldoAposEntrada: renegValues.remainingAfterEntrada,
            primeiraParcelaVencimento: renegFirstDueDate ? formatDateBR(renegFirstDueDate) : undefined,
          }}
          onClose={() => setTermoModal(false)}
        />
      )}
    </div>
  );
}

export default function FinancialModal(props: Props) {
  return (
    <FinancialModalErrorBoundary onClose={props.onClose}>
      <FinancialModalInner {...props} />
    </FinancialModalErrorBoundary>
  );
}
