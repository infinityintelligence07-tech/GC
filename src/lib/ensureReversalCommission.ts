// ─── Garantia de comissão em reversões ──────────────────────────────────────
// Alguns fluxos de reversão (ex.: reversão reprovada e refeita, ou reversão
// registrada na conciliação com tipo "cancelamento") acabavam sem comissão
// gerada para o assessor. Este helper garante que, ao aprovar/conciliar uma
// reversão, exista uma comissão vinculada ao caso — criando-a se necessário —
// e a libera (pendingApproval = false).

import { useAppStore } from '@/store/useAppStore';
import { useCommissionsStore, mapPagamentoTipoToPaymentType } from '@/store/useCommissionsStore';

export function ensureReversalCommission(caseId: string): void {
  const cs = useCommissionsStore.getState();
  const existing = cs.commissions.find(
    (c) => (c.cancellationCaseId === caseId || c.cancellationCaseId.startsWith(`${caseId}#`)) && c.status !== 'cancelada',
  );

  if (!existing) {
    const app = useAppStore.getState();
    const caseRef = app.cancellationCases.find((c) => c.id === caseId);
    if (caseRef) {
      const st = caseRef.studentId
        ? app.students.find((s) => s.id === caseRef.studentId)
        : app.students.find((s) => s.name === caseRef.studentName);
      const contractTotal =
        st?.saleValue && st.saleValue > 0
          ? st.saleValue
          : caseRef.value && caseRef.value > 0
            ? caseRef.value
            : 0;
      const total = caseRef.quantidadeInscricoes ?? 1;
      const qty = Math.max(1, caseRef.inscricoesRevertidas ?? total);
      const reverted = Math.round(((contractTotal / Math.max(1, total)) * qty) * 100) / 100;
      if (reverted > 0) {
        const acName = st?.ac ?? caseRef.ac;
        const acRow = app.acs.find((a) => a.name === acName);
        cs.register({
          cancellationCaseId: caseId,
          studentId: caseRef.studentId,
          studentName: caseRef.studentName,
          acId: acRow?.id,
          acName: acRow?.name ?? acName,
          paymentType: mapPagamentoTipoToPaymentType(caseRef.pagamentoTipo),
          revertedValue: reverted,
          product: st?.product,
          pendingApproval: true,
        });
      }
    }
  }

  useCommissionsStore.getState().approvePendingByCaseId(caseId);
}
