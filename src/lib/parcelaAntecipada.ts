import type { Installment } from '@/types';
import { getTodayBrasilia } from '@/lib/brasiliaDate';

/**
 * Parcela baixada por antecipação de recebível (banco/fundo), não por pagamento do aluno.
 * Só faz sentido quando a parcela já está `paid` — em aberto ela é uma parcela comum.
 */
export function isParcelaAntecipada(i: Installment): boolean {
  return !!i.paid && !!i.antecipada;
}

/** Vencimento estritamente anterior ao dia de referência (meia-noite local). */
export function parcelaVencidaNaData(dueDate: string, ref: Date): boolean {
  const day = new Date(ref);
  day.setHours(0, 0, 0, 0);
  return new Date(dueDate + 'T00:00:00').getTime() < day.getTime();
}

/**
 * Antecipação do fundo que já venceu. O aluno ainda deve: sai de Boletos
 * Antecipados e entra na faixa de atraso (Vencido 1, Vencido 2, À Negativar).
 */
export function isAntecipadaVencida(i: Installment, ref: Date = getTodayBrasilia()): boolean {
  return isParcelaAntecipada(i) && parcelaVencidaNaData(i.dueDate, ref);
}

/** Dívida que ainda compõe saldo em aberto. Pago pelo aluno fica de fora. */
export function contaNoSaldoEmAberto(i: Installment, ref: Date = getTodayBrasilia()): boolean {
  if (!i.paid) return true;
  return isAntecipadaVencida(i, ref);
}

/** Classes do chip no Fluxo de Pagamento (azul claro). */
export const ANTECIPADA_CHIP_CLASS = 'border-sky-300 bg-sky-50';
export const ANTECIPADA_TEXT_CLASS = 'text-sky-700';
export const ANTECIPADA_BADGE_CLASS = 'bg-sky-100 text-sky-700';
export const ANTECIPADA_LABEL = 'Antecipado';
