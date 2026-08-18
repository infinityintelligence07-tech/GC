// ─── Comissões — Persistência no backend ────────────────────────────────────
// As comissões passaram a viver no banco (tabela `commissions`) para que sejam
// compartilhadas entre usuários. A visibilidade é controlada por RLS:
//   • admin / acesso à aba Comissões → vê todas as comissões da empresa ativa
//   • assessor                        → vê apenas as próprias comissões
import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';
import type { Commission, CommissionPaymentType, CommissionRates } from '@/store/useCommissionsStore';

const activeCompanyId = (): string | null => useCompanyStore.getState().activeCompanyId ?? null;

type Row = {
  id: string;
  cancellation_case_id: string;
  student_id: string | null;
  student_name: string;
  ac_id: string | null;
  ac_name: string | null;
  payment_type: string;
  reverted_value: number | string;
  percent: number | string;
  value: number | string;
  status: string;
  pending_approval: boolean;
  observacao: string | null;
  product: string | null;
  paid_at: string | null;
  created_at: string;
};

const num = (v: unknown): number => Number(v ?? 0) || 0;

export function rowToCommission(r: Row): Commission {
  return {
    id: r.id,
    cancellationCaseId: r.cancellation_case_id,
    studentId: r.student_id ?? undefined,
    studentName: r.student_name,
    acId: r.ac_id ?? undefined,
    acName: r.ac_name ?? undefined,
    paymentType: (r.payment_type as CommissionPaymentType) ?? 'boleto',
    revertedValue: num(r.reverted_value),
    percent: num(r.percent),
    value: num(r.value),
    status: (r.status as Commission['status']) ?? 'pendente',
    createdAt: r.created_at,
    paidAt: r.paid_at ?? undefined,
    observacao: r.observacao ?? undefined,
    product: r.product ?? undefined,
    pendingApproval: !!r.pending_approval,
  };
}

export async function fetchCommissions(): Promise<Commission[]> {
  const companyId = activeCompanyId();
  if (!companyId) return [];
  const { data, error } = await supabase
    .from('commissions' as never)
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(rowToCommission);
}

export async function insertCommissionDb(c: Commission): Promise<void> {
  const companyId = activeCompanyId();
  if (!companyId) return;
  const { error } = await supabase.from('commissions' as never).insert({
    id: c.id,
    company_id: companyId,
    cancellation_case_id: c.cancellationCaseId,
    student_id: c.studentId ?? null,
    student_name: c.studentName,
    ac_id: c.acId ?? null,
    ac_name: c.acName ?? null,
    payment_type: c.paymentType,
    reverted_value: c.revertedValue,
    percent: c.percent,
    value: c.value,
    status: c.status,
    pending_approval: !!c.pendingApproval,
    observacao: c.observacao ?? null,
    product: c.product ?? null,
    paid_at: c.paidAt ?? null,
    created_at: c.createdAt,
  } as never);
  if (error) throw error;
}

export async function updateCommissionDb(id: string, patch: Partial<Commission>): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.paymentType !== undefined) payload.payment_type = patch.paymentType;
  if (patch.percent !== undefined) payload.percent = patch.percent;
  if (patch.value !== undefined) payload.value = patch.value;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.pendingApproval !== undefined) payload.pending_approval = patch.pendingApproval;
  if (patch.paidAt !== undefined) payload.paid_at = patch.paidAt ?? null;
  if (patch.observacao !== undefined) payload.observacao = patch.observacao ?? null;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from('commissions' as never).update(payload as never).eq('id', id);
  if (error) throw error;
}

export async function setCommissionAcDb(id: string, acId: string): Promise<void> {
  const { error } = await supabase.from('commissions' as never).update({ ac_id: acId } as never).eq('id', id);
  if (error) throw error;
}

export async function deleteCommissionDb(id: string): Promise<void> {
  const { error } = await supabase.from('commissions' as never).delete().eq('id', id);
  if (error) throw error;
}

export async function fetchCommissionRates(): Promise<CommissionRates | null> {
  const companyId = activeCompanyId();
  if (!companyId) return null;
  const { data, error } = await supabase
    .from('commission_rates' as never)
    .select('boleto, pix, cartao')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as { boleto: number; pix: number; cartao: number };
  return { boleto: num(r.boleto), pix: num(r.pix), cartao: num(r.cartao) };
}

export async function saveCommissionRatesDb(rates: CommissionRates): Promise<void> {
  const companyId = activeCompanyId();
  if (!companyId) return;
  const { error } = await supabase
    .from('commission_rates' as never)
    .upsert({ company_id: companyId, ...rates } as never, { onConflict: 'company_id' });
  if (error) throw error;
}
