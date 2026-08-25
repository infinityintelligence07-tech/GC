import type { Student, StudentStatus, StatusCancelamento } from '@/types';
import { calculateAutoStatus } from '@/store/useAppStore';
import { cancelamentoOverridesFinancialStatus } from '@/lib/acPortfolioVisibility';

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
  juridico: { label: 'Jurídico', color: 'bg-slate-200 text-slate-600 border border-slate-300' },
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

/** Pendência operacional (PIX/link IAM ou status manual Pendente). */
export function isOperationalPendente(student: Student): boolean {
  if (student.status === 'Pendente') return true;
  return String(student.iamControlContratoStatus ?? '').toUpperCase() === 'PENDENTE';
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
