import type { CancellationCase } from '@/types';

/** Extrai o AC original gravado nas notas do caso (`| AC: Nome |`). */
export function parseAcFromCancellationNotes(notes?: string): string {
  if (!notes) return '';
  const m = notes.match(/\|\s*AC:\s*([^|]+)/i);
  return m?.[1]?.trim() ?? '';
}

/**
 * AC de carteira do primeiro cancelamento — usado quando o aluno reverteu
 * e solicita cancelamento de novo.
 */
export function resolveOriginalCancellationAc(c: CancellationCase): string {
  const fromNotes = parseAcFromCancellationNotes(c.notes);
  if (fromNotes) return fromNotes;
  return (c.ac ?? '').trim();
}
