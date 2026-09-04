import type { Student } from '@/types';

/**
 * Normaliza nome de aluno para comparação: sem acento, minúsculo, espaços
 * duplos colapsados. Espelha `public.gc_nome_norm()` no banco — "Marina
 * Brandão Pereira" e "MARINA BRANDAO PEREIRA" precisam casar.
 */
export function normalizeNomeAluno(nome: string | null | undefined): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ficha única com esse nome na carteira. Retorna `undefined` quando não há
 * ficha ou quando há homônimos (casar por nome vincularia ao contrato errado).
 */
export function findUnicoAlunoPorNome(students: Student[], nome: string): Student | undefined {
  const alvo = normalizeNomeAluno(nome);
  if (!alvo) return undefined;
  const matches = students.filter((s) => normalizeNomeAluno(s.name) === alvo);
  return matches.length === 1 ? matches[0] : undefined;
}
