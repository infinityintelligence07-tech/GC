// ─── Conciliação imediata (atalho admin/conciliação na aba Alunos) ────────
// Quando uma alteração é registrada com `executaImediatamente: true`, o item
// é gravado já como 'conciliado' E as mudanças são aplicadas direto no aluno,
// sem precisar passar pela aba Conciliação. Esta função centraliza o "apply"
// para cada tipo de alteração suportada.

import { useAppStore } from '@/store/useAppStore';
import { applyConciliacaoEfetivacao } from '@/lib/conciliacaoApply';
import type { ConciliacaoItem, HistoryEntry, Installment } from '@/types';

function fmtBR(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pushHistory(studentId: string, text: string) {
  const store = useAppStore.getState();
  const st = store.students.find((s) => s.id === studentId);
  if (!st) return;
  const entry: HistoryEntry = {
    date: new Date().toISOString(),
    type: 'Sistema',
    text,
  };
  store.updateStudent(studentId, { history: [...(st.history ?? []), entry] });
}

export function applyConciliacaoImmediate(item: ConciliacaoItem): boolean {
  const after = (item.depois as Record<string, unknown>)?._after;
  if (after && typeof after === 'object') {
    return applyConciliacaoEfetivacao(item);
  }

  if (!item.studentId) return false;
  const store = useAppStore.getState();
  const st = store.students.find((s) => s.id === item.studentId);
  if (!st) return false;

  const todayIso = new Date().toISOString().split('T')[0];
  const depois = (item.depois ?? {}) as Record<string, unknown>;

  if (item.tipo === 'pagamento_parcela') {
    const parcelaNum = Number(depois.parcela);
    const valorPago = Number(depois.valor);
    if (!Number.isFinite(parcelaNum)) return false;
    const paidDate =
      typeof depois.paidDate === 'string' && depois.paidDate ? depois.paidDate : todayIso;
    const paidMarkedAt =
      typeof depois.paidMarkedAt === 'string' && depois.paidMarkedAt
        ? depois.paidMarkedAt
        : new Date().toISOString();
    const updatedInst: Installment[] = st.installments.map((i) => {
      if (i.number !== parcelaNum) return i;
      const paidValueField =
        Number.isFinite(valorPago) && Math.abs(valorPago - i.value) > 0.01
          ? { paidValue: valorPago }
          : {};
      return { ...i, paid: true, paidDate, paidMarkedAt, ...paidValueField };
    });
    store.updateStudent(st.id, {
      installments: updatedInst,
      paidInstallments: updatedInst.filter((i) => i.paid).length,
    });
    pushHistory(
      st.id,
      `Pagamento da parcela ${parcelaNum} conciliado automaticamente${Number.isFinite(valorPago) ? ` (${fmtBR(valorPago)})` : ''}.`,
    );
    return true;
  }

  if (item.tipo === 'quitacao') {
    const updatedInst: Installment[] = st.installments.map((i) =>
      !i.paid ? { ...i, paid: true, paidDate: todayIso } : i,
    );
    const valorPago = Number(depois.valorPago);
    const desconto = Number(depois.desconto);
    store.updateStudent(st.id, {
      installments: updatedInst,
      paidInstallments: updatedInst.length,
    });
    pushHistory(
      st.id,
      `Quitação conciliada automaticamente${Number.isFinite(valorPago) ? ` — valor pago ${fmtBR(valorPago)}` : ''}${Number.isFinite(desconto) && desconto > 0 ? ` (desconto ${fmtBR(desconto)})` : ''}.`,
    );
    return true;
  }

  if (item.tipo === 'renegociacao') {
    const novasParcelas = depois.novasParcelas as
      | Array<{ number: number; dueDate: string; value: number; paid?: boolean; paidDate?: string }>
      | undefined;
    if (!Array.isArray(novasParcelas)) return false;
    const novoSaleValue = Number(depois.saleValue);
    const novoTotal = Number(depois.totalParcelas);
    const novoValor = Number(depois.valorParcela);
    const novaEntrada = Number(depois.entrada) || 0;
    const allInst: Installment[] = novasParcelas.map((i, idx) => ({
      ...i,
      number: idx + 1,
      paid: !!i.paid,
    }));
    const downPayAtual = Number(st.downPayment) || 0;
    store.updateStudent(st.id, {
      installments: allInst,
      totalInstallments: Number.isFinite(novoTotal) ? novoTotal : allInst.length,
      installmentValue: Number.isFinite(novoValor) ? novoValor : st.installmentValue,
      saleValue: Number.isFinite(novoSaleValue) ? novoSaleValue : st.saleValue,
      downPayment: downPayAtual + novaEntrada,
      paidInstallments: allInst.filter((i) => i.paid).length,
    });
    pushHistory(st.id, `Renegociação conciliada automaticamente — ${item.resumo}`);
    return true;
  }

  // Demais tipos sem draftAfter: nada a aplicar automaticamente.
  return false;
}
