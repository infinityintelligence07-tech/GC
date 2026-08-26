// ─── Conciliação imediata (atalho admin/conciliação na aba Alunos) ────────
// Quando uma alteração é registrada com `executaImediatamente: true`, o item
// é gravado já como 'conciliado' E as mudanças são aplicadas direto no aluno,
// sem precisar passar pela aba Conciliação. Este módulo centraliza o "apply"
// para cada tipo de alteração suportada.

import { useAppStore } from '@/store/useAppStore';
import { applyConciliacaoEfetivacao } from '@/lib/conciliacaoApply';
import type { ConciliacaoItem, HistoryEntry, Installment, Student } from '@/types';

function fmtBR(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Calcula o patch do aluno para conciliação imediata, sem gravar.
 * Inclui entradas de histórico para mesclar numa única gravação (evita race
 * entre parcelas e histórico no studentWriteGuard).
 */
export function computeConciliacaoImmediateUpdate(
  item: ConciliacaoItem,
  student: Student,
): Partial<Student> | null {
  const after = (item.depois as Record<string, unknown>)?._after;
  if (after && typeof after === 'object') {
    return null;
  }

  const todayIso = new Date().toISOString().split('T')[0];
  const depois = (item.depois ?? {}) as Record<string, unknown>;
  const history: HistoryEntry[] = [...(student.history ?? [])];

  if (item.tipo === 'pagamento_parcela') {
    const parcelaNum = Number(depois.parcela);
    const valorPago = Number(depois.valor);
    if (!Number.isFinite(parcelaNum)) return null;
    const target = student.installments.find((i) => i.number === parcelaNum);
    if (target?.paid) return null;
    const paidDate =
      typeof depois.paidDate === 'string' && depois.paidDate ? depois.paidDate : todayIso;
    const paidMarkedAt =
      typeof depois.paidMarkedAt === 'string' && depois.paidMarkedAt
        ? depois.paidMarkedAt
        : new Date().toISOString();
    const updatedInst: Installment[] = student.installments.map((i) => {
      if (i.number !== parcelaNum) return i;
      const paidValueField =
        Number.isFinite(valorPago) && Math.abs(valorPago - i.value) > 0.01
          ? { paidValue: valorPago }
          : {};
      return { ...i, paid: true, paidDate, paidMarkedAt, ...paidValueField };
    });
    history.push({
      date: new Date().toISOString(),
      type: 'Sistema',
      text: `Pagamento da parcela ${parcelaNum} conciliado automaticamente${Number.isFinite(valorPago) ? ` (${fmtBR(valorPago)})` : ''}.`,
    });
    return {
      installments: updatedInst,
      paidInstallments: updatedInst.filter((i) => i.paid).length,
      history,
    };
  }

  if (item.tipo === 'quitacao') {
    const updatedInst: Installment[] = student.installments.map((i) =>
      !i.paid ? { ...i, paid: true, paidDate: todayIso } : i,
    );
    const valorPago = Number(depois.valorPago);
    const desconto = Number(depois.desconto);
    history.push({
      date: new Date().toISOString(),
      type: 'Sistema',
      text: `Quitação conciliada automaticamente${Number.isFinite(valorPago) ? ` — valor pago ${fmtBR(valorPago)}` : ''}${Number.isFinite(desconto) && desconto > 0 ? ` (desconto ${fmtBR(desconto)})` : ''}.`,
    });
    return {
      installments: updatedInst,
      paidInstallments: updatedInst.length,
      history,
    };
  }

  if (item.tipo === 'renegociacao') {
    const novasParcelas = depois.novasParcelas as
      | Array<{ number: number; dueDate: string; value: number; paid?: boolean; paidDate?: string }>
      | undefined;
    if (!Array.isArray(novasParcelas)) return null;
    const novoSaleValue = Number(depois.saleValue);
    const novoTotal = Number(depois.totalParcelas);
    const novoValor = Number(depois.valorParcela);
    const novaEntrada = Number(depois.entrada) || 0;
    const allInst: Installment[] = novasParcelas.map((i, idx) => ({
      ...i,
      number: idx + 1,
      paid: !!i.paid,
    }));
    const downPayAtual = Number(student.downPayment) || 0;
    history.push({
      date: new Date().toISOString(),
      type: 'Sistema',
      text: `Renegociação conciliada automaticamente — ${item.resumo}`,
    });
    return {
      installments: allInst,
      totalInstallments: Number.isFinite(novoTotal) ? novoTotal : allInst.length,
      installmentValue: Number.isFinite(novoValor) ? novoValor : student.installmentValue,
      saleValue: Number.isFinite(novoSaleValue) ? novoSaleValue : student.saleValue,
      downPayment: downPayAtual + novaEntrada,
      paidInstallments: allInst.filter((i) => i.paid).length,
      history,
    };
  }

  return null;
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

  const patch = computeConciliacaoImmediateUpdate(item, st);
  if (!patch) return false;
  store.updateStudent(st.id, patch);
  return true;
}
