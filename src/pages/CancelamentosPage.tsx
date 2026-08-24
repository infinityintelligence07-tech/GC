import { useState, useMemo, useRef, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import {
  CancellationCase,
  CancellationStage,
  CancellationOperationalStatus,
  MOTIVOS_CANCELAMENTO,
  MotivoCancelamento,
  Student,
  FunnelStage,
  CancellationAction,
  CancellationResponsavel,
  HistoryEntry,
  Installment,
  AbatimentoInfo,
} from '@/types';
import CancellationModal from '@/components/modals/CancellationModal';
import ImportExternalCancellationModal from '@/components/modals/ImportExternalCancellationModal';
import DeleteModal from '@/components/modals/DeleteModal';
import MultaPagaModal from '@/components/modals/MultaPagaModal';
import HistoryModal from '@/components/modals/HistoryModal';
import CancellationStudentEditModal from '@/components/modals/CancellationStudentEditModal';
import StudentViewModal from '@/components/modals/StudentViewModal';
import { getTagStyle } from '@/lib/tagColors';
import FinancialModal from '@/components/modals/FinancialModal';
import PeriodFilterBar from '@/components/ui/PeriodFilterBar';
import ProcessingSpeedCard from '@/components/ui/ProcessingSpeedCard';
import {
  Clock,
  CheckCircle2, AlertTriangle, Ban, LayoutGrid, List,
  Users, History, X, RotateCcw, Award, Eye, Phone, FileEdit, Trash2, Bell, UserPlus, User,
  DollarSign, Gavel, Info, Upload, FileText, Download as DownloadIcon, ArrowRight, PencilLine,
} from 'lucide-react';
import { formatCurrency, formatCurrencyCompact } from '@/store/useAppStore';
import { DatePreset, AnalysisMode, getPresetRange, getCurrentMonthDates } from '@/lib/periodFilter';
import CurrencyInput from '@/components/ui/CurrencyInput';
import { supabase } from '@/integrations/supabase/client';
import { registrarConciliacao, useConciliacaoStore } from '@/store/useConciliacaoStore';
import { useCommissionsStore, mapPagamentoTipoToPaymentType } from '@/store/useCommissionsStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { openCancellationPdf, downloadCancellationPdf } from '@/lib/openCancellationPdf';
import { createIamCancelamentoTermo } from '@/lib/iamControlTermo';
import { toast } from 'sonner';
import { toShortName, shortNameFontClass } from '@/lib/utils';
import CaseNotesPanel from '@/components/cancellation/CaseNotesPanel';
import ExternalCancellationViewModal from '@/components/modals/ExternalCancellationViewModal';
import CancelDivergenceEditModal from '@/components/modals/CancelDivergenceEditModal';
import { pendingDoubleCheckCorrection } from '@/lib/doubleCheckRejection';
import { getTodayStringBrasilia } from '@/lib/brasiliaDate';

// ─── Novo Funil (5 colunas fixas) ─────────────────────────────────────────────

interface FunnelConfig {
  label: FunnelStage;         // chave interna (mantida para compat com dados salvos)
  displayLabel: string;       // rótulo mostrado na UI
  color: string;
  borderColor: string;
  icon: React.ReactNode;
}

const FUNNEL_STAGES: FunnelConfig[] = [
  { label: 'Entrada',      displayLabel: 'Entrada',              color: 'bg-blue-600',    borderColor: 'border-l-blue-500',    icon: <AlertTriangle size={13} /> },
  { label: 'Em Execução',  displayLabel: 'Em Tratativas',        color: 'bg-amber-500',   borderColor: 'border-l-amber-400',   icon: <Clock size={13} /> },
  { label: 'Formalização', displayLabel: 'Distrato do Contrato', color: 'bg-violet-600',  borderColor: 'border-l-violet-500',  icon: <CheckCircle2 size={13} /> },
  { label: 'Pendente',     displayLabel: 'JUDICIAL / PROCON',    color: 'bg-rose-600',    borderColor: 'border-l-rose-500',    icon: <AlertTriangle size={13} /> },
  { label: 'Finalizado',   displayLabel: 'Finalizado',           color: 'bg-emerald-600', borderColor: 'border-l-emerald-500', icon: <Ban size={13} /> },
];

// Marcador de métrica: reversão acionada com o card na coluna Distrato do Contrato
const DISTRATO_REVERT_MARKER = '[Métrica Distrato]';
function hasDistratoRevertMarker(c: CancellationCase): boolean {
  return (c.history ?? []).some((h) => (h.note ?? '').includes(DISTRATO_REVERT_MARKER));
}

// Card esteve em "Distrato do Contrato" e foi arrastado manualmente para "Em Tratativas"
function movedDistratoToTratativa(c: CancellationCase): boolean {
  return (c.history ?? []).some((h) => {
    const n = (h.note ?? '').toLowerCase();
    return n.includes('movido no funil') && n.includes('formalização') && n.includes('em execução')
      && n.indexOf('formalização') < n.indexOf('em execução');
  });
}

// Conciliação recusada/reprovada → sai do KPI
function hasConciliacaoReprovada(c: CancellationCase): boolean {
  return (c.history ?? []).some((h) => {
    const n = (h.note ?? '').toLowerCase();
    return (n.includes('reprovad') || n.includes('recusad')) && n.includes('concilia');
  });
}


// Valor de multa efetivamente QUITADO pelo aluno além do que já havia pago —
// registrado pelo botão "Aluno pagou a multa" (modal MultaPagaModal).
export function getMultaQuitadaValor(c: CancellationCase): number {
  const re = /Aluno pagou a multa negativada:\s*R\$\s*([\d.]+,\d{2})/i;
  let total = 0;
  (c.history ?? []).forEach((h) => {
    const m = re.exec(h.note ?? '');
    if (m) total += Number(m[1].replace(/\./g, '').replace(',', '.')) || 0;
  });
  return Math.round(total * 100) / 100;
}



// Rótulo visível da coluna a partir da chave interna do funil
export function funnelDisplayLabel(stage: string): string {
  return FUNNEL_STAGES.find((f) => f.label === stage)?.displayLabel ?? stage;
}

// Traduz nomes internos de etapas do funil em textos livres (histórico/notas),
// para que o histórico sempre mostre o nome atual da coluna — inclusive em
// registros antigos gravados antes da renomeação.
export function translateFunnelNames(text: string): string {
  let out = text;
  for (const f of FUNNEL_STAGES) {
    if (f.label === f.displayLabel) continue;
    out = out.split(f.label).join(f.displayLabel);
  }
  return out;
}


// Ações dinâmicas por etapa do funil
const ACTIONS_BY_FUNNEL: Record<FunnelStage, CancellationAction[]> = {
  'Entrada':      ['Aguardando Contato', 'Em Contato'],
  'Em Execução':  ['Conversa WhatsApp', 'Ligação Agendada', 'Enviar Proposta ao Aluno', 'Proposta Enviada (cobrar retorno)', 'Aguardando Retorno Aluno', 'Renegociação Jurídico', 'Corrigir por Erro'],
  'Formalização': ['Iniciar Tratativa', 'Em Tratativa', 'Cobrar Informação ou Pagamento', 'Confeccionar Termo', 'Em Assinatura'],
  'Pendente':     ['Procon', 'Processo Judicial'],
  'Finalizado':   ['Cancelado', 'Revertido'],
};

// Ação fixa na coluna Entrada (sempre "Aguardando Contato")
const FIXED_ACTION_STAGES: FunnelStage[] = ['Entrada'];

const RESPONSAVEIS: CancellationResponsavel[] = ['Jurídico', 'Financeiro'];

// Mapeamento (compatibilidade) estágio legado → funil novo
function stageToFunnel(stage: CancellationStage): FunnelStage {
  switch (stage) {
    case 'Aguardando Contato':
    case 'Em Contato':
    case 'Orientações (Jurídico)':
      return 'Entrada';
    case 'Ajustes em Geral / Boleto':
    case 'Cancelamento de Boleto':
    case 'Início do Estorno':
    case 'Estorno em Andamento':
      return 'Em Execução';
    case 'Confeccionar Termo':
    case 'Assinar Termo':
      return 'Formalização';
    case 'Recuperado':
    case 'Cancelado':
    case 'Saldo a Receber - Sem Resposta':
    case 'PROCON ou Judicial':
    case 'Iniciar Negativação':
    case 'Negativação Efetivada':
    case 'Pagando Parcelado (Negativado)':
    case 'Negativação Retirada':
      return 'Finalizado';
    default:
      return 'Entrada';
  }
}

function getFunnelStage(c: CancellationCase): FunnelStage {
  return c.funnelStage ?? stageToFunnel(c.stage);
}

/**
 * Caso ainda em fluxo ativo (Entrada, Tratativas ou Distrato em andamento).
 * Nesses estágios não forçamos a coluna Finalizado por conciliações antigas.
 */
function isActiveCancellationWorkflow(c: CancellationCase): boolean {
  const fs = getFunnelStage(c);
  if (fs === 'Entrada' || fs === 'Em Execução' || fs === 'Pendente') return true;
  if (fs === 'Formalização') {
    const acao = (c.acao ?? '').trim();
    const stage = c.stage ?? '';
    if (acao === 'Assinar Termo' || stage === 'Assinar Termo') return false;
    return true;
  }
  return false;
}

// ─── Constantes auxiliares (KPIs) ─────────────────────────────────────────────

const FINAL_STAGES: CancellationStage[] = ['Recuperado', 'Cancelado', 'Negativação Retirada', 'Negativação Efetivada'];
const RECOVERED_STAGES: CancellationStage[] = ['Recuperado', 'Negativação Retirada'];

const opStatusColor: Record<CancellationOperationalStatus, string> = {
  'Sem contato': 'bg-slate-100 text-slate-600',
  'Em contato': 'bg-blue-100 text-blue-700',
  'Negociando': 'bg-amber-100 text-amber-700',
  'Aguardando': 'bg-purple-100 text-purple-700',
  'Jurídico': 'bg-red-100 text-red-700',
  'Recuperado': 'bg-emerald-100 text-emerald-700',
  'Cancelado': 'bg-rose-100 text-rose-700',
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateFull(iso: string): string {
  if (!iso) return '';
  // Datas no formato YYYY-MM-DD são interpretadas como UTC pelo Date(),
  // o que pode exibir um dia a menos em fusos negativos. Parse local.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  if (dateOnly) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR');
  }
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ─── Historical stage resolution ─────────────────────────────────────────────

function getHistoricalStage(c: CancellationCase, periodEnd: Date): CancellationStage {
  if (!c.history || c.history.length === 0) return c.stage;
  const sorted = [...c.history].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const periodEndMs = periodEnd.getTime();
  let lastEntry = null;
  for (const entry of sorted) {
    if (new Date(entry.date).getTime() <= periodEndMs) lastEntry = entry;
  }
  return lastEntry ? lastEntry.to : c.stage;
}

function caseExistedAt(c: CancellationCase, date: Date): boolean {
  return new Date(c.createdAt).getTime() <= date.getTime();
}

function resolvedInPeriod(c: CancellationCase, start: Date, end: Date): boolean {
  return c.history.some((h) => {
    const t = new Date(h.date).getTime();
    return t >= start.getTime() && t <= end.getTime() && FINAL_STAGES.includes(h.to);
  });
}

function recoveredInPeriod(c: CancellationCase, start: Date, end: Date): boolean {
  return c.history.some((h) => {
    const t = new Date(h.date).getTime();
    return t >= start.getTime() && t <= end.getTime() && RECOVERED_STAGES.includes(h.to);
  });
}

/** Caso chegou (ou passou) pelo Jurídico / Distrato do Contrato. */
function reachedJuridico(c: CancellationCase): boolean {
  const fs = getFunnelStage(c);
  if (fs === 'Formalização' || fs === 'Pendente') return true;
  if (hasDistratoRevertMarker(c) || movedDistratoToTratativa(c)) return true;
  if (c.responsavel === 'Jurídico') return true;
  return (c.history ?? []).some((h) => {
    const n = (h.note ?? '').toLowerCase();
    return (
      n.includes('enviado ao jurídico') ||
      n.includes('distrato do contrato') ||
      (n.includes('movido no funil') && n.includes('formalização')) ||
      n.includes(DISTRATO_REVERT_MARKER.toLowerCase())
    );
  });
}

/** Reversão atribuída ao Jurídico (acionada no Distrato ou fluxo equivalente). */
function isReversaoJuridico(c: CancellationCase): boolean {
  if (hasDistratoRevertMarker(c)) return true;
  if (movedDistratoToTratativa(c) && c.acao === 'Revertido') return true;
  if (c.acao === 'Revertido' && reachedJuridico(c) && getFunnelStage(c) === 'Finalizado') {
    // Revertido após passar pelo Distrato, sem necessariamente ter o marcador antigo
    return true;
  }
  return false;
}

/** Caso revertido (geral — financeiro ou jurídico). */
function isCaseRevertidoGeral(c: CancellationCase): boolean {
  if (c.acao === 'Revertido') return true;
  if (RECOVERED_STAGES.includes(c.stage)) return true;
  if (hasDistratoRevertMarker(c)) return true;
  return false;
}

// ─── Helper: compute vencido + a vencer for a linked student ─────────────────

function computeOpenValue(student: Student | undefined): { vencido: number; aVencer: number; total: number } {
  if (!student) return { vencido: 0, aVencer: 0, total: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let vencido = 0; let aVencer = 0;
  student.installments.forEach((i) => {
    if (i.paid) return;
    const due = new Date(i.dueDate);
    if (due < today) vencido += i.value;
    else aVencer += i.value;
  });
  return { vencido, aVencer, total: vencido + aVencer };
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────

interface CardProps {
  c: CancellationCase;
  student?: Student;
  funnelStage: FunnelStage;
  onRevert: (c: CancellationCase) => void;
  onCancel: (c: CancellationCase) => void;
  onSendToLegal?: (c: CancellationCase) => void;
  onMoveToTratativas?: (c: CancellationCase) => void;
  onView: (c: CancellationCase) => void;
  onDelete: (c: CancellationCase) => void;
  onChangeAcao: (c: CancellationCase, acao: CancellationAction) => void;
  onChangeResponsavel: (c: CancellationCase, resp: CancellationResponsavel) => void;
  onConciliar?: (c: CancellationCase) => void;
  podeConciliar?: boolean;
  onRenegotiate?: (c: CancellationCase) => void;
  onFollowCancellation?: (c: CancellationCase) => void;
  onMultaPaga?: (c: CancellationCase, valorNegativado: number) => void;
  readOnly?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, id: string) => void;
}



function CancellationCard({
  c, student, funnelStage,
  onRevert, onCancel, onSendToLegal, onMoveToTratativas, onView, onDelete,
  onChangeAcao, onChangeResponsavel,
  onConciliar, podeConciliar,
  onRenegotiate, onFollowCancellation, onMultaPaga,
  readOnly, draggable, onDragStart,
}: CardProps) {
  const cfg = FUNNEL_STAGES.find((f) => f.label === funnelStage)!;
  const borderColor = cfg.borderColor;
  const isFinal = funnelStage === 'Finalizado';
  // Nos cards Finalizados exibimos o tempo TOTAL do cancelamento:
  // da data da solicitação até o dia em que o card foi movido para Finalizado.
  const diasCorridos = daysSince(c.createdAt);
  const diasTotalFinalizado = (() => {
    const start = new Date(c.createdAt).getTime();
    const end = new Date(c.movedToCurrentStageAt || c.createdAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return diasCorridos;
    return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
  })();
  const dias = isFinal ? diasTotalFinalizado : diasCorridos;

  const whatsapp = c.studentWhatsapp || student?.whatsapp || '';
  const allowedAcoes = ACTIONS_BY_FUNNEL[funnelStage];
  const isFixedAction = FIXED_ACTION_STAGES.includes(funnelStage);
  const fixedActionLabel = isFixedAction ? allowedAcoes[0] : '';
  // Colunas de Entrada e Em Tratativas são de responsabilidade fixa do Financeiro
  const isFinanceFixed = funnelStage === 'Entrada' || funnelStage === 'Em Execução';
  const isLegalFixed = funnelStage === 'Formalização' || funnelStage === 'Pendente';
  const isRenegociacaoJuridica = c.acao === 'Renegociação Jurídico';
  const [showErro, setShowErro] = useState(false);
  // Conciliação: caso cancelado mas aluno ainda aguarda baixa contábil.
  // "pendente" e "aprovado" contam como aguardando — só "conciliado" encerra.
  const hasPendingConciliacao = useConciliacaoStore((s) =>
    s.items.some((it) => it.relatedCaseId === c.id && (it.status === 'pendente' || it.status === 'aprovado'))
  );
  // Reversão já conciliada: existe item conciliado do caso e nada pendente.
  const hasConciliadoItem = useConciliacaoStore((s) =>
    s.items.some((it) => it.relatedCaseId === c.id && it.status === 'conciliado')
  );
  // Cancelamento/reversão conciliado em definitivo.
  const hasCancelConciliado = useConciliacaoStore((s) =>
    s.items.some(
      (it) =>
        it.relatedCaseId === c.id &&
        (it.tipo === 'cancelamento' || it.tipo === 'reversao') &&
        it.status === 'conciliado'
    )
  );
  const aguardandoConciliacao =
    hasPendingConciliacao ||
    (student?.statusCancelamento === 'aguardando_conciliacao' && !hasCancelConciliado);
  const aguardandoPagamentoMulta = student?.statusCancelamento === 'pagamento_multa_pendente';
  const isRevertido = student?.statusCancelamento === 'revertido' || c.acao === 'Revertido';
  const conciliado =
    (student?.statusCancelamento === 'cancelado' && !hasPendingConciliacao) ||
    (isRevertido && hasConciliadoItem && !hasPendingConciliacao) ||
    (hasCancelConciliado && !hasPendingConciliacao);

  // Trava só faz sentido quando o caso já foi finalizado como Cancelado e
  // aguarda apenas a baixa contábil. Antes disso (Em Tratativas/Em Execução),
  // o card precisa continuar movimentável — inclusive quando existe uma
  // conciliação pendente de outra inscrição (ex.: reversão parcial).
  const lockedForConciliation =
    isFinal && (aguardandoConciliacao || aguardandoPagamentoMulta);

  // ── Negativação: caso finalizado em que sobrou multa a negativar ──────────
  // Só nesses casos exibimos o botão "Aluno pagou a multa".
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const negativarInfo = useMemo(() => {
    let valor = 0;
    let jaPago = false;
    for (const it of conciliacaoItems) {
      if (it.relatedCaseId !== c.id) continue;
      const d = (it.depois ?? {}) as Record<string, unknown>;
      const n = Number(d.totalNegativar);
      if (Number.isFinite(n) && n > valor) valor = n;
      if (d.multaNegativadaPaga != null) jaPago = true;
    }
    return { valor, jaPago };
  }, [conciliacaoItems, c.id]);
  const podeInformarMultaPaga =
    isFinal && negativarInfo.valor > 0.0049 && !negativarInfo.jaPago;

  // ── Double-check reprovado: libera correção só dos campos apontados ──────
  const correcaoPendente = useMemo(
    () => pendingDoubleCheckCorrection(conciliacaoItems, c.studentId),
    [conciliacaoItems, c.studentId],
  );
  const [showCorrigir, setShowCorrigir] = useState(false);



  return (
    <div
      draggable={draggable && !readOnly && !lockedForConciliation}
      onDragStart={(e) => {
        // Impede que um clique/arraste iniciado em botões, selects, inputs ou links
        // do card seja interpretado como drag do card inteiro (o que causava a
        // movimentação acidental entre colunas ao clicar em "Baixar/Visualizar PDF").
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, a, select, input, textarea, [role="button"]')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onDragStart?.(e, c.id);
      }}
      className={`w-full min-w-0 min-h-[300px] flex flex-col gap-2 bg-card border border-border border-l-4 ${borderColor} rounded-xl p-3 saas-shadow ${readOnly ? 'opacity-75' : 'cursor-move'}`}
    >

      {/* Header: Nome + "Há X dias" */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={`${shortNameFontClass(c.studentName)} font-semibold text-foreground truncate`}
            title={c.studentName}
          >
            {toShortName(c.studentName)}
          </p>
          {(student?.product || c.treinamento) && (
            <p className="text-[9px] text-muted-foreground/80 truncate mt-0.5" title="Treinamento">
              {student?.product || c.treinamento}
            </p>
          )}
          {!!c.quantidadeInscricoes && c.quantidadeInscricoes > 0 && (
            <p className="text-[9px] text-muted-foreground/80 mt-0.5" title="Quantidade de inscrições">
              Inscrições: {c.quantidadeInscricoes}
            </p>
          )}
          {whatsapp && (
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Phone size={9} /> {whatsapp}
            </p>
          )}
          {(c.ac || student?.ac) && (
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1" title="Assessor de Conta">
              <User size={9} /> <span className="truncate">AC: {c.ac || student?.ac}</span>
            </p>
          )}
        </div>
        <span
          className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 leading-[1.1] ${
            dias >= 15 ? 'bg-rose-100 text-rose-700' : dias >= 7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
          }`}
          title={isFinal ? 'Tempo total: da solicitação até a finalização' : 'Dias desde a solicitação'}
        >
          {isFinal
            ? <>Levou {dias} {dias === 1 ? 'dia' : 'dias'}<br />&nbsp;p/ finalizar</>
            : `Há ${dias} ${dias === 1 ? 'dia' : 'dias'}`}

        </span>
      </div>

      {/* Conciliação reprovada — destaque "Ver erro" */}
      {c.conciliacaoReprovadaMotivo && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowErro(true); }}
          className="w-full flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-rose-100 text-rose-700 border border-rose-300 hover:bg-rose-200 transition-colors animate-pulse"
          title="Conciliação reprovada — ver o que ocorreu"
        >
          <Ban size={10} /> Ver erro
        </button>
      )}
      {correcaoPendente && student && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowCorrigir(true); }}
          className="w-full flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors"
          title="Conciliação reprovada — corrigir os campos apontados"
        >
          <PencilLine size={10} /> Corrigir dados reprovados
        </button>
      )}
      {showCorrigir && correcaoPendente && student && (
        <div onClick={(e) => e.stopPropagation()}>
          <CancelDivergenceEditModal
            student={student}
            allowedFields={correcaoPendente.fields}
            rejectionMotivo={correcaoPendente.item.reprovadoMotivo || c.conciliacaoReprovadaMotivo}
            rejectionBy={correcaoPendente.item.reprovadoPorNome || c.conciliacaoReprovadaPorNome}
            onClose={() => setShowCorrigir(false)}
            onSaved={() => {
              setShowCorrigir(false);
              useAppStore.getState().updateCancellationCase(c.id, {
                conciliacaoReprovadaMotivo: undefined,
                conciliacaoReprovadaAt: undefined,
                conciliacaoReprovadaPorNome: undefined,
                acao: undefined,
              });
            }}
          />
        </div>
      )}
      {showErro && c.conciliacaoReprovadaMotivo && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[80] p-4"
          onClick={(e) => { e.stopPropagation(); setShowErro(false); }}
        >
          <div className="bg-card rounded-2xl w-full max-w-md p-5 shadow-2xl border border-border space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center">
                <Ban size={16} className="text-rose-700" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Conciliação reprovada</h3>
                <p className="text-[11px] text-muted-foreground">{c.studentName}</p>
              </div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-700 mb-1">O que ocorreu</p>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{c.conciliacaoReprovadaMotivo}</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Reprovado por {c.conciliacaoReprovadaPorNome ?? '—'}. Os valores permanecem aplicados — corrija o que foi apontado e reenvie para conciliação.
            </p>
            <button
              onClick={() => setShowErro(false)}
              className="w-full px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* Motivo */}
      <div className="flex flex-wrap items-center gap-1">
        {c.motivoCancelamento && (
          <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            {c.motivoCancelamento}
          </span>
        )}
        {c.externalImport && (
          <span
            className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200"
            title="Caso criado pela importação manual de cancelamento"
          >
            Cadastrado manualmente
          </span>
        )}
      </div>



      {/* Respostas do cancelamento (7d, >30d, multa) ficam apenas na visualização
          interna, na seção "Motivo do Cancelamento". */}


      {/* Ação (editável — fixa em Entrada/Em Contato). Oculta em "Pendente". */}
      {allowedAcoes.length > 0 && (
        <div>
          <label className="block text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Ação</label>
          {isFixedAction ? (
            <div
              className="w-full text-[10px] px-1.5 py-1 rounded border border-border bg-muted/50 text-foreground font-medium"
              title="Ação fixa para esta etapa"
            >
              {fixedActionLabel}
            </div>
          ) : (
            <select
              disabled={readOnly || lockedForConciliation}
              value={c.acao && allowedAcoes.includes(c.acao) ? c.acao : ''}
              onChange={(e) => onChangeAcao(c, e.target.value as CancellationAction)}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[10px] px-1.5 py-1 rounded border border-border bg-card text-foreground"
            >
              <option value="">— Selecionar —</option>
              {allowedAcoes.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          )}
          {c.acao === 'Ligação Agendada' && c.ligacaoAgendadaAt && (
            <div className="mt-1 text-[10px] font-medium px-1.5 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1">
              <Clock size={10} /> {new Date(c.ligacaoAgendadaAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Responsável: fixo Financeiro em Entrada/Em Execução; fixo Jurídico em Distrato/Pendente; editável nas demais; oculto em Finalizado */}
      {!isFinal && (
        <div>
          <label className="block text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Responsável</label>
          {isFinanceFixed ? (
            <div
              className="w-full text-[10px] px-1.5 py-1 rounded border border-border bg-slate-100 text-slate-700 font-medium flex items-center gap-1"
              title="Responsável fixo: Financeiro"
            >
              Financeiro
            </div>
          ) : isLegalFixed ? (
            <div
              className="w-full text-[10px] px-1.5 py-1 rounded border border-border bg-slate-100 text-slate-700 font-medium flex items-center gap-1"
              title="Responsável fixo: Jurídico"
            >
              Jurídico
            </div>
          ) : (
            <select
              disabled={readOnly || lockedForConciliation}
              value={c.responsavel ?? ''}
              onChange={(e) => onChangeResponsavel(c, e.target.value as CancellationResponsavel)}
              onClick={(e) => e.stopPropagation()}
              className="w-full text-[10px] px-1.5 py-1 rounded border border-border bg-card text-foreground"
            >
              <option value="">— Selecionar —</option>
              {RESPONSAVEIS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Data solicitação */}
      <div className="text-[10px] text-muted-foreground">
        Solicitado: <span className="text-foreground font-medium">{formatDateFull(c.createdAt)}</span>
      </div>

      {/* Status de Conciliação (após Cancelado) */}
      {(aguardandoConciliacao || aguardandoPagamentoMulta || conciliado) && (
        <div className={`text-[10px] font-semibold px-2 py-1 rounded border flex items-center gap-1 ${
          conciliado
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : aguardandoPagamentoMulta
              ? 'bg-amber-50 text-amber-700 border-amber-300'
              : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}>
          {conciliado ? <CheckCircle2 size={11} /> : <Clock size={11} />}
          {conciliado
            ? (isRevertido ? 'Conciliado — Reversão' : 'Conciliado — Baixado da carteira')
            : aguardandoPagamentoMulta
              ? `Pagamento Multa Pendente${c.cancellationFineValue ? ` — ${formatCurrency(c.cancellationFineValue)}` : ''}`
              : 'Aguardando Conciliação'}
        </div>
      )}

      {/* Card Finalizado: detalhamento do pagamento da multa */}
      {isFinal && conciliado && !isRevertido && (c.cancellationFineValue ?? 0) > 0 && (
        <div className="text-[10px] font-semibold px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200 flex items-center gap-1">
          <CheckCircle2 size={11} />
          PAGO {formatCurrency(c.cancellationFineValue ?? 0)} de Multa de Cancelamento
        </div>
      )}
      {isFinal && conciliado && !isRevertido && (c.cancellationFineValue ?? 0) === 0 && (
        <div className="text-[10px] font-semibold px-2 py-1 rounded border bg-slate-50 text-slate-600 border-slate-200 flex items-center gap-1">
          <CheckCircle2 size={11} />
          Cancelado sem multa
        </div>
      )}

      {/* Contrato importado em PDF */}
      {c.contractPdfUrl && (
        <div className="pt-1 border-t border-border/50 flex items-center gap-1">
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await openCancellationPdf(c.contractPdfUrl!, 'contrato.pdf');
              } catch {
                window.alert('Não foi possível abrir o contrato anexado.');
              }
            }}
            className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 transition-all text-[10px] font-medium min-w-0"
            title="Visualizar contrato (PDF) no navegador"
          >
            <Eye size={11} className="shrink-0" />
            <span className="truncate flex-1 text-left">Contrato (PDF)</span>
          </button>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await downloadCancellationPdf(c.contractPdfUrl!, 'contrato.pdf');
              } catch {
                window.alert('Não foi possível baixar o contrato anexado.');
              }
            }}
            className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 transition-all"
            title="Baixar contrato (PDF)"
          >
            <DownloadIcon size={11} />
          </button>
        </div>
      )}

      {/* Termos assinados anexados (visível inclusive em Finalizado) */}
      {(() => {
        const termos = (c.termAttachments ?? []).filter((t) => t.type === 'termo_assinado');
        if (termos.length === 0) return null;
        return (
          <div className="flex flex-col gap-1 pt-1 border-t border-border/50">
            {termos.map((t) => (
              <button
                key={t.url}
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await openCancellationPdf(t.url, t.name);
                  } catch {
                    window.alert('Não foi possível abrir o termo anexado.');
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all text-[10px] font-medium"
                title="Abrir termo assinado"
              >
                <FileText size={11} className="shrink-0" />
                <span className="truncate flex-1 text-left">{t.name}</span>
                <DownloadIcon size={10} className="shrink-0" />
              </button>
            ))}
          </div>
        );
      })()}


      {/* Ações do card */}
      {!readOnly && (
        <div className="flex items-center gap-1 pt-1 mt-auto border-t border-border/50 flex-wrap">
          {funnelStage === 'Entrada' && !lockedForConciliation && (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveToTratativas?.(c); }}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all"
              title="Mover card para Em Tratativas"
            >
              <ArrowRight size={10} /> Mover para Em Tratativas
            </button>
          )}
          {!isFinal && !lockedForConciliation && funnelStage !== 'Entrada' && !isRenegociacaoJuridica && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onRevert(c); }}
                className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all"
                title="Reverter cancelamento"
              >
                <RotateCcw size={10} /> Reverter
              </button>
              {funnelStage === 'Em Execução' ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onSendToLegal?.(c); }}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-all"
                  title="Enviar para o Jurídico (Distrato do Contrato)"
                >
                  <Gavel size={10} /> Enviar p/ Jurídico
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onCancel(c); }}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                  title="Cancelar"
                >
                  <X size={10} /> Cancelar
                </button>
              )}
            </>
          )}
          {funnelStage === 'Em Execução' && isRenegociacaoJuridica && !isFinal && !lockedForConciliation && (
            <>
              {onRenegotiate && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRenegotiate(c); }}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-all"
                  title="Abrir Gestão Financeira para renegociar as parcelas"
                >
                  <RotateCcw size={10} /> Renegociar
                </button>
              )}
              {onFollowCancellation && (
                <button
                  onClick={(e) => { e.stopPropagation(); onFollowCancellation(c); }}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-all"
                  title="Devolver para o Jurídico prosseguir com o cancelamento"
                >
                  <Gavel size={10} /> Vai Seguir Cancelamento
                </button>
              )}
            </>
          )}
          {aguardandoConciliacao && onConciliar && (
            <button
              onClick={(e) => { e.stopPropagation(); if (podeConciliar) onConciliar(c); }}
              disabled={!podeConciliar}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={podeConciliar ? 'Conciliar (baixa total da carteira)' : 'Apenas usuários com permissão de Confirmar Pagamento podem conciliar'}
            >
              <CheckCircle2 size={10} /> Conciliar
            </button>
          )}
          {podeInformarMultaPaga && onMultaPaga && (
            <button
              onClick={(e) => { e.stopPropagation(); onMultaPaga(c, negativarInfo.valor); }}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition-all"
              title={`Informar pagamento da multa negativada (${formatCurrency(negativarInfo.valor)})`}
            >
              <DollarSign size={10} /> Aluno pagou a multa
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onView(c); }}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all ml-auto"
            title="Visualizar informações"
          >
            <Eye size={10} /> Visualizar
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(c); }}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[9px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
            title="Excluir caso (não remove o aluno da carteira)"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Case History Modal (history of stage transitions) ──────────────────────

function CaseHistoryModal({ c, onClose }: { c: CancellationCase; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto saas-shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-foreground">{c.studentName}</h2>
            <p className="text-xs text-muted-foreground">Histórico de movimentações</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {c.history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Sem histórico</p>
          ) : (
            [...c.history].reverse().map((entry, i) => (
              <div key={i} className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1 shrink-0" />
                  {i < c.history.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="pb-3">
                  <p className="text-muted-foreground text-[10px]">{formatDateFull(entry.date)}</p>
                  <p className="text-foreground font-medium">
                    {entry.from !== entry.to ? `${entry.from} → ${entry.to}` : entry.to}
                  </p>
                  {entry.note && <p className="text-muted-foreground italic">{translateFunnelNames(entry.note)}</p>}
                  {entry.operationalStatus && (
                    <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full ${opStatusColor[entry.operationalStatus] ?? ''}`}>
                      {entry.operationalStatus}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Motivo Prompt Modal ─────────────────────────────────────────────────────

interface MotivoPromptModalProps {
  caseRef: CancellationCase;
  targetFunnel: FunnelStage;
  onCancel: () => void;
  onConfirm: (motivo: MotivoCancelamento, descricao: string) => void;
}

function MotivoPromptModal({ caseRef, targetFunnel, onCancel, onConfirm }: MotivoPromptModalProps) {
  const [motivo, setMotivo] = useState<MotivoCancelamento | ''>('');
  const [descricao, setDescricao] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 saas-shadow-md">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
            <AlertTriangle size={16} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Motivo de cancelamento obrigatório</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Para mover <strong>{caseRef.studentName}</strong> para <strong>{targetFunnel}</strong>, é necessário informar o motivo do cancelamento.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Motivo</label>
            <select className="input-field w-full text-xs" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoCancelamento)}>
              <option value="">— Selecione —</option>
              {MOTIVOS_CANCELAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Descrição (opcional)</label>
            <textarea
              className="input-field w-full text-xs resize-none"
              rows={3}
              placeholder="Detalhes do motivo..."
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => motivo && onConfirm(motivo, descricao)}
            disabled={!motivo}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirmar e mover
          </button>
          <button onClick={onCancel} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Revert Choice Modal (2 botões) ──────────────────────────────────────────

interface RevertChoiceModalProps {
  caseRef: CancellationCase;
  student?: Student;
  overdueCount: number;
  /** Fluxo específico da coluna Distrato do Contrato (Formalização) */
  isFormalizacao: boolean;
  onClose: () => void;
  onRevertWithoutAdjustNoChanges: () => void;
  onRevertWithoutAdjustWithChanges: (observacoes: string) => void;
  onOpenRenegotiation: () => void;
}

function RevertChoiceModal({ caseRef, student, overdueCount, isFormalizacao, onClose, onRevertWithoutAdjustNoChanges, onRevertWithoutAdjustWithChanges, onOpenRenegotiation }: RevertChoiceModalProps) {
  type View = 'main' | 'sem-ajustes-sub' | 'com-alteracoes-obs';
  const [view, setView] = useState<View>('main');
  const [showBlock, setShowBlock] = useState(false);
  const [obs, setObs] = useState('');

  const handleWithoutAdjust = () => {
    // Em Formalização (Distrato) sempre abrimos o sub-menu — a checagem
    // de "em dia" só vale para o leaf "Sem Alterações".
    if (isFormalizacao) {
      setView('sem-ajustes-sub');
      return;
    }
    if (overdueCount > 0) {
      setShowBlock(true);
      return;
    }
    onRevertWithoutAdjustNoChanges();
  };

  const handleSubSemAlteracoes = () => {
    if (overdueCount > 0) {
      setShowBlock(true);
      return;
    }
    onRevertWithoutAdjustNoChanges();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 saas-shadow-md">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <RotateCcw size={16} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Reverter cancelamento</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                <strong>{caseRef.studentName}</strong> — escolha como deseja prosseguir.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {showBlock ? (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-rose-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Regularização necessária</p>
                <p className="text-[11px] mt-1">
                  Este aluno possui <strong>{overdueCount}</strong> parcela{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}. Regularize o financeiro antes de reverter sem ajustes, ou utilize "Reverter COM Ajustes Financeiros" para renegociar.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setShowBlock(false); onOpenRenegotiation(); }}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Reverter COM Ajustes Financeiros
              </button>
              <button
                onClick={onClose}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : view === 'main' ? (
          <div className="space-y-3">
            <button
              onClick={handleWithoutAdjust}
              className="w-full text-left p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={14} className="text-emerald-700" />
                <span className="text-xs font-bold text-emerald-800">Reverter SEM Ajustes Financeiros</span>
              </div>
              <p className="text-[10px] text-emerald-700">
                Mantém o contrato atual. Requer que o aluno esteja em dia (sem parcelas vencidas).
              </p>
              {student && (
                <p className="text-[10px] text-emerald-700 mt-1">
                  Situação atual: {overdueCount > 0
                    ? <span className="font-semibold text-rose-700">{overdueCount} parcela{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}</span>
                    : <span className="font-semibold">Em dia</span>}
                </p>
              )}
            </button>
            <button
              onClick={onOpenRenegotiation}
              className="w-full text-left p-3 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <FileEdit size={14} className="text-blue-700" />
                <span className="text-xs font-bold text-blue-800">Reverter COM Ajustes Financeiros</span>
              </div>
              <p className="text-[10px] text-blue-700">
                {isFormalizacao
                  ? 'Move o card para "Em Tratativas" com a ação "Renegociação Jurídico".'
                  : 'Abre a renegociação financeira (novo número de parcelas, encargos, etc.).'}
              </p>
            </button>
          </div>
        ) : view === 'sem-ajustes-sub' ? (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">Como deseja concluir a reversão sem ajustes financeiros?</p>
            <button
              onClick={handleSubSemAlteracoes}
              className="w-full text-left p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={14} className="text-emerald-700" />
                <span className="text-xs font-bold text-emerald-800">Sem Alterações</span>
              </div>
              <p className="text-[10px] text-emerald-700">
                Move o card para Finalizado e retorna o aluno ao status anterior à solicitação.
              </p>
            </button>
            <button
              onClick={() => setView('com-alteracoes-obs')}
              className="w-full text-left p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <FileEdit size={14} className="text-amber-700" />
                <span className="text-xs font-bold text-amber-800">Com Alterações</span>
              </div>
              <p className="text-[10px] text-amber-700">
                Envia o ajuste apontado nas observações para a aba Conciliação e move o card para Finalizado.
              </p>
            </button>
            <button
              onClick={() => setView('main')}
              className="w-full py-2 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Voltar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-foreground">Observações do ajuste</span>
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                rows={5}
                placeholder="Descreva o ajuste financeiro que deverá ser conciliado…"
                className="mt-1 w-full text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setView('sem-ajustes-sub')}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar
              </button>
              <button
                disabled={!obs.trim()}
                onClick={() => onRevertWithoutAdjustWithChanges(obs.trim())}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enviar para Conciliação e Finalizar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal: Troca de Turma antes da Reversão ────────────────────────────────
// Perguntado ANTES do fluxo "com/sem ajuste financeiro". Se "Sim", coleta
// nova turma + % de taxa (sobre o valor total do contrato) e envia os dados
// para a aba Conciliação junto com o restante do ajuste.
interface ClassChangePromptModalProps {
  caseRef: CancellationCase;
  contractValue: number;
  onClose: () => void;
  onNo: () => void;
  onYes: (novaTurma: string, taxaPercent: number, taxaValor: number) => void;
}

function ClassChangePromptModal({ caseRef, contractValue, onClose, onNo, onYes }: ClassChangePromptModalProps) {
  const [view, setView] = useState<'ask' | 'form'>('ask');
  const [novaTurma, setNovaTurma] = useState('');
  const [taxaPct, setTaxaPct] = useState<number>(0);
  const taxaValor = Math.round(contractValue * (taxaPct / 100) * 100) / 100;
  const canSubmit = novaTurma.trim().length > 0 && taxaPct >= 0 && Number.isFinite(taxaPct);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 saas-shadow-md">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
              <RotateCcw size={16} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Houve troca de turma?</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                <strong>{caseRef.studentName}</strong> — informe se a reversão envolve troca de turma antes de prosseguir.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {view === 'ask' ? (
          <div className="space-y-3">
            <button
              onClick={() => setView('form')}
              className="w-full text-left p-3 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={14} className="text-indigo-700" />
                <span className="text-xs font-bold text-indigo-800">Sim, reversão com troca de turma</span>
              </div>
              <p className="text-[10px] text-indigo-700">
                Informe a nova turma e a taxa cobrada. Os dados seguem para a aba Conciliação junto do ajuste financeiro.
              </p>
            </button>
            <button
              onClick={onNo}
              className="w-full text-left p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw size={14} className="text-emerald-700" />
                <span className="text-xs font-bold text-emerald-800">Não, reversão sem troca de turma</span>
              </div>
              <p className="text-[10px] text-emerald-700">
                Segue para o fluxo padrão de reversão (com ou sem ajuste financeiro).
              </p>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-foreground">Nova turma do aluno *</span>
              <input
                type="text"
                value={novaTurma}
                onChange={(e) => setNovaTurma(e.target.value)}
                placeholder="Ex.: Turma XYZ — Setembro/2026"
                className="mt-1 w-full text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-foreground">Taxa de troca de turma (%) *</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={taxaPct}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setTaxaPct(Number(e.target.value) || 0)}
                className="mt-1 w-full text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="block mt-1 text-[10px] text-muted-foreground">
                Sobre o total do contrato ({formatCurrency(contractValue)}) → <strong className="text-foreground">{formatCurrency(taxaValor)}</strong>
              </span>
            </label>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setView('ask')}
                className="px-3 py-2 rounded-lg text-[11px] font-semibold bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Voltar
              </button>
              <button
                disabled={!canSubmit}
                onClick={() => onYes(novaTurma.trim(), taxaPct, taxaValor)}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Enviar para Conciliação e Finalizar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CancellationReviewModalProps {
  caseRef: CancellationCase;
  student?: Student;
  onClose: () => void;
  onConfirm: (installments: Installment[], fineValue: number, fineDueDate: string, fineAlreadyPaid: boolean, skipConciliation?: boolean, abatimento?: AbatimentoInfo) => void;
  /** Chamado antes do cancelamento quando o jurídico fraciona inscrições no próprio modal. */
  onPartialRevertBeforeCancel?: (qty: number) => void;
  simplified?: boolean;
}

function CancellationReviewModal({ caseRef, student, onClose, onConfirm, onPartialRevertBeforeCancel, simplified = false }: CancellationReviewModalProps) {
  const installments = student?.installments ?? [];
  const pending = installments.filter((i) => !i.paid);
  const paid = installments.filter((i) => i.paid);
  const entrada = Number(student?.downPayment) || 0;
  const totalPaidParcelas = paid.reduce((sum, i) => sum + i.value, 0);
  // Casos importados manualmente (sem ficha de aluno vinculada) usam os valores
  // informados na importação: valor do contrato e "Pago até o momento (Kamino)".
  const totalPaidCalc = totalPaidParcelas + entrada;
  const totalPaid = student ? totalPaidCalc : (Number(caseRef.totalPagoAteMomento) || totalPaidCalc);
  const totalPendingCalc = pending.reduce((sum, i) => sum + i.value, 0);
  const totalContract =
    student?.saleValue ?? (Number(caseRef.value) || totalPaidCalc + totalPendingCalc);
  const totalPending = student
    ? totalPendingCalc
    : Math.max(0, Math.round((totalContract - totalPaid) * 100) / 100);

  // ── Cancelamento parcial (assessor já reverteu parte das inscrições) ──────
  const totalInscricoes = Math.max(1, caseRef.quantidadeInscricoes ?? 1);
  const inscRevertidasPersistidas = Math.min(Math.max(0, caseRef.inscricoesRevertidas ?? 0), totalInscricoes);
  const [localRevertQty, setLocalRevertQty] = useState(0);
  const effectiveInscRevertidas = inscRevertidasPersistidas + localRevertQty;
  const effectiveSimplified = simplified || (localRevertQty > 0 && totalInscricoes > effectiveInscRevertidas);
  const inscRevertidas = effectiveInscRevertidas;
  const inscRestantes = Math.max(1, totalInscricoes - inscRevertidas);
  const valorPorInscricao = Math.round((totalContract / totalInscricoes) * 100) / 100;
  const fineBase = effectiveSimplified
    ? Math.round(valorPorInscricao * inscRestantes * 100) / 100
    : totalContract;
  const paidBase = effectiveSimplified
    ? Math.round((totalPaid * inscRestantes / totalInscricoes) * 100) / 100
    : totalPaid;
  const pendingBase = effectiveSimplified
    ? Math.round((totalPending * inscRestantes / totalInscricoes) * 100) / 100
    : totalPending;


  const today = getTodayStringBrasilia();
  const defaultRefundFirstDate = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const { updateCancellationCase, students: allStudents, updateStudent } = useAppStore();
  const [semMultaCDC7, setSemMultaCDC7] = useState<boolean>(
    caseRef.dentro7Dias === true && (caseRef.multaPercent ?? -1) === 0,
  );
  const [finePercent, setFinePercent] = useState<number>(semMultaCDC7 ? 0 : (caseRef.multaPercent ?? 30));
  const computedFine = Math.round(fineBase * (finePercent / 100) * 100) / 100;
  const [fineValue, setFineValue] = useState<number>(
    semMultaCDC7 ? 0 : (caseRef.cancellationFineValue ?? computedFine),
  );
  // Se usuário mudar o percentual, recalcula a multa automaticamente
  const handlePercentChange = (p: number) => {
    if (semMultaCDC7) return;
    setFinePercent(p);
    const v = Math.round(fineBase * (p / 100) * 100) / 100;
    setFineValue(v);
    // Persiste a % da multa no caso para refletir corretamente na Conciliação
    // (linha "Encargos (Multa / Juros)").
    updateCancellationCase(caseRef.id, {
      multaPercent: p,
      multaValue: v,
      cancellationFineValue: v,
    });
  };
  const toggleSemMultaCDC7 = (checked: boolean) => {
    setSemMultaCDC7(checked);
    if (checked) {
      setFinePercent(0);
      setFineValue(0);
      updateCancellationCase(caseRef.id, {
        dentro7Dias: true,
        multaPercent: 0,
        multaValue: 0,
        cancellationFineValue: 0,
      });
    } else {
      setFinePercent(30);
      setFineValue(Math.round(fineBase * 0.3 * 100) / 100);
      updateCancellationCase(caseRef.id, {
        dentro7Dias: false,
        multaPercent: 30,
      });
    }
  };
  const [finePaymentDate, setFinePaymentDate] = useState<string>(today);
  const [confirmStep, setConfirmStep] = useState(false);

  // ─── Abatimento em outro contrato (usa o saldo a devolver ao aluno) ─────────
  const [abaterOutroContrato, setAbaterOutroContrato] = useState(false);
  const [abatimentoValorInput, setAbatimentoValorInput] = useState<number>(0);
  const [abatimentoBusca, setAbatimentoBusca] = useState('');
  const [abatimentoStudentId, setAbatimentoStudentId] = useState<string>('');

  // ─── Plano de estorno ao aluno (quando saldo é negativo) ───────────────────
  type PixType = 'CPF' | 'CNPJ' | 'Email' | 'Telefone' | 'Aleatória';
  const initialPlan = caseRef.refundPlan;
  const [refundQty, setRefundQty] = useState<number>(initialPlan?.installments?.length ?? 1);
  const [refundInstallments, setRefundInstallments] = useState<Array<{ date: string; value: number }>>(
    initialPlan?.installments ?? [{ date: defaultRefundFirstDate, value: 0 }],
  );
  const [pixKey, setPixKey] = useState<string>(initialPlan?.pixKey ?? '');
  const [pixKeyType, setPixKeyType] = useState<PixType>(initialPlan?.pixKeyType ?? 'CPF');

  // Upload do termo assinado (PDF ou imagem)
  const termos = (caseRef.termAttachments ?? []).filter((t) => t.type === 'termo_assinado');
  const [uploading, setUploading] = useState(false);
  const [zapsignLoading, setZapsignLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [legalNotes, setLegalNotes] = useState<string>(caseRef.legalNotes ?? '');
  const [legalNotesSaving, setLegalNotesSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const legalNotesSavedAt = caseRef.legalNotesUpdatedAt;

  const saveLegalNotes = async () => {
    const value = legalNotes.trim();
    if ((caseRef.legalNotes ?? '') === value) return;
    setLegalNotesSaving('saving');
    try {
      await updateCancellationCase(caseRef.id, {
        legalNotes: value || undefined,
        legalNotesUpdatedAt: value ? new Date().toISOString() : undefined,
      });
      setLegalNotesSaving('saved');
      setTimeout(() => setLegalNotesSaving('idle'), 1500);
    } catch {
      setLegalNotesSaving('idle');
    }
  };

  const handleUploadTermo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isPdfFile = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImageFile = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(file.name);
    if (!isPdfFile && !isImageFile) { setUploadError('Selecione um PDF ou uma imagem.'); return; }
    if (file.size > 15 * 1024 * 1024) { setUploadError('Arquivo maior que 15 MB.'); return; }
    setUploadError(null);
    setUploading(true);
    try {
      const companyId = useCompanyStore.getState().activeCompanyId;
      if (!companyId) throw new Error('Empresa ativa não identificada.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${companyId}/termos/${caseRef.id}_${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('cancellation-docs').upload(path, file, {
        contentType: file.type || (isPdfFile ? 'application/pdf' : 'application/octet-stream'), upsert: false,
      });
      if (error) throw error;
      const next = [
        ...(caseRef.termAttachments ?? []),
        { name: file.name, url: path, uploadedAt: new Date().toISOString(), type: 'termo_assinado' as const },
      ];
      await updateCancellationCase(caseRef.id, { termAttachments: next });
    } catch (err: any) {
      setUploadError(err?.message ?? 'Falha ao enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveTermo = async (idx: number) => {
    const attach = caseRef.termAttachments ?? [];
    const target = termos[idx];
    if (!target) return;
    try {
      await supabase.storage.from('cancellation-docs').remove([target.url]);
    } catch {}
    const next = attach.filter((a) => !(a.type === 'termo_assinado' && a.url === target.url));
    await updateCancellationCase(caseRef.id, { termAttachments: next });
  };

  const handleDownloadTermo = async (storagePath: string) => {
    try {
      const fileName = termos.find((t) => t.url === storagePath)?.name;
      await openCancellationPdf(storagePath, fileName);
    } catch (err: any) {
      setUploadError(err?.message ?? 'Não foi possível abrir o PDF.');
    }
  };

  const handleGerarZapSign = async () => {
    if (!student) {
      setUploadError('Vincule o caso a um aluno cadastrado para gerar o termo na ZapSign.');
      return;
    }
    if (!student.iamControlAlunoId) {
      setUploadError('Aluno sem vínculo com IAM Control. Sincronize o cadastro antes de gerar o termo.');
      return;
    }

    const netBalance = balance < 0 ? -estornoTotal : balance;
    setZapsignLoading(true);
    setUploadError(null);
    try {
      const result = await createIamCancelamentoTermo({
        student,
        caseRef: { ...caseRef, legalNotes },
        fineValue,
        totalPaid: paidBase,
        totalContract: effectiveSimplified ? fineBase : totalContract,
        balance: netBalance,
        semMultaCDC7,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Não foi possível gerar o termo na ZapSign.');
      }

      const signUrl = result.url_assinatura || result.file_url;
      if (signUrl) {
        window.open(signUrl, '_blank', 'noopener,noreferrer');
      }

      const nextAttachments = [
        ...(caseRef.termAttachments ?? []),
        {
          name: `ZapSign — ${result.nome_documento || 'Termo de Cancelamento'}`,
          url: signUrl || `zapsign:${result.id}`,
          uploadedAt: new Date().toISOString(),
          type: 'outro' as const,
        },
      ];
      await updateCancellationCase(caseRef.id, { termAttachments: nextAttachments });
      toast.success('Termo enviado para assinatura na ZapSign.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar termo na ZapSign.';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setZapsignLoading(false);
    }
  };

  const zapsignLinks = (caseRef.termAttachments ?? []).filter(
    (t) => t.type === 'outro' && t.name.toLowerCase().includes('zapsign'),
  );

  // Saldo: multa - pago
  //  > 0: aluno ainda deve
  //  < 0: devolver ao aluno
  //  = 0: quitado
  const balance = Math.round((fineValue - paidBase) * 100) / 100;
  const estornoBruto = balance < 0 ? Math.abs(balance) : 0;
  const abatimentoAtivo = abaterOutroContrato && estornoBruto > 0 && !!abatimentoStudentId;
  const abatimentoValor = abatimentoAtivo
    ? Math.min(Math.round((abatimentoValorInput || 0) * 100) / 100, estornoBruto)
    : 0;
  const estornoTotal = Math.round((estornoBruto - abatimentoValor) * 100) / 100;
  const netBalance = balance < 0 ? -estornoTotal : balance;
  const precisaEstorno = estornoTotal > 0.01;
  const abatimentoCobreTudo = abatimentoValor > 0.01 && !precisaEstorno && balance < 0;
  const abatimentoStudent = allStudents.find((s) => s.id === abatimentoStudentId);
  const abatimentoCandidatos = allStudents
    .filter((s) =>
      abatimentoBusca.trim().length >= 2 &&
      s.name.toLowerCase().includes(abatimentoBusca.trim().toLowerCase()))
    .slice(0, 8);
  const saldoDevedorAluno = (s?: Student) =>
    (s?.installments ?? []).filter((i) => !i.paid).reduce((acc, i) => acc + (i.value || 0), 0);

  const addDays = (dateStr: string, days: number) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /** Se cair em sábado ou domingo, antecipa para a sexta-feira anterior. */
  const antecipaFimDeSemana = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const dow = d.getDay(); // 0=Dom, 6=Sáb
    if (dow === 6) d.setDate(d.getDate() - 1);
    else if (dow === 0) d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  };

  /** Datas das parcelas: 1ª manual, demais 30 dias após a anterior (base) e antecipando fds. */
  const buildRefundDates = (firstDate: string, qty: number) =>
    Array.from({ length: qty }, (_, i) => (i === 0 ? firstDate : antecipaFimDeSemana(addDays(firstDate, i * 30))));

  // Ajusta a quantidade de parcelas do plano de estorno redistribuindo o valor.
  const applyRefundQty = (qty: number) => {
    const safeQty = Math.max(1, Math.min(24, Math.floor(qty || 1)));
    setRefundQty(safeQty);
    const per = Math.floor((estornoTotal / safeQty) * 100) / 100;
    const rest = Math.round((estornoTotal - per * safeQty) * 100) / 100;
    setRefundInstallments((prev) => {
      const first = prev[0]?.date || defaultRefundFirstDate;
      const dates = buildRefundDates(first, safeQty);
      return Array.from({ length: safeQty }, (_, i) => ({
        date: dates[i] || prev[i]?.date || defaultRefundFirstDate,
        value: i === safeQty - 1 ? Math.round((per + rest) * 100) / 100 : per,
      }));
    });
  };

  useEffect(() => {
    if (!semMultaCDC7) {
      const v = Math.round(fineBase * (finePercent / 100) * 100) / 100;
      setFineValue(v);
    }
  }, [fineBase, finePercent, semMultaCDC7]);

  useEffect(() => {
    if (estornoTotal > 0.01) {
      applyRefundQty(refundQty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estornoTotal, localRevertQty]);

  const maxLocalRevert = Math.max(0, totalInscricoes - inscRevertidasPersistidas - 1);
  const showFractionControls = totalInscricoes >= 2 && inscRevertidasPersistidas === 0 && !simplified;

  const setRefundDate = (idx: number, date: string) => {
    setRefundInstallments((prev) => {
      if (idx !== 0 || prev.length <= 1 || !date) {
        return prev.map((p, i) => (i === idx ? { ...p, date } : p));
      }
      // Regra: a partir da primeira data, as demais parcelas são 30 dias depois
      // uma da outra, antecipando para sexta-feira quando caírem em sáb/dom.
      const dates = buildRefundDates(date, prev.length);
      return prev.map((p, i) => ({ ...p, date: dates[i] || p.date }));
    });
  };

  const setRefundValue = (idx: number, value: number) => {
    setRefundInstallments((prev) => prev.map((p, i) => i === idx ? { ...p, value } : p));
  };

  const refundSum = Math.round(refundInstallments.reduce((s, p) => s + (p.value || 0), 0) * 100) / 100;
  const refundMatches = !precisaEstorno || Math.abs(refundSum - estornoTotal) < 0.01;
  const refundDatesOk = !precisaEstorno || refundInstallments.every((p) => !!p.date);
  const refundPixOk = !precisaEstorno || pixKey.trim().length > 0;
  const abatimentoOk =
    !abaterOutroContrato ||
    (!!abatimentoStudentId && abatimentoValor > 0 && abatimentoValor <= estornoBruto + 0.01);
  const refundReady = refundMatches && refundDatesOk && refundPixOk && abatimentoOk;

  /** Aplica o crédito no contrato do aluno selecionado, abatendo as parcelas em aberto. */
  const aplicarAbatimento = () => {
    const alvo = abatimentoStudent;
    if (!alvo || abatimentoValor <= 0) return;
    let restante = abatimentoValor;
    const hoje = new Date().toISOString().slice(0, 10);
    const ordenadas = [...(alvo.installments ?? [])].sort((a, b) =>
      (a.dueDate || '').localeCompare(b.dueDate || ''));
    const novas = ordenadas.map((i) => {
      if (i.paid || restante <= 0.009) return i;
      if (restante >= i.value - 0.009) {
        restante = Math.round((restante - i.value) * 100) / 100;
        return {
          ...i,
          paid: true,
          paidDate: hoje,
          paidValue: i.value,
          observacao: `Abatimento de crédito — cancelamento de ${caseRef.studentName}`,
        };
      }
      const novoValor = Math.round((i.value - restante) * 100) / 100;
      const abatido = restante;
      restante = 0;
      return {
        ...i,
        value: novoValor,
        observacao: `Abatimento parcial de ${formatCurrency(abatido)} — cancelamento de ${caseRef.studentName}`,
      };
    });
    const historyEntry = {
      date: new Date().toISOString(),
      type: 'Sistema' as const,
      text: `Recebeu abatimento de ${formatCurrency(abatimentoValor)} proveniente do saldo a devolver do cancelamento de ${caseRef.studentName}.`,
    };
    updateStudent(alvo.id, {
      installments: novas,
      paidInstallments: novas.filter((i) => i.paid).length,
      history: [...(alvo.history ?? []), historyEntry],
    });
  };

  const handleConfirmCancellation = (fineAlreadyPaid: boolean, abatimentoInfo?: AbatimentoInfo) => {
    if (localRevertQty > 0 && onPartialRevertBeforeCancel) {
      onPartialRevertBeforeCancel(localRevertQty);
    }
    onConfirm(installments, fineValue, finePaymentDate, fineAlreadyPaid, simplified || undefined, abatimentoInfo);
  };

  const persistRefundPlanAndConfirm = (fineAlreadyPaid: boolean) => {
    let abatimentoInfo: AbatimentoInfo | undefined;
    if (balance < 0) {
      if (!refundReady) return;
      if (abatimentoValor > 0 && abatimentoStudent) {
        const saldoAntes = saldoDevedorAluno(abatimentoStudent);
        aplicarAbatimento();
        abatimentoInfo = {
          valor: abatimentoValor,
          studentId: abatimentoStudent.id,
          studentName: abatimentoStudent.name,
          product: abatimentoStudent.product ?? null,
          saldoAntes,
          saldoDepois: Math.max(0, Math.round((saldoAntes - abatimentoValor) * 100) / 100),
          estornoBruto,
          estornoRestante: estornoTotal,
          appliedAt: new Date().toISOString(),
        };
        const note = {
          id: crypto.randomUUID(),
          text: `Abatimento de ${formatCurrency(abatimentoValor)} do saldo a devolver aplicado no contrato de ${abatimentoStudent.name}.`,
          authorName: 'Sistema',
          createdAt: new Date().toISOString(),
          attachments: [],
        } as any;
        updateCancellationCase(caseRef.id, { caseNotes: [...(caseRef.caseNotes ?? []), note], abatimento: abatimentoInfo });
      }
      if (precisaEstorno) {
        const plan = {
          pixKey: pixKey.trim(),
          pixKeyType,
          totalValue: estornoTotal,
          installments: refundInstallments.map((p) => ({ date: p.date, value: Math.round(p.value * 100) / 100, lancadoParaPagamento: false })),
          createdAt: new Date().toISOString(),
        };
        updateCancellationCase(caseRef.id, { refundPlan: plan });
      } else if (caseRef.refundPlan) {
        // Abatimento cobriu todo o saldo a devolver — não há estorno a pagar.
        updateCancellationCase(caseRef.id, { refundPlan: null as any });
      }

    }
    handleConfirmCancellation(fineAlreadyPaid, abatimentoInfo);
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md">
        <div className="sticky top-0 bg-card border-b border-border p-5 flex items-start justify-between gap-3 z-10">
          <div>
            <h2 className="text-base font-bold text-foreground">Revisar cancelamento</h2>
            <p className="text-xs text-muted-foreground mt-1">{caseRef.studentName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {showFractionControls && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase text-indigo-800 tracking-wider">
                  Fracionar contrato
                </p>
                <p className="text-xs text-indigo-900/90 mt-1 leading-relaxed">
                  Este contrato tem <strong>{totalInscricoes} inscrições</strong>. Escolha quantas reverter
                  (sem cancelar) e quantas cancelar agora com multa e eventual estorno.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Reverter (sem cancelar)</span>
                  <select
                    value={localRevertQty}
                    onChange={(e) => setLocalRevertQty(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    {Array.from({ length: maxLocalRevert + 1 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0
                          ? `0 — cancelar todas (${totalInscricoes})`
                          : `${i} — cancelar ${totalInscricoes - i}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-lg border border-indigo-200 bg-white/70 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase text-indigo-700">Resumo</p>
                  <p className="text-sm font-bold text-indigo-900 mt-1">
                    Reverter {localRevertQty} · Cancelar {Math.max(1, totalInscricoes - localRevertQty)}
                  </p>
                  <p className="text-[10px] text-indigo-800/80 mt-0.5">
                    {formatCurrency(valorPorInscricao)} por inscrição
                  </p>
                </div>
              </div>
            </div>
          )}

          {effectiveSimplified && (
            <>
              {simplified ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                  <p className="text-[11px] font-semibold uppercase text-sky-800 tracking-wider">
                    Cancelamento pós-reversão parcial
                  </p>
                  <p className="text-xs text-sky-900 mt-1 leading-relaxed">
                    O assessor já reverteu {inscRevertidasPersistidas} inscrição(ões) e enviou esse ajuste à Conciliação.
                    O cálculo abaixo considera apenas a(s) <strong>{inscRestantes} inscrição(ões) remanescente(s)</strong>
                    {' '}— base de <strong>{formatCurrency(fineBase)}</strong> para multa e eventual estorno.
                    <strong> Nenhuma nova pendência</strong> será enviada à Conciliação.
                  </p>
                </div>
              ) : localRevertQty > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-[11px] font-semibold uppercase text-amber-800 tracking-wider">
                    Cancelamento fracionado
                  </p>
                  <p className="text-xs text-amber-900 mt-1 leading-relaxed">
                    Ao confirmar, <strong>{localRevertQty} inscrição(ões) será(ão) revertida(s)</strong> e{' '}
                    <strong>{inscRestantes} cancelada(s)</strong> com multa e eventual estorno proporcional
                    (base <strong>{formatCurrency(fineBase)}</strong>).
                  </p>
                </div>
              ) : null}
              {(simplified || localRevertQty > 0) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Contrato</p>
                  <p className="text-base font-bold text-foreground">{totalInscricoes} inscriç{totalInscricoes !== 1 ? 'ões' : 'ão'}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatCurrency(valorPorInscricao)} / inscrição</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[10px] font-semibold uppercase text-emerald-700">
                    {simplified ? 'Revertidas pelo assessor' : 'A reverter agora'}
                  </p>
                  <p className="text-base font-bold text-emerald-800">{inscRevertidas}</p>
                  <p className="text-[10px] text-emerald-700/80 mt-0.5">{formatCurrency(Math.round(valorPorInscricao * inscRevertidas * 100) / 100)}</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-[10px] font-semibold uppercase text-rose-700">A cancelar agora</p>
                  <p className="text-base font-bold text-rose-800">{inscRestantes}</p>
                  <p className="text-[10px] text-rose-700/80 mt-0.5">{formatCurrency(fineBase)}</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Pago (proporcional)</p>
                  <p className="text-base font-bold text-foreground">{formatCurrency(paidBase)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">de {formatCurrency(totalPaid)} pagos</p>
                </div>
              </div>
              )}
            </>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                {effectiveSimplified ? 'Valor da inscrição a cancelar' : 'Valor do contrato'}
              </p>
              <p className="text-base font-bold text-foreground">{formatCurrency(effectiveSimplified ? fineBase : totalContract)}</p>
              {effectiveSimplified && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {inscRestantes} de {totalInscricoes} inscrições · contrato {formatCurrency(totalContract)}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Pago até o momento</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(effectiveSimplified ? paidBase : totalPaid)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {effectiveSimplified
                  ? `proporcional — de ${formatCurrency(totalPaid)} pagos`
                  : `${paid.length} parcela${paid.length !== 1 ? 's' : ''}${entrada > 0 ? ` + entrada ${formatCurrency(entrada)}` : ''}`}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Pendente</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(effectiveSimplified ? pendingBase : totalPending)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {effectiveSimplified ? 'proporcional à inscrição' : `${pending.length} parcela${pending.length !== 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Multa final</p>
              <p className="text-base font-bold text-foreground">{formatCurrency(fineValue)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/10">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Multa de cancelamento</h3>
              <label
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-all ${
                  semMultaCDC7
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-card border-border text-foreground hover:bg-muted'
                }`}
                title="Direito de arrependimento (Art. 49 CDC). Zera a multa e registra na conciliação."
              >
                <input
                  type="checkbox"
                  className="accent-emerald-600"
                  checked={semMultaCDC7}
                  onChange={(e) => toggleSemMultaCDC7(e.target.checked)}
                />
                Sem multa — 7 dias CDC
              </label>
            </div>
            <label
              className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all ${
                estornoBruto <= 0
                  ? 'bg-muted/40 border-border text-muted-foreground cursor-not-allowed opacity-70'
                  : abaterOutroContrato
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800 cursor-pointer'
                    : 'bg-card border-border text-foreground hover:bg-muted cursor-pointer'
              }`}
              title={estornoBruto <= 0
                ? 'Disponível apenas quando houver saldo a devolver ao aluno.'
                : 'Usa o saldo a devolver para abater parcelas de outro contrato.'}
            >
              <input
                type="checkbox"
                className="accent-indigo-600"
                disabled={estornoBruto <= 0}
                checked={abaterOutroContrato}
                onChange={(e) => {
                  setAbaterOutroContrato(e.target.checked);
                  if (e.target.checked) setAbatimentoValorInput(estornoBruto);
                  else { setAbatimentoValorInput(0); setAbatimentoStudentId(''); setAbatimentoBusca(''); }
                }}
              />
              Abater em outro contrato
            </label>
            {semMultaCDC7 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                Cancelamento dentro do prazo de arrependimento (7 dias — Art. 49 do CDC). Multa zerada automaticamente e essa informação será enviada para a Conciliação.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">% sobre o contrato</label>
                <div className="mt-1 relative">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={finePercent === 0 ? '' : finePercent}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') { handlePercentChange(0); return; }
                      handlePercentChange(Number(raw));
                    }}
                    disabled={semMultaCDC7}
                    className={`input-field text-sm w-full pr-8 ${semMultaCDC7 ? 'opacity-60 cursor-not-allowed' : ''}`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {semMultaCDC7 ? 'Bloqueado — Sem multa 7 dias CDC.' : 'Editável pelo jurídico.'}
                </p>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Valor da multa</label>
                <div className={`mt-1 ${semMultaCDC7 ? 'opacity-60 pointer-events-none' : ''}`}>
                  <CurrencyInput value={fineValue} onChange={(v) => {
                    setFineValue(v);
                    const pct = totalContract > 0 ? Math.round((v / totalContract) * 10000) / 100 : 0;
                    setFinePercent(pct);
                    updateCancellationCase(caseRef.id, {
                      multaPercent: pct,
                      multaValue: v,
                      cancellationFineValue: v,
                    });
                  }} className="text-sm" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Data de pagamento</label>
                <input
                  type="date"
                  className="input-field text-sm mt-1 w-full"
                  value={finePaymentDate}
                  onChange={(e) => setFinePaymentDate(e.target.value)}
                  disabled={semMultaCDC7}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {semMultaCDC7
                ? <>Sem multa aplicada — <strong className="text-emerald-700">Direito de arrependimento (7 dias CDC)</strong>.</>
                : <>Cálculo: {finePercent}% de {formatCurrency(totalContract)} = <strong className="text-foreground">{formatCurrency(computedFine)}</strong>. Ajuste manualmente se necessário.</>}
            </p>
          </div>

          {/* Saldo final: aluno paga ou empresa devolve (líquido do abatimento) */}
          {(() => {
            const netBalance = balance < 0 ? -estornoTotal : balance;
            return (
          <div
            className={`rounded-xl border p-4 ${
              netBalance > 0.01
                ? 'border-amber-200 bg-amber-50'
                : netBalance < -0.01
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {netBalance > 0.01 ? 'Aluno ainda deverá pagar' : netBalance < -0.01 ? 'Devolver ao aluno' : 'Situação quitada'}
                </p>
                <p
                  className={`text-xl font-bold ${
                    netBalance > 0.01 ? 'text-amber-800' : netBalance < -0.01 ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  {formatCurrency(Math.abs(netBalance))}
                </p>
                {abatimentoValor > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Abatido em outro contrato: <strong>{formatCurrency(abatimentoValor)}</strong>
                  </p>
                )}
              </div>
              <div className="text-right text-[10px] text-muted-foreground leading-tight">
                Multa {formatCurrency(fineValue)}<br />
                − Pago {formatCurrency(totalPaid)}<br />
                {abatimentoValor > 0 && <>+ Abatimento {formatCurrency(abatimentoValor)}<br /></>}
                <strong className="text-foreground">
                  = {netBalance >= 0 ? '+' : '−'} {formatCurrency(Math.abs(netBalance))}
                </strong>
              </div>
            </div>
          </div>
            );
          })()}



          {/* Abatimento em outro contrato */}
          {abaterOutroContrato && estornoBruto > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-indigo-800 uppercase tracking-wider">Abater em outro contrato</h3>
                <p className="text-[10px] text-indigo-700 mt-0.5">
                  Saldo disponível a devolver: <strong>{formatCurrency(estornoBruto)}</strong>. O valor abatido reduz o saldo devedor do contrato escolhido — pode ser do mesmo aluno ou de outro aluno.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase text-indigo-800">Valor a abater</label>
                  <div className="mt-1">
                    <CurrencyInput
                      value={abatimentoValorInput}
                      onChange={(v) => setAbatimentoValorInput(Math.min(v, estornoBruto))}
                      className="text-sm"
                    />
                  </div>
                  {abatimentoValorInput > estornoBruto + 0.01 && (
                    <p className="text-[10px] text-rose-600 mt-1">Não pode ser maior que o saldo a devolver.</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase text-indigo-800">
                    Contrato de destino <span className="text-rose-600">*</span>
                  </label>
                  {abatimentoStudent ? (
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-indigo-200 bg-card px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{abatimentoStudent.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Saldo devedor atual: {formatCurrency(saldoDevedorAluno(abatimentoStudent))}
                          {abatimentoStudent.product ? ` · ${abatimentoStudent.product}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAbatimentoStudentId(''); setAbatimentoBusca(''); }}
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Trocar aluno"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={abatimentoBusca}
                        onChange={(e) => setAbatimentoBusca(e.target.value)}
                        placeholder="Buscar aluno pelo nome (mesmo aluno ou outro)…"
                        className="input-field text-xs w-full mt-1"
                      />
                      {abatimentoBusca.trim().length >= 2 && (
                        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-indigo-200 bg-card divide-y divide-border">
                          {abatimentoCandidatos.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground px-3 py-2">Nenhum aluno encontrado.</p>
                          ) : abatimentoCandidatos.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => { setAbatimentoStudentId(s.id); setAbatimentoBusca(''); }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                            >
                              <p className="text-xs font-semibold text-foreground truncate">{s.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {s.product ? `${s.product} · ` : ''}Saldo devedor: {formatCurrency(saldoDevedorAluno(s))}
                                {s.ac ? ` · AC ${s.ac}` : ''}
                              </p>

                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {abatimentoStudent && abatimentoValor > 0 && (
                <div className="rounded-lg border border-indigo-200 bg-card px-3 py-2 text-[11px] text-foreground">
                  Ao confirmar: o saldo devedor de <strong>{abatimentoStudent.name}</strong> passa de{' '}
                  <strong>{formatCurrency(saldoDevedorAluno(abatimentoStudent))}</strong> para{' '}
                  <strong>{formatCurrency(Math.max(0, saldoDevedorAluno(abatimentoStudent) - abatimentoValor))}</strong>{' '}
                  (parcelas em aberto quitadas/abatidas na ordem de vencimento).
                  {estornoTotal > 0.01
                    ? <> Restam <strong>{formatCurrency(estornoTotal)}</strong> a estornar via PIX.</>
                    : <> O saldo a devolver foi totalmente abatido — não há estorno via PIX.</>}
                </div>

              )}
              {!abatimentoStudentId && (
                <p className="text-[10px] text-rose-600 font-medium">Selecione o contrato de destino do abatimento.</p>
              )}
            </div>
          )}




          {/* Plano de estorno ao aluno — aparece apenas quando saldo é negativo */}
          {precisaEstorno && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-rose-800 uppercase tracking-wider">Pagamento do estorno</h3>
                  <p className="text-[10px] text-rose-700 mt-0.5">
                    Total a estornar: <strong>{formatCurrency(estornoTotal)}</strong>. Divida em quantas parcelas forem necessárias.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-semibold uppercase text-rose-800">Qtd parcelas</label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={refundQty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => applyRefundQty(Number(e.target.value || 1))}
                    className="input-field text-xs w-20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                {refundInstallments.map((p, idx) => {
                  const isParcela01 = idx === 0;
                  const parcela01Vazia = isParcela01 && !p.date;
                  return (
                    <div key={idx} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center rounded-lg border border-rose-200 bg-card px-3 py-2">
                      <span className="text-[11px] font-semibold text-foreground">
                        Parcela {idx + 1}
                        {isParcela01 && <span className="text-rose-600 ml-0.5">*</span>}
                      </span>
                      <div className="space-y-1">
                        <input
                          type="date"
                          value={p.date}
                          required={isParcela01}
                          onChange={(e) => setRefundDate(idx, e.target.value)}
                          className={`input-field text-xs ${parcela01Vazia ? 'border-rose-500 ring-1 ring-rose-500' : ''}`}
                        />
                        {parcela01Vazia && <p className="text-[9px] text-rose-600 font-medium">Data da parcela 01 obrigatória</p>}
                      </div>
                      <CurrencyInput
                        value={p.value}
                        onChange={(v) => setRefundValue(idx, v)}
                        className="text-xs"
                      />
                    </div>
                  );
                })}
              </div>

              <div className={`text-[10px] flex items-center justify-between px-1 ${refundMatches ? 'text-emerald-700' : 'text-rose-700 font-semibold'}`}>
                <span>Soma das parcelas: {formatCurrency(refundSum)}</span>
                <span>{refundMatches ? '✓ confere com o total' : `Falta ${formatCurrency(estornoTotal - refundSum)}`}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 pt-1">
                <div>
                  <label className="text-[10px] font-semibold uppercase text-rose-800">Tipo da chave PIX</label>
                  <select
                    value={pixKeyType}
                    onChange={(e) => setPixKeyType(e.target.value as PixType)}
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
                  <label className="text-[10px] font-semibold uppercase text-rose-800">
                    Chave PIX do aluno <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={pixKey}
                    required
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="Informe a chave PIX para o estorno"
                    className={`input-field text-xs w-full mt-1 ${!pixKey.trim() ? 'border-rose-500 ring-1 ring-rose-500' : ''}`}
                  />
                  {!pixKey.trim() && <p className="text-[9px] text-rose-600 font-medium mt-1">Chave PIX obrigatória</p>}
                </div>
              </div>
              <p className="text-[10px] text-rose-700/80">
                Estas informações são registradas na aba <strong>Estornos</strong> e não são enviadas para a Conciliação.
              </p>
            </div>
          )}



          {/* Termo assinado — anexar ou gerar no ZapSign */}
          <div className="rounded-xl border border-border p-4 space-y-3 bg-muted/10">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">TERMO DE CANCELAMENTO</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Anexar */}
              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">Anexar</p>
                <p className="text-[10px] text-muted-foreground">Envie o PDF ou imagem do termo já assinado pelo aluno.</p>
                <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                  uploading ? 'bg-muted text-muted-foreground opacity-60 cursor-wait' : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}>
                  <Upload size={12} />
                  {uploading ? 'Enviando...' : 'Anexar PDF/Imagem'}
                  <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUploadTermo} disabled={uploading} />
                </label>
              </div>

              {/* Gerar termo no ZapSign */}
              <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">Gerar termo no ZapSign</p>
                <p className="text-[10px] text-muted-foreground">
                  Gera o PDF no IAM Control e envia para assinatura digital na ZapSign.
                </p>
                <button
                  type="button"
                  onClick={handleGerarZapSign}
                  disabled={zapsignLoading || !student?.iamControlAlunoId}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <FileText size={12} />
                  {zapsignLoading ? 'Gerando…' : 'Gerar no ZapSign'}
                </button>
                {!student?.iamControlAlunoId && (
                  <p className="text-[10px] text-amber-700">
                    Aluno precisa estar vinculado ao IAM Control.
                  </p>
                )}
              </div>
            </div>

            {uploadError && <p className="text-[10px] text-rose-600">{uploadError}</p>}
            {zapsignLinks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Links ZapSign</p>
                {zapsignLinks.map((t) => (
                  <div key={t.url} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
                    <FileText size={14} className="text-blue-700 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground">Gerado em {new Date(t.uploadedAt).toLocaleString('pt-BR')}</p>
                    </div>
                    {t.url.startsWith('http') && (
                      <button
                        type="button"
                        onClick={() => window.open(t.url, '_blank', 'noopener,noreferrer')}
                        className="p-1.5 rounded-md text-blue-700 hover:bg-blue-100 transition-colors"
                        title="Abrir link de assinatura"
                      >
                        <DownloadIcon size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {termos.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhum termo anexado.</p>
            ) : (
              <div className="space-y-1.5">
                {termos.map((t, idx) => (
                  <div key={t.url} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                    <FileText size={14} className="text-emerald-700 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground">Enviado em {new Date(t.uploadedAt).toLocaleString('pt-BR')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadTermo(t.url)}
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title="Baixar / abrir"
                    >
                      <DownloadIcon size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveTermo(idx)}
                      className="p-1.5 rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      title="Remover"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>


          {/* Observações do Jurídico */}
          <div className="rounded-xl border border-border p-4 space-y-2 bg-muted/10">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Observações do Jurídico
              </h3>
              <span className="text-[10px] text-muted-foreground">
                {legalNotesSaving === 'saving'
                  ? 'Salvando…'
                  : legalNotesSaving === 'saved'
                    ? 'Salvo ✓'
                    : legalNotesSavedAt
                      ? `Atualizado em ${new Date(legalNotesSavedAt).toLocaleString('pt-BR')}`
                      : 'Uso interno do Jurídico'}
              </span>
            </div>
            <textarea
              value={legalNotes}
              onChange={(e) => setLegalNotes(e.target.value)}
              onBlur={saveLegalNotes}
              placeholder="Registre aqui anotações internas sobre este cancelamento (contato com o aluno, prazos, argumentos jurídicos, etc.)"
              rows={4}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
          </div>




          {confirmStep && (
            <div
              className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[60] fade-in"
              onClick={() => setConfirmStep(false)}
            >
              <div
                className="bg-card rounded-2xl w-full max-w-md shadow-2xl border border-border overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle size={20} className="text-destructive" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-foreground">Confirmar cancelamento?</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Essa ação encerra o contrato do aluno. Revise os valores antes de confirmar.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Multa de cancelamento</span>
                      <span className="font-semibold text-foreground">{formatCurrency(fineValue)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{effectiveSimplified ? 'Pago (proporcional às inscrições canceladas)' : 'Pago até o momento'}</span>
                      <span className="font-semibold text-foreground">{formatCurrency(paidBase)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                      <span className="text-muted-foreground">
                        {balance > 0
                          ? 'Saldo pendente da multa'
                          : abatimentoCobreTudo
                            ? 'Abatimento em outro contrato'
                            : precisaEstorno
                              ? 'Estorno ao aluno'
                              : 'Situação'}
                      </span>
                      <span className={`font-semibold ${balance > 0 ? 'text-amber-700' : precisaEstorno ? 'text-sky-700' : abatimentoCobreTudo ? 'text-indigo-700' : 'text-emerald-700'}`}>
                        {balance > 0
                          ? formatCurrency(balance)
                          : abatimentoCobreTudo
                            ? formatCurrency(abatimentoValor)
                            : precisaEstorno
                              ? formatCurrency(estornoTotal)
                              : 'Quitada'}
                      </span>
                    </div>
                    {abatimentoValor > 0.01 && balance < 0 && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Saldo bruto a devolver</span>
                        <span>{formatCurrency(estornoBruto)}</span>
                      </div>
                    )}
                  </div>

                  {balance > 0 ? (
                    <div className="space-y-2 pt-1">
                      <p className="text-[11px] text-muted-foreground">
                        Ainda há saldo de multa a receber. Escolha como formalizar:
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          onClick={() => handleConfirmCancellation(true)}
                          className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                          title="O aluno já quitou a multa — encerra o caso imediatamente."
                        >
                          Multa Quitada
                        </button>
                        <button
                          onClick={() => handleConfirmCancellation(false)}
                          className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                          title="Registra o saldo da multa como pendência a negativar."
                        >
                          Negativar Multa
                        </button>
                      </div>
                      <button
                        onClick={() => setConfirmStep(false)}
                        className="w-full px-5 py-2 rounded-xl text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Voltar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      {precisaEstorno && (
                        <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900">
                          <p className="font-semibold">Estorno ao aluno</p>
                          <p className="mt-0.5">
                            Será realizado o estorno de <strong>{formatCurrency(estornoTotal)}</strong> ao aluno,
                            em <strong>{refundInstallments.length}</strong> parcela(s) via PIX ({pixKeyType}).
                            O plano ficará registrado na aba <strong>Estornos</strong>.
                          </p>
                        </div>
                      )}
                      {abatimentoCobreTudo && abatimentoStudent && (
                        <div className="rounded-xl border border-indigo-300 bg-indigo-50 p-3 text-xs text-indigo-900">
                          <p className="font-semibold">Abatimento em outro contrato</p>
                          <p className="mt-0.5">
                            O saldo de <strong>{formatCurrency(abatimentoValor)}</strong> será abatido no contrato de{' '}
                            <strong>{abatimentoStudent.name}</strong>
                            {abatimentoStudent.product ? ` (${abatimentoStudent.product})` : ''}.
                            Não haverá estorno via PIX — o registro ficará apenas no histórico do cancelamento.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          onClick={() => persistRefundPlanAndConfirm(true)}
                          disabled={balance < 0 && !refundReady}
                          className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {precisaEstorno
                            ? 'Confirmar Cancelamento com Estorno'
                            : abatimentoCobreTudo
                              ? 'Confirmar Cancelamento com Abatimento'
                              : 'Confirmar Cancelamento'}
                        </button>
                        <button
                          onClick={() => setConfirmStep(false)}
                          className="px-5 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Voltar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}




          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            {balance > 0 ? (
              <>
                <button
                  onClick={() => handleConfirmCancellation(true)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                  title="O aluno já quitou a multa — encerra o caso imediatamente."
                >
                  Multa Quitada
                </button>
                <button
                  onClick={() => handleConfirmCancellation(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                  title="Registra o saldo da multa como pendência a negativar."
                >
                  Negativar Multa
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmStep(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Confirmar Cancelamento
              </button>
            )}
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
              Voltar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Movement History Bell (para a aba Cancelamentos) ───────────────────────

interface MovementBellProps {
  cases: CancellationCase[];
}

function MovementBell({ cases }: MovementBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Aggregate all history entries with case context
  const entries = useMemo(() => {
    const all: Array<{ caseId: string; studentName: string; date: string; note?: string; from: string; to: string }> = [];
    cases.forEach((c) => {
      (c.history ?? []).forEach((h) => {
        all.push({
          caseId: c.id,
          studentName: c.studentName,
          date: h.date,
          note: h.note,
          from: h.from,
          to: h.to,
        });
      });
    });
    return all
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 50);
  }, [cases]);

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-xl border border-border bg-card hover:bg-muted/60 transition-colors"
        title="Histórico de movimentações"
      >
        <Bell size={15} className="text-foreground" />
        {entries.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center shadow-sm">
            {entries.length > 99 ? '99+' : entries.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-h-[480px] overflow-auto bg-card border border-border rounded-2xl shadow-2xl z-50 fade-in">
          <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Histórico de movimentações</h3>
            <span className="text-[10px] text-muted-foreground">Últimas {entries.length}</span>
          </div>
          {entries.length === 0 ? (
            <div className="p-8 text-center">
              <Bell size={28} className="mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">Sem movimentações ainda.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {entries.map((e, i) => (
                <li key={`${e.caseId}-${i}`} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground truncate">{e.studentName}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatDateFull(e.date)}</span>
                  </div>
                  {e.note ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{translateFunnelNames(e.note)}</p>
                  ) : e.from !== e.to ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{e.from} → {e.to}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug italic">Movimentação registrada</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CancelamentosPage() {
  const {
    cancellationCases: allCancellationCases,
    deleteCancellationCase,
    revertCancellation,
    finalizeCancellation,
    students,
    updateCancellationCase,
    updateStudent,
    currentUser,
    acs,
    studentTags,
  } = useAppStore();
  // AC N2 tem permissão total na aba de Cancelamentos — visualiza todos os casos
  // (assim como admin / jurídico). Apenas a role 'ac' (N1) seria escopada — porém
  // ela hoje não tem acesso à aba (ver permissions defaults em types/index.ts).
  const cancellationCases = allCancellationCases;

  // UI state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CancellationCase | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyCase, setHistoryCase] = useState<CancellationCase | null>(null);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [editStudentForCase, setEditStudentForCase] = useState<{ student: Student; caseRef: CancellationCase } | null>(null);
  const [finalizeAction, setFinalizeAction] = useState<{ caseRef: CancellationCase; type: 'reverter' | 'cancelar' } | null>(null);
  const [checklistCase, setChecklistCase] = useState<CancellationCase | null>(null);
  const [concilConfirmCase, setConcilConfirmCase] = useState<CancellationCase | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('kanban');
  const [revertChoice, setRevertChoice] = useState<CancellationCase | null>(null);
  // Prompt de quantidade (contratos com múltiplas inscrições)
  const [revertQtyPrompt, setRevertQtyPrompt] = useState<CancellationCase | null>(null);
  // Quando definido, indica que o próximo fluxo de reversão é parcial (qty < remaining)
  const [pendingPartialRevert, setPendingPartialRevert] = useState<{ caseId: string; qty: number } | null>(null);
  // Pergunta inicial de troca de turma (antes do fluxo com/sem ajuste financeiro)
  const [classChangePrompt, setClassChangePrompt] = useState<CancellationCase | null>(null);
  // Troca de turma escolhida — persistida até o final do fluxo com/sem ajustes financeiros
  const [pendingClassChange, setPendingClassChange] = useState<{ caseId: string; novaTurma: string; taxaPct: number; taxaValor: number } | null>(null);
  const [renegStudent, setRenegStudent] = useState<Student | null>(null);
  const [renegBanner, setRenegBanner] = useState<{ title: string; body?: string } | null>(null);
  // Total sugerido para redistribuição automática das parcelas pendentes
  // no fluxo de reversão parcial COM ajuste financeiro.
  const [renegSuggestedTotal, setRenegSuggestedTotal] = useState<number | null>(null);
  // Prompt de multa contratual + encargos p/ reversão parcial COM ajuste financeiro
  const [partialAdjustPrompt, setPartialAdjustPrompt] = useState<{
    studentName: string;
    totalContract: number;
    saldoBase: number;
    valorRevertidas: number;
    pagoTotal: number;
    partial: number;
    totalInscricoes?: number;
    onConfirm: (multaValue: number, encargos: number, multaPct: number) => void;
    onCancel: () => void;
  } | null>(null);
  // Caso de cancelamento vinculado à renegociação atual — quando fechada, marcamos como Revertido/Finalizado
  const [renegSourceCaseId, setRenegSourceCaseId] = useState<string | null>(null);
  // Visualização da Ficha do Aluno (caso vinculado)
  const [viewingCase, setViewingCase] = useState<{ student: Student; caseRef: CancellationCase } | null>(null);
  const [viewingExternal, setViewingExternal] = useState<CancellationCase | null>(null);
  // Mostrar/ocultar histórico de finalizados
  const [showFinalizados, setShowFinalizados] = useState(false);
  const [showImportExternal, setShowImportExternal] = useState(false);
  // Pesquisa por nome do aluno (filtra cards do funil)
  const [searchTerm, setSearchTerm] = useState('');
  const [acFilter, setAcFilter] = useState<string>('all');
  const [columnActionFilter, setColumnActionFilter] = useState<Partial<Record<FunnelStage, string>>>({});
  // Paginação e busca local da coluna "Finalizado"
  const [finalizadoSearch, setFinalizadoSearch] = useState('');
  const [finalizadoLimit, setFinalizadoLimit] = useState(10);

  // Envio para Jurídico (Em Tratativas → Distrato do Contrato) com observações
  const [sendToLegalCase, setSendToLegalCase] = useState<CancellationCase | null>(null);
  const [multaPagaCase, setMultaPagaCase] = useState<{ caseRef: CancellationCase; valor: number } | null>(null);

  // Helper: lookup student by case
  const getCaseStudent = (c: CancellationCase): Student | undefined =>
    c.studentId ? students.find((s) => s.id === c.studentId) : students.find((s) => s.name === c.studentName);

  // Visualizar — abre a ficha do aluno (mesma da Gestão Financeira) acrescida de
  // Etiquetas e Motivo do Cancelamento. Se não houver aluno vinculado, abre o modal do caso.
  const handleView = (c: CancellationCase) => {
    // Casos importados manualmente (Importar Aluno Cancelamento): somente leitura
    if (c.externalImport) {
      setViewingExternal(c);
      return;
    }
    const st = getCaseStudent(c);
    if (st) {
      setViewingCase({ student: st, caseRef: c });
    } else {
      setEditing(c); setShowModal(true);
    }
  };

  // Finalize handlers (Reverter / Cancelar)
  // Reverter: em "Em Tratativas", pergunta primeiro a quantidade de inscrições (se >1).
  // Em "Formalização" (Distrato) o Jurídico reverte diretamente as inscrições remanescentes.
  const openRevertFlow = (c: CancellationCase) => {
    const total = c.quantidadeInscricoes ?? 1;
    const reverted = c.inscricoesRevertidas ?? 0;
    const remaining = Math.max(1, total - reverted);
    const isEmTratativas = getFunnelStage(c) === 'Em Execução';
    // Métrica: registra que a reversão foi acionada com o card no Distrato do Contrato
    if (getFunnelStage(c) === 'Formalização' && !hasDistratoRevertMarker(c)) {
      const now = new Date().toISOString();
      updateCancellationCase(c.id, {
        history: [
          ...c.history,
          {
            date: now,
            from: c.stage,
            to: c.stage,
            operationalStatus: c.operationalStatus,
            note: `${DISTRATO_REVERT_MARKER} Reverter acionado com o card em Distrato do Contrato.`,
          },
        ],
      });
    }
    if (remaining >= 2 && (isEmTratativas || getFunnelStage(c) === 'Formalização')) {
      setRevertQtyPrompt(c);
      return;
    }
    // 1 inscrição restante (ou Formalização): fluxo direto — pergunta troca de turma
    setPendingPartialRevert(null);
    setClassChangePrompt(c);
  };

  const handleRevert = (c: CancellationCase) => openRevertFlow(c);
  const handleFinalize = (c: CancellationCase) => setFinalizeAction({ caseRef: c, type: 'cancelar' });

  // Ação / Responsável handlers
  const [ligacaoPrompt, setLigacaoPrompt] = useState<{ caseRef: CancellationCase; dateTime: string } | null>(null);
  const handleChangeAcao = (c: CancellationCase, acao: CancellationAction) => {
    // Sinalizar 'Revertido' abre o fluxo de reversão (não grava a ação diretamente)
    if (acao === 'Revertido') {
      openRevertFlow(c);
      return;
    }
    if (acao === 'Ligação Agendada') {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      const iso = now.toISOString().slice(0, 16);
      setLigacaoPrompt({ caseRef: c, dateTime: c.ligacaoAgendadaAt ? c.ligacaoAgendadaAt.slice(0, 16) : iso });
      return;
    }
    const now = new Date().toISOString();
    const entry = {
      date: now,
      from: c.stage,
      to: c.stage,
      operationalStatus: c.operationalStatus,
      note: `Ação alterada: ${c.acao ?? '—'} → ${acao}`,
    };
    updateCancellationCase(c.id, { acao, history: [...c.history, entry] });
  };
  const handleChangeResponsavel = (c: CancellationCase, responsavel: CancellationResponsavel) => {
    const now = new Date().toISOString();
    const entry = {
      date: now,
      from: c.stage,
      to: c.stage,
      operationalStatus: c.operationalStatus,
      note: `Responsável alterado: ${c.responsavel ?? '—'} → ${responsavel}`,
    };
    updateCancellationCase(c.id, { responsavel, history: [...c.history, entry] });
  };

  // ── Drag and drop (entre colunas do novo funil) ──
  const [dragOverFunnel, setDragOverFunnel] = useState<FunnelStage | null>(null);
  const [pendingMotivoCase, setPendingMotivoCase] = useState<{ caseRef: CancellationCase; targetFunnel: FunnelStage } | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, stage: FunnelStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverFunnel !== stage) setDragOverFunnel(stage);
  };
  const handleDragLeave = () => setDragOverFunnel(null);

  // Move card → new funnel stage (apenas atualiza funnelStage, não muda o estágio legado)
  const moveCaseToFunnel = (caseRef: CancellationCase, newFunnel: FunnelStage) => {
    const now = new Date().toISOString();
    const prevFunnel = getFunnelStage(caseRef);
    if (prevFunnel === newFunnel) return;

    const entry = {
      date: now,
      from: caseRef.stage,
      to: caseRef.stage,
      operationalStatus: caseRef.operationalStatus,
      note: `Movido no funil: ${prevFunnel} → ${newFunnel}`,
    };

    // Ação padrão por coluna (setada automaticamente na chegada)
    const defaultAcaoByFunnel: Partial<Record<FunnelStage, CancellationAction>> = {
      'Entrada': 'Aguardando Contato',
      'Em Execução': 'Conversa WhatsApp',
      'Formalização': 'Iniciar Tratativa',
    };
    const defaultAcao = defaultAcaoByFunnel[newFunnel];

    updateCancellationCase(caseRef.id, {
      funnelStage: newFunnel,
      movedToCurrentStageAt: now,
      ...(defaultAcao ? { acao: defaultAcao } : {}),
      // Limpa agendamento antigo ao sair de "Em Tratativas"
      ...(newFunnel !== 'Em Execução' ? { ligacaoAgendadaAt: undefined } : {}),
      history: [...caseRef.history, entry],
    });

    // Refletir no histórico do aluno vinculado
    const st = getCaseStudent(caseRef);
    if (st) {
      const studentEntry: HistoryEntry = {
        date: now,
        type: 'Sistema',
        text: `Cancelamento movido no funil: ${prevFunnel} → ${newFunnel}`,
      };
      updateStudent(st.id, { history: [...st.history, studentEntry] });
    }
  };

  const handleMoveToTratativas = (caseRef: CancellationCase) => {
    if (!caseRef.motivoCancelamento) {
      setPendingMotivoCase({ caseRef, targetFunnel: 'Em Execução' });
      return;
    }
    moveCaseToFunnel(caseRef, 'Em Execução');
  };

  const handleDrop = (e: React.DragEvent, targetFunnel: FunnelStage) => {
    e.preventDefault();
    setDragOverFunnel(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const caseRef = cancellationCases.find((c) => c.id === id);
    if (!caseRef) return;
    // Se a fase de destino não é Entrada e o caso não tem motivo, exigir motivo
    if (targetFunnel !== 'Entrada' && !caseRef.motivoCancelamento) {
      setPendingMotivoCase({ caseRef, targetFunnel });
      return;
    }
    // Distrato do Contrato → Finalizado: pedir checklist do Jurídico antes
    const prevFunnel = getFunnelStage(caseRef);
    if (targetFunnel === 'Finalizado' && prevFunnel === 'Formalização' && !caseRef.finalChecklist?.preenchidoAt) {
      setChecklistCase(caseRef);
      return;
    }
    // Em Tratativas → Distrato do Contrato: aciona o mesmo fluxo do botão
    // "Enviar para Jurídico" (abre modal de observações antes de mover).
    if (prevFunnel === 'Em Execução' && targetFunnel === 'Formalização') {
      setSendToLegalCase(caseRef);
      return;
    }
    // If moving to "Finalizado", show the finalize modal to choose outcome
    if (targetFunnel === 'Finalizado') {
      setFinalizeAction({ caseRef, type: 'cancelar' });
      return;
    }
    moveCaseToFunnel(caseRef, targetFunnel);
  };

  // ── Period filter state ──
  const { firstDay: currentMonthStart, lastDay: currentMonthEnd } = getCurrentMonthDates();
  const [preset, setPreset] = useState<DatePreset>('este-mes');
  const [customStart, setCustomStart] = useState(currentMonthStart);
  const [customEnd, setCustomEnd] = useState(currentMonthEnd);
  const [mode, setMode] = useState<AnalysisMode>('performance');

  const period = useMemo(
    () => getPresetRange(preset, customStart, customEnd),
    [preset, customStart, customEnd]
  );

  const isHistoricalMode = mode === 'historico';

  // ── Base display dataset ──
  const displayCases = useMemo(() => {
    return cancellationCases.filter((c) => caseExistedAt(c, period.end));
  }, [cancellationCases, period]);

  // ── Indicadores da coluna Distrato do Contrato ──────────────────────────
  const [distratoMetricsOpen, setDistratoMetricsOpen] = useState(false);
  const distratoMetrics = useMemo(() => {
    const revertidosNoDistrato = displayCases.filter(
      (c) =>
        !hasConciliacaoReprovada(c) &&
        (hasDistratoRevertMarker(c) ||
          (movedDistratoToTratativa(c) && c.acao === 'Revertido' && getFunnelStage(c) === 'Finalizado')),
    );
    const revertidosFinalizados = revertidosNoDistrato.filter(
      (c) => getFunnelStage(c) === 'Finalizado' && c.acao === 'Revertido',
    );

    const canceladosComMulta = displayCases.filter((c) => getMultaQuitadaValor(c) > 0.0049);
    const canceladosComAbatimento = displayCases.filter((c) => (c.abatimento?.valor ?? 0) > 0.0049);
    return {
      revertidosNoDistrato,
      revertidosFinalizados,
      canceladosComMulta,
      canceladosComAbatimento,
      totalMulta: canceladosComMulta.reduce((s, c) => s + getMultaQuitadaValor(c), 0),
      totalAbatimento: canceladosComAbatimento.reduce((s, c) => s + (c.abatimento?.valor ?? 0), 0),
    };
  }, [displayCases]);



  // ── Casos criados dentro do período de referência (guia os indicadores) ──
  const periodCases = useMemo(() => {
    return cancellationCases.filter((c) => {
      const t = new Date(c.createdAt).getTime();
      return t >= period.start.getTime() && t <= period.end.getTime();
    });
  }, [cancellationCases, period]);

  // ── KPIs ────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const total = periodCases.length;

    if (mode === 'performance') {
      const resolvedCases = periodCases.filter((c) => resolvedInPeriod(c, period.start, period.end));
      const recoveredCases = periodCases.filter((c) => recoveredInPeriod(c, period.start, period.end));
      const cancelledCount = resolvedCases.length - recoveredCases.length;
      const retentionRate = resolvedCases.length > 0 ? Math.round((recoveredCases.length / resolvedCases.length) * 100) : 0;
      const valueRecovered = recoveredCases.reduce((s, c) => s + (c.value ?? 0), 0);
      const valueLost = resolvedCases.filter((c) => !recoveredInPeriod(c, period.start, period.end)).reduce((s, c) => s + (c.value ?? 0), 0);
      const active = periodCases.filter((c) => !FINAL_STAGES.includes(c.stage));
      const valueAtRisk = active.reduce((s, c) => s + (c.value ?? 0), 0);
      return { total, resolved: resolvedCases.length, recovered: recoveredCases.length, cancelled: cancelledCount, retentionRate, valueAtRisk, valueRecovered, valueLost };
    }

    const recovered = periodCases.filter((c) => {
      const s = isHistoricalMode ? getHistoricalStage(c, period.end) : c.stage;
      return RECOVERED_STAGES.includes(s);
    });
    const cancelled = periodCases.filter((c) => {
      const s = isHistoricalMode ? getHistoricalStage(c, period.end) : c.stage;
      return s === 'Cancelado' || s === 'Negativação Efetivada';
    });
    const active = periodCases.filter((c) => {
      const s = isHistoricalMode ? getHistoricalStage(c, period.end) : c.stage;
      return !FINAL_STAGES.includes(s);
    });
    const retentionRate = total > 0 ? Math.round((recovered.length / total) * 100) : 0;
    const valueAtRisk = active.reduce((s, c) => s + (c.value ?? 0), 0);
    const valueRecovered = recovered.reduce((s, c) => s + (c.value ?? 0), 0);
    const valueLost = cancelled.reduce((s, c) => s + (c.value ?? 0), 0);

    return { total, resolved: recovered.length + cancelled.length, recovered: recovered.length, cancelled: cancelled.length, retentionRate, valueAtRisk, valueRecovered, valueLost };
  }, [periodCases, mode, period, isHistoricalMode]);

  // ── Motivo Stats ──
  const motivoStats = useMemo(() => {
    const stats = MOTIVOS_CANCELAMENTO.map((motivo) => {
      const cases = periodCases.filter((c) => c.motivoCancelamento === motivo);
      const count = cases.length;
      const cancelledCases = cases.filter((c) => c.stage === 'Cancelado' || c.stage === 'Negativação Efetivada');
      const valueLost = cancelledCases.reduce((s, c) => s + (c.value ?? 0), 0);
      return { motivo, count, valueLost };
    }).filter((m) => m.count > 0);
    return stats;
  }, [periodCases]);

  const totalMotivoCount = motivoStats.reduce((s, m) => s + m.count, 0);

  // ── Reversão KPIs (geral + jurídico), no período selecionado ───────────────
  const reversaoKpis = useMemo(() => {
    const total = periodCases.length;
    const revertidos = periodCases.filter(isCaseRevertidoGeral);
    const pct = total > 0 ? Math.round((revertidos.length / total) * 100) : 0;
    const valueRecovered = revertidos.reduce((s, c) => s + (c.value ?? 0), 0);
    return { total, revertidos: revertidos.length, pct, valueRecovered };
  }, [periodCases]);

  const juridicoReversaoKpis = useMemo(() => {
    const base = periodCases.filter(reachedJuridico);
    const revertidos = base.filter(isReversaoJuridico);
    const pct = base.length > 0 ? Math.round((revertidos.length / base.length) * 100) : 0;
    const valueRecovered = revertidos.reduce((s, c) => s + (c.value ?? 0), 0);
    return { total: base.length, revertidos: revertidos.length, pct, valueRecovered };
  }, [periodCases]);

  // Set com todos caseIds que possuem item pendente na aba Conciliação —
  // usado para forçar o card na coluna Finalizado enquanto aguarda baixa.
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const pendingConciliacaoCaseIds = useMemo(() => {
    const set = new Set<string>();
    for (const it of conciliacaoItems) {
      // "pendente" e "aprovado" ainda aguardam a conciliação definitiva
      if ((it.status === 'pendente' || it.status === 'aprovado') && it.relatedCaseId) set.add(it.relatedCaseId);
    }
    return set;
  }, [conciliacaoItems]);

  // Casos cujo cancelamento já foi conciliado em definitivo — permanecem em
  // Finalizado (agora com o selo "Conciliado"), sem voltar para a coluna
  // salva no funil (ex.: Distrato do Contrato).
  const conciliadoCancelCaseIds = useMemo(() => {
    const set = new Set<string>();
    for (const it of conciliacaoItems) {
      if ((it.tipo === 'cancelamento' || it.tipo === 'reversao') && it.status === 'conciliado' && it.relatedCaseId) set.add(it.relatedCaseId);
    }
    return set;
  }, [conciliacaoItems]);

  // Cards com status "aguardando_conciliacao" (no aluno vinculado) OU com item
  // pendente na Conciliação sempre aparecem na coluna Finalizado,
  // independentemente do funnelStage salvo.
  // EXCEÇÃO: reversão PARCIAL de inscrições — parte foi revertida e o restante
  // segue para o Jurídico (Distrato do Contrato). Nesse caso o card deve
  // permanecer na coluna salva (Formalização), mesmo com conciliação pendente.
  const hasReversaoParcialPendente = (c: CancellationCase): boolean => {
    const total = c.quantidadeInscricoes ?? 1;
    const revertidas = c.inscricoesRevertidas ?? 0;
    return total > 1 && revertidas > 0 && revertidas < total;
  };
  const isAguardandoConciliacao = (c: CancellationCase): boolean => {
    if (hasReversaoParcialPendente(c)) return false;
    if (isActiveCancellationWorkflow(c)) return false;
    if (pendingConciliacaoCaseIds.has(c.id)) return true;
    const st = students.find((s) => s.id === c.studentId) ?? (c.studentId ? undefined : students.find((s) => s.cancellationCaseId === c.id));
    return st?.statusCancelamento === 'aguardando_conciliacao';
  };
  const isCancelamentoConciliado = (c: CancellationCase): boolean =>
    !hasReversaoParcialPendente(c) &&
    !isActiveCancellationWorkflow(c) &&
    conciliadoCancelCaseIds.has(c.id) &&
    !pendingConciliacaoCaseIds.has(c.id);
  const effectiveFunnel = (c: CancellationCase): FunnelStage =>
    isAguardandoConciliacao(c) || isCancelamentoConciliado(c) ? 'Finalizado' : getFunnelStage(c);


  // ── Regra: "Finalizado" recente vs Histórico ─────────────────────────
  // Cards permanecem na coluna/listagem "Finalizado" por 7 dias após
  // serem movidos para essa etapa. Após esse período migram para o
  // "Histórico de finalizados" (visível somente via toggle).
  const FINALIZADO_RETENTION_DAYS = 30;
  const isFinalizadoRecente = (c: CancellationCase): boolean => {
    if (effectiveFunnel(c) !== 'Finalizado') return false;
    if (isAguardandoConciliacao(c)) return true; // sempre visível enquanto aguarda conciliação
    const ref = c.movedToCurrentStageAt || c.createdAt;
    if (!ref) return true; // sem data → mantém visível por segurança
    const diffMs = Date.now() - new Date(ref).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= FINALIZADO_RETENTION_DAYS;
  };
  const isFinalizadoHistorico = (c: CancellationCase): boolean =>
    effectiveFunnel(c) === 'Finalizado' && !isFinalizadoRecente(c);

  // ── Funnel chart data (baseado no novo funil) ──
  // No card "Finalizado" do funil contamos apenas os recentes (≤7 dias).
  const funnelData = useMemo(() => {
    return FUNNEL_STAGES.map((f) => {
      const count = periodCases.filter((c) => {
        if (f.label === 'Finalizado') return isFinalizadoRecente(c);
        return effectiveFunnel(c) === f.label;
      }).length;
      return { ...f, count };
    });
  }, [periodCases, students]);

  const maxFunnel = Math.max(...funnelData.map((f) => f.count), 1);

  // Filtro de pesquisa por nome do aluno + AC (afeta cards do Kanban e Lista)
  const matchesSearch = (c: CancellationCase) => {
    const q = searchTerm.trim().toLowerCase();
    if (q && !c.studentName.toLowerCase().includes(q)) return false;
    if (acFilter !== 'all') {
      const st = students.find((s) => s.id === c.studentId);
      const acName = (c.ac || st?.ac || '').trim();
      if (acName !== acFilter) return false;
    }
    return true;
  };

  // Filtro de ação aplicado por coluna
  const matchesColumnAction = (c: CancellationCase, fs: FunnelStage) => {
    const sel = columnActionFilter[fs];
    if (!sel || sel === 'all') return true;
    return (c.acao ?? '').trim() === sel;
  };

  // Lista de ACs disponíveis nos casos (dedupe por nome)
  const availableACs = useMemo(() => {
    const set = new Set<string>();
    displayCases.forEach((c) => {
      const st = students.find((s) => s.id === c.studentId);
      const name = (c.ac || st?.ac || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayCases, students]);

  // Lista de Ações disponíveis nos casos (dedupe)
  const availableActions = useMemo(() => {
    const set = new Set<string>();
    displayCases.forEach((c) => {
      const a = (c.acao ?? '').trim();
      if (a) set.add(a);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayCases]);

  // ── Agrupamento por coluna do novo funil ──
  // Coluna "Finalizado" mostra os 10 cards mais recentes por padrão; busca
  // local expande a lista filtrada e o botão "Ver mais" carrega mais 10.
  // Ordenação: mais recente primeiro (data de movimentação para a coluna).
  const finalizadoDateRef = (c: CancellationCase) =>
    new Date(c.movedToCurrentStageAt || c.createdAt || Date.now()).getTime();
  const casesByFunnel = (fs: FunnelStage) => {
    const list = displayCases.filter((c) => {
      if (!matchesSearch(c)) return false;
      if (!matchesColumnAction(c, fs)) return false;
      if (fs === 'Finalizado') return isFinalizadoRecente(c);
      return effectiveFunnel(c) === fs;
    });
    if (fs !== 'Finalizado') return list;
    const q = finalizadoSearch.trim().toLowerCase();
    const filtered = q
      ? list.filter((c) => c.studentName.toLowerCase().includes(q))
      : list;
    return filtered
      .sort((a, b) => finalizadoDateRef(b) - finalizadoDateRef(a))
      .slice(0, finalizadoLimit);
  };
  const totalFinalizadoRecente = displayCases.filter((c) => matchesSearch(c) && isFinalizadoRecente(c)).length;


  // Ações disponíveis (dedupe) dentro de uma coluna específica
  const actionsForColumn = (fs: FunnelStage): string[] => {
    const set = new Set<string>();
    displayCases.forEach((c) => {
      if (!matchesSearch(c)) return;
      const inCol = fs === 'Finalizado' ? isFinalizadoRecente(c) : effectiveFunnel(c) === fs;
      if (!inCol) return;
      const a = (c.acao ?? '').trim();
      if (a) set.add(a);
    });
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    // Em Distrato do Contrato, "Iniciar Tratativa" fica sempre por último
    if (fs === 'Formalização') {
      const idx = sorted.indexOf('Iniciar Tratativa');
      if (idx >= 0) {
        sorted.splice(idx, 1);
        sorted.push('Iniciar Tratativa');
      }
    }
    return sorted;
  };

  // ── Sorted list ─────────────────────────────────────────────────────
  // - showFinalizados ON  → mostra somente o Histórico (>7 dias)
  // - showFinalizados OFF → ativos + Finalizados recentes (≤7 dias)
  const sortedList = useMemo(() => {
    const base = showFinalizados
      ? displayCases.filter(isFinalizadoHistorico)
      : displayCases.filter((c) => effectiveFunnel(c) !== 'Finalizado' || isFinalizadoRecente(c));
    const filtered = base.filter(matchesSearch);
    return [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [displayCases, showFinalizados, searchTerm, acFilter, students]);

  // Badge do botão "Histórico" reflete somente os casos arquivados (>7 dias).
  const finalizadosCount = useMemo(
    () => displayCases.filter(isFinalizadoHistorico).length,
    [displayCases]
  );

  // ── Handlers ──
  const handleCloseModal = () => { setShowModal(false); setEditing(null); };

  // Gera comissão quando a reversão ocorre a partir de "Em Tratativas".
  // Base = VALOR TOTAL DO CONTRATO (independe de quanto o aluno pagou).
  //  - 1 inscrição: comissão sobre o valor total do contrato.
  //  - N inscrições: valor por inscrição = total / N; comissão sobre (qtdRevertida × valor por inscrição).
  const registerCommissionIfEligible = (caseRef: CancellationCase, partialQty?: number) => {
    const stage = getFunnelStage(caseRef);
    const allowFormalizacaoImport = stage === 'Formalização' && caseRef.externalImport === true;
    if (stage !== 'Em Execução' && !allowFormalizacaoImport) return;
    const st = getCaseStudent(caseRef);
    // Valor total do contrato: prioriza saleValue do aluno; fallback para o value do caso
    // (usado quando o caso foi criado via importação com contrato já quitado).
    const contractTotal =
      (st?.saleValue && st.saleValue > 0)
        ? st.saleValue
        : (caseRef.value && caseRef.value > 0 ? caseRef.value : 0);
    if (!contractTotal || contractTotal <= 0) return;
    const total = caseRef.quantidadeInscricoes ?? 1;
    const already = caseRef.inscricoesRevertidas ?? 0;
    const qty = partialQty ?? Math.max(1, total - already);
    const perInscricao = contractTotal / Math.max(1, total);
    const reverted = Math.round(perInscricao * qty * 100) / 100;
    const acFromCase = caseRef.ac ?? st?.ac;
    const acRow = acs.find((a) => a.name === (st?.ac ?? acFromCase));
    useCommissionsStore.getState().register({
      cancellationCaseId: `${caseRef.id}${partialQty ? `#p${(already + qty)}` : ''}`,
      studentId: caseRef.studentId,
      studentName: caseRef.studentName + (partialQty ? ` (${qty}/${total} inscrições)` : ''),
      acId: acRow?.id,
      acName: acRow?.name ?? acFromCase,
      paymentType: mapPagamentoTipoToPaymentType(caseRef.pagamentoTipo),
      revertedValue: reverted,
      product: st?.product,
      // Só é computada após aprovação da conciliação da reversão.
      pendingApproval: true,
    });

  };

  // Move card para Formalização (Distrato) mantendo o restante das inscrições para o Jurídico.
  // Não altera o status do aluno (segue com solicitação de cancelamento das remanescentes).
  const applyPartialRevert = (caseRef: CancellationCase, qty: number, extraNote: string) => {
    const now = new Date().toISOString();
    const total = caseRef.quantidadeInscricoes ?? 1;
    const already = caseRef.inscricoesRevertidas ?? 0;
    const newReverted = already + qty;
    const remaining = Math.max(0, total - newReverted);
    const noteHeader = `[Reversão parcial] ${qty} inscrição(ões) revertida(s) · ${remaining} remanescente(s) para o Jurídico.`;
    const fullNote = extraNote ? `${noteHeader} ${extraNote}` : noteHeader;
    const entry = {
      date: now,
      from: caseRef.stage,
      to: caseRef.stage,
      operationalStatus: caseRef.operationalStatus,
      note: fullNote,
    };
    const prevNotes = caseRef.notes ? `${caseRef.notes}\n\n` : '';
    updateCancellationCase(caseRef.id, {
      funnelStage: 'Formalização',
      acao: 'Iniciar Tratativa',
      responsavel: 'Jurídico',
      movedToCurrentStageAt: now,
      inscricoesRevertidas: newReverted,
      notes: prevNotes + `[${new Date(now).toLocaleString('pt-BR')}] ${fullNote}`,
      history: [...caseRef.history, entry],
    });
    // Reflete no histórico do aluno (aluno permanece com solicitação de cancelamento)
    const st = getCaseStudent(caseRef);
    if (st) {
      const studentEntry: HistoryEntry = {
        date: now,
        type: 'Sistema',
        text: `Cancelamento — ${fullNote}`,
      };
      updateStudent(st.id, { history: [...st.history, studentEntry] });
    }
    registerCommissionIfEligible(caseRef, qty);
  };

  // Executa a reversão "Sem Ajustes Financeiros" após confirmar que o aluno está em dia
  const executeRevertWithoutAdjust = (caseRef: CancellationCase, partialQty?: number) => {
    if (partialQty && partialQty < (caseRef.quantidadeInscricoes ?? 1) - (caseRef.inscricoesRevertidas ?? 0)) {
      applyPartialRevert(caseRef, partialQty, 'Reversão SEM Ajustes Financeiros — aluno em dia.');
      return;
    }
    const now = new Date().toISOString();
    // Marca o caso como Finalizado/Revertido no funil e registra histórico
    const total = caseRef.quantidadeInscricoes ?? 1;
    const entry = {
      date: now,
      from: caseRef.stage,
      to: caseRef.stage,
      operationalStatus: caseRef.operationalStatus,
      note: 'Reverter Sem Ajustes Financeiros — aluno em dia.',
    };
    updateCancellationCase(caseRef.id, {
      funnelStage: 'Finalizado',
      acao: 'Revertido',
      inscricoesRevertidas: total,
      history: [...caseRef.history, entry],
      movedToCurrentStageAt: now,
    });
    // Atualiza status do aluno e grava no histórico do aluno e GC (via store.revertCancellation)
    revertCancellation(caseRef.id);
    registerCommissionIfEligible(caseRef);
  };


  return (
    <div className="space-y-5">

      {/* ── Period + Mode Filter ───────────────────── */}
      <PeriodFilterBar
        preset={preset} setPreset={setPreset}
        customStart={customStart} setCustomStart={setCustomStart}
        customEnd={customEnd} setCustomEnd={setCustomEnd}
        mode={mode} setMode={setMode}
        variant="dashboard-cancelamentos"
      />

      {/* ── Top controls: view toggle ────────────── */}
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <LayoutGrid size={13} /> Kanban
            </button>
            <button onClick={() => setViewMode('lista')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'lista' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <List size={13} /> Lista
            </button>
          </div>
          <button
            onClick={() => setShowFinalizados((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              showFinalizados
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-card text-foreground border-border hover:bg-muted/60'
            }`}
            title={showFinalizados ? 'Voltar para casos ativos' : 'Visualizar somente casos finalizados'}
          >
            <History size={13} />
            {showFinalizados ? 'Voltar para casos ativos' : 'Histórico de finalizados'}
            <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              showFinalizados ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {finalizadosCount}
            </span>
          </button>
          <button
            onClick={() => setShowImportExternal(true)}
            className="gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border text-white border-violet-600 transition-all shadow-sm flex-row flex items-center justify-start bg-[#0022ff]"
            title="Importar aluno diretamente na aba de Cancelamentos"
          >
            <UserPlus size={13} />
            Cadastrar Cancelamento (à vista)
          </button>
          <MovementBell cases={cancellationCases} />
        </div>
      </div>

      {/* ── Dashboard KPIs ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="min-w-0 bg-card border border-border rounded-xl p-4 saas-shadow">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-primary shrink-0" />
            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wide truncate">
              Solicitação de Cancelamento
            </span>
          </div>
          <p className="kpi-value-lg text-foreground">{kpis.total}</p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate" title={`Valor total: ${formatCurrency(kpis.valueAtRisk)}`}>
            Valor total: <span className="font-semibold text-foreground">
              <span className="hidden sm:inline">{formatCurrency(kpis.valueAtRisk)}</span>
              <span className="sm:hidden">{formatCurrencyCompact(kpis.valueAtRisk)}</span>
            </span>
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">vencido + a vencer</p>
        </div>

        <div className="min-w-0 bg-emerald-50 border border-emerald-200 rounded-xl p-4 saas-shadow">
          <div className="flex items-center gap-2 mb-1">
            <RotateCcw size={14} className="text-emerald-600 shrink-0" />
            <span className="text-[11px] text-emerald-700 uppercase font-semibold tracking-wide truncate">Revertido</span>
          </div>
          <p className="text-[11px] text-emerald-700 truncate">
            <span className="font-semibold">{reversaoKpis.revertidos}</span> de {reversaoKpis.total}{' '}
            <span className="text-emerald-600">({reversaoKpis.pct}%)</span>
          </p>
          <p className="text-[10px] text-emerald-700 uppercase font-semibold tracking-wide mt-1 truncate">Valor futuro recuperado</p>
          <p className="kpi-value text-emerald-700" title={formatCurrency(reversaoKpis.valueRecovered)}>
            <span className="hidden sm:inline">{formatCurrency(reversaoKpis.valueRecovered)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(reversaoKpis.valueRecovered)}</span>
          </p>
        </div>

        <div
          className="min-w-0 bg-violet-50 border border-violet-200 rounded-xl p-4 saas-shadow cursor-pointer hover:ring-2 hover:ring-violet-300/50 transition-all"
          onClick={() => setDistratoMetricsOpen(true)}
          title="Abrir indicadores do Distrato / Jurídico"
        >
          <div className="flex items-center gap-2 mb-1">
            <Gavel size={14} className="text-violet-600 shrink-0" />
            <span className="text-[11px] text-violet-700 uppercase font-semibold tracking-wide truncate">
              Reversão Jurídico
            </span>
          </div>
          <p className="kpi-value text-violet-700">{juridicoReversaoKpis.pct}%</p>
          <p className="text-[11px] text-violet-700 truncate mt-1">
            <span className="font-semibold">{juridicoReversaoKpis.revertidos}</span> de {juridicoReversaoKpis.total} no Distrato
          </p>
          <p className="text-[10px] text-violet-600/80 mt-0.5 truncate" title={formatCurrency(juridicoReversaoKpis.valueRecovered)}>
            Recuperados:{' '}
            <span className="font-semibold">
              <span className="hidden sm:inline">{formatCurrency(juridicoReversaoKpis.valueRecovered)}</span>
              <span className="sm:hidden">{formatCurrencyCompact(juridicoReversaoKpis.valueRecovered)}</span>
            </span>
          </p>
        </div>

        <div className="min-w-0 bg-rose-50 border border-rose-200 rounded-xl p-4 saas-shadow">
          <div className="flex items-center gap-2 mb-1">
            <Ban size={14} className="text-rose-600 shrink-0" />
            <span className="text-[11px] text-rose-700 uppercase font-semibold tracking-wide truncate">Cancelado</span>
          </div>
          <p className="text-[11px] text-rose-700 truncate">
            <span className="font-semibold">{kpis.cancelled}</span> de {kpis.total} <span className="text-rose-600">({kpis.total > 0 ? Math.round((kpis.cancelled / kpis.total) * 100) : 0}%)</span>
          </p>
          <p className="text-[10px] text-rose-700 uppercase font-semibold tracking-wide mt-1 truncate">Valor perdido</p>
          <p className="kpi-value text-rose-700" title={formatCurrency(kpis.valueLost)}>
            <span className="hidden sm:inline">{formatCurrency(kpis.valueLost)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(kpis.valueLost)}</span>
          </p>
        </div>
      </div>

      {/* Processing Speed */}
      <ProcessingSpeedCard cancellationCases={periodCases} compact={false} />

      {/* Motivos Panel */}
      {motivoStats.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 saas-shadow">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Award size={13} />
            Motivos de Cancelamento
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {motivoStats.map((m) => {
              const pct = totalMotivoCount > 0 ? Math.round((m.count / totalMotivoCount) * 100) : 0;
              return (
                <div key={m.motivo} className="flex gap-3 p-3 bg-muted/40 rounded-lg border border-border/50">
                  <div className="flex-1">
                    <p className="text-[11px] font-semibold text-foreground">{m.motivo}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{m.count} caso{m.count !== 1 ? 's' : ''} • {pct}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Funnel chart */}
      <div className="bg-card border border-border rounded-xl p-5 saas-shadow">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4">Funil de cancelamentos</h3>
        <div className="space-y-2">
          {funnelData.map((f) => {
            const pct = kpis.total > 0 ? Math.round((f.count / kpis.total) * 100) : 0;
            const barWidth = kpis.total > 0 ? Math.max(8, Math.round((f.count / maxFunnel) * 100)) : 8;
            return (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-[11px] font-medium text-muted-foreground w-28 text-right shrink-0">{f.displayLabel}</span>
                <div className="flex-1 h-8 bg-muted/40 rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${f.color} rounded-lg transition-all duration-700 ease-out flex items-center`}
                    style={{ width: `${barWidth}%` }}
                  >
                    {barWidth > 20 && (
                      <span className="text-[11px] font-bold text-white pl-3">{f.count}</span>
                    )}
                  </div>
                  {barWidth <= 20 && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-foreground" style={{ left: `calc(${barWidth}% + 8px)` }}>{f.count}</span>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground w-10 text-right shrink-0">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pesquisa por nome do aluno (filtra cards do funil/lista) */}
      <div className="bg-card border border-border rounded-xl p-3 saas-shadow flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0 ml-1"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Pesquisar por nome do aluno..."
          className="flex-1 bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
            title="Limpar pesquisa"
          >
            Limpar
          </button>
        )}
        <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-border">
          <User size={12} className="text-muted-foreground shrink-0" />
          <select
            value={acFilter}
            onChange={(e) => setAcFilter(e.target.value)}
            className="bg-transparent outline-none text-xs text-foreground cursor-pointer pr-1"
            title="Filtrar por Assessor de Conta"
          >
            <option value="all">Todos os assessores</option>
            {availableACs.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          {acFilter !== 'all' && (
            <button
              onClick={() => setAcFilter('all')}
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 rounded-md hover:bg-muted transition-colors"
              title="Limpar filtro de AC"
            >
              ×
            </button>
          )}
        </div>
      </div>


      {/* Mode-specific banner */}
      {mode === 'historico' && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <History size={13} />
          <span>
            <strong>Histórico:</strong> posição real dos casos em{' '}
            {period.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </div>
      )}
      {mode === 'performance' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
          <Clock size={13} className="text-blue-600 shrink-0" />
          <span>
            <strong>Performance:</strong> acompanhamento em tempo real dos casos no período
          </span>
        </div>
      )}

      {/* ── KANBAN VIEW (5 colunas fixas na mesma direção) ───────────────── */}
      {viewMode === 'kanban' && (
        <div className="pb-4">
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 min-w-[1200px] items-start">

            {FUNNEL_STAGES.map((f) => {
              const cards = casesByFunnel(f.label);
              const isFinalizado = f.label === 'Finalizado';
              const isOver = dragOverFunnel === f.label;
              return (
                <div key={f.label} className="flex flex-col min-w-0">
                  <div className="sticky top-14 z-20 shadow-sm">
                    <div className={`flex items-center justify-between gap-2 px-3 py-2 h-11 rounded-t-xl ${f.color} text-white`}>
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="shrink-0">{f.icon}</span>
                        <span className="text-[11px] font-bold uppercase tracking-wide whitespace-nowrap truncate" title={f.displayLabel}>
                          {f.displayLabel}
                        </span>
                      </div>

                      <span className="shrink-0 text-[10px] bg-white/20 px-2 py-0.5 rounded-full">
                        {isFinalizado ? totalFinalizadoRecente : cards.length}
                      </span>
                    </div>
                    {/* Faixa de responsável — altura fixa em todas as colunas */}
                    {(f.label === 'Entrada' || f.label === 'Em Execução') ? (
                      <div
                        className={`flex items-center justify-center gap-1 h-6 px-2 text-[10px] font-medium border-b border-border/40 ${
                          f.label === 'Entrada'
                            ? 'bg-blue-50/80 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'bg-amber-50/80 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        }`}
                        title="Responsável: Time Financeiro"
                      >
                        <DollarSign size={10} strokeWidth={2.5} />
                        Time Financeiro
                      </div>
                    ) : (f.label === 'Formalização' || f.label === 'Pendente') ? (
                      <div
                        className="flex items-center justify-center gap-1.5 h-6 px-2 text-[10px] font-medium border-b border-border/40 bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
                        title={
                          f.label === 'Formalização'
                            ? `Responsável: Jurídico · Reversão ${juridicoReversaoKpis.pct}% (${juridicoReversaoKpis.revertidos}/${juridicoReversaoKpis.total})`
                            : 'Responsável: Jurídico'
                        }
                      >
                        <Gavel size={10} strokeWidth={2.5} />
                        Jurídico
                        {f.label === 'Formalização' && (
                          <span className="ml-0.5 px-1.5 py-0 rounded-full bg-violet-600/15 text-violet-700 font-bold tabular-nums">
                            {juridicoReversaoKpis.pct}%
                          </span>
                        )}
                      </div>
                    ) : (
                      isFinalizado ? (
                        <div className="h-6 border-b border-border/40 bg-muted/40 flex items-center justify-center px-2 overflow-hidden">
                          <p className="text-[9px] text-muted-foreground leading-none text-center">
                            A coluna exibe apenas os 10 últimos finalizados.&nbsp;
                          </p>
                        </div>
                      ) : (
                        <div className="h-6 border-b border-border/40 bg-muted/40" aria-hidden />
                      )
                    )}
                    {/* Faixa de filtro — altura fixa; placeholder nas colunas sem filtro */}
                    {(f.label === 'Em Execução' || f.label === 'Formalização' || f.label === 'Pendente') ? (() => {
                      const opts = actionsForColumn(f.label);
                      const sel = columnActionFilter[f.label] ?? 'all';
                      return (
                        <div className="flex items-center gap-1.5 h-8 px-2 bg-card border border-t-0 border-border">
                          <Clock size={11} className="text-muted-foreground shrink-0" />
                          <select
                            value={sel}
                            onChange={(e) => setColumnActionFilter((prev) => ({ ...prev, [f.label]: e.target.value }))}
                            className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-foreground cursor-pointer"
                            title={`Filtrar ações — ${f.displayLabel}`}
                            disabled={opts.length === 0}
                          >
                            <option value="all">Todas as ações{opts.length === 0 ? ' (nenhuma)' : ''}</option>
                            {opts.map((name) => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </select>
                          {sel !== 'all' && (
                            <button
                              onClick={() => setColumnActionFilter((prev) => ({ ...prev, [f.label]: 'all' }))}
                              className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded hover:bg-muted"
                              title="Limpar"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })() : (
                      <div className={`bg-card border border-t-0 border-border ${isFinalizado ? 'h-8 px-2 flex items-center gap-1.5' : 'h-8'}`} aria-hidden={!isFinalizado}>
                        {isFinalizado && (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                            <input
                              type="text"
                              value={finalizadoSearch}
                              onChange={(e) => { setFinalizadoSearch(e.target.value); setFinalizadoLimit(10); }}
                              placeholder="Pesquisar em Finalizado..."
                              className="flex-1 bg-transparent outline-none text-[10px] text-foreground placeholder:text-muted-foreground"
                            />
                            {finalizadoSearch && (
                              <button
                                onClick={() => { setFinalizadoSearch(''); setFinalizadoLimit(10); }}
                                className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded hover:bg-muted"
                                title="Limpar"
                              >
                                ×
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>


                  <div
                    onDragOver={(e) => !isHistoricalMode && handleDragOver(e, f.label)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => !isHistoricalMode && handleDrop(e, f.label)}
                    className={`flex-1 space-y-2 min-h-[200px] rounded-b-xl p-3 border border-t-0 border-dashed transition-colors ${
                      isOver ? 'bg-primary/10 border-primary' : 'bg-muted/30 border-border/50'
                    }`}
                  >
                    {cards.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground/50 text-center py-6">vazio</p>
                    ) : (
                      <>
                        {cards.map((c) => (
                          <CancellationCard
                            key={c.id}
                            c={c}
                            student={getCaseStudent(c)}
                            funnelStage={f.label}
                            readOnly={isHistoricalMode}
                            draggable={!isHistoricalMode}
                            onDragStart={handleDragStart}
                            onRevert={handleRevert}
                            onCancel={handleFinalize}
                            onSendToLegal={(c) => setSendToLegalCase(c)}
                            onMoveToTratativas={handleMoveToTratativas}
                            onView={handleView}
                            onDelete={(c) => setDeleteId(c.id)}
                            onChangeAcao={handleChangeAcao}
                            onChangeResponsavel={handleChangeResponsavel}
                            onConciliar={undefined}
                            podeConciliar={false}
                            onRenegotiate={(cc) => {
                              const st = getCaseStudent(cc);
                              if (!st) { window.alert('Aluno não encontrado para renegociação.'); return; }
                              setRenegBanner({
                                title: 'Renegociação Jurídico — ajuste financeiro',
                                body: 'Ajuste o fluxo de parcelas para refletir a renegociação acordada com o aluno. Ao fechar, o caso será marcado como Revertido.',
                              });
                              setRenegStudent(st);
                              setRenegSourceCaseId(cc.id);
                            }}
                            onMultaPaga={(cc, valor) => setMultaPagaCase({ caseRef: cc, valor })}
                            onFollowCancellation={(cc) => {
                              if (!window.confirm('Devolver este caso ao Jurídico para prosseguir com o cancelamento?')) return;
                              const now = new Date().toISOString();
                              updateCancellationCase(cc.id, {
                                funnelStage: 'Formalização',
                                acao: 'Iniciar Tratativa',
                                responsavel: 'Jurídico',
                                movedToCurrentStageAt: now,
                                history: [
                                  ...cc.history,
                                  {
                                    date: now,
                                    from: cc.stage,
                                    to: cc.stage,
                                    operationalStatus: cc.operationalStatus,
                                    note: 'Financeiro decidiu seguir com o cancelamento — devolvido ao Jurídico (Distrato do Contrato).',
                                  },
                                ],
                              });
                            }}
                          />
                        ))}
                        {isFinalizado && (
                          (() => {
                            const q = finalizadoSearch.trim().toLowerCase();
                            const total = displayCases.filter((c) => matchesSearch(c) && isFinalizadoRecente(c) && (q ? c.studentName.toLowerCase().includes(q) : true)).length;
                            return cards.length < total ? (
                              <button
                                type="button"
                                onClick={() => setFinalizadoLimit((prev) => prev + 10)}
                                className="w-full mt-1 py-2 rounded-lg border border-border bg-card text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                              >
                                Ver mais
                              </button>
                            ) : null;
                          })()
                        )}
                      </>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
          
        </div>
      )}

      {/* ── LISTA VIEW ───────────────────────────────────────────────────── */}
      {viewMode === 'lista' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden saas-shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Nome</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">WhatsApp</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Status</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Motivo</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Ação</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Responsável</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Solicitado</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Há</th>
                  <th className="text-left px-3 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Valor</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sortedList.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-10 text-muted-foreground">
                      Nenhum caso encontrado para o período e modo selecionados.
                    </td>
                  </tr>
                ) : (
                  sortedList.map((c) => {
                    const funnelStage = getFunnelStage(c);
                    const cfg = FUNNEL_STAGES.find((f) => f.label === funnelStage)!;
                    const totalDays = daysSince(c.createdAt);
                    const student = getCaseStudent(c);
                    const open = computeOpenValue(student);
                    const valorTotal = open.total > 0 ? open.total : (c.value ?? 0);
                    const allowedAcoes = ACTIONS_BY_FUNNEL[funnelStage];
                    const isFinal = funnelStage === 'Finalizado';
                    const isFixedActionRow = FIXED_ACTION_STAGES.includes(funnelStage);
                    const whatsapp = c.studentWhatsapp || student?.whatsapp || '';
                    return (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-foreground">{c.studentName}</td>
                        <td className="px-3 py-3 text-muted-foreground">{whatsapp || '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${cfg.color} inline-block shrink-0`} />
                            <select
                              disabled={isHistoricalMode}
                              value={funnelStage}
                              onChange={(e) => {
                                const target = e.target.value as FunnelStage;
                                if (target === funnelStage) return;
                                // Mesma regra do drag-and-drop:
                                // - exigir motivo ao sair de "Entrada"
                                // - abrir modal de finalização ao mover para "Finalizado"
                                if (target !== 'Entrada' && !c.motivoCancelamento) {
                                  setPendingMotivoCase({ caseRef: c, targetFunnel: target });
                                  return;
                                }
                                if (target === 'Finalizado' && funnelStage === 'Formalização' && !c.finalChecklist?.preenchidoAt) {
                                  setChecklistCase(c);
                                  return;
                                }
                                if (target === 'Finalizado') {
                                  setFinalizeAction({ caseRef: c, type: 'cancelar' });
                                  return;
                                }
                                moveCaseToFunnel(c, target);
                              }}
                              className="text-[10px] px-1.5 py-1 rounded border border-border bg-card text-foreground"
                              title="Alterar status do funil"
                            >
                              {FUNNEL_STAGES.map((f) => (
                                <option key={f.label} value={f.label}>{f.displayLabel}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {c.motivoCancelamento ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                              {c.motivoCancelamento}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3">
                          {allowedAcoes.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground italic">—</span>
                          ) : isFixedActionRow ? (
                            <span
                              className="inline-block text-[10px] px-1.5 py-1 rounded border border-border bg-muted/50 text-foreground font-medium"
                              title="Ação fixa para esta etapa"
                            >
                              {allowedAcoes[0]}
                            </span>
                          ) : (
                            <select
                              disabled={isHistoricalMode}
                              value={c.acao && allowedAcoes.includes(c.acao) ? c.acao : ''}
                              onChange={(e) => handleChangeAcao(c, e.target.value as CancellationAction)}
                              className="text-[10px] px-1.5 py-1 rounded border border-border bg-card text-foreground"
                            >
                              <option value="">— Selecionar —</option>
                              {allowedAcoes.map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                            </select>
                          )}
                          {c.acao === 'Ligação Agendada' && c.ligacaoAgendadaAt && (
                            <div className="mt-1 text-[10px] font-medium text-sky-700">
                              {new Date(c.ligacaoAgendadaAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {(funnelStage === 'Entrada' || funnelStage === 'Em Execução') ? (
                            <span className="text-[10px] px-1.5 py-1 rounded border border-border bg-slate-100 text-slate-700 font-medium">Financeiro</span>
                          ) : (funnelStage === 'Formalização' || funnelStage === 'Pendente') ? (
                            <span className="text-[10px] px-1.5 py-1 rounded border border-border bg-slate-100 text-slate-700 font-medium">Jurídico</span>
                          ) : (
                            <select
                              disabled={isHistoricalMode}
                              value={c.responsavel ?? ''}
                              onChange={(e) => handleChangeResponsavel(c, e.target.value as CancellationResponsavel)}
                              className="text-[10px] px-1.5 py-1 rounded border border-border bg-card text-foreground"
                            >
                              <option value="">— Selecionar —</option>
                              {RESPONSAVEIS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{formatDateFull(c.createdAt)}</td>
                        <td className="px-3 py-3 text-muted-foreground">Há {totalDays} {totalDays === 1 ? 'dia' : 'dias'}</td>
                        <td className="px-3 py-3 font-medium text-foreground">
                          {valorTotal > 0 ? formatCurrency(valorTotal) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            {!isHistoricalMode && !isFinal && (
                              <>
                                <button
                                  onClick={() => handleRevert(c)}
                                  className="flex items-center gap-1 p-1.5 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all"
                                  title="Reverter"
                                >
                                  <RotateCcw size={12} />
                                </button>
                                <button
                                  onClick={() => handleFinalize(c)}
                                  className="flex items-center gap-1 p-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                                  title="Cancelar"
                                >
                                  <X size={12} />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => handleView(c)}
                              className="flex items-center gap-1 p-1.5 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all"
                              title="Visualizar informações"
                            >
                              <Eye size={12} />
                            </button>
                            <button
                              onClick={() => setHistoryCase(c)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                              title="Histórico"
                            >
                              <History size={12} />
                            </button>
                            {!isHistoricalMode && (
                              <button
                                onClick={() => setDeleteId(c.id)}
                                className="p-1.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all"
                                title="Excluir caso (não remove o aluno da carteira)"
                              >
                                <Trash2 size={12} />
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
          {sortedList.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-[11px] text-muted-foreground bg-muted/20">
              {sortedList.length} caso{sortedList.length !== 1 ? 's' : ''} listado{sortedList.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showModal && <CancellationModal existing={editing} onClose={handleCloseModal} />}
      {showImportExternal && <ImportExternalCancellationModal onClose={() => setShowImportExternal(false)} />}
      {deleteId && (() => {
        const alvo = cancellationCases.find((c) => c.id === deleteId);
        const aluno = alvo
          ? (alvo.studentId ? students.find((s) => s.id === alvo.studentId) : undefined)
            ?? students.find((s) => s.cancellationCaseId === alvo.id)
          : undefined;
        const statusRestaurado = (aluno as any)?.statusAntesCancelamento || 'o status calculado pelas parcelas';
        const naEntrada = alvo ? getFunnelStage(alvo) === 'Entrada' : false;
        return (
          <DeleteModal
            title="Excluir Registro?"
            description={
              <>
                <p className="text-center">Esta ação não pode ser desfeita.</p>
                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
                  <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide">O que acontece ao excluir</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>O card {alvo ? <strong>de {alvo.studentName}</strong> : null} sai da aba Cancelamentos{naEntrada ? ' (coluna Entrada)' : ''}.</li>
                    <li>O aluno volta para a carteira do assessor com o status anterior à solicitação{aluno ? <> (<strong>{statusRestaurado}</strong>)</> : null}.</li>
                    <li>O selo “Solicitação Cancelamento” é removido do aluno.</li>
                    <li>Nenhum dado financeiro do contrato é alterado; o histórico do aluno registra a exclusão.</li>
                  </ul>
                </div>
              </>
            }
            onConfirm={() => { deleteCancellationCase(deleteId); setDeleteId(null); }}
            onClose={() => setDeleteId(null)}
          />
        );
      })()}
      {historyCase && <CaseHistoryModal c={historyCase} onClose={() => setHistoryCase(null)} />}
      {historyStudent && <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />}
      {viewingExternal && (
        <ExternalCancellationViewModal caseRef={viewingExternal} onClose={() => setViewingExternal(null)} />
      )}
      {viewingCase && (() => {
        const c = viewingCase.caseRef;
        const st = viewingCase.student;
        const funnelStage = getFunnelStage(c);
        const cfg = FUNNEL_STAGES.find((f) => f.label === funnelStage);
        // Etiquetas: combina tags do aluno + tags específicas do caso
        const tagIds = Array.from(new Set([...(st.tags ?? []), ...(c.tags ?? [])]));
        const tags = tagIds
          .map((ref) => studentTags.find((t) => t.id === ref || t.name.toLowerCase() === ref.toLowerCase())
            ?? { id: ref, name: ref, color: 'slate' })
          .filter((t) => t.name && t.name.toLowerCase() !== 'recompra');

        return (
          <StudentViewModal
            student={st}
            onClose={() => setViewingCase(null)}
            headerBadge={cfg ? (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg text-white ${cfg.color}`}>
                {funnelStage}
              </span>
            ) : null}
            extraSections={
              <>
                {/* Etiquetas */}
                <div className="bg-muted/30 border border-border rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">Etiquetas</h3>
                  {tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma etiqueta atribuída.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="text-[10px] font-semibold px-2 py-1 rounded-lg border"
                          style={getTagStyle(tag.color)}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Motivo do Cancelamento */}
                <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-4">
                  <h3 className="text-xs font-semibold text-rose-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                    <Ban size={12} /> Motivo do Cancelamento
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Motivo</p>
                      <p className="text-sm text-foreground font-medium">
                        {c.motivoCancelamento || <span className="text-muted-foreground">Não informado</span>}
                      </p>
                    </div>
                    {c.descricaoCancelamento && (
                      <div>
                        <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Descrição</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{c.descricaoCancelamento}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-rose-200/60">
                      <div>
                        <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Solicitado em</p>
                        <p className="text-xs text-foreground font-medium">{formatDateFull(c.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Etapa atual</p>
                        <p className="text-xs text-foreground font-medium">{funnelStage}</p>
                      </div>
                      {c.responsavel && (
                        <div>
                          <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Responsável</p>
                          <p className="text-xs text-foreground font-medium">{c.responsavel}</p>
                        </div>
                      )}
                      {c.acao && (
                        <div>
                          <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Ação</p>
                          <p className="text-xs text-foreground font-medium">{c.acao}</p>
                        </div>
                      )}
                      {c.dentro7Dias !== undefined && (
                        <div>
                          <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Dentro de 7 dias (CDC)</p>
                          <p className="text-xs text-foreground font-medium">{c.dentro7Dias ? 'Sim' : 'Não'}</p>
                        </div>
                      )}
                      {c.com30DiasAntecedencia !== undefined && (
                        <div>
                          <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Antecedência</p>
                          <p className="text-xs text-foreground font-medium">
                            {c.com30DiasAntecedencia ? 'Sim, mais de 30D' : 'Não, menos de 30D'}
                          </p>
                        </div>
                      )}
                      {c.multaValue != null && c.multaPercent != null && (
                        <div>
                          <p className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Multa de cancelamento</p>
                          <p className="text-xs text-foreground font-medium">
                            {c.multaPercent}% • {formatCurrency(c.multaValue)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {c.conciliacaoReprovadaMotivo && (
                  <div className="bg-rose-50 border border-rose-300 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-rose-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                      <Ban size={12} /> Conciliação Reprovada
                    </h3>
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {c.conciliacaoReprovadaMotivo}
                    </p>
                    <p className="text-[10px] text-rose-700 mt-2">
                      Reprovado por {c.conciliacaoReprovadaPorNome ?? '—'}
                      {c.conciliacaoReprovadaAt ? ` em ${formatDateFull(c.conciliacaoReprovadaAt)}` : ''}
                    </p>
                  </div>
                )}
                {(c.notes && c.notes.trim().length > 0) && (
                  <div className="bg-violet-50/40 border border-violet-200 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-violet-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                      <Info size={12} /> Observações do Caso
                    </h3>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{c.notes}</p>
                  </div>
                )}
                {/* Observações do Jurídico (última anotação salva) */}
                {c.legalNotes && c.legalNotes.trim().length > 0 && (
                  <div className="bg-indigo-50/40 border border-indigo-200 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-indigo-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                      <Info size={12} /> Observações do Jurídico
                    </h3>
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{c.legalNotes}</p>
                    {c.legalNotesUpdatedAt && (
                      <p className="text-[10px] text-indigo-700 mt-2">
                        Atualizado em {formatDateFull(c.legalNotesUpdatedAt)}
                      </p>
                    )}
                  </div>
                )}
                {/* Observações manuais + anexos (Formalização / Pendente / Finalizado) */}
                {(funnelStage === 'Formalização' || funnelStage === 'Pendente' || funnelStage === 'Finalizado') && (
                  <CaseNotesPanel caseRef={c} />
                )}
                {/* Histórico completo do caso (todas as anotações registradas por assessor e jurídico) */}
                {c.history && c.history.filter((h) => h.note && h.note.trim().length > 0).length > 0 && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-slate-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                      <Info size={12} /> Histórico de Observações
                    </h3>
                    <ol className="space-y-2">
                      {[...c.history]
                        .filter((h) => h.note && h.note.trim().length > 0)
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .map((h, idx) => (
                          <li key={`${h.date}-${idx}`} className="border-l-2 border-slate-300 pl-3">
                            <p className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
                              {formatDateFull(h.date)} · {h.from} → {h.to}
                            </p>
                            <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed mt-0.5">{translateFunnelNames(h.note ?? '')}</p>
                          </li>
                        ))}
                    </ol>
                  </div>
                )}

              </>
            }
          />
        );
      })()}
      {editStudentForCase && (
        <CancellationStudentEditModal
          student={editStudentForCase.student}
          caseRef={editStudentForCase.caseRef}
          onClose={() => setEditStudentForCase(null)}
        />
      )}
      {pendingMotivoCase && (
        <MotivoPromptModal
          caseRef={pendingMotivoCase.caseRef}
          targetFunnel={pendingMotivoCase.targetFunnel}
          onCancel={() => setPendingMotivoCase(null)}
          onConfirm={(motivo, descricao) => {
            updateCancellationCase(pendingMotivoCase.caseRef.id, {
              motivoCancelamento: motivo,
              descricaoCancelamento: descricao || undefined,
            });
            // Aplica o movimento depois de salvar o motivo
            const updated = { ...pendingMotivoCase.caseRef, motivoCancelamento: motivo };
            moveCaseToFunnel(updated, pendingMotivoCase.targetFunnel);
            setPendingMotivoCase(null);
          }}
        />
      )}
      {revertChoice && (() => {
        const st = getCaseStudent(revertChoice);
        const open = computeOpenValue(st);
        const overdueCount = st
          ? st.installments.filter((i) => !i.paid && new Date(i.dueDate) < new Date(new Date().setHours(0, 0, 0, 0))).length
          : 0;
        const isFormalizacao = getFunnelStage(revertChoice) === 'Formalização';
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        void open;
        // Troca de turma escolhida no passo anterior (se houver)
        const troca = pendingClassChange && pendingClassChange.caseId === revertChoice.id ? pendingClassChange : null;
        const trocaSuffix = troca
          ? ` | TROCA DE TURMA: nova turma "${troca.novaTurma}", taxa ${troca.taxaPct}% (${formatCurrency(troca.taxaValor)})`
          : '';
        const registerTrocaConciliacao = (contexto: string) => {
          if (!troca) return;
          registrarConciliacao({
            tipo: 'cancelamento',
            studentId: revertChoice.studentId,
            studentName: revertChoice.studentName,
            ac: revertChoice.ac || st?.ac,
            resumo: `Reversão com TROCA DE TURMA — nova turma "${troca.novaTurma}" • Taxa: ${troca.taxaPct}% (${formatCurrency(troca.taxaValor)})`,
            antes: {},
            depois: { trocaTurma: { novaTurma: troca.novaTurma, taxaPercent: troca.taxaPct, taxaValor: troca.taxaValor } },
            relatedCaseId: revertChoice.id,
            autorObservacao: `Troca de turma solicitada durante ${contexto}.\nNova turma: ${troca.novaTurma}\nTaxa: ${troca.taxaPct}% (${formatCurrency(troca.taxaValor)}).`,
          });
        };
        return (
          <RevertChoiceModal
            caseRef={revertChoice}
            student={st}
            overdueCount={overdueCount}
            isFormalizacao={isFormalizacao}
            onClose={() => { setRevertChoice(null); setPendingPartialRevert(null); setPendingClassChange(null); }}
            onRevertWithoutAdjustNoChanges={() => {
              const partial = pendingPartialRevert && pendingPartialRevert.caseId === revertChoice.id ? pendingPartialRevert.qty : undefined;
              registerTrocaConciliacao('Reverter SEM Ajustes Financeiros');
              executeRevertWithoutAdjust(revertChoice, partial);
              setRevertChoice(null);
              setPendingPartialRevert(null);
              setPendingClassChange(null);
            }}
            onRevertWithoutAdjustWithChanges={(observacoes) => {
              const partial = pendingPartialRevert && pendingPartialRevert.caseId === revertChoice.id ? pendingPartialRevert.qty : undefined;
              registerTrocaConciliacao('Reverter SEM Ajustes (Com Alterações)');
              // 1) Envia o ajuste apontado nas observações para a aba Conciliação
              registrarConciliacao({
                tipo: 'cancelamento',
                studentId: revertChoice.studentId,
                studentName: revertChoice.studentName,
                ac: revertChoice.ac || st?.ac,
                resumo: (partial ? `Reversão parcial (${partial} inscrição(ões)) com ajuste financeiro a conciliar` : 'Reversão de cancelamento com ajuste financeiro a conciliar') + trocaSuffix,
                antes: {},
                depois: {},
                relatedCaseId: revertChoice.id,
                autorObservacao: observacoes + (trocaSuffix ? `\n${trocaSuffix}` : ''),
              });
              if (partial) {
                applyPartialRevert(revertChoice, partial, `SEM Ajustes (Com Alterações) — enviado para Conciliação. Obs.: ${observacoes}${trocaSuffix}`);
                setRevertChoice(null);
                setPendingPartialRevert(null);
                setPendingClassChange(null);
                return;
              }
              const now = new Date().toISOString();
              const totalInsc = revertChoice.quantidadeInscricoes ?? 1;
              updateCancellationCase(revertChoice.id, {
                funnelStage: 'Finalizado',
                acao: 'Revertido',
                inscricoesRevertidas: totalInsc,
                history: [
                  ...revertChoice.history,
                  {
                    date: now,
                    from: revertChoice.stage,
                    to: revertChoice.stage,
                    operationalStatus: revertChoice.operationalStatus,
                    note: `Reverter SEM Ajustes (Com Alterações) — enviado para Conciliação. Obs.: ${observacoes}${trocaSuffix}`,
                  },
                ],
                movedToCurrentStageAt: now,
              });
              revertCancellation(revertChoice.id);
              registerCommissionIfEligible(revertChoice);
              setRevertChoice(null);
              setPendingPartialRevert(null);
              setPendingClassChange(null);
            }}
            onOpenRenegotiation={() => {
              const partial = pendingPartialRevert && pendingPartialRevert.caseId === revertChoice.id ? pendingPartialRevert.qty : undefined;
              registerTrocaConciliacao('Reverter COM Ajustes Financeiros');
              // ── Hipóteses para Reversão Parcial COM Ajustes Financeiros ──
              // Compara o valor pago (entrada + parcelas pagas) com o valor contratual
              // proporcional às inscrições que estão sendo revertidas agora.
              //   • Se pago ≥ valor das inscrições revertidas → sem ajuste financeiro
              //     (o excedente será tratado no cancelamento das remanescentes).
              //   • Caso contrário → abre o fluxo de renegociação (FinancialModal)
              //     para ajustar o saldo restante.
              if (partial && st) {
                const totalInsc = revertChoice.quantidadeInscricoes ?? 1;
                const totalContract = st.saleValue ?? 0;
                const valorPorInscricao = totalInsc > 0 ? totalContract / totalInsc : 0;
                const valorInscricoesRevertidas = Math.round(valorPorInscricao * partial * 100) / 100;
                const entrada = Number(st.downPayment) || 0;
                const parcelasPagas = (st.installments ?? [])
                  .filter((i) => i.paid)
                  .reduce((s, i) => s + (Number((i as { paidValue?: number }).paidValue) || i.value || 0), 0);
                const pagoTotal = Math.round((entrada + parcelasPagas) * 100) / 100;
                if (pagoTotal >= valorInscricoesRevertidas && valorInscricoesRevertidas > 0) {
                  const msg =
                    `Reversão parcial SEM ajuste financeiro necessário.\n\n` +
                    `• ${partial} inscrição(ões) revertida(s) = ${formatCurrency(valorInscricoesRevertidas)}\n` +
                    `• Entrada + Total pago = ${formatCurrency(pagoTotal)}\n\n` +
                    `Como o valor pago é maior/igual ao valor das inscrições revertidas, ` +
                    `não há saldo a ajustar. O restante seguirá para o Jurídico (Distrato do Contrato).`;
                  window.alert(msg);
                  applyPartialRevert(
                    revertChoice,
                    partial,
                    `COM Ajustes Financeiros — sem ajuste necessário (pago ${formatCurrency(pagoTotal)} ≥ ${formatCurrency(valorInscricoesRevertidas)} da(s) inscrição(ões) revertida(s)).`,
                  );
                  setRevertChoice(null);
                  setPendingPartialRevert(null);
                  setPendingClassChange(null);
                  return;
                }
                const saldoAPagar = Math.max(0, Math.round((valorInscricoesRevertidas - pagoTotal) * 100) / 100);
                // Abre prompt de multa contratual + encargos ANTES de ir para o FinancialModal.
                // A multa é calculada sobre o VALOR TOTAL do contrato (não sobre o proporcional
                // das inscrições revertidas) — a soma vai integrar o saldo a parcelar.
                const caseRef = revertChoice;
                const stRef = st;
                setPartialAdjustPrompt({
                  studentName: caseRef.studentName,
                  totalContract,
                  saldoBase: saldoAPagar,
                  valorRevertidas: valorInscricoesRevertidas,
                  pagoTotal,
                  partial,
                  totalInscricoes: totalInsc,
                  onCancel: () => setPartialAdjustPrompt(null),
                  onConfirm: (multaValue, encargos, multaPct) => {
                    const totalSaldo = Math.round((saldoAPagar + multaValue + encargos) * 100) / 100;
                    // Persiste multa (%) e valor no caso para refletir corretamente na Conciliação.
                    updateCancellationCase(caseRef.id, {
                      multaPercent: multaPct,
                      multaValue,
                      cancellationFineValue: multaValue,
                    });
                    setRenegBanner({
                      title: 'Reversão parcial COM ajuste financeiro',
                      body:
                        `• ${partial} inscrição(ões) revertida(s) = ${formatCurrency(valorInscricoesRevertidas)}\n` +
                        `• Entrada + Total pago = ${formatCurrency(pagoTotal)}\n` +
                        `• Saldo das inscrições revertidas: ${formatCurrency(saldoAPagar)}\n` +
                        (multaValue > 0
                          ? `• Multa contratual (${multaPct}% sobre ${formatCurrency(totalContract)} — valor total do contrato): ${formatCurrency(multaValue)}\n`
                          : '') +
                        (encargos > 0 ? `• Encargos/juros: ${formatCurrency(encargos)}\n` : '') +
                        `\n➜ TOTAL a parcelar: ${formatCurrency(totalSaldo)}\n\n` +
                        `Ajuste o fluxo de parcelas para refletir este saldo.`,
                    });
                    setRenegStudent(stRef);
                    setRenegSourceCaseId(caseRef.id);
                    setRenegSuggestedTotal(totalSaldo);
                    setPartialAdjustPrompt(null);
                    setRevertChoice(null);
                    setPendingClassChange(null);
                  },
                });
                return;
              }
              if (isFormalizacao) {
                // Fluxo Distrato → move card para Em Tratativas com ação "Renegociação Jurídico"
                const now = new Date().toISOString();
                updateCancellationCase(revertChoice.id, {
                  funnelStage: 'Em Execução',
                  acao: 'Renegociação Jurídico',
                  responsavel: 'Jurídico',
                  history: [
                    ...revertChoice.history,
                    {
                      date: now,
                      from: revertChoice.stage,
                      to: revertChoice.stage,
                      operationalStatus: revertChoice.operationalStatus,
                      note: 'Reverter COM Ajustes Financeiros — movido para Em Tratativas (Renegociação Jurídico).',
                    },
                  ],
                  movedToCurrentStageAt: now,
                });
              } else if (st) {
                setRenegStudent(st);
                setRenegSourceCaseId(revertChoice.id);
                // pendingPartialRevert é preservado para tratar no fechamento do FinancialModal
              }
              setRevertChoice(null);
              setPendingClassChange(null);
            }}
          />
        );
      })()}

      {classChangePrompt && (() => {
        const c = classChangePrompt;
        const st = getCaseStudent(c);
        const contractValue = st?.saleValue ?? 0;
        return (
          <ClassChangePromptModal
            caseRef={c}
            contractValue={contractValue}
            onClose={() => { setClassChangePrompt(null); setPendingPartialRevert(null); setPendingClassChange(null); }}
            onNo={() => {
              setPendingClassChange(null);
              setClassChangePrompt(null);
              setRevertChoice(c);
            }}
            onYes={(novaTurma, taxaPct, taxaValor) => {
              // Guarda a troca de turma e abre o menu de ajustes financeiros.
              // O registro em Conciliação e a finalização acontecem no fluxo
              // COM/SEM ajustes financeiros (RevertChoiceModal), incluindo os dados da troca.
              setPendingClassChange({ caseId: c.id, novaTurma, taxaPct, taxaValor });
              setClassChangePrompt(null);
              setRevertChoice(c);
            }}
          />
        );
      })()}

      {revertQtyPrompt && (() => {
        const total = revertQtyPrompt.quantidadeInscricoes ?? 1;
        const already = revertQtyPrompt.inscricoesRevertidas ?? 0;
        const remaining = Math.max(1, total - already);
        return (
          <RevertQuantityModal
            caseRef={revertQtyPrompt}
            remaining={remaining}
            totalInscricoes={total}
            onClose={() => setRevertQtyPrompt(null)}
            onSelect={(qty) => {
              const target = revertQtyPrompt;
              setRevertQtyPrompt(null);
              // qty === remaining → reversão total; qty < remaining → reversão parcial
              if (qty < remaining) {
                setPendingPartialRevert({ caseId: target.id, qty });
              } else {
                setPendingPartialRevert(null);
              }
              setClassChangePrompt(target);
            }}
          />
        );
      })()}

      {renegStudent && (
        <FinancialModal
          student={renegStudent}
          banner={renegBanner ?? undefined}
          suggestedPendingTotal={renegSuggestedTotal ?? undefined}
          onClose={() => {
            // Se o modal foi aberto a partir do fluxo de Reverter (Confeccionar Ajustes Contratual),
            // ao fechar marcamos o caso como Revertido e movemos o card para "Finalizado".
            if (renegSourceCaseId) {
              const srcCase = cancellationCases.find((c) => c.id === renegSourceCaseId);
              const partial = pendingPartialRevert && pendingPartialRevert.caseId === renegSourceCaseId ? pendingPartialRevert.qty : undefined;
              if (srcCase && partial) {
                applyPartialRevert(srcCase, partial, 'COM Ajustes Financeiros — renegociação aplicada.');
              } else {
                // Reversão total via renegociação: registra as inscrições revertidas
                // e gera a comissão (pendente de conciliação), igual ao fluxo "Sem Ajustes".
                if (srcCase) {
                  const nowIso = new Date().toISOString();
                  const totalInsc = srcCase.quantidadeInscricoes ?? 1;
                  updateCancellationCase(srcCase.id, {
                    inscricoesRevertidas: totalInsc,
                    history: [
                      ...srcCase.history,
                      {
                        date: nowIso,
                        from: srcCase.stage,
                        to: srcCase.stage,
                        operationalStatus: srcCase.operationalStatus,
                        note: 'Reverter COM Ajustes Financeiros — renegociação aplicada.',
                      },
                    ],
                  });
                }
                revertCancellation(renegSourceCaseId);
                if (srcCase) registerCommissionIfEligible(srcCase);
              }
              setRenegSourceCaseId(null);
              setPendingPartialRevert(null);
            }
            setRenegStudent(null);
            setRenegBanner(null);
            setRenegSuggestedTotal(null);
          }}
        />
      )}
      {partialAdjustPrompt && (
        <PartialRevertAdjustModal
          data={partialAdjustPrompt}
          onCancel={partialAdjustPrompt.onCancel}
          onConfirm={partialAdjustPrompt.onConfirm}
        />
      )}
      {finalizeAction && (() => {
        const liveCase = cancellationCases.find((c) => c.id === finalizeAction.caseRef.id) ?? finalizeAction.caseRef;
        // Modo simplificado: o assessor já reverteu parte das inscrições e
        // enviou o ajuste financeiro à Conciliação. Aqui o Jurídico só formaliza
        // o cancelamento da parcela remanescente — sem nova conciliação.
        const simplified = (liveCase.inscricoesRevertidas ?? 0) > 0
          && (liveCase.quantidadeInscricoes ?? 1) > (liveCase.inscricoesRevertidas ?? 0);
        return (
          <CancellationReviewModal
            caseRef={liveCase}
            student={getCaseStudent(liveCase)}
            simplified={simplified}
            onPartialRevertBeforeCancel={(qty) => {
              applyPartialRevert(liveCase, qty, 'Fracionamento definido no distrato — jurídico.');
            }}
            onClose={() => setFinalizeAction(null)}
            onConfirm={(installments, fineValue, fineDueDate, fineAlreadyPaid, skipConciliation, abatimento) => {
              finalizeCancellation(liveCase.id, installments, fineValue, fineDueDate, fineAlreadyPaid, skipConciliation, abatimento);
              setFinalizeAction(null);
            }}
          />

        );
      })()}
      {checklistCase && (
        <FinalChecklistModal
          caseRef={checklistCase}
          currentUserName={currentUser?.name}
          currentUserId={currentUser?.id}
          onClose={() => setChecklistCase(null)}
          onSave={(checklist) => {
            const now = new Date().toISOString();
            const filled: typeof checklist = {
              ...checklist,
              preenchidoAt: now,
              preenchidoPorId: currentUser?.id,
              preenchidoPorNome: currentUser?.name,
            };
            updateCancellationCase(checklistCase.id, { finalChecklist: filled });
            const updated = { ...checklistCase, finalChecklist: filled };
            setChecklistCase(null);
            // Continua para o fluxo padrão de finalização
            setFinalizeAction({ caseRef: updated, type: 'cancelar' });
          }}
        />
      )}
      {distratoMetricsOpen && (
        <DistratoMetricsModal metrics={distratoMetrics} onClose={() => setDistratoMetricsOpen(false)} />
      )}

      {multaPagaCase && (
        <MultaPagaModal
          caseRef={multaPagaCase.caseRef}
          valorNegativado={multaPagaCase.valor}
          onClose={() => setMultaPagaCase(null)}
          onConfirm={({ valorPago, dataPagamento, observacao, comprovanteUrl, comprovanteNome }) => {
            const caseRef = multaPagaCase.caseRef;
            const valorNegativado = multaPagaCase.valor;
            const st = getCaseStudent(caseRef);
            const now = new Date().toISOString();
            const [yy, mm, dd] = dataPagamento.split('-');
            const dataFmt = yy ? `${dd}/${mm}/${yy}` : dataPagamento;
            const saldoRestante = Math.max(0, Math.round((valorNegativado - valorPago) * 100) / 100);
            const avisoRetirada =
              'Aluno pagou a multa — a negativação precisa ser retirada em no máximo 5 dias.';

            registrarConciliacao({
              tipo: 'cancelamento',
              studentId: caseRef.studentId,
              studentName: caseRef.studentName,
              ac: caseRef.ac || st?.ac,
              relatedCaseId: caseRef.id,
              resumo:
                `Multa negativada PAGA — ${caseRef.studentName}: ${formatCurrency(valorPago)} pago em ${dataFmt}. ` +
                avisoRetirada,
              autorObservacao: observacao || undefined,
              antes: {
                totalNegativar: valorNegativado,
                statusNegativacao: 'Negativado (multa em aberto)',
              },
              depois: {
                multaNegativadaPaga: valorPago,
                dataPagamentoMulta: dataPagamento,
                totalNegativar: saldoRestante,
                statusNegativacao: 'Multa paga — retirar negativação',
                prazoRetiradaNegativacao: 'Até 5 dias corridos a partir da confirmação do pagamento',
                ...(comprovanteUrl ? { comprovanteMultaUrl: comprovanteUrl, comprovanteMultaNome: comprovanteNome || 'comprovante-multa' } : {}),
                ...(observacao ? { observacao } : {}),
              },
            });

            updateCancellationCase(caseRef.id, {
              history: [
                ...caseRef.history,
                {
                  date: now,
                  from: caseRef.stage,
                  to: caseRef.stage,
                  operationalStatus: caseRef.operationalStatus,
                  note:
                    `Aluno pagou a multa negativada: ${formatCurrency(valorPago)} em ${dataFmt}` +
                    (saldoRestante > 0.0049 ? ` (restam ${formatCurrency(saldoRestante)})` : ' (quitado)') +
                    `. Enviado à Conciliação — ${avisoRetirada}` +
                    (comprovanteNome ? ` Comprovante anexado: ${comprovanteNome}.` : '') +
                    (observacao ? ` Obs.: ${observacao}` : ''),
                },
              ],
            });

            // Ajusta a parcela de multa para o valor efetivamente pago,
            // baixa a parcela e finaliza o cancelamento (status "Cancelado").
            useAppStore.getState().registrarPagamentoMultaCancelamento(caseRef.id, {
              valorPago,
              dataPagamento,
            });

            setMultaPagaCase(null);
          }}
        />
      )}
      {sendToLegalCase && (
        <SendToLegalModal
          caseRef={sendToLegalCase}
          onClose={() => setSendToLegalCase(null)}
          onConfirm={(obs, revertidasAgora) => {
            const caseRef = sendToLegalCase;
            const now = new Date().toISOString();
            const trimmed = obs.trim();
            const qtyRevertida = Math.max(0, revertidasAgora || 0);
            const totalInsc = caseRef.quantidadeInscricoes ?? 1;
            const jaRevertidas = caseRef.inscricoesRevertidas ?? 0;
            const parcialSuffix = qtyRevertida > 0
              ? ` [Reversão parcial] ${qtyRevertida} inscrição(ões) revertida(s) · ${Math.max(0, totalInsc - jaRevertidas - qtyRevertida)} remanescente(s) para o Jurídico.`
              : '';
            const noteText = (trimmed
              ? `Enviado ao Jurídico. Observações da tratativa: ${trimmed}`
              : 'Enviado ao Jurídico. Sem observações adicionais.') + parcialSuffix;
            const entry = {
              date: now,
              from: caseRef.stage,
              to: caseRef.stage,
              operationalStatus: caseRef.operationalStatus,
              note: noteText,
            };
            const prevNotes = caseRef.notes ? `${caseRef.notes}\n\n` : '';
            const legalNote = `[${new Date(now).toLocaleString('pt-BR')}] Observações para o Jurídico:\n${trimmed || '(sem observações)'}${parcialSuffix}`;
            updateCancellationCase(caseRef.id, {
              funnelStage: 'Formalização',
              acao: 'Iniciar Tratativa',
              movedToCurrentStageAt: now,
              responsavel: 'Jurídico',
              notes: prevNotes + legalNote,
              ...(qtyRevertida > 0 ? { inscricoesRevertidas: jaRevertidas + qtyRevertida } : {}),
              history: [...caseRef.history, entry],
            });
            // Reversão parcial informada no envio ao Jurídico → comissão proporcional ao AC
            if (qtyRevertida > 0) registerCommissionIfEligible(caseRef, qtyRevertida);

            const st = getCaseStudent(caseRef);
            if (st) {
              const studentEntry: HistoryEntry = {
                date: now,
                type: 'Sistema',
                text: `Cancelamento enviado ao Jurídico (Distrato do Contrato).${trimmed ? ` Observações: ${trimmed}` : ''}`,
              };
              updateStudent(st.id, { history: [...st.history, studentEntry] });
            }
            setSendToLegalCase(null);
          }}
        />
      )}
      {ligacaoPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md saas-shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                <Clock size={16} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Agendar Ligação</h2>
                <p className="text-[11px] text-muted-foreground">{ligacaoPrompt.caseRef.studentName}</p>
              </div>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Data e horário</label>
            <input
              type="datetime-local"
              className="input-field w-full"
              value={ligacaoPrompt.dateTime}
              onChange={(e) => setLigacaoPrompt({ ...ligacaoPrompt, dateTime: e.target.value })}
            />
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => {
                  if (!ligacaoPrompt.dateTime) return;
                  const c = ligacaoPrompt.caseRef;
                  const nowIso = new Date().toISOString();
                  const scheduledIso = new Date(ligacaoPrompt.dateTime).toISOString();
                  updateCancellationCase(c.id, {
                    acao: 'Ligação Agendada',
                    ligacaoAgendadaAt: scheduledIso,
                    history: [...c.history, {
                      date: nowIso,
                      from: c.stage,
                      to: c.stage,
                      operationalStatus: c.operationalStatus,
                      note: `Ligação agendada para ${new Date(scheduledIso).toLocaleString('pt-BR')}`,
                    }],
                  });
                  setLigacaoPrompt(null);
                }}
                disabled={!ligacaoPrompt.dateTime}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                Agendar
              </button>
              <button
                onClick={() => setLigacaoPrompt(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Final Checklist Modal (Jurídico responde ao mover Distrato → Finalizado) ─

interface FinalChecklistModalProps {
  caseRef: CancellationCase;
  currentUserName?: string;
  currentUserId?: string;
  onClose: () => void;
  onSave: (checklist: NonNullable<CancellationCase['finalChecklist']>) => void;
}

function FinalChecklistModal({ caseRef, onClose, onSave }: FinalChecklistModalProps) {
  const initial = caseRef.finalChecklist ?? {};
  const [cancelamentoBoleto, setCancelamentoBoleto] = useState<boolean | undefined>(initial.cancelamentoBoleto);
  const [cancelamentoBonus, setCancelamentoBonus] = useState<boolean | undefined>(initial.cancelamentoBonus);
  const [retirarAlunoTurma, setRetirarAlunoTurma] = useState<boolean>(initial.retirarAlunoTurma ?? true);
  const [multaRecebida, setMultaRecebida] = useState<boolean | undefined>(initial.multaRecebida);
  const [fazerEstorno, setFazerEstorno] = useState<boolean | undefined>(initial.fazerEstorno);
  const [negativarAluno, setNegativarAluno] = useState<boolean | undefined>(initial.negativarAluno);
  const [negativarValor, setNegativarValor] = useState<number>(initial.negativarValor ?? 0);
  const [liberarTreinamentoOnline, setLiberarTreinamentoOnline] = useState<boolean | undefined>(initial.liberarTreinamentoOnline);
  const [termoUrl, setTermoUrl] = useState<string>(initial.termoUrl ?? '');
  const [observacoes, setObservacoes] = useState<string>(initial.observacoes ?? '');

  const YesNo = ({ value, onChange, label, required }: { value: boolean | undefined; onChange: (v: boolean) => void; label: string; required?: boolean }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0">
      <span className="text-xs text-foreground flex-1">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            value === true ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-card text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          Sim
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`px-3 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            value === false ? 'bg-rose-500 text-white border-rose-500' : 'bg-card text-muted-foreground border-border hover:bg-muted'
          }`}
        >
          Não
        </button>
      </div>
    </div>
  );

  const requiredAnswered =
    cancelamentoBoleto !== undefined &&
    cancelamentoBonus !== undefined &&
    multaRecebida !== undefined &&
    fazerEstorno !== undefined &&
    negativarAluno !== undefined &&
    liberarTreinamentoOnline !== undefined;

  const handleSave = () => {
    if (!requiredAnswered) return;
    onSave({
      cancelamentoBoleto,
      cancelamentoBonus,
      retirarAlunoTurma,
      multaRecebida,
      fazerEstorno,
      negativarAluno,
      negativarValor: negativarAluno ? negativarValor : undefined,
      liberarTreinamentoOnline,
      termoUrl: termoUrl.trim() || undefined,
      observacoes: observacoes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg saas-shadow-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-foreground">Checklist do Jurídico — Distrato → Finalizado</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <strong>{caseRef.studentName}</strong> — responda as perguntas antes de finalizar.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1 mb-4">
          <YesNo value={cancelamentoBoleto} onChange={setCancelamentoBoleto} label="Cancelamento de boleto?" required />
          <YesNo value={cancelamentoBonus} onChange={setCancelamentoBonus} label="Cancelamento de bônus (tirar acesso)?" required />
          <YesNo value={retirarAlunoTurma} onChange={setRetirarAlunoTurma} label="Retirar aluno da turma?" required />
          <YesNo value={multaRecebida} onChange={setMultaRecebida} label="Multa recebida (conciliar)?" required />
          <YesNo value={fazerEstorno} onChange={setFazerEstorno} label="Fazer estorno?" required />
          <YesNo value={negativarAluno} onChange={setNegativarAluno} label="Negativar aluno pela multa?" required />
          {negativarAluno && (
            <div className="pl-3 py-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">Valor a negativar (R$)</label>
              <CurrencyInput value={negativarValor} onChange={setNegativarValor} />
            </div>
          )}
          <YesNo value={liberarTreinamentoOnline} onChange={setLiberarTreinamentoOnline} label="Liberar treinamento online (em vez de estorno total)?" required />
        </div>

        <div className="space-y-3 pt-3 border-t border-border">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">
              Termo de cancelamento — URL/link do arquivo (opcional)
            </label>
            <input
              className="input-field w-full text-xs"
              placeholder="Cole aqui o link do termo (Drive, Dropbox, ZapSign etc.)"
              value={termoUrl}
              onChange={(e) => setTermoUrl(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Fase 2: sincronização automática com ZapSign.</p>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">Observações do Jurídico</label>
            <textarea
              className="input-field w-full text-xs resize-none"
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          As respostas ficam disponíveis na aba <strong>Conciliação</strong>, que confirmará se todos os itens foram executados (incluindo o cancelamento dos boletos) e concluirá a baixa.
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={!requiredAnswered}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            Salvar e continuar
          </button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Modal: Enviar para Jurídico (Em Tratativas → Distrato do Contrato) ─────

function SendToLegalModal({
  caseRef,
  onClose,
  onConfirm,
}: {
  caseRef: CancellationCase;
  onClose: () => void;
  onConfirm: (obs: string, revertidasAgora: number) => void;
}) {
  const [obs, setObs] = useState('');
  const totalInsc = caseRef.quantidadeInscricoes ?? 1;
  const jaRevertidas = caseRef.inscricoesRevertidas ?? 0;
  // Só faz sentido informar reversão parcial se sobrar ao menos 1 inscrição para o Jurídico
  const maxRevertivel = Math.max(0, totalInsc - jaRevertidas - 1);
  const [revertidas, setRevertidas] = useState(0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg saas-shadow-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
              <Gavel size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Enviar para Jurídico</h2>
              <p className="text-[11px] text-muted-foreground">
                {caseRef.studentName} — o card será movido para <b>Distrato do Contrato</b>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {maxRevertivel > 0 && (
            <label className="block rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">
                Reversão parcial — inscrições revertidas nesta tratativa
              </span>
              <p className="text-[11px] text-emerald-700 mt-0.5 mb-1.5">
                Contrato com {totalInsc} inscrições. Informe quantas você conseguiu reverter — o assessor recebe comissão
                proporcional a essas inscrições e as demais seguem para o Jurídico.
              </p>
              <select
                className="input-field w-full text-sm"
                value={revertidas}
                onChange={(e) => setRevertidas(Number(e.target.value))}
              >
                {Array.from({ length: maxRevertivel + 1 }, (_, i) => i).map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Nenhuma inscrição revertida' : `${n} inscrição(ões) revertida(s)`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Observações da tratativa com o aluno
            </span>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              autoFocus
              rows={6}
              placeholder="Descreva o alinhamento feito com o aluno para o Jurídico analisar (ex.: condições acordadas, prazo, valores, promessas etc.)."
              className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Essas observações ficarão registradas no histórico do caso e do aluno, visíveis para o Jurídico ao abrir o card.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(obs, revertidas)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors flex items-center gap-1.5"
          >
            <Gavel size={14} /> Enviar para Jurídico
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Modal: Escolha de quantidade de inscrições ao reverter ─────────────────

function RevertQuantityModal({
  caseRef,
  remaining,
  totalInscricoes,
  onClose,
  onSelect,
}: {
  caseRef: CancellationCase;
  remaining: number;
  totalInscricoes: number;
  onClose: () => void;
  /** qty = quantas inscrições reverter agora. remaining-qty vão para o Jurídico. */
  onSelect: (qty: number) => void;
}) {
  const [qty, setQty] = useState<number>(remaining);
  const cancelQty = Math.max(0, remaining - qty);
  const partialQty = qty < remaining ? qty : remaining - 1;
  const partialCancel = remaining - partialQty;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg saas-shadow-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <RotateCcw size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Quantas inscrições reverter?</h2>
              <p className="text-[11px] text-muted-foreground">{caseRef.studentName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Banner destacado com quantidade de inscrições do contrato */}
        <div className="px-5 pt-5">
          <div className="rounded-xl border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-lg font-bold shadow-sm">
              {totalInscricoes}
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-indigo-900 uppercase tracking-wide">
                CONTRATO COM {totalInscricoes} INSCRIÇÕES
              </div>
              <div className="text-[11px] text-indigo-700 mt-0.5">
                Restam <b>{remaining}</b> inscrição{remaining !== 1 ? 'ões' : ''} para tratar. Escolha abaixo como deseja proceder.
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {/* Opção A — Reverter TODAS */}
          <button
            onClick={() => onSelect(remaining)}
            className="w-full text-left rounded-xl border-2 border-emerald-400 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-500 transition-all px-4 py-4 group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1">
                <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
                  <RotateCcw size={16} />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-emerald-900">
                    Reverter {remaining} inscrições
                  </div>
                  <div className="text-[11px] text-emerald-800/80 mt-1 leading-relaxed">
                    Reversão <b>total</b> — segue o fluxo normal (Sem/Com Ajustes) e finaliza o card.
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-bold text-white bg-emerald-600 rounded-full px-2.5 py-1 uppercase tracking-wide">Total</span>
            </div>
          </button>

          {/* Opção B — reversão parcial */}
          {remaining >= 2 && (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center flex-shrink-0">
                    <RotateCcw size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-amber-900">
                      Reverter {partialQty} inscrição{partialQty !== 1 ? 'ões' : ''} e cancelar {partialCancel} inscrição{partialCancel !== 1 ? 'ões' : ''}
                    </div>
                    <div className="text-[11px] text-amber-800/80 mt-1 leading-relaxed">
                      Reversão <b>parcial</b> — reverte parte agora e envia o restante para o Jurídico (Distrato do Contrato).
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-white bg-amber-600 rounded-full px-2.5 py-1 uppercase tracking-wide">Parcial</span>
              </div>

              <div className="mt-3 flex items-center gap-2 flex-wrap bg-white/70 border border-amber-200 rounded-lg px-3 py-2">
                <label className="text-[11px] font-semibold text-amber-900">Reverter agora:</label>
                <select
                  value={partialQty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="px-2 py-1 rounded-md text-xs bg-card border border-amber-300 font-semibold"
                >
                  {Array.from({ length: remaining - 1 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n} inscrição(ões)</option>
                  ))}
                </select>
                <span className="text-[11px] text-amber-900">→ Jurídico: <b>{partialCancel}</b></span>
                <button
                  onClick={() => onSelect(partialQty)}
                  className="ml-auto px-3 py-1.5 rounded-md text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-700 shadow-sm"
                >
                  Continuar reversão parcial
                </button>
              </div>
              <div className="mt-2 text-[10px] text-amber-800/80">
                A comissão será proporcional às inscrições revertidas. O card seguirá para <b>Distrato do Contrato</b> com as {partialCancel} inscrição(ões) remanescente(s).
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt de Multa Contratual + Encargos (Reversão Parcial COM Ajustes) ────
function PartialRevertAdjustModal({
  data,
  onCancel,
  onConfirm,
}: {
  data: {
    studentName: string;
    totalContract: number;
    saldoBase: number;
    valorRevertidas: number;
    pagoTotal: number;
    partial: number;
    totalInscricoes?: number;
  };
  onCancel: () => void;
  onConfirm: (multaValue: number, encargos: number, multaPct: number) => void;
}) {
  const [multaPct, setMultaPct] = useState<string>('');
  const [encargos, setEncargos] = useState<string>('');
  const pct = Math.max(0, Number(multaPct.replace(',', '.')) || 0);
  const enc = Math.max(0, Number(encargos.replace(',', '.')) || 0);
  const valorCancelado = Math.max(0, Math.round((data.totalContract - data.valorRevertidas) * 100) / 100);
  const multaValue = Math.round(((data.totalContract * pct) / 100) * 100) / 100;
  const totalSaldo = Math.round((data.saldoBase + multaValue + enc) * 100) / 100;
  const inscCanceladas = Math.max(0, (data.totalInscricoes ?? 0) - data.partial);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg saas-shadow-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground">Multa contratual e encargos</h2>
            <p className="text-[11px] text-muted-foreground">{data.studentName}</p>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Valor total do contrato</span>
              <span className="font-semibold text-foreground">{formatCurrency(data.totalContract)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">{data.partial} inscrição(ões) revertida(s)</span>
              <span className="font-semibold text-foreground">{formatCurrency(data.valorRevertidas)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">
                {inscCanceladas > 0 ? `${inscCanceladas} inscrição(ões) cancelada(s)` : 'Valor da(s) inscrição(ões) cancelada(s)'}
              </span>
              <span className="font-semibold text-foreground">{formatCurrency(valorCancelado)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Entrada + Total pago</span>
              <span className="font-semibold text-foreground">{formatCurrency(data.pagoTotal)}</span>
            </div>
            <div className="flex justify-between text-[11px] pt-1.5 border-t border-border/60">
              <span className="text-muted-foreground">Saldo das inscrições revertidas</span>
              <span className="font-bold text-foreground">{formatCurrency(data.saldoBase)}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-1">
              Multa contratual (% sobre o valor total do contrato)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min={0}
                value={multaPct}
                onChange={(e) => setMultaPct(e.target.value)}
                placeholder="Ex: 30"
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              <span className="text-xs text-muted-foreground">%</span>
              <div className="text-xs font-bold text-rose-700 min-w-[100px] text-right">
                {formatCurrency(multaValue)}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Calculada sobre {formatCurrency(data.totalContract)} (valor total do contrato). A multa é aplicada pela(s) inscrição(ões) cancelada(s).
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-1">
              Encargos / juros adicionais (R$) — opcional
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={encargos}
              onChange={(e) => setEncargos(e.target.value)}
              placeholder="0,00"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>

          <div className="rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3 space-y-1">
            <div className="flex justify-between text-[11px] text-rose-800">
              <span>Saldo das inscrições revertidas</span>
              <span className="font-semibold">{formatCurrency(data.saldoBase)}</span>
            </div>
            {multaValue > 0 && (
              <div className="flex justify-between text-[11px] text-rose-800">
                <span>+ Multa contratual ({pct}%)</span>
                <span className="font-semibold">{formatCurrency(multaValue)}</span>
              </div>
            )}
            {enc > 0 && (
              <div className="flex justify-between text-[11px] text-rose-800">
                <span>+ Encargos / juros</span>
                <span className="font-semibold">{formatCurrency(enc)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-1.5 border-t border-rose-300">
              <span className="font-bold text-rose-900">TOTAL a parcelar</span>
              <span className="font-bold text-rose-900">{formatCurrency(totalSaldo)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(multaValue, enc, pct)}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
          >
            Continuar para o ajuste de parcelas
          </button>
        </div>
      </div>
    </div>
  );
}



// ─── Modal: Indicadores da coluna Distrato do Contrato ───────────────────────
interface DistratoMetricsModalProps {
  metrics: {
    revertidosNoDistrato: CancellationCase[];
    revertidosFinalizados: CancellationCase[];
    canceladosComMulta: CancellationCase[];
    canceladosComAbatimento: CancellationCase[];
    totalMulta: number;
    totalAbatimento: number;
  };
  onClose: () => void;
}

function caseRefDate(c: CancellationCase): Date {
  const last = (c.history ?? []).reduce<string | null>((acc, h) => {
    if (!h?.date) return acc;
    return !acc || new Date(h.date) > new Date(acc) ? h.date : acc;
  }, null);
  return new Date(last ?? c.movedToCurrentStageAt ?? c.createdAt);
}

type DistratoPreset = 'mes' | 'mes_passado' | 'trimestre' | 'trimestre_passado' | 'ano' | 'custom';

function presetRange(p: DistratoPreset): { start: Date; end: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3) * 3;
  switch (p) {
    case 'mes_passado':
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59) };
    case 'trimestre':
      return { start: new Date(y, q, 1), end: new Date(y, q + 3, 0, 23, 59, 59) };
    case 'trimestre_passado':
      return { start: new Date(y, q - 3, 1), end: new Date(y, q, 0, 23, 59, 59) };
    case 'ano':
      return { start: new Date(y, 0, 1), end: new Date(y, 11, 31, 23, 59, 59) };
    default:
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0, 23, 59, 59) };
  }
}

const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function DistratoMetricsModal({ metrics, onClose }: DistratoMetricsModalProps) {
  const [preset, setPreset] = useState<DistratoPreset>('mes');
  const initial = presetRange('mes');
  const [startStr, setStartStr] = useState(toInput(initial.start));
  const [endStr, setEndStr] = useState(toInput(initial.end));

  const applyPreset = (p: DistratoPreset) => {
    setPreset(p);
    const r = presetRange(p);
    setStartStr(toInput(r.start));
    setEndStr(toInput(r.end));
  };

  const inRange = (c: CancellationCase) => {
    const t = caseRefDate(c).getTime();
    const s = new Date(`${startStr}T00:00:00`).getTime();
    const e = new Date(`${endStr}T23:59:59`).getTime();
    if (Number.isNaN(t) || Number.isNaN(s) || Number.isNaN(e)) return true;
    return t >= s && t <= e;
  };

  const fRevertidos = metrics.revertidosNoDistrato.filter(inRange);
  const fRevertidosFin = metrics.revertidosFinalizados.filter(inRange);
  const fMulta = metrics.canceladosComMulta.filter(inRange);
  const fAbatimento = metrics.canceladosComAbatimento.filter(inRange);

  const PRESETS: Array<{ key: DistratoPreset; label: string }> = [
    { key: 'mes', label: 'Este mês' },
    { key: 'mes_passado', label: 'Mês passado' },
    { key: 'trimestre', label: 'Trimestre atual' },
    { key: 'trimestre_passado', label: 'Trimestre passado' },
    { key: 'ano', label: 'Este ano' },
  ];

  const blocks: Array<{ title: string; hint: string; cases: CancellationCase[]; total?: number; tone: string; value: (c: CancellationCase) => string }> = [

    {
      title: 'Reversões acionadas no Distrato',
      hint: 'Casos em que o botão "Reverter" foi acionado com o card na coluna Distrato do Contrato.',
      cases: fRevertidos,
      tone: 'bg-violet-50 border-violet-200 text-violet-800',
      value: (c) => funnelDisplayLabel(getFunnelStage(c)),
    },
    {
      title: 'Revertidos → Finalizado',
      hint: 'Dos casos acima, os que concluíram a reversão e foram enviados para Finalizado.',
      cases: fRevertidosFin,
      tone: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      value: () => 'Revertido',
    },
    {
      title: 'Multa quitada pelo aluno',
      hint: 'Casos em que o aluno complementou e pagou a multa (botão "Aluno pagou a multa") — valor pago além do que já havia sido pago no contrato.',
      cases: fMulta,
      total: fMulta.reduce((acc, c) => acc + getMultaQuitadaValor(c), 0),
      tone: 'bg-amber-50 border-amber-200 text-amber-800',
      value: (c) => formatCurrency(getMultaQuitadaValor(c)),
    },
    {
      title: 'Cancelados com abatimento em outro treinamento',
      hint: 'Casos em que o saldo a devolver foi abatido no contrato de outro treinamento.',
      cases: fAbatimento,
      total: fAbatimento.reduce((acc, c) => acc + (c.abatimento?.valor ?? 0), 0),
      tone: 'bg-blue-50 border-blue-200 text-blue-800',
      value: (c) => `${formatCurrency(c.abatimento?.valor ?? 0)} · ${c.abatimento?.studentName ?? '—'}`,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto saas-shadow-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card rounded-t-2xl">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-violet-600" />
            <h2 className="text-sm font-bold text-foreground">Indicadores — Distrato do Contrato</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-700">Taxa de reversão no Distrato</p>
              <p className="text-[11px] text-violet-800/80 mt-0.5">
                {fRevertidos.length} reversão(ões) acionada(s) · {fRevertidosFin.length} concluída(s) no período
              </p>
            </div>
            <p className="text-2xl font-bold text-violet-700 tabular-nums">
              {fRevertidos.length > 0
                ? `${Math.round((fRevertidosFin.length / fRevertidos.length) * 100)}%`
                : '0%'}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Período de referência</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors ${
                    preset === p.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Início:
                <input
                  type="date"
                  value={startStr}
                  onChange={(e) => { setStartStr(e.target.value); setPreset('custom'); }}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-foreground"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Fim:
                <input
                  type="date"
                  value={endStr}
                  onChange={(e) => { setEndStr(e.target.value); setPreset('custom'); }}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-foreground"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {blocks.map((b) => (
              <div key={b.title} className={`rounded-xl border p-3 ${b.tone}`}>
                <p className="text-[10px] font-semibold uppercase leading-tight">{b.title}</p>
                <p className="text-2xl font-bold mt-1">{b.cases.length}</p>
                {b.total != null && b.total > 0 && (
                  <p className="text-[10px] mt-0.5 opacity-80">{formatCurrency(b.total)}</p>
                )}
              </div>
            ))}
          </div>

          {blocks.map((b) => (
            <div key={`list-${b.title}`} className="border border-border rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border">
                <p className="text-[11px] font-bold text-foreground">{b.title} · {b.cases.length}</p>
                <p className="text-[10px] text-muted-foreground">{b.hint}</p>
              </div>
              {b.cases.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">Nenhum caso registrado.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {b.cases.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="text-[11px] font-medium text-foreground truncate">{c.studentName}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{b.value(c)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
