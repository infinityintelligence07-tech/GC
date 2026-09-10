// Helpers de filtragem por tag — suportam tags por aluno OU por parcela.
// Quando uma tag é encontrada em qualquer parcela do aluno, o aluno aparece
// na listagem mas só os dados financeiros das parcelas marcadas são considerados.

import type { Student, Installment, StudentStatus } from '@/types';
import { effectiveDueDate, faixaAtrasoPorMes, getTodayBrasilia } from '@/lib/brasiliaDate';

/**
 * Retorna todas as tags visíveis do aluno, incluindo tags aplicadas em parcelas.
 * Mantém compatibilidade com imports antigos que possam ter salvo o nome da tag
 * diretamente no array em vez do ID.
 */
export function getVisibleStudentTagRefs(student: Student): string[] {
  const refs = new Set<string>();
  (student.tags || []).forEach((tid) => tid && refs.add(tid));
  (student.installments || []).forEach((inst) => {
    (inst.tags || []).forEach((tid) => tid && refs.add(tid));
  });
  return Array.from(refs);
}

/**
 * Verifica se o aluno deve aparecer na listagem ao filtrar por tags.
 * Aluno aparece se TODAS as tags filtradas estiverem presentes em:
 *   - tags do aluno OU
 *   - tags de pelo menos uma parcela.
 */
export function studentMatchesTagFilter(student: Student, tagFilters: string[]): boolean {
  if (tagFilters.length === 0) return true;
  return tagFilters.every((tid) => {
    if ((student.tags || []).includes(tid)) return true;
    return (student.installments || []).some((inst) => (inst.tags || []).includes(tid));
  });
}

/**
 * Quando há filtro de tag ativo, retorna apenas as parcelas relevantes:
 *   - Se a tag está no aluno (e não em parcelas), retorna TODAS as parcelas
 *   - Se a tag está em parcelas específicas, retorna SÓ essas parcelas
 *   - Se a tag está em ambos, retorna as parcelas marcadas (mais específico vence)
 */
export function getFilteredInstallments(student: Student, tagFilters: string[]): Installment[] {
  if (tagFilters.length === 0) return student.installments || [];

  // Para cada tag filtrada, descobrir se há parcelas marcadas com ela
  const installmentsWithAnyFilteredTag = (student.installments || []).filter((inst) =>
    tagFilters.some((tid) => (inst.tags || []).includes(tid))
  );

  // Se nenhuma parcela tem as tags filtradas, mas o aluno tem → todas as parcelas
  if (installmentsWithAnyFilteredTag.length === 0) {
    const allOnStudent = tagFilters.every((tid) => (student.tags || []).includes(tid));
    if (allOnStudent) return student.installments || [];
    return [];
  }

  // Filtra parcelas que possuem TODAS as tags filtradas (mesma semântica do AND)
  return (student.installments || []).filter((inst) => {
    return tagFilters.every((tid) => {
      if ((inst.tags || []).includes(tid)) return true;
      // Tag também pode estar no nível do aluno
      return (student.tags || []).includes(tid);
    });
  });
}

/**
 * Recalcula status financeiro com base apenas nas parcelas filtradas.
 */
export function calculateStatusFromInstallments(installments: Installment[]): StudentStatus {
  if (installments.length === 0) return 'Em Dia';
  const today = getTodayBrasilia();

  const unpaid = installments.filter((i) => !i.paid);
  if (unpaid.length === 0) return 'Pago';

  const overdue = unpaid.filter((i) => effectiveDueDate(i.dueDate).getTime() < today.getTime());
  if (overdue.length === 0) return 'Em Dia';

  // A parcela vencida mais antiga define a faixa (mesma regra de
  // calculateAutoStatus): 1º mês Vencido 1, 2º mês Vencido 2, 3º mês em diante
  // À Negativar — onde permanece até ser marcado manualmente como "Negativado".
  const oldestOverdue = overdue.reduce((oldest, curr) =>
    effectiveDueDate(curr.dueDate).getTime() < effectiveDueDate(oldest.dueDate).getTime() ? curr : oldest,
  );
  return faixaAtrasoPorMes(oldestOverdue.dueDate, today);
}

/**
 * Aplica filtro de tag a um aluno: retorna o aluno com installments e status
 * recalculados quando há filtro ativo. Quando não há filtro, retorna o original.
 */
export function applyTagFilterToStudent(student: Student, tagFilters: string[]): Student {
  if (tagFilters.length === 0) return student;
  const filteredInst = getFilteredInstallments(student, tagFilters);
  // Recalcula installmentValue como média dos pendentes filtrados (para exibição)
  const unpaidFiltered = filteredInst.filter((i) => !i.paid);
  const avgValue =
    unpaidFiltered.length > 0
      ? unpaidFiltered.reduce((a, i) => a + i.value, 0) / unpaidFiltered.length
      : student.installmentValue;
  return {
    ...student,
    installments: filteredInst,
    totalInstallments: filteredInst.length,
    paidInstallments: filteredInst.filter((i) => i.paid).length,
    installmentValue: avgValue,
    status: calculateStatusFromInstallments(filteredInst),
  };
}
