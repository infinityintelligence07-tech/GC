// Esteira de assessores — espelho client-side das regras do trigger
// `students_assign_ac_esteira` (ordem + próximo AC). A atribuição real
// acontece no INSERT via banco; estas helpers servem UI/preview.

import type { AC, Student } from '@/types';

export function isAcFilled(ac?: string | null): boolean {
  return Boolean(ac && ac.trim());
}

export function normalizeCpfDigits(cpf?: string | null): string {
  return (cpf ?? '').replace(/\D/g, '');
}

export function normalizeCiclo(ciclo?: string | null): string {
  return (ciclo ?? '').trim().toLowerCase();
}

export function cpfCicloKey(cpf?: string | null, ciclo?: string | null): string {
  return `${normalizeCpfDigits(cpf)}|${normalizeCiclo(ciclo)}`;
}

/** Normaliza nome de produto para comparação (minúsculas, sem acento). */
export function normalizeProductName(product?: string | null): string {
  return (product ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * IPR / Imersão Prosperar / Imersão de Negócios — fora do escopo do GC
 * (sync IAM, esteira e carteira).
 */
export function isProductExcludedFromGc(product?: string | null): boolean {
  const p = normalizeProductName(product);
  if (!p) return false;
  if (p === 'ipr' || p.startsWith('ipr ') || p.endsWith(' ipr') || p.includes(' ipr ')) return true;
  if (p.includes('imersao prosperar')) return true;
  if (p.includes('imersao de negocios')) return true;
  return false;
}

/** @deprecated Use isProductExcludedFromGc — mesma regra da esteira. */
export function isProductExcludedFromEsteira(product?: string | null): boolean {
  return isProductExcludedFromGc(product);
}

/** Ordem estável dos ACs ativos (created_at, depois name) — igual ao SQL. */
export function orderActiveAcs(acs: AC[]): AC[] {
  return acs
    .filter((a) => a.active)
    .slice()
    .sort((a, b) => {
      const ca = a.createdAt ?? '';
      const cb = b.createdAt ?? '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
}

/** Normaliza nome de pessoa para comparação (minúsculas, sem acento). */
export function normalizePersonName(name?: string | null): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * AC de outra ficha da mesma pessoa (qualquer treinamento/ciclo).
 * 1) Mesmo CPF com AC preenchido
 * 2) Fallback: mesmo nome normalizado (quando CPF não bate entre fichas)
 */
export function findExistingStudentAc(
  students: Student[],
  cpf?: string | null,
  _ciclo?: string | null,
  excludeId?: string,
  name?: string | null,
): string | null {
  const cpfDigits = normalizeCpfDigits(cpf);
  if (cpfDigits.length >= 11) {
    const byCpf = students.find(
      (s) =>
        s.id !== excludeId &&
        normalizeCpfDigits(s.cpf) === cpfDigits &&
        isAcFilled(s.ac),
    );
    if (byCpf?.ac) return byCpf.ac.trim();
  }

  const nameKey = normalizePersonName(name);
  if (!nameKey) return null;

  const byName = students.find(
    (s) =>
      s.id !== excludeId &&
      normalizePersonName(s.name) === nameKey &&
      isAcFilled(s.ac),
  );
  return byName?.ac?.trim() ?? null;
}

/**
 * Próximo AC da esteira sem mutar estado.
 * Se `lastAssignedAcId` não estiver na lista ativa, começa do primeiro.
 */
export function peekNextAc(
  acs: AC[],
  lastAssignedAcId: string | null | undefined,
): AC | null {
  const ordered = orderActiveAcs(acs);
  if (ordered.length === 0) return null;
  if (!lastAssignedAcId) return ordered[0];
  const idx = ordered.findIndex((a) => a.id === lastAssignedAcId);
  if (idx < 0) return ordered[0];
  return ordered[(idx + 1) % ordered.length];
}
