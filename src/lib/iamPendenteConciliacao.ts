import type { ConciliacaoItem, Student, Installment, StudentStatus } from '@/types';
import { supabase } from '@/integrations/supabase/client';
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

export type IamGcCarteira = 'iam' | 'liberty';

/**
 * Carteira do contrato IAM pelo treinamento — espelho de
 * public.product_is_liberty_gc: Liberty, Liberty Begin, BEGIN → Liberty;
 * demais treinamentos → IAM.
 */
export function isLibertyGcProduct(product?: string | null): boolean {
  const p = String(product ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!p) return false;
  return (
    p === 'liberty' ||
    p === 'begin' ||
    p.startsWith('liberty ') ||
    p.endsWith(' liberty') ||
    p.includes(' liberty ') ||
    p.includes('liberty begin')
  );
}

export function resolveIamGcCarteira(product?: string | null): IamGcCarteira {
  return isLibertyGcProduct(product) ? 'liberty' : 'iam';
}

export const IAM_GC_CARTEIRA_LABEL: Record<IamGcCarteira, string> = {
  iam: 'IAM',
  liberty: 'Liberty',
};

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

/**
 * Contrato IAM quitado à vista / cartão integral, reconhecido pelo GC.
 *
 * Vale quando o IAM diz CONCILIADO (entra na dashboard sem aprovação GC) ou
 * quando o GC já aprovou o contrato (iam_gc_conciliado_at): depois da
 * aprovação o IAM pode trocar o rótulo (ex.: AJUSTES) e o pull espelha esse
 * status — o contrato continua quitado e não pode sumir do card Pago nem
 * voltar para "Em Dia" sem parcela.
 */
export function isIamConciliadoQuitadoAvista(student: Student): boolean {
  if (!isIamControlStudent(student)) return false;
  const conciliadoNoIam = normalizeIamContratoStatus(student.iamControlContratoStatus) === 'CONCILIADO';
  if (!conciliadoNoIam && !student.iamGcConciliadoAt) return false;

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

/** Entra na carteira do assessor — IAM só após aprovação na Conciliação GC. */
export function countsInAcPortfolioTotals(student: Student): boolean {
  if (isIamControlStudent(student)) {
    return Boolean(student.iamGcConciliadoAt) || isIamConciliadoQuitadoAvista(student);
  }
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

/**
 * Reconfere no banco, na hora de inserir, quais candidatos ainda precisam de
 * item: o snapshot do reload pode ser velho (students e conciliacao_items são
 * buscados em paralelo — o item já aparece conciliado e a ficha ainda não
 * mostra iam_gc_conciliado_at), e outra aba pode ter criado o item.
 */
async function fetchIamPendenteBloqueadosNoBanco(studentIds: string[]): Promise<Set<string>> {
  const bloqueados = new Set<string>();
  if (studentIds.length === 0) return bloqueados;
  const [aprovadosRes, abertosRes] = await Promise.all([
    supabase.from('students').select('id').in('id', studentIds).not('iam_gc_conciliado_at', 'is', null),
    supabase
      .from('conciliacao_items')
      .select('student_id')
      .eq('tipo', 'iam_pendente')
      .in('status', ['pendente', 'aprovado'])
      .in('student_id', studentIds),
  ]);
  if (aprovadosRes.error) throw aprovadosRes.error;
  if (abertosRes.error) throw abertosRes.error;
  for (const r of aprovadosRes.data ?? []) bloqueados.add(String(r.id));
  for (const r of abertosRes.data ?? []) if (r.student_id) bloqueados.add(String(r.student_id));
  return bloqueados;
}

/** Erros esperados quando o banco já protegeu a fila (trigger / índice único). */
function isIamPendenteGuardError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const msg = String(err?.message ?? '');
  return err?.code === '23505' || msg.includes('IAM_PENDENTE_JA_APROVADO') || msg.includes('conciliacao_items_iam_pendente_aberto_uidx');
}

/** Cria item na fila Conciliação > IAM CONTROL → GC. */
export async function ensureIamPendenteConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const candidatos = students.filter(
    (s) => needsIamGcConciliacaoApproval(s) && !hasOpenIamPendenteItem(s.id, items),
  );
  if (candidatos.length === 0) return items;

  let bloqueados = new Set<string>();
  try {
    bloqueados = await fetchIamPendenteBloqueadosNoBanco(candidatos.map((s) => s.id));
  } catch (e) {
    console.error('[iam_pendente] falha ao reconferir fila no banco; adiando criação', e);
    return items;
  }

  const created: ConciliacaoItem[] = [];
  for (const s of candidatos) {
    if (bloqueados.has(s.id)) continue;
    const iamStatus = normalizeIamContratoStatus(s.iamControlContratoStatus);
    // Item já conciliado não bloqueia: se o aluno voltou a precisar de aprovação
    // é porque o IAM reabriu uma pendência (iam_gc_conciliado_at foi zerado pelo
    // sync), e o contrato precisa aparecer de novo na fila IAM CONTROL → GC.
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
      // Banco já protegeu (aluno aprovado entre o reload e o insert, ou item
      // criado por outra aba): não é erro.
      if (isIamPendenteGuardError(e)) continue;
      console.error('[iam_pendente] falha ao criar item de conciliação', s.id, e);
    }
  }
  return created.length > 0 ? [...items, ...created] : items;
}

/** Libera o aluno IAM na carteira do AC e na dashboard após aprovação na Conciliação GC. */
export function buildIamGcApprovalStudentPatch(
  student: Student,
  autoStatus: StudentStatus,
  revisorNome: string,
): Partial<Student> {
  const nowIso = new Date().toISOString();
  const statusAnterior = String(student.iamControlContratoStatus ?? 'PENDENTE').replace(/_/g, ' ');
  return {
    iamControlContratoStatus: 'CONCILIADO',
    iamGcConciliadoAt: nowIso,
    statusMode: 'Automático',
    status: autoStatus,
    history: [
      ...student.history,
      {
        date: nowIso,
        type: 'Sistema',
        text: `Contrato IAM (${statusAnterior}) aprovado na Conciliação por ${revisorNome}. Passa a contar na carteira e nos totais financeiros.`,
      },
    ],
  };
}
