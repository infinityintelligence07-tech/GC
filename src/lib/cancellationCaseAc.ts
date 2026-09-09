import type { CancellationCase, CancellationStage, Student } from '@/types';

/** Estágios em que o caso já foi concluído — o AC gravado nele é histórico e não acompanha a carteira. */
export const CANCELLATION_FINAL_STAGES: CancellationStage[] = [
  'Recuperado',
  'Cancelado',
  'Negativação Retirada',
  'Negativação Efetivada',
];

export function isCancellationCaseAtivo(c: Pick<CancellationCase, 'stage' | 'funnelStage'>): boolean {
  return c.funnelStage !== 'Finalizado' && !CANCELLATION_FINAL_STAGES.includes(c.stage);
}

/**
 * AC exibido/filtrado para um caso de cancelamento.
 * Caso ativo → assessor atual da carteira do aluno (quem assumiu a carteira herda o caso).
 * Caso finalizado → AC gravado no caso (histórico operacional/comissões).
 */
export function resolveCancellationCaseAc(
  c: Pick<CancellationCase, 'ac' | 'stage' | 'funnelStage'>,
  student?: Pick<Student, 'ac'> | null,
): string {
  const caseAc = (c.ac ?? '').trim();
  const studentAc = (student?.ac ?? '').trim();
  return isCancellationCaseAtivo(c) ? studentAc || caseAc : caseAc || studentAc;
}

/** O caso pertence a este aluno (por id, pelo espelho na ficha ou por nome dentro da mesma carteira). */
export function isCancellationCaseOfStudent(
  c: Pick<CancellationCase, 'id' | 'studentId' | 'studentName' | 'ac'>,
  student: Pick<Student, 'id' | 'name' | 'ac' | 'cancellationCaseId'>,
  previousAc?: string,
): boolean {
  if (c.studentId) return c.studentId === student.id;
  if (student.cancellationCaseId && student.cancellationCaseId === c.id) return true;
  const sameName = c.studentName.trim().toLowerCase() === student.name.trim().toLowerCase();
  const acRef = (previousAc ?? student.ac ?? '').trim();
  return sameName && (c.ac ?? '').trim() === acRef;
}

/**
 * Casos ativos do aluno cujo AC gravado está desatualizado em relação à carteira atual.
 * Usado ao trocar o AC do aluno e na auto-correção ao abrir a aba Cancelamentos.
 */
export function cancellationCasesToResyncAc(
  cases: CancellationCase[],
  student: Pick<Student, 'id' | 'name' | 'ac' | 'cancellationCaseId'>,
  previousAc?: string,
): CancellationCase[] {
  const newAc = (student.ac ?? '').trim();
  if (!newAc) return [];
  return cases.filter(
    (c) =>
      isCancellationCaseAtivo(c) &&
      (c.ac ?? '').trim() !== newAc &&
      isCancellationCaseOfStudent(c, student, previousAc),
  );
}
