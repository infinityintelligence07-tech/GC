// Contexto isolado para evitar invalidação durante HMR/Fast Refresh.
// Mantenha este arquivo SEM componentes React — apenas o contexto e tipos.
import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
