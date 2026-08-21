import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';

/** Solicitação de cancelamento sobrepõe o status financeiro nos KPIs. */
export function isSolicitacaoCancelamento(s: Student): boolean {
  return s.statusCancelamento === 'solicitado' || s.status === 'Solicitação Cancelamento';
}

/**
 * Alunos que saem da carteira do assessor (Kanban judicial / finalizado),
 * espelhando a regra de `ACPortfolioPage`.
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

    if (c.studentId) ids.add(c.studentId);
    if (c.studentName) names.add(c.studentName.trim().toLowerCase());
  });

  return { ids, names };
}

/** Mesmo universo da carteira do assessor / Taxa Em Dia (sem filtros de produto/tag). */
export function studentsForAcRanking(
  students: Student[],
  hidden: { ids: Set<string>; names: Set<string> },
): Student[] {
  return students.filter((s) => {
    if (hidden.ids.has(s.id)) return false;
    if (hidden.names.has((s.name || '').trim().toLowerCase())) return false;
    if (s.status === 'Pago') return false;
    if (s.statusCancelamento === 'cancelado') return false;
    if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') {
      return false;
    }
    return true;
  });
}
