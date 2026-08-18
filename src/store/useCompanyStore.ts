// Store da empresa ativa (multi-tenant). O isolamento real é via RLS
// (current_company_id() lê de user_active_company), aqui guardamos só o
// estado de UI + dispara reload do useSupabaseSync ao trocar.
import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export type Company = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  color_primary: string;
  color_accent: string;
  logo_url: string | null;
  title: string | null;
  subtitle: string | null;
};

type State = {
  companies: Company[];
  activeCompanyId: string | null;
  loading: boolean;
  loadForUser: (userId: string) => Promise<void>;
  setActiveCompany: (companyId: string) => Promise<void>;
  refreshCompanies: () => Promise<void>;
  createCompany: (c: Omit<Company, 'id'>) => Promise<{ error: string | null }>;
  updateCompany: (id: string, patch: Partial<Omit<Company, 'id'>>) => Promise<void>;
};

export const useCompanyStore = create<State>((set, get) => ({
  companies: [],
  activeCompanyId: null,
  loading: true,

  refreshCompanies: async () => {
    const { data, error } = await supabase
      .from('companies' as any)
      .select('*')
      .order('name');
    if (error) {
      console.error('Erro carregando empresas:', error);
      return;
    }
    set({ companies: (data ?? []) as Company[] });
  },

  loadForUser: async (userId: string) => {
    set({ loading: true });
    // 1) lista de empresas que o usuário enxerga
    await get().refreshCompanies();
    const companies = get().companies;
    const accessibleIds = new Set(companies.map((c) => c.id));

    // 2) empresa ativa atual
    const { data: active } = await supabase
      .from('user_active_company' as any)
      .select('company_id')
      .eq('user_id', userId)
      .maybeSingle();

    let activeId: string | null = (active as any)?.company_id ?? null;

    // 3) se ativa for inválida (usuário não tem acesso) OU não existe, faz fallback
    if (!activeId || !accessibleIds.has(activeId)) {
      activeId = companies[0]?.id ?? null;
      if (activeId) {
        await supabase.from('user_active_company' as any).upsert({
          user_id: userId,
          company_id: activeId,
        });
      }
    }

    set({ activeCompanyId: activeId, loading: false });
  },

  setActiveCompany: async (companyId: string) => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { error } = await supabase
      .from('user_active_company' as any)
      .upsert({ user_id: userId, company_id: companyId });
    if (error) {
      console.error('Falha ao trocar empresa:', error);
      return;
    }
    set({ activeCompanyId: companyId });
    // força reload completo p/ refletir RLS (current_company_id() mudou)
    window.location.reload();
  },

  createCompany: async (c) => {
    const { error } = await supabase.from('companies' as any).insert(c);
    if (error) return { error: error.message };
    await get().refreshCompanies();
    return { error: null };
  },

  updateCompany: async (id, patch) => {
    const { error } = await supabase.from('companies' as any).update(patch).eq('id', id);
    if (error) {
      console.error('Erro atualizando empresa:', error);
      return;
    }
    await get().refreshCompanies();
  },
}));
