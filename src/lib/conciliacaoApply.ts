// ─── Efetivação de rascunhos da Conciliação ──────────────────────────────────
// Quando uma alteração é registrada como RASCUNHO (`depois._after` presente),
// o aluno NÃO é alterado no momento do envio. As mudanças ficam pendentes na
// aba Conciliação e só são aplicadas quando o setor clicar em "Conciliar"
// (sub-aba Aprovados). Este módulo centraliza essa aplicação.

import { useAppStore } from '@/store/useAppStore';
import type { ConciliacaoItem, Student, HistoryEntry, Installment } from '@/types';

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const APPLY_KEYS: (keyof Student)[] = [
  'installments',
  'totalInstallments',
  'paidInstallments',
  'installmentValue',
  'saleValue',
  'downPayment',
  'dueDay',
  'statusCancelamento',
  'cancellationCaseId',
  'isRendaExtra',
  'rendaExtraStatus',
  'rendaExtraAcordoValue',
  'product',
  'productHistory',
];

export function isDraftItem(item: ConciliacaoItem): boolean {
  const after = (item.depois as Record<string, unknown>)?._after;
  return !!after && typeof after === 'object';
}

/**
 * Reordena as parcelas por data de vencimento e renumera 1..N.
 * Quando o novo número difere do anterior, preenche `numeroOriginal` e
 * grava uma observação (ex.: "Antes era Parcela 2 — vencimento alterado").
 * Mantém parcelas pagas em suas posições cronológicas naturais.
 */
function renumberInstallmentsAfterConciliacao(
  next: Installment[],
  prev: Installment[],
): { installments: Installment[]; changes: string[] } {
  const prevByNum = new Map(prev.map((p) => [p.number, p]));
  const sorted = [...next].sort(
    (a, b) =>
      parseDateLocal(a.dueDate).getTime() - parseDateLocal(b.dueDate).getTime() ||
      a.number - b.number,
  );
  const changes: string[] = [];
  const total = sorted.length;
  const renumbered = sorted.map((inst, idx) => {
    const novoNum = idx + 1;
    if (inst.number === novoNum) return inst;
    const original = inst.numeroOriginal ?? inst.number;
    const before = prevByNum.get(inst.number);
    const dateChanged = before && before.dueDate !== inst.dueDate;
    const posLabel = novoNum === total ? 'última parcela' : `Parcela ${novoNum}`;
    const obs = dateChanged
      ? `Antes era Parcela ${original} (venc. ${before!.dueDate}) — agora é ${posLabel} (venc. ${inst.dueDate}).`
      : `Antes era Parcela ${original} — agora é ${posLabel}.`;
    changes.push(`Parcela ${original} → ${posLabel}`);
    return {
      ...inst,
      number: novoNum,
      numeroOriginal: original,
      observacao: obs,
    };
  });
  return { installments: renumbered, changes };
}

/**
 * Aplica o `depois._after` do item rascunho no aluno e adiciona uma entrada
 * no histórico informando a efetivação. Retorna true se aplicou.
 */
export function applyConciliacaoEfetivacao(
  item: ConciliacaoItem,
  opts?: { upfront?: boolean },
): boolean {
  if (!isDraftItem(item)) return false;
  if (!item.studentId) return false;
  const store = useAppStore.getState();
  const student = store.students.find((s) => s.id === item.studentId);
  if (!student) return false;

  const after = (item.depois as Record<string, unknown>)._after as Record<string, unknown>;
  const updates: Partial<Student> = {};
  // Rascunhos que não são do fluxo de cancelamento (correção de contrato,
  // renegociação, etc.) podem ter sido criados ANTES de uma reversão/cancelamento.
  // Aplicar o snapshot antigo faria o aluno voltar para "Solicitação Cancelamento"
  // mesmo com o caso já revertido — por isso esses campos são ignorados aqui.
  const isCancellationFlowItem = item.tipo === 'cancelamento' || item.tipo === 'reversao';
  const STALE_CANCEL_KEYS: (keyof Student)[] = ['statusCancelamento', 'cancellationCaseId'];
  for (const k of APPLY_KEYS) {
    if (!isCancellationFlowItem && STALE_CANCEL_KEYS.includes(k)) continue;
    if (Object.prototype.hasOwnProperty.call(after, k)) {
      (updates as Record<string, unknown>)[k as string] = after[k as string];
    }
  }

  // Renumeração pós-conciliação: se as parcelas foram alteradas, reordena
  // por vencimento e renumera. Preserva histórico do número anterior.
  let renumberNote = '';
  if (Array.isArray(updates.installments)) {
    const snapshot = (item.antes as Record<string, unknown>)?._snapshot as
      | Record<string, unknown>
      | undefined;
    const prevInst =
      (Array.isArray(snapshot?.installments)
        ? (snapshot!.installments as Installment[])
        : student.installments) ?? [];
    const { installments: renum, changes } = renumberInstallmentsAfterConciliacao(
      updates.installments as Installment[],
      prevInst,
    );
    updates.installments = renum;
    if (changes.length) {
      renumberNote = ` | Renumeração: ${changes.join('; ')}`;
    }
  }

  const entry: HistoryEntry = {
    date: new Date().toISOString(),
    type: 'Sistema',
    text: opts?.upfront
      ? `Alteração aplicada imediatamente (aguardando double-check da Conciliação) — ${item.resumo}${renumberNote}`
      : `Alteração conciliada e efetivada — ${item.resumo}${renumberNote}`,
  };
  updates.history = [...(student.history ?? []), entry];

  store.updateStudent(student.id, updates);
  return true;
}
