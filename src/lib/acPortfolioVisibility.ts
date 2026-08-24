import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';

/** Solicitação de cancelamento sobrepõe o status financeiro nos KPIs. */
export function isSolicitacaoCancelamento(s: Student): boolean {
  return s.statusCancelamento === 'solicitado' || s.status === 'Solicitação Cancelamento';
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
  if (inst.length === 0) return false;
  return inst.every((i) => i.paid);
}

/**
 * Aluno compõe a carteira ativa do assessor (quem ainda exige cobrança/ação).
 * Quitados (Pago / parcelas todas pagas) ficam só na aba Alunos.
 */
export function isStudentInAcPortfolio(student: Student): boolean {
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
    if ((it.status === 'pendente' || it.status === 'aprovado') && it.relatedCaseId) {
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

    const aguardando =
      !reversaoParcialPendente &&
      (pendingCaseIds.has(c.id) || st?.statusCancelamento === 'aguardando_conciliacao');
    const conciliado =
      !reversaoParcialPendente && conciliadoCaseIds.has(c.id) && !pendingCaseIds.has(c.id);
    const isFinalizado = c.funnelStage === 'Finalizado' || aguardando || conciliado;
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
