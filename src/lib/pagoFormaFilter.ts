import type { Installment } from '@/types';
import { isEntradaPendenciaInstallment } from '@/lib/studentDisplayStatus';

/**
 * Filtro dos cards "Pago" (Dashboard e Carteira do AC).
 *
 * - `boleto` (padrão): só títulos da carteira — parcelas pagas por boleto.
 *   Ficam de fora a entrada de contrato IAM quitado à vista / cartão de
 *   crédito (que não vira parcela) e parcelas de entrada PIX/link
 *   (tags `entrada-pendente` / `entrada-restante`).
 * - `geral`: tudo o que foi pago, independente da forma.
 *
 * A parcela não guarda a forma de pagamento; a distinção usa os sinais que
 * o sistema tem (origem IAM à vista/cartão e tags de entrada PIX/link).
 */
export type PagoFormaFilter = 'boleto' | 'geral';

export const PAGO_FORMA_FILTER_DEFAULT: PagoFormaFilter = 'boleto';

export const PAGO_FORMA_FILTER_LABEL: Record<PagoFormaFilter, string> = {
  boleto: 'Somente boleto',
  geral: 'Geral',
};

export const PAGO_FORMA_FILTER_HINT: Record<PagoFormaFilter, string> = {
  boleto: 'Pago só com títulos da carteira (boletos). Entrada à vista/cartão e entrada PIX/link ficam de fora.',
  geral: 'Pago com tudo: boletos, entrada à vista/cartão de crédito e entrada PIX/link.',
};

/** Parcela paga é título de boleto (não é entrada PIX/link). */
export function isBoletoInstallment(i: Installment): boolean {
  return !isEntradaPendenciaInstallment(i);
}

/** Parcela paga entra no card Pago sob o filtro atual? */
export function installmentCountsInPago(filter: PagoFormaFilter, i: Installment): boolean {
  return filter === 'geral' || isBoletoInstallment(i);
}

/** Entrada de contrato IAM quitado à vista/cartão entra no card Pago sob o filtro atual? */
export function entradaAvistaCountsInPago(filter: PagoFormaFilter): boolean {
  return filter === 'geral';
}
