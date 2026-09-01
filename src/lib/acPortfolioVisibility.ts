import type { CancellationCase, ConciliacaoItem, Student, StatusCancelamento } from '@/types';
import {
  isIamConciliadoQuitadoAvista,
  needsIamGcConciliacaoApproval,
} from '@/lib/iamPendenteConciliacao';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import {
  caseHasCancelamentoFinalPending,
  isCancelamentoFinalPendingItem,
} from '@/lib/cancelamentoGcConciliacao';

const FUNIL_CANCELAMENTO_ATIVO = new Set<StatusCancelamento>([
  'solicitado',
  'em_tratamento',
  'juridico',
  'aguardando_conciliacao',
  'pagamento_multa_pendente',
]);

/**
 * Cancelamento (solicitação ou concluído) sobrepõe Vencido/Em Dia/etc.
 * Usado para KPIs, auto-recálculo e exibição.
 */
export function cancelamentoOverridesFinancialStatus(s: Student): boolean {
  const sc = s.statusCancelamento;
  if (sc === 'cancelado' || s.status === 'Cancelado') return true;
  if (sc && FUNIL_CANCELAMENTO_ATIVO.has(sc)) return true;
  return s.status === 'Solicitação Cancelamento';
}

/** Aluno no funil de cancelamento (exclui já cancelado conciliado). */
export function isSolicitacaoCancelamento(s: Student): boolean {
  const sc = s.statusCancelamento;
  if (sc && FUNIL_CANCELAMENTO_ATIVO.has(sc)) return true;
  return s.status === 'Solicitação Cancelamento';
}

const FINALIZED_CANCEL_STAGES = new Set(['Cancelado', 'Negativação Efetivada', 'Recuperado']);

/** Caso ainda em fluxo ativo — espelha a regra do funil Cancelamentos. */
function findActiveCancellationCase(s: Student, cases: CancellationCase[]): CancellationCase | undefined {
  if (s.cancellationCaseId) {
    const byId = cases.find((c) => c.id === s.cancellationCaseId);
    if (byId) return byId;
  }
  return cases.find((c) => c.studentId === s.id);
}

/** Caso de cancelamento ativo vinculado ao aluno (funil Kanban, não finalizado). */
export function hasActiveCancellationCase(s: Student, cases: CancellationCase[]): boolean {
  const linked = findActiveCancellationCase(s, cases);
  if (!linked) return false;
  if (linked.acao === 'Revertido' || linked.acao === 'Cancelado') return false;
  if (linked.funnelStage === 'Finalizado') return false;
  if (FINALIZED_CANCEL_STAGES.has(linked.stage)) return false;
  return true;
}

/** Filtro "Cancelamento solicitado" — todo aluno em cancelamento ativo. */
export function matchesCancelamentoFilter(s: Student, cases: CancellationCase[]): boolean {
  if (s.statusCancelamento === 'cancelado' || s.status === 'Cancelado') return false;
  return isSolicitacaoCancelamento(s) || hasActiveCancellationCase(s, cases);
}

function normalizeStudentName(name?: string | null): string {
  return (name || '').trim().toLowerCase();
}

/** Nome único no cadastro — fallback seguro quando o caso não tem `studentId`. */
function isUniqueStudentName(name: string, students: Student[]): boolean {
  const norm = normalizeStudentName(name);
  if (!norm) return false;
  return students.filter((s) => normalizeStudentName(s.name) === norm).length === 1;
}

/** Contrato quitado: todas as parcelas marcadas como pagas. */
export function isStudentFullyPaid(student: Student): boolean {
  const inst = student.installments ?? [];
  // Quitado à vista/cartão integral chega sem parcelas: a venda inteira vira
  // entrada. Sem este caso o contrato ficaria na carteira ativa como "Em Dia",
  // divergindo do card Pago, que soma o mesmo valor pela entrada. Array vazio
  // sozinho não basta — cadastro incompleto também tem zero parcelas.
  if (inst.length === 0) return isIamConciliadoQuitadoAvista(student);
  return inst.every((i) => i.paid);
}

/**
 * Aluno compõe a carteira ativa do assessor (quem ainda exige cobrança/ação).
 * Quitados (Pago / parcelas todas pagas) ficam só na aba Alunos.
 */
export function isStudentInAcPortfolio(student: Student): boolean {
  // IAM na fila Conciliação → GC: AC reservado na esteira, mas fora da carteira até aprovar.
  if (needsIamGcConciliacaoApproval(student)) return false;
  if (isSolicitacaoCancelamento(student)) return true;
  if (isStudentFullyPaid(student)) return false;
  if (student.status === 'Pago') return false;
  if (student.statusCancelamento === 'cancelado') return false;
  if (
    isRendaExtraAtivo(student) &&
    student.rendaExtraStatus &&
    student.rendaExtraStatus !== 'Conciliar Exclusão'
  ) {
    return false;
  }
  return true;
}

