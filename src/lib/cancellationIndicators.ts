import type { CancellationCase, Student } from '@/types';
import { isSolicitacaoCancelamento } from '@/lib/acPortfolioVisibility';

/** Estágios legados considerados reversão. */
const RECOVERED_STAGES = new Set(['Recuperado', 'Negativação Retirada']);

/**
 * Caso revertido: funil novo (`acao=Revertido`) ou estágio legado recuperado.
 */
export function isCancellationCaseRevertido(c: CancellationCase): boolean {
  if (c.acao === 'Revertido') return true;
  if (RECOVERED_STAGES.has(c.stage)) return true;
  const revertidas = c.inscricoesRevertidas ?? 0;
  if (revertidas > 0 && c.funnelStage === 'Finalizado') return true;
  return false;
}

/** Data de referência do caso para filtro de período (criação). */
export function cancellationCaseRefDate(c: CancellationCase): Date {
  return new Date(c.createdAt);
}

export function isCancellationCaseInRange(
  c: CancellationCase,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!range) return true;
  const t = cancellationCaseRefDate(c).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/**
 * Data em que a reversão foi registrada (histórico / move / createdAt).
 * Usada quando o filtro deve olhar “quando reverteu”, não “quando pediu”.
 */
export function cancellationRevertedAt(c: CancellationCase): Date {
  const hist = [...(c.history ?? [])]
    .filter((h) => {
      const note = (h.note ?? '').toLowerCase();
      const to = (h.to ?? '').toLowerCase();
      return (
        note.includes('revert') ||
        to === 'recuperado' ||
        to === 'negativação retirada' ||
        (h as { acao?: string }).acao === 'Revertido'
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (hist[0]?.date) return new Date(hist[0].date);
  if (c.acao === 'Revertido' && c.movedToCurrentStageAt) {
    return new Date(c.movedToCurrentStageAt);
  }
  return new Date(c.movedToCurrentStageAt || c.createdAt);
}

export function isRevertidoInRange(
  c: CancellationCase,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!isCancellationCaseRevertido(c)) return false;
  if (!range) return true;
  const t = cancellationRevertedAt(c).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Pedido de cancelamento ativo no aluno (KPI Solicitação). */
export function studentHasPedidoCancelamento(s: Student): boolean {
  return isSolicitacaoCancelamento(s);
}
