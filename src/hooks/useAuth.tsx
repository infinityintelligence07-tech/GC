// Hook de autenticação — usa Supabase Auth nativo (senhas com hash bcrypt).
// Mantém `currentUser` no Zustand alimentado a partir de `app_users`
// via lookup por auth_user_id.
import { useContext, ReactNode, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { AuthContext } from '@/hooks/authContext';
import { rowToAppUser } from '@/lib/supabaseMutations';
import { loginToEmail } from '@/lib/loginToEmail';

async function hydrateAppUser(authUserId: string) {
  const [{ data, error }, { data: acRows }, { data: activeCompany }] = await Promise.all([
    supabase.from('app_users').select('*').eq('auth_user_id', authUserId).maybeSingle(),
    supabase.from('user_company_acs').select('company_id, ac_id').eq('user_id', authUserId),
    supabase.from('user_active_company').select('company_id').eq('user_id', authUserId).maybeSingle(),
  ]);
  if (error || !data) return null;
  const user = rowToAppUser(data);
  user.perCompanyAcIds = Object.fromEntries(((acRows ?? []) as any[]).map((row) => [row.company_id, row.ac_id]));
  const activeCompanyId = (activeCompany as any)?.company_id;
  if (activeCompanyId) user.acId = user.perCompanyAcIds[activeCompanyId] ?? null;
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        const uid = newSession.user.id;
        setTimeout(() => {
          hydrateAppUser(uid).then((u) => setCurrentUser(u));
          useCompanyStore.getState().loadForUser(uid).catch(console.error);
        }, 0);
      } else {
        setCurrentUser(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        const uid = data.session.user.id;
        Promise.all([
          hydrateAppUser(uid).then((u) => setCurrentUser(u)),
          useCompanyStore.getState().loadForUser(uid),
        ]).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (login: string, password: string) => {
    const email = loginToEmail(login);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    const uid = data.user?.id;
    if (!uid) return { error: 'Falha ao autenticar.' };
    // Garante que existe perfil em app_users — senão a tela fica presa em "Entrando..."
    const appUser = await hydrateAppUser(uid);
    if (!appUser) {
      await supabase.auth.signOut();
      setCurrentUser(null);
      return {
        error:
          'Login autenticado, mas sem perfil no sistema (app_users). Peça a um admin para vincular sua conta.',
      };
    }
    setCurrentUser(appUser);
    try {
      await useCompanyStore.getState().loadForUser(uid);
    } catch (e) {
      console.error(e);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
