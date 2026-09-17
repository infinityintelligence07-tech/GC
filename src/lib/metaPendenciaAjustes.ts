import type { Student } from '@/types';
import { getEntradaPendenteInstallments } from '@/lib/studentDisplayStatus';

/** Meta padrão (R$) da fita "Pago · mês vigente" quando ainda não há meta salva. */
export const EM_DIA_NOVOS_META_PADRAO = 144500;

/** Item de pendência que explica acréscimo na meta do mês. */
export interface MetaPendenciaItem {
  studentId: string;
  studentName: string;
  product: string;
  value: number;
  dueDate?: string;
  tipo: string;
}

/** Pendências de entrada em aberto (entrada-pendente / entrada-restante) na carteira. */
export function listMetaPendenciaItems(students: Student[]): MetaPendenciaItem[] {
  const items: MetaPendenciaItem[] = [];
  for (const s of students) {
    for (const inst of getEntradaPendenteInstallments(s)) {
      items.push({
        studentId: s.id,
        studentName: s.name,
        product: s.product,
        value: Number(inst.value) || 0,
        dueDate: inst.dueDate,
        tipo: 'Entrada pendente',
      });
    }
  }
  return items.sort((a, b) => b.value - a.value || a.studentName.localeCompare(b.studentName, 'pt-BR'));
}

export function sumMetaPendenciaItems(items: MetaPendenciaItem[]): number {
  return items.reduce((acc, i) => acc + i.value, 0);
}

/**
 * Acréscimo da meta em relação ao padrão do app (ex.: 154500 − 144500 = 10000).
 * Se a meta salva for ≤ ao padrão, não há acréscimo.
 */
export function metaAcrescimoSobrePadrao(
  metaAtual: number,
  base: number = EM_DIA_NOVOS_META_PADRAO,
): number {
  return Math.max(0, Math.round((metaAtual - base) * 100) / 100);
}

/**
 * Escolhe quais pendências explicam o acréscimo da meta:
 * 1) item único com o mesmo valor do acréscimo;
 * 2) senão, subconjunto guloso que fecha o acréscimo;
 * 3) senão, lista vazia (o UI mostra o acréscimo + pendências em aberto à parte).
 */
export function pickPendenciasDoAcrescimo(
  items: MetaPendenciaItem[],
  acrescimo: number,
): MetaPendenciaItem[] {
  if (acrescimo <= 0.0049 || items.length === 0) return [];
  const exact = items.filter((i) => Math.abs(i.value - acrescimo) < 0.05);
  if (exact.length >= 1) return [exact[0]];

  let restante = acrescimo;
  const picked: MetaPendenciaItem[] = [];
  for (const i of items) {
    if (i.value <= restante + 0.05) {
      picked.push(i);
      restante = Math.round((restante - i.value) * 100) / 100;
      if (restante <= 0.05) break;
    }
  }
  if (restante <= 0.05 && picked.length > 0) return picked;
  return [];
}

function formatDueBR(iso?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatMetaPendenciaDue(iso?: string): string {
  return formatDueBR(iso);
}
