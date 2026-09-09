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

/**
 * Recompra cujo saldo em aberto foi levado para a renegociação do contrato de
 * origem (gravado em `depois.recomprasIncorporadas` do item de conciliação).
 */
export interface RecompraIncorporada {
  studentId: string;
  studentName: string;
  product: string;
  /** Números das parcelas da recompra que entraram no saldo renegociado. */
  parcelas: number[];
  /** Soma dessas parcelas. */
  valor: number;
}

/**
 * Recompras vinculadas que ainda têm saldo em aberto — candidatas a entrar na
 * renegociação do contrato de origem. Fichas canceladas ficam de fora.
 */
export function findRecomprasComSaldo(original: Student, students: Student[]): Student[] {
  return findRecomprasVinculadas(original, students).filter(
    (r) => contaNoStatusConjunto(r) && (r.installments ?? []).some((i) => !i.paid),
  );
}

/** Parcelas em aberto da ficha + soma (o que entra no saldo renegociado). */
export function recompraSaldoAberto(ficha: Student): { parcelas: Installment[]; valor: number } {
  const parcelas = (ficha.installments ?? []).filter((i) => !i.paid);
  return { parcelas, valor: parcelas.reduce((a, i) => a + (i.value || 0), 0) };
}

/**
 * Outros treinamentos do mesmo aluno (fichas que não são recompra) com saldo em
 * aberto — podem ser juntados à renegociação, mas só se o AC marcar (ao contrário
 * da recompra vinculada, que entra por padrão).
 */
export function findOutrosContratosComSaldo(original: Student, students: Student[]): Student[] {
  return students.filter(
    (s) =>
      !isRecompraFicha(s) &&
      sameAluno(original, s) &&
      contaNoStatusConjunto(s) &&
      (s.installments ?? []).some((i) => !i.paid),
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
 * sobrescreve. Fora disso:
 *  - se o outro lado do vínculo está Negativado (é o mesmo contrato), a ficha
 *    aparece Negativado também — a recompra não pode ficar "Vencido 2" com o
 *    treinamento de origem já negativado;
 *  - senão, o status é calculado sobre a união das parcelas do grupo, e a
 *    parcela vencida da recompra conta como vencida.
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

  const outroNegativado = [group.original, ...group.recompras].some(
    (s) => s.id !== student.id && contaNoStatusConjunto(s) && s.status === 'Negativado',
  );
  if (outroNegativado) {
    return { status: 'Negativado', installments, group, puxadoDoVinculo: own !== 'Negativado' };
  }

  const status = calculateAutoStatus(installments, { includeRecompraParcelas: true });
  return { status, installments, group, puxadoDoVinculo: status !== own };
}

/**
 * Status para tabelas/KPIs fora da aba Alunos (Carteira do AC, Dashboard):
 * usa o vínculo quando a ficha participa de um grupo recompra ↔ original e,
 * fora disso, a leitura própria (`resolveStudentDisplayStatus`).
 */
export function resolveStudentStatusComVinculo(student: Student, students: Student[]): StudentStatus {
  return resolveStudentDisplayStatusVinculado(student, students).status;
}
