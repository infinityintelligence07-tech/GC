// Helper de auditoria — grava ações dos usuários em activity_logs.
// Fire-and-forget: nunca quebra a UX se o insert falhar.
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';

export type ActivityEntity =
  | 'student'
  | 'installment'
  | 'user'
  | 'ac'
  | 'product'
  | 'tag'
  | 'rules'
  | 'cancellation'
  | 'renda_extra'
  | 'conciliacao'
  | 'config'
  | 'system';

export interface LogActivityInput {
  action: string;
  entity: ActivityEntity;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
}

export function logActivity(input: LogActivityInput): void {
  try {
    const user = useAppStore.getState().currentUser;
    const companyId = useCompanyStore.getState().activeCompanyId ?? null;
    const row = {
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      summary: input.summary,
      meta: (input.meta as any) ?? null,
      actor_user_id: user?.authUserId ?? null,
      actor_name: user?.name ?? 'Sistema',
      company_id: companyId,
    };
    // fire-and-forget
    void supabase.from('activity_logs').insert(row as any).then(({ error }) => {
      if (error) console.warn('[activityLog] falha ao gravar:', error.message);
    });
  } catch (e) {
    console.warn('[activityLog] erro inesperado:', e);
  }
}

export function formatBRL(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}
