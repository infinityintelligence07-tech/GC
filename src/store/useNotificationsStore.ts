// ─── Notificações por AC (Item 2 — Onda 2) ───────────────────────────────────
// Cada AC tem sua caixa de notificações. Histórico mantido por 15 dias.
// Notificações automáticas:
//   - "vencimento_hoje": gerada 1x por dia com soma do que vence hoje
//   - "conciliacao_aprovada" / "conciliacao_reprovada": ao conciliar/reprovar
//   - "renda_extra": eventos de RE (futuro)
//
// O badge mostra apenas notificações não lidas (readAt === null).

import { create } from 'zustand';
import type { Notification, NotificationType } from '@/types';
import {
  fetchNotificationsDb,
  createNotificationDb,
  markNotificationsReadDb,
  deleteOldNotificationsDb,
} from '@/lib/supabaseMutations';
import { reportDbError } from '@/lib/dbError';

interface NotificationsState {
  notifications: Notification[];          // últimas 15 dias, qualquer AC (admin vê todas)
  loading: boolean;
  loadAll: (daysBack?: number) => Promise<void>;
  addLocal: (n: Notification) => void;
  notify: (input: { acId?: string; userId?: string; type: NotificationType; title: string; body?: string; meta?: Record<string, unknown> }) => Promise<void>;
  markAllReadForAC: (acId: string) => Promise<void>;
  cleanupOld: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  notifications: [],
  loading: false,
  loadAll: async (daysBack = 15) => {
    set({ loading: true });
    try {
      const list = await fetchNotificationsDb({ daysBack });
      set({ notifications: list, loading: false });
    } catch (e) {
      console.error('Falha ao buscar notificações', e);
      set({ loading: false });
    }
  },
  addLocal: (n) => {
    set((s) => ({ notifications: [n, ...s.notifications] }));
  },
  notify: async (input) => {
    try {
      const created = await createNotificationDb(input);
      get().addLocal(created);
    } catch (e) {
      reportDbError('criar notificação')(e as Error);
    }
  },
  markAllReadForAC: async (acId) => {
    const now = new Date().toISOString();
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.acId === acId && !n.readAt ? { ...n, readAt: now } : n
      ),
    }));
    try {
      await markNotificationsReadDb(acId);
    } catch (e) {
      reportDbError('marcar como lido')(e as Error);
    }
  },
  cleanupOld: async () => {
    try {
      await deleteOldNotificationsDb(15);
    } catch (e) {
      console.error('Falha ao limpar notificações antigas', e);
    }
  },
}));

// Helpers de filtragem usados pelos componentes
export function notificationsForAC(notifs: Notification[], acId: string): Notification[] {
  return notifs.filter((n) => n.acId === acId);
}

export function unreadCountForAC(notifs: Notification[], acId: string): number {
  return notifs.filter((n) => n.acId === acId && !n.readAt).length;
}
