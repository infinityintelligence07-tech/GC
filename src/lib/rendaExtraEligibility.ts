// Regra: aluno cancelado não compõe Renda Extra.
// Com o cancelamento do contrato, todas as cobranças/pendências são resolvidas,
// então ele não pode aparecer nem contar como Renda Extra em nenhuma tela.

import type { Student } from '@/types';

export function isStudentCancelado(s: Pick<Student, 'status' | 'statusCancelamento'>): boolean {
  return s.status === 'Cancelado' || s.statusCancelamento === 'cancelado';
}

/** true quando o aluno deve ser tratado como Renda Extra (não cancelado). */
export function isRendaExtraAtivo(
  s: Pick<Student, 'status' | 'statusCancelamento' | 'isRendaExtra'>
): boolean {
  return !!s.isRendaExtra && !isStudentCancelado(s);
}
