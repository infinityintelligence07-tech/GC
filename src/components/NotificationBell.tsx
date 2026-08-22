// ─── Sino de notificações por AC (Item 2 — Onda 2) ───────────────────────────
// Usado no header da página de Portfólio do AC.
//
// Comportamento:
//  - badge com contagem de não-lidas
//  - ao abrir o popover, marca todas como lidas (removendo o badge)
//  - histórico mantém-se visível (15 dias) ao reabrir
//  - clique em notificação de conciliação_reprovada/aprovada abre Gestão
//    Financeira do aluno via callback `onOpenStudent`

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Wallet, Check, X as XIcon, AlertCircle, ExternalLink } from 'lucide-react';
import { useNotificationsStore, notificationsForAC, unreadCountForAC } from '@/store/useNotificationsStore';
import { useAppStore } from '@/store/useAppStore';
import type { Notification } from '@/types';

interface Props {
  acId: string;
  onOpenStudent?: (studentId: string, notification?: Notification) => void;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - dDay.getTime()) / (24 * 3600 * 1000));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (diffDays === 0) return `Hoje, ${hh}:${mm}`;
  if (diffDays === 1) return `Ontem, ${hh}:${mm}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hh}:${mm}`;
}

function iconFor(type: Notification['type']) {
  switch (type) {
    case 'vencimento_hoje': return <Wallet size={14} className="text-amber-500" />;
    case 'conciliacao_aprovada': return <Check size={14} className="text-emerald-600" />;
    case 'conciliacao_pre_aprovada': return <Check size={14} className="text-sky-600" />;
    case 'conciliacao_reprovada': return <XIcon size={14} className="text-rose-600" />;
    case 'renda_extra': return <AlertCircle size={14} className="text-blue-500" />;
    case 'sistema': return <AlertCircle size={14} className="text-muted-foreground" />;
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return <AlertCircle size={14} className="text-muted-foreground" />;
    }
  }
}

export default function NotificationBell({ acId, onOpenStudent }: Props) {
  const notifications = useNotificationsStore((s) => s.notifications);
  const markAllReadForAC = useNotificationsStore((s) => s.markAllReadForAC);
  const currentUser = useAppStore((s) => s.currentUser);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filterOpts = useMemo(
    () => ({ userId: currentUser?.authUserId ?? currentUser?.id ?? null }),
    [currentUser?.authUserId, currentUser?.id],
  );
  const myNotifs = useMemo(
    () => notificationsForAC(notifications, acId, filterOpts),
    [notifications, acId, filterOpts],
  );
  const unread = useMemo(
    () => unreadCountForAC(notifications, acId, filterOpts),
    [notifications, acId, filterOpts],
  );

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleToggle = () => {
    if (!open && unread > 0) {
      // Ao abrir, marca como lidas (badge some, mas histórico permanece)
      markAllReadForAC(acId).catch(console.error);
    }
    setOpen((o) => !o);
  };

  const handleClickItem = (n: Notification) => {
    const sid = n.meta?.studentId as string | undefined;
    if (sid && onOpenStudent) {
      onOpenStudent(sid, n);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-xl hover:bg-muted/60 transition-colors"
        title="Notificações"
      >
        <Bell size={18} className="text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-h-[480px] overflow-auto bg-card border border-border rounded-2xl shadow-2xl z-50 fade-in">
          <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Notificações</h3>
            <span className="text-[10px] text-muted-foreground">Últimos 15 dias</span>
          </div>
          {myNotifs.length === 0 ? (
            <div className="p-8 text-center">
              <Bell size={28} className="mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">Nenhuma notificação ainda.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {myNotifs.map((n) => {
                const isClickable = !!(n.meta?.studentId && onOpenStudent);
                return (
                  <li
                    key={n.id}
                    onClick={() => handleClickItem(n)}
                    className={`p-3 transition-colors ${isClickable ? 'cursor-pointer hover:bg-muted/40' : ''} ${
                      n.type === 'conciliacao_reprovada'
                        ? (!n.readAt ? 'bg-rose-50 border-l-4 border-rose-500' : 'bg-rose-50/40 border-l-4 border-rose-300')
                        : (!n.readAt ? 'bg-primary/5' : '')
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">{iconFor(n.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold leading-snug truncate ${n.type === 'conciliacao_reprovada' ? 'text-rose-700' : 'text-foreground'}`}>{n.title}</p>
                        {n.body && (
                          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{n.body}</p>
                        )}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[10px] text-muted-foreground/80">{formatRelative(n.createdAt)}</span>
                          {isClickable && <ExternalLink size={10} className="text-muted-foreground/60" />}
                        </div>
                      </div>
                      {!n.readAt && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