/** Filtro de carteira: quitados saem, exceto consulta explícita por status Pago. */
export function filterCarteiraActiveStudents(students: Student[], statusFilter: string): Student[] {
  if (statusFilter === 'Pago') {
    return students.filter((s) => s.status === 'Pago' || isStudentFullyPaid(s));
  }
  return students.filter(
    (s) => isSolicitacaoCancelamento(s) || (s.status !== 'Pago' && !isStudentFullyPaid(s)),
  );
}

export function isVisibleInAcPortfolio(
  student: Student,
  hidden: { ids: Set<string>; names: Set<string> },
  allStudents: Student[],
): boolean {
  if (isStudentHiddenFromAcPortfolio(student, hidden, allStudents)) return false;
  return isStudentInAcPortfolio(student);
}

export function isStudentHiddenFromAcPortfolio(
  student: Student,
  hidden: { ids: Set<string>; names: Set<string> },
  allStudents: Student[],
): boolean {
  if (hidden.ids.has(student.id)) return true;
  const norm = normalizeStudentName(student.name);
  if (hidden.names.has(norm) && isUniqueStudentName(student.name, allStudents)) return true;
  return false;
}

/**
 * Alunos que saem da carteira do assessor (Kanban judicial / finalizado),
 * espelhando a regra de `ACPortfolioPage`.
 *
 * Ocultação por contrato (`studentId`). Nome só entra quando o caso legado
 * não tem vínculo explícito — e na filtragem só afeta aluno com nome único.
 */
export function getHiddenFromAcPortfolioKeys(
  cancellationCases: CancellationCase[],
  conciliacaoItems: ConciliacaoItem[],
  students: Student[],
): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  const pendingCaseIds = new Set<string>();
  const conciliadoCaseIds = new Set<string>();

  for (const it of conciliacaoItems) {
    if (it.relatedCaseId && isCancelamentoFinalPendingItem(it)) {
      pendingCaseIds.add(it.relatedCaseId);
    }
    if ((it.tipo === 'cancelamento' || it.tipo === 'reversao') && it.status === 'conciliado' && it.relatedCaseId) {
      conciliadoCaseIds.add(it.relatedCaseId);
    }
  }

  cancellationCases.forEach((c) => {
    const isJudicial = c.funnelStage ? c.funnelStage === 'Pendente' : c.stage === 'PROCON ou Judicial';
    const total = c.quantidadeInscricoes ?? 1;
    const revertidas = c.inscricoesRevertidas ?? 0;
    const reversaoParcialPendente = total > 1 && revertidas > 0 && revertidas < total;
    const st = c.studentId
      ? students.find((s) => s.id === c.studentId)
      : students.find((s) => s.cancellationCaseId === c.id);
    const isRevertido =
      c.acao === 'Revertido' ||
      st?.statusCancelamento === 'revertido' ||
      (total > 0 && revertidas >= total);
    if (isRevertido) return;

    const casoFinalizado = c.funnelStage === 'Finalizado';
    // Conciliação formal pendente/conciliada ganha da ação do card (ex.: "Em Tratativa"
    // alterada depois da formalização não devolve o aluno à carteira do AC).
    const temConciliacaoFormal =
      caseHasCancelamentoFinalPending(c.id, conciliacaoItems) || conciliadoCaseIds.has(c.id);
    const aguardandoPosFormalizacao =
      (!reversaoParcialPendente || temConciliacaoFormal) &&
      (caseHasCancelamentoFinalPending(c.id, conciliacaoItems) ||
        st?.statusCancelamento === 'aguardando_conciliacao' ||
        st?.statusCancelamento === 'pagamento_multa_pendente');
    const conciliado =
      (!reversaoParcialPendente || temConciliacaoFormal) &&
      conciliadoCaseIds.has(c.id) &&
      !caseHasCancelamentoFinalPending(c.id, conciliacaoItems);
    const isFinalizado = casoFinalizado || aguardandoPosFormalizacao || conciliado;
    if (!isJudicial && !isFinalizado) return;

    if (c.studentId) {
      ids.add(c.studentId);
    } else if (c.studentName) {
      names.add(normalizeStudentName(c.studentName));
    }
  });

  return { ids, names };
}

/** Mesmo universo da carteira do assessor / Taxa Em Dia (sem filtros de produto/tag). */
export function studentsForAcRanking(
  students: Student[],
  hidden: { ids: Set<string>; names: Set<string> },
  allStudents: Student[] = students,
): Student[] {
  return students.filter((s) => isVisibleInAcPortfolio(s, hidden, allStudents));
}
