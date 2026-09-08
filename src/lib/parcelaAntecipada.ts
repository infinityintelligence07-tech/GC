import type { Installment } from '@/types';

/**
 * Parcela baixada por antecipação de recebível (banco/fundo), não por pagamento do aluno.
 * Só faz sentido quando a parcela já está `paid` — em aberto ela é uma parcela comum.
 */
export function isParcelaAntecipada(i: Installment): boolean {
  return !!i.paid && !!i.antecipada;
}

/** Classes do chip no Fluxo de Pagamento (azul claro). */
export const ANTECIPADA_CHIP_CLASS = 'border-sky-300 bg-sky-50';
export const ANTECIPADA_TEXT_CLASS = 'text-sky-700';
export const ANTECIPADA_BADGE_CLASS = 'bg-sky-100 text-sky-700';
export const ANTECIPADA_LABEL = 'Antecipado';
