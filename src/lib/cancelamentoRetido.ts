import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { isCancelamentoEspelhoItem } from '@/lib/cancelamentoGcConciliacao';
import { isConciliacaoReversaoItem } from '@/lib/conciliacaoTipo';

/**
 * Card Pago para contrato CANCELADO: entra só o que a empresa ficou de fato —
 *   retido = pago pelo aluno (entrada + parcelas + complemento de multa)
 *            − estorno devolvido ao aluno
 *            − abatimento levado para outro contrato (já conta lá).
 * Na prática é a multa quitada; quando a multa foi negativada, é o que o
 * aluno já tinha pago (nada é devolvido); no cancelamento em 7 dias (CDC) é 0.
 * As parcelas em aberto do contrato cancelado nunca entram no A Vencer.
 */
export interface CancelamentoRetido {
  valor: number;
  /** Data (YYYY-MM-DD) em que o cancelamento foi concluído — filtro de período do card. */
  data: string;
  pago: number;
  estorno: number;
  abatimento: number;
  multa: number;
  fonte: 'conciliacao' | 'caso';
  caseId: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const toIsoDate = (v?: string | null): string => (v ? String(v).slice(0, 10) : '');

function findCase(student: Student, cases: CancellationCase[]): CancellationCase | undefined {
  const byId = student.cancellationCaseId
    ? cases.find((c) => c.id === student.cancellationCaseId)
    : undefined;
  if (byId) return byId;
  return cases
    .filter((c) => c.studentId === student.id && c.stage === 'Cancelado')
    .sort((a, b) => String(b.movedToCurrentStageAt ?? '').localeCompare(String(a.movedToCurrentStageAt ?? '')))[0];
}

function findItem(caseId: string, items: ConciliacaoItem[]): ConciliacaoItem | undefined {
  return items
    .filter(
      (it) =>
        it.tipo === 'cancelamento' &&
        it.status === 'conciliado' &&
        it.relatedCaseId === caseId &&
        !isCancelamentoEspelhoItem(it) &&
        !isConciliacaoReversaoItem(it),
    )
    .sort((a, b) => String(b.conciliadoAt ?? '').localeCompare(String(a.conciliadoAt ?? '')))[0];
}

export function valorRetidoCancelamento(
  student: Student,
  cases: CancellationCase[],
  items: ConciliacaoItem[],
): CancelamentoRetido | null {
  if (student.statusCancelamento !== 'cancelado') return null;
  const caso = findCase(student, cases);
  if (!caso) return null;

  const item = findItem(caso.id, items);
  if (item) {
    const d = item.depois ?? {};
    const pago = num(d.totalPagoEfetivo ?? d.totalPago);
    const estorno = num(d.estornoAluno);
    const abatimento = num(d.abatimentoValor);
    const multa = num(d.multaCancelamento);
    const valor = round2(Math.max(0, pago - estorno - abatimento));
    return {
      valor,
      data: toIsoDate(item.conciliadoAt) || toIsoDate(caso.movedToCurrentStageAt),
      pago,
      estorno,
      abatimento,
      multa,
      fonte: 'conciliacao',
      caseId: caso.id,
    };
  }

  // Sem item de conciliação (cancelamento antigo / importado): o que ficou é
  // a parcela de multa paga que a finalização deixou na ficha.
  const multaPaga = (student.installments ?? [])
    .filter((i) => i.paid && (i.tags ?? []).includes('multa-cancelamento'))
    .reduce((acc, i) => acc + num(i.paidValue ?? i.value), 0);
  return {
    valor: round2(multaPaga),
    data: toIsoDate(caso.movedToCurrentStageAt),
    pago: multaPaga,
    estorno: 0,
    abatimento: 0,
    multa: multaPaga,
    fonte: 'caso',
    caseId: caso.id,
  };
}

/** O retido entra no período do card? Em "Todos" sempre; com intervalo, pela data de conclusão. */
export function retidoNoPeriodo(
  retido: Pick<CancelamentoRetido, 'data'>,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!range) return true;
  if (!retido.data) return false;
  const dt = new Date(retido.data + 'T00:00:00');
  return !(dt < range.start || dt > range.end);
}
