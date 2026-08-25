import type { CancellationCase, Student } from '@/types';
import { isSolicitacaoCancelamento } from '@/lib/acPortfolioVisibility';

function normalizeStudentName(name?: string | null): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Últimos 2 tokens do nome — ajuda a casar "MARI GOMES ROCHA" ↔ "MARILEUSA GOMES ROCHA". */
function studentNameSuffix(name: string): string {
  const parts = normalizeStudentName(name).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(' ');
  return normalizeStudentName(name);
}

function studentMatchesCaseName(student: Student, caseName: string): boolean {
  const sn = normalizeStudentName(student.name);
  const cn = normalizeStudentName(caseName);
  if (!sn || !cn) return false;
  if (sn === cn) return true;
  return studentNameSuffix(student.name) === studentNameSuffix(caseName);
}

/** Estágios legados considerados reversão. */
const RECOVERED_STAGES = new Set(['Recuperado', 'Negativação Retirada']);

/**
 * Caso revertido: funil novo (`acao=Revertido`) ou estágio legado recuperado.
 */
export function isCancellationCaseRevertido(c: CancellationCase): boolean {
  if (c.acao === 'Revertido') return true;
  if (RECOVERED_STAGES.has(c.stage)) return true;
  const revertidas = c.inscricoesRevertidas ?? 0;
  if (revertidas > 0 && c.funnelStage === 'Finalizado') return true;
  return false;
}

/** Data de referência do caso para filtro de período (criação). */
export function cancellationCaseRefDate(c: CancellationCase): Date {
  return new Date(c.createdAt);
}

export function isCancellationCaseInRange(
  c: CancellationCase,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!range) return true;
  const t = cancellationCaseRefDate(c).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/**
 * Data em que a reversão foi registrada (histórico / move / createdAt).
 * Usada quando o filtro deve olhar “quando reverteu”, não “quando pediu”.
 */
export function cancellationRevertedAt(c: CancellationCase): Date {
  const hist = [...(c.history ?? [])]
    .filter((h) => {
      const note = (h.note ?? '').toLowerCase();
      const to = (h.to ?? '').toLowerCase();
      return (
        note.includes('revert') ||
        to === 'recuperado' ||
        to === 'negativação retirada' ||
        (h as { acao?: string }).acao === 'Revertido'
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (hist[0]?.date) return new Date(hist[0].date);
  if (c.acao === 'Revertido' && c.movedToCurrentStageAt) {
    return new Date(c.movedToCurrentStageAt);
  }
  return new Date(c.movedToCurrentStageAt || c.createdAt);
}

export function isRevertidoInRange(
  c: CancellationCase,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!isCancellationCaseRevertido(c)) return false;
  if (!range) return true;
  const t = cancellationRevertedAt(c).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Pedido de cancelamento ativo no aluno (KPI Solicitação). */
export function studentHasPedidoCancelamento(s: Student): boolean {
  return isSolicitacaoCancelamento(s);
}

/** IDs de alunos vinculados a casos revertidos (filtro do card Revertidos). */
export function studentIdsFromRevertidosCases(
  cases: CancellationCase[],
  students: Student[],
  acName?: string,
): Set<string> {
  const ids = new Set<string>();
  const scoped = acName ? students.filter((s) => s.ac === acName) : students;

  const add = (s: Student) => {
    if (!acName || s.ac === acName) ids.add(s.id);
  };

  for (const c of cases) {
    if (c.studentId) {
      const byId = scoped.find((s) => s.id === c.studentId);
      if (byId) add(byId);
    }

    scoped.filter((s) => s.cancellationCaseId === c.id).forEach(add);

    const byExactName = scoped.filter((s) => normalizeStudentName(s.name) === normalizeStudentName(c.studentName));
    if (byExactName.length === 1) byExactName.forEach(add);

    if (!c.studentId && c.studentName) {
      const bySuffix = scoped.filter((s) => studentMatchesCaseName(s, c.studentName));
      if (bySuffix.length === 1) bySuffix.forEach(add);
    }
  }

  scoped.filter((s) => s.statusCancelamento === 'revertido').forEach(add);

  return ids;
}
