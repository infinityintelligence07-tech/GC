import type { ConciliacaoItem, Student, Installment } from '@/types';
import { createConciliacaoItemDb } from '@/lib/supabaseMutations';

const IAM_STATUSES_AWAITING_GC_APPROVAL = new Set(['PENDENTE', 'PARA_CONCILIAR']);

export function normalizeIamContratoStatus(status?: string | null): string {
  return String(status ?? '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_');
}

/** IAM PENDENTE / PARA_CONCILIAR ainda não aprovado na Conciliação do GC. */
export function isAwaitingIamGcApproval(student: Student): boolean {
  if (student.iamGcConciliadoAt) return false;
  return IAM_STATUSES_AWAITING_GC_APPROVAL.has(
    normalizeIamContratoStatus(student.iamControlContratoStatus),
  );
}

/** Contrato inteiro fora da dash até aprovação na Conciliação GC. */
export function isInstallmentExcludedFromFinancialTotals(student: Student, inst: Installment): boolean {
  if (!isAwaitingIamGcApproval(student)) return false;
  return !inst.paid;
}

/** Aluno permanece na carteira; exclusão é por parcela (ver isInstallmentExcludedFromFinancialTotals). */
export function countsInFinancialTotals(_student: Student): boolean {
  return true;
}

function hasOpenIamPendenteItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.tipo === 'iam_pendente' &&
      i.studentId === studentId &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
}

/** Cria item na fila de Conciliação para cada import IAM aguardando aprovação GC. */
export async function ensureIamPendenteConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const created: ConciliacaoItem[] = [];
  for (const s of students) {
    if (!isAwaitingIamGcApproval(s)) continue;
    const iamStatus = normalizeIamContratoStatus(s.iamControlContratoStatus);
    if (hasOpenIamPendenteItem(s.id, items)) continue;
    if (items.some((i) => i.tipo === 'iam_pendente' && i.studentId === s.id && i.status === 'conciliado')) {
      continue;
    }
    try {
      const row = await createConciliacaoItemDb({
        tipo: 'iam_pendente',
        studentId: s.id,
        studentName: s.name,
        ac: s.ac,
        resumo: `Import IAM — contrato ${iamStatus.replace(/_/g, ' ')} (${s.iamControlPendenteTipo ?? '—'})`,
        antes: {
          iam_control_contrato_status: iamStatus,
        },
        depois: {
          iam_control_contrato_status: 'CONCILIADO',
          pendente_tipo: s.iamControlPendenteTipo ?? null,
          pendente_link: s.iamControlPendenteLink ?? null,
          sale_value: s.saleValue,
          down_payment: s.downPayment,
          total_installments: s.totalInstallments,
          product: s.product,
        },
        autorNome: 'Sistema IAM',
        status: 'pendente',
      });
      created.push(row);
    } catch (e) {
      console.error('[iam_pendente] falha ao criar item de conciliação', s.id, e);
    }
  }
  return created.length > 0 ? [...items, ...created] : items;
}
