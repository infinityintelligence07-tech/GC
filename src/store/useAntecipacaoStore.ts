// ─── Antecipação — Store Isolado ─────────────────────────────────────────────
import { reportDbError } from '@/lib/dbError';
// Dados vêm do Supabase via useSupabaseSync. Mutações vão para supabaseMutations.

import { create } from 'zustand';
import { AntecipacaoItem, AntecipacaoStatus } from '@/types';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import {
  createAntecipacaoItemDb,
  createAntecipacaoItemsBulkDb,
  deleteAntecipacaoItemDb,
  clearAntecipacaoByACDb,
} from '@/lib/supabaseMutations';

interface AntecipacaoState {
  items: AntecipacaoItem[];
  addItem: (item: AntecipacaoItem) => void;
  addMany: (items: AntecipacaoItem[]) => void;
  deleteItem: (id: string) => void;
  clearByAC: (acId: string) => void;
}

export const useAntecipacaoStore = create<AntecipacaoState>()(
  (set) => ({
    items: [],
    addItem: (item) => {
      set((state) => ({ items: [...state.items, item] }));
      createAntecipacaoItemDb(item).catch(reportDbError("salvar alteração"));
    },
    addMany: (items) => {
      set((state) => ({ items: [...state.items, ...items] }));
      createAntecipacaoItemsBulkDb(items).catch(reportDbError("salvar alteração"));
    },
    deleteItem: (id) => {
      set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
      deleteAntecipacaoItemDb(id).catch(reportDbError("salvar alteração"));
    },
    clearByAC: (acId) => {
      set((state) => ({ items: state.items.filter((i) => i.acId !== acId) }));
      clearAntecipacaoByACDb(acId).catch(reportDbError("salvar alteração"));
    },
  }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function newAntecipacaoId(): string {
  return `ant_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function computeAntecipacaoStatus(dataVencimento: string, ref: Date = getTodayBrasilia()): AntecipacaoStatus {
  if (!dataVencimento) return 'Vencido 1';
  const due = new Date(`${dataVencimento}T00:00:00`);
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays > 30 ? 'Vencido 2' : 'Vencido 1';
}
