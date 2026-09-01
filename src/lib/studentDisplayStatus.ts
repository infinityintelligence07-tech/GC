import type { Student, StudentStatus, StatusCancelamento, Installment } from '@/types';
import { calculateAutoStatus } from '@/store/useAppStore';
import { cancelamentoOverridesFinancialStatus } from '@/lib/acPortfolioVisibility';
import { isAwaitingIamGcApproval } from '@/lib/iamPendenteConciliacao';

/** Etapas do funil em que o status financeiro (Vencido, Em Dia…) não deve aparecer. */
const FUNIL_CANCELAMENTO_ATIVO = new Set<StatusCancelamento>([
  'solicitado',
  'em_tratamento',
  'juridico',
  'aguardando_conciliacao',
  'pagamento_multa_pendente',
]);

export const CANCELAMENTO_BADGE_CONFIG: Record<string, { label: string; color: string }> = {
  solicitado: {
    label: 'Solicitação Cancelamento',
    color: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
  },
  em_tratamento: { label: 'Em Tratamento', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  // Mantém o selo principal de solicitação; o destino jurídico fica no funil do card.
  juridico: {
    label: 'Solicitação Cancelamento',
    color: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
  },
  aguardando_conciliacao: { label: 'Conciliação Pendente', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
  pagamento_multa_pendente: {
    label: 'Pagamento Multa Pendente',
    color: 'bg-amber-100 text-amber-700 border border-amber-300',
  },
  revertido: { label: 'Revertido', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
};

export function isFunilCancelamentoAtivo(sc?: StatusCancelamento | null): boolean {
  return !!sc && FUNIL_CANCELAMENTO_ATIVO.has(sc);
}

export const PENDENCIA_INSTALLMENT_TAGS = ['entrada-restante', 'entrada-pendente'] as const;

export function isEntradaPendenciaInstallment(inst: Installment): boolean {
  return (inst.tags ?? []).some((t) =>
    (PENDENCIA_INSTALLMENT_TAGS as readonly string[]).includes(t),
  );
}

/** Parcelas de entrada ainda não quitadas (PIX/link da entrada). */
export function getEntradaPendenteInstallments(student: Student): Installment[] {
  return student.installments.filter((i) => !i.paid && isEntradaPendenciaInstallment(i));
}

export function sumEntradaPendenteValue(student: Student): number {
  return getEntradaPendenteInstallments(student).reduce((acc, i) => acc + i.value, 0);
}

/**
 * Parcelas que representam a pendência operacional (PIX/link), não o plano de parcelas futuro.
 */
export function getOperationalPendenteInstallments(student: Student): Installment[] {
  if (!isOperationalPendente(student)) return [];
  const unpaid = student.installments.filter((i) => !i.paid);
  if (unpaid.length === 0) return [];

  const entradaTagged = getEntradaPendenteInstallments(student);
  if (entradaTagged.length > 0) return entradaTagged;

  const sorted = [...unpaid].sort((a, b) => a.number - b.number);
  return sorted.slice(0, 1);
}

/** Valor da entrada: quitada (down_payment) + parcelas com tag de entrada pendente. */
export function getEntradaDisplayValue(student: Student): number {
  const paidEntrada = Number(student.downPayment) || 0;
  return paidEntrada + sumEntradaPendenteValue(student);
}

/** Tipo da pendência operacional para exibição em tabelas/KPIs. */
export function getOperationalPendenteTipoLabel(student: Student): string {
  const insts = getOperationalPendenteInstallments(student);
  if (insts.some((i) => isEntradaPendenciaInstallment(i))) {
    const tipo = String(student.iamControlPendenteTipo ?? '').toUpperCase();
    if (tipo === 'PIX') return 'Entrada (PIX)';
    if (tipo === 'LINK') return 'Entrada (Link)';
    return 'Entrada';
  }
  const tipo = String(student.iamControlPendenteTipo ?? '').toUpperCase();
  if (tipo === 'PIX') return 'PIX';
  if (tipo === 'LINK') return 'Link';
  return 'Pendência';
}

export function sumOperationalPendenteValue(student: Student): number {
  return getOperationalPendenteInstallments(student).reduce((acc, i) => acc + i.value, 0);
}

/** Pendência operacional (PIX/link IAM, PARA_CONCILIAR ou status manual Pendente). */
export function isOperationalPendente(student: Student): boolean {
  if (student.status === 'Pendente') return true;
  return isAwaitingIamGcApproval(student);
}

/** Status operacional exibido em tabelas/KPIs (sem Vencido quando há cancelamento ativo). */
export function resolveStudentDisplayStatus(student: Student): StudentStatus {
  if (student.statusCancelamento === 'cancelado' || student.status === 'Cancelado') {
    return 'Cancelado';
  }
  if (student.status === 'Negativado') return 'Negativado';
  if (cancelamentoOverridesFinancialStatus(student)) {
    return 'Solicitação Cancelamento';
  }
  // Pendência IAM / Manual não é sobrescrita por Em Dia/Vencido.
  if (isOperationalPendente(student)) return 'Pendente';
  if (student.statusMode === 'Automático') {
    return calculateAutoStatus(student.installments);
  }
  return student.status;
}

export function getCancelamentoBadge(student: Student): { label: string; color: string } | null {
  const sc = student.statusCancelamento;
  if (!sc || sc === 'nenhum') return null;
  if (sc === 'revertido' && student.status === 'Pago') return null;
  if (sc === 'cancelado' || student.status === 'Cancelado') {
    return { label: 'Cancelado', color: 'bg-slate-200 text-slate-600 border border-slate-300' };
  }
  return CANCELAMENTO_BADGE_CONFIG[sc] ?? null;
}
