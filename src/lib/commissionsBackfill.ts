// ─── Comissões — Recuperação retroativa ─────────────────────────────────────
// Antes da migração para o banco, as comissões nasciam no localStorage de quem
// revertia o card — ou seja, o registro nunca chegava ao backend. Esta rotina
// varre os casos de cancelamento já revertidos e cria as comissões faltantes.
//
// Base do cálculo (igual ao fluxo ao vivo): VALOR TOTAL DO CONTRATO,
// rateado pela quantidade de inscrições revertidas.

import { useAppStore } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { useCommissionsStore, mapPagamentoTipoToPaymentType } from '@/store/useCommissionsStore';

export function backfillCommissionsFromCases(): number {
  const { cancellationCases, students, acs } = useAppStore.getState();
  const store = useCommissionsStore.getState();
  const existentes = store.commissions;
  const conciliacaoItems = useConciliacaoStore.getState().items;
  let criadas = 0;

  for (const caseRef of cancellationCases) {
    const revertido = caseRef.acao === 'Revertido' || (caseRef.inscricoesRevertidas ?? 0) > 0;
    if (!revertido) continue;

    const jaTem = existentes.some(
      (c) => c.cancellationCaseId === caseRef.id || c.cancellationCaseId.startsWith(`${caseRef.id}#`),
    );
    if (jaTem) continue;

    const st = caseRef.studentId
      ? students.find((s) => s.id === caseRef.studentId)
      : students.find((s) => s.name === caseRef.studentName);

    const contractTotal =
      st?.saleValue && st.saleValue > 0
        ? st.saleValue
        : caseRef.value && caseRef.value > 0
          ? caseRef.value
          : 0;
    if (!contractTotal || contractTotal <= 0) continue;

    const total = caseRef.quantidadeInscricoes ?? 1;
    const qty = Math.max(1, Math.min(total, caseRef.inscricoesRevertidas || total));
    const perInscricao = contractTotal / Math.max(1, total);
    const reverted = Math.round(perInscricao * qty * 100) / 100;

    const acFromCase = caseRef.ac ?? st?.ac;
    const acRow = acs.find((a) => a.name === (st?.ac ?? acFromCase));

    // Só libera a comissão quando existe uma conciliação concluída para o
    // caso. Sem item conciliado (inclusive em casos legados), ela permanece
    // como possível comissão até a confirmação do setor responsável.
    const temConciliacaoConcluida = conciliacaoItems.some(
      (i) =>
        i.relatedCaseId === caseRef.id &&
        (i.tipo === 'cancelamento' || i.tipo === 'reversao') &&
        i.status === 'conciliado',
    );

    const created = store.register({
      cancellationCaseId: qty < total ? `${caseRef.id}#p${qty}` : caseRef.id,
      studentId: caseRef.studentId,
      studentName: caseRef.studentName + (qty < total ? ` (${qty}/${total} inscrições)` : ''),
      acId: acRow?.id,
      acName: acRow?.name ?? acFromCase,
      paymentType: mapPagamentoTipoToPaymentType(caseRef.pagamentoTipo),
      revertedValue: reverted,
      product: st?.product,
      observacao: 'Comissão recuperada automaticamente a partir do caso revertido.',
      pendingApproval: !temConciliacaoConcluida,
    });
    if (created) criadas++;
  }

  return criadas;
}
