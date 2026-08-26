import type { ConciliacaoItem, Student, Installment } from '@/types';
import { createConciliacaoItemDb } from '@/lib/supabaseMutations';

/** Status IAM que exigem aprovação na Conciliação GC antes de entrar na dashboard. */
export function isIamPendenteStatus(status?: string | null): boolean {
  const s = normalizeIamContratoStatus(status);
  return s === 'PENDENTE' || s === 'PENDENTE_LINK' || s === 'PENDENTE_PIX' || s.startsWith('PENDENTE_');
}

/** Contratos IAM que precisam passar pela Conciliação GC antes de entrar na dashboard. */
const IAM_STATUSES_REQUIRING_GC_APPROVAL = new Set([
  'CONCILIADO',
  'PENDENTE',
  'PENDENTE_LINK',
  'PENDENTE_PIX',
  'PARA_CONCILIAR',
]);

export function normalizeIamContratoStatus(status?: string | null): string {
  return String(status ?? '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_');
}

/** Aluno importado/sincronizado pelo IAM Control. */
export function isIamControlStudent(student: Student): boolean {
  return student.iamControlAlunoId != null && Number.isFinite(student.iamControlAlunoId);
}

/** Aluno com financeiro vindo da sync Kamino (carteira principal). */
export function isKaminoPortfolioStudent(student: Student): boolean {
  if (isIamControlStudent(student)) return false;
  if (student.kaminoSyncedAt) return true;
  // Legado: coluna kamino_synced_at ainda não populada — não-IAM permanece na carteira Kamino.
  return true;
}

/** CONCILIADO quitado à vista / cartão integral — entra na dashboard sem aprovação GC. */
export function isIamConciliadoQuitadoAvista(student: Student): boolean {
  if (!isIamControlStudent(student)) return false;
  if (normalizeIamContratoStatus(student.iamControlContratoStatus) !== 'CONCILIADO') return false;

  const sale = Number(student.saleValue ?? 0);
  const down = Number(student.downPayment ?? 0);
  const totalInst = Number(student.totalInstallments ?? 0);
  const paidInst = Number(student.paidInstallments ?? 0);

  if (totalInst === 0 && down >= sale - 0.01) return true;
  if (totalInst > 0 && paidInst >= totalInst) return true;

  const inst = student.installments ?? [];
  if (inst.length > 0 && inst.every((i) => i.paid)) return true;
  return false;
}

/** IAM ainda não aprovado na Conciliação GC (fila IAM CONTROL → GC). */
export function needsIamGcConciliacaoApproval(student: Student): boolean {
  if (!isIamControlStudent(student)) return false;
  if (student.iamGcConciliadoAt) return false;
  if (isIamConciliadoQuitadoAvista(student)) return false;
  const status = normalizeIamContratoStatus(student.iamControlContratoStatus);
  return IAM_STATUSES_REQUIRING_GC_APPROVAL.has(status);
}

/** @deprecated Use needsIamGcConciliacaoApproval */
export function isAwaitingIamGcApproval(student: Student): boolean {
  return needsIamGcConciliacaoApproval(student);
}

/** Entra nos totais da dashboard principal — Kamino ou IAM já aprovado no GC. */
export function countsInFinancialTotals(student: Student): boolean {
  if (isIamControlStudent(student)) {
    return Boolean(student.iamGcConciliadoAt) || isIamConciliadoQuitadoAvista(student);
  }
  return isKaminoPortfolioStudent(student);
}

/** Entra na carteira do assessor (inclui IAM aguardando aprovação). */
export function countsInAcPortfolioTotals(student: Student): boolean {
  if (isIamControlStudent(student)) return true;
  return isKaminoPortfolioStudent(student);
}

/** Parcela fora da dashboard/carteira Kamino. */
export function isInstallmentExcludedFromFinancialTotals(student: Student, inst: Installment): boolean {
  if (!countsInFinancialTotals(student)) return true;
  return false;
}

/** Parcela fora da carteira do assessor. */
export function isInstallmentExcludedFromAcPortfolio(student: Student, inst: Installment): boolean {
  if (!countsInAcPortfolioTotals(student)) return true;
  return false;
}

function hasOpenIamPendenteItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.tipo === 'iam_pendente' &&
      i.studentId === studentId &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
}

function iamConciliacaoResumo(student: Student): string {
  const iamStatus = normalizeIamContratoStatus(student.iamControlContratoStatus);
  const tipo = String(student.iamControlPendenteTipo ?? '').toUpperCase();
  const isPendente = isIamPendenteStatus(iamStatus);
  if (isPendente && (tipo === 'LINK' || iamStatus === 'PENDENTE_LINK')) return 'IAM Control — Pendente Link';
  if (isPendente && (tipo === 'PIX' || iamStatus === 'PENDENTE_PIX')) return 'IAM Control — Pendente PIX';
  if (isPendente) return 'IAM Control — Pendente';
  if (iamStatus === 'PARA_CONCILIAR') return 'IAM Control — Para Conciliar';
  if (iamStatus === 'CONCILIADO') return 'IAM Control — Conciliado (aguarda aprovação GC)';
  return `IAM Control — ${iamStatus.replace(/_/g, ' ')}`;
}

/** Cria item na fila Conciliação > IAM CONTROL → GC. */
export async function ensureIamPendenteConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const created: ConciliacaoItem[] = [];
  for (const s of students) {
    if (!needsIamGcConciliacaoApproval(s)) continue;
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
        resumo: iamConciliacaoResumo(s),
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
