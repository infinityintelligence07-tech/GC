import type { ConciliacaoItem, Student } from '@/types';
import { createConciliacaoItemDb } from '@/lib/supabaseMutations';

/** IAM PENDENTE ainda não aprovado na Conciliação do GC. */
export function isAwaitingIamGcApproval(student: Student): boolean {
  if (student.iamGcConciliadoAt) return false;
  return String(student.iamControlContratoStatus ?? '').toUpperCase() === 'PENDENTE';
}

/** Só entra em totais financeiros (A vencer/vencido) após aprovação na Conciliação. */
export function countsInFinancialTotals(student: Student): boolean {
  return !isAwaitingIamGcApproval(student);
}

function hasOpenIamPendenteItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.tipo === 'iam_pendente' &&
      i.studentId === studentId &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
}

/** Cria item na fila de Conciliação para cada import IAM PENDENTE sem pendência aberta. */
export async function ensureIamPendenteConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const created: ConciliacaoItem[] = [];
  for (const s of students) {
    if (!isAwaitingIamGcApproval(s)) continue;
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
        resumo: `Import IAM — contrato PENDENTE (${s.iamControlPendenteTipo ?? '—'})`,
        antes: {
          iam_control_contrato_status: 'PENDENTE',
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
