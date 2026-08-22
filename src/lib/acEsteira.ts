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
 * Produtos que NÃO entram na esteira automática (IPR / Imersão Prosperar /
 * Imersão de Negócios). Ficam sem AC até atribuição manual (ou AC já informado).
 */
export function isProductExcludedFromEsteira(product?: string | null): boolean {
  const p = normalizeProductName(product);
  if (!p) return false;
  if (p === 'ipr' || p.startsWith('ipr ') || p.endsWith(' ipr') || p.includes(' ipr ')) return true;
  if (p.includes('imersao prosperar')) return true;
  if (p.includes('imersao de negocios')) return true;
  return false;
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

/**
 * AC de uma ficha já existente com mesmo CPF+ciclo (não avança a fila).
 * Retorna o nome do assessor ou null.
 */
export function findExistingStudentAc(
  students: Student[],
  cpf?: string | null,
  ciclo?: string | null,
  excludeId?: string,
): string | null {
  const key = cpfCicloKey(cpf, ciclo);
  if (!normalizeCpfDigits(cpf)) return null;
  const hit = students.find(
    (s) =>
      s.id !== excludeId &&
      cpfCicloKey(s.cpf, s.ciclo) === key &&
      isAcFilled(s.ac),
  );
  return hit?.ac?.trim() ?? null;
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
