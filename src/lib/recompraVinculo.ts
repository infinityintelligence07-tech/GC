// ─── Recompra ↔ contrato original ────────────────────────────────────────────
// Depois do vínculo feito na Conciliação (`recompraTreinamento`), a recompra e o
// treinamento de origem são tratados como "um contrato só" para leitura de
// status: se um lado está devendo, os dois aparecem devendo. As fichas
// continuam separadas (parcelas, valores e carteira do AC não se misturam).

import type { Installment, Student, StudentStatus } from '@/types';
import { calculateAutoStatus } from '@/store/useAppStore';
import { isRecompraFicha } from '@/lib/recompraConciliacao';
import { cancelamentoOverridesFinancialStatus } from '@/lib/acPortfolioVisibility';
import { isOperationalPendente, resolveStudentDisplayStatus } from '@/lib/studentDisplayStatus';

export interface RecompraVinculoGroup {
  /** Contrato do treinamento de origem. */
  original: Student;
  /** Recompras vinculadas a esse treinamento (mesmo aluno). */
  recompras: Student[];
}

function normName(name?: string | null): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normProduct(p?: string | null): string {
  return normName(p);
}

function sameAluno(a: Student, b: Student): boolean {
  if (a.id === b.id) return false;
  const cpfA = (a.cpf ?? '').replace(/\D/g, '');
  const cpfB = (b.cpf ?? '').replace(/\D/g, '');
  if (cpfA && cpfB) return cpfA === cpfB;
  return normName(a.name) === normName(b.name);
}

/** Contrato de origem de uma recompra já vinculada. */
export function findRecompraOriginal(recompra: Student, students: Student[]): Student | undefined {
  if (!isRecompraFicha(recompra) || !recompra.recompraTreinamento) return undefined;
  const alvo = normProduct(recompra.recompraTreinamento);
  const candidatos = students.filter(
    (s) => !isRecompraFicha(s) && normProduct(s.product) === alvo && sameAluno(recompra, s),
  );
  if (candidatos.length <= 1) return candidatos[0];
  // Homônimos com o mesmo treinamento: prefere o contrato que ainda tem saldo.
  return candidatos.find((s) => s.installments.some((i) => !i.paid)) ?? candidatos[0];
}

/** Recompras vinculadas a um contrato de origem. */
export function findRecomprasVinculadas(original: Student, students: Student[]): Student[] {
  if (isRecompraFicha(original)) return [];
  const prod = normProduct(original.product);
  if (!prod) return [];
  return students.filter(
    (s) =>
      isRecompraFicha(s) &&
      !!s.recompraTreinamento &&
      normProduct(s.recompraTreinamento) === prod &&
      sameAluno(original, s) &&
      // A recompra só pertence a este contrato se ele for o "original" dela
      // (evita puxar para um homônimo).
      findRecompraOriginal(s, students)?.id === original.id,
  );
}

/** Grupo vinculado do qual a ficha faz parte (ou null se não há vínculo). */
export function getRecompraVinculoGroup(student: Student, students: Student[]): RecompraVinculoGroup | null {
  if (isRecompraFicha(student)) {
    const original = findRecompraOriginal(student, students);
    if (!original) return null;
    return { original, recompras: findRecomprasVinculadas(original, students) };
  }
  const recompras = findRecomprasVinculadas(student, students);
  if (recompras.length === 0) return null;
  return { original: student, recompras };
}

function contaNoStatusConjunto(s: Student): boolean {
  if (s.statusCancelamento === 'cancelado' || s.status === 'Cancelado' || s.status === 'Excluído') return false;
  if (cancelamentoOverridesFinancialStatus(s)) return false;
  return true;
}

/** Parcelas de todas as fichas do grupo (só as que entram no status conjunto). */
export function getVinculoInstallments(group: RecompraVinculoGroup): Installment[] {
  return [group.original, ...group.recompras]
    .filter(contaNoStatusConjunto)
    .flatMap((s) => s.installments ?? []);
}

export interface StatusVinculado {
  status: StudentStatus;
  /** Parcelas usadas no cálculo (do grupo, quando vinculado; senão, da própria ficha). */
  installments: Installment[];
  group: RecompraVinculoGroup | null;
  /** O status exibido veio do conjunto (difere do que a ficha teria sozinha). */
  puxadoDoVinculo: boolean;
}

/**
 * Status de exibição considerando o vínculo recompra ↔ original.
 *
 * Mantém a leitura própria quando a ficha está em cancelamento, Negativado,
 * Pendente operacional ou com status Manual — nesses casos o vínculo não
 * sobrescreve. Fora disso, o status é calculado sobre a união das parcelas do
 * grupo, e a parcela vencida da recompra conta como vencida.
 */
export function resolveStudentDisplayStatusVinculado(student: Student, students: Student[]): StatusVinculado {
  const own = resolveStudentDisplayStatus(student);
  const proprio = (group: RecompraVinculoGroup | null): StatusVinculado => ({
    status: own,
    installments: student.installments ?? [],
    group,
    puxadoDoVinculo: false,
  });

  const group = getRecompraVinculoGroup(student, students);
  if (!group) return proprio(null);
  if (!contaNoStatusConjunto(student)) return proprio(group);
  if (student.status === 'Negativado' || isOperationalPendente(student)) return proprio(group);
  if (student.statusMode !== 'Automático') return proprio(group);

  const installments = getVinculoInstallments(group);
  if (installments.length === 0) return proprio(group);
  const status = calculateAutoStatus(installments, { includeRecompraParcelas: true });
  return { status, installments, group, puxadoDoVinculo: status !== own };
}
