import type { ConciliacaoItem } from '@/types';

/** Item de conciliação que representa reversão (incl. troca de turma na reversão). */
export function isConciliacaoReversaoItem(item: Pick<ConciliacaoItem, 'tipo' | 'resumo'>): boolean {
  return item.tipo === 'reversao' || (item.tipo === 'cancelamento' && /revers/i.test(item.resumo ?? ''));
}
