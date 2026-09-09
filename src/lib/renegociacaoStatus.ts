// ─── Status "Em Renegociação" ────────────────────────────────────────────────
// Quando o AC salva um rascunho de renegociação (ou envia a proposta para a
// Conciliação), a ficha passa a exibir o status manual "Em Renegociação" até a
// renegociação ser aprovada, reprovada ou o rascunho descartado. Aqui ficam os
// patches de entrada/saída desse status, para os vários pontos do fluxo
// (FinancialModal, ConciliacaoPage, conciliacaoRevert) fazerem a mesma coisa.

import type { HistoryEntry, Student, StudentStatus } from '@/types';
import { calculateStudentAutoStatus } from '@/store/useAppStore';

export const STATUS_EM_RENEGOCIACAO: StudentStatus = 'Em Renegociação';

/** Status/modo que a ficha tinha antes de entrar em renegociação (para restaurar). */
export interface StatusAnteriorRenegociacao {
  status: StudentStatus;
  statusMode: Student['statusMode'];
}

export function isEmRenegociacao(s: Pick<Student, 'status'>): boolean {
  return s.status === STATUS_EM_RENEGOCIACAO;
}

function entrada(text: string): HistoryEntry {
  return { date: new Date().toISOString(), type: 'Sistema', text };
}

/** Snapshot do status atual, para voltar a ele se a renegociação não for adiante. */
export function capturarStatusAnterior(s: Student): StatusAnteriorRenegociacao | undefined {
  if (isEmRenegociacao(s)) return undefined;
  return { status: s.status, statusMode: s.statusMode };
}

/**
 * Patch que coloca a ficha em "Em Renegociação". Devolve null quando não se
 * aplica (já está nesse status, ou a ficha está cancelada/excluída).
 */
export function buildEntrarRenegociacaoPatch(s: Student, autor: string, motivo: string): Partial<Student> | null {
  if (isEmRenegociacao(s)) return null;
  if (s.status === 'Cancelado' || s.status === 'Excluído' || s.statusCancelamento === 'cancelado') return null;
  return {
    status: STATUS_EM_RENEGOCIACAO,
    statusMode: 'Manual',
    history: [...(s.history ?? []), entrada(`Status alterado para "Em Renegociação" por ${autor} — ${motivo}.`)],
  };
}

/**
 * Patch que tira a ficha de "Em Renegociação". Se havia um status manual antes
 * (ex.: Negativado) e `restaurarAnterior` vier preenchido, volta para ele; senão
 * volta ao modo Automático, recalculando pelas parcelas (`installments` permite
 * calcular já sobre o novo plano, na aprovação).
 */
export function buildSairRenegociacaoPatch(
  s: Student,
  motivo: string,
  opts: { anterior?: StatusAnteriorRenegociacao | null; installments?: Student['installments'] } = {},
): Partial<Student> | null {
  if (!isEmRenegociacao(s)) return null;
  const anterior = opts.anterior ?? null;
  const restauraManual = anterior && anterior.statusMode === 'Manual' && anterior.status !== STATUS_EM_RENEGOCIACAO;
  const base: Student = opts.installments ? { ...s, installments: opts.installments } : s;
  const status: StudentStatus = restauraManual ? anterior.status : calculateStudentAutoStatus(base);
  const statusMode: Student['statusMode'] = restauraManual ? 'Manual' : 'Automático';
  return {
    status,
    statusMode,
    history: [
      ...(s.history ?? []),
      entrada(`Saiu de "Em Renegociação" (${motivo}) — status ${statusMode === 'Manual' ? `manual "${status}" restaurado` : `automático: "${status}"`}.`),
    ],
  };
}

/** Lê o status anterior gravado no item de conciliação (`antes.statusAnterior`). */
export function lerStatusAnterior(v: unknown): StatusAnteriorRenegociacao | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.status !== 'string') return null;
  return {
    status: r.status as StudentStatus,
    statusMode: r.statusMode === 'Manual' ? 'Manual' : 'Automático',
  };
}
