import { useEffect, useMemo, useState } from 'react';
import { Loader2, ScrollText, Search, Filter, RefreshCw, User as UserIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { canViewTab, canEditTab } from '@/types';

interface ActivityLogRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  company_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  meta: any;
}

const ENTITY_LABELS: Record<string, string> = {
  student: 'Aluno',
  installment: 'Parcela',
  user: 'Usuário',
  ac: 'Assessor de Conta',
  product: 'Produto',
  tag: 'Tag',
  rules: 'Regras',
  cancellation: 'Cancelamento',
  renda_extra: 'Renda Extra',
  conciliacao: 'Conciliação',
  config: 'Configurações',
  system: 'Sistema',
};

const ENTITY_COLORS: Record<string, string> = {
  student: 'bg-blue-50 text-blue-700 border-blue-200',
  installment: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  user: 'bg-purple-50 text-purple-700 border-purple-200',
  ac: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  product: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  tag: 'bg-pink-50 text-pink-700 border-pink-200',
  rules: 'bg-amber-50 text-amber-700 border-amber-200',
  cancellation: 'bg-red-50 text-red-700 border-red-200',
  renda_extra: 'bg-orange-50 text-orange-700 border-orange-200',
  conciliacao: 'bg-teal-50 text-teal-700 border-teal-200',
  config: 'bg-slate-100 text-slate-700 border-slate-200',
  system: 'bg-muted text-muted-foreground border-border',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

export default function RegistrosPage() {
  const { currentUser } = useAppStore();
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterActor, setFilterActor] = useState<string>('');

  const canView = canViewTab(currentUser, 'admin') || canEditTab(currentUser, 'admin');

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('activity_logs' as any)
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) console.error('[Registros] falha ao carregar:', error.message);
    setRows(((data ?? []) as unknown) as ActivityLogRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!canView) return;
    load();
    const channel = supabase
      .channel('activity_logs_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, (payload) => {
        setRows((prev) => [payload.new as ActivityLogRow, ...prev].slice(0, 1000));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  const actors = useMemo(() => {
    const set = new Map<string, string>();
    rows.forEach((r) => {
      const key = r.actor_user_id || r.actor_name || '';
      if (key && !set.has(key)) set.set(key, r.actor_name || 'Desconhecido');
    });
    return Array.from(set.entries());
  }, [rows]);

  const entities = useMemo(() => Array.from(new Set(rows.map((r) => r.entity))), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterEntity && r.entity !== filterEntity) return false;
      if (filterActor) {
        const key = r.actor_user_id || r.actor_name || '';
        if (key !== filterActor) return false;
      }
      if (q) {
        const hay = `${r.summary} ${r.actor_name ?? ''} ${r.entity_label ?? ''} ${r.action}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filterEntity, filterActor]);

  if (!canView) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Você não tem permissão para visualizar os registros do sistema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <ScrollText size={20} className="text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Registros</h1>
            <p className="text-sm text-muted-foreground">Ações feitas no sistema nos últimos 7 dias</p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por descrição, usuário ou aluno…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Todas as áreas</option>
            {entities.map((e) => (
              <option key={e} value={e}>{ENTITY_LABELS[e] ?? e}</option>
            ))}
          </select>
          <select
            value={filterActor}
            onChange={(e) => setFilterActor(e.target.value)}
            className="text-xs px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Todos os usuários</option>
            {actors.map(([k, name]) => (
              <option key={k} value={k}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center text-muted-foreground">
            <Loader2 size={18} className="animate-spin mr-2" /> Carregando registros…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum registro encontrado nos últimos 7 dias.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => {
              const entityLabel = ENTITY_LABELS[r.entity] ?? r.entity;
              const colorCls = ENTITY_COLORS[r.entity] ?? ENTITY_COLORS.system;
              return (
                <li key={r.id} className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md border ${colorCls} whitespace-nowrap mt-0.5`}>
                    {entityLabel}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">{r.summary}</p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={11} /> {r.actor_name || 'Sistema'}
                      </span>
                      <span>·</span>
                      <span>{formatDateTime(r.created_at)}</span>
                      {r.entity_label && (
                        <>
                          <span>·</span>
                          <span className="truncate">{r.entity_label}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Exibindo {filtered.length} registro{filtered.length === 1 ? '' : 's'} · retenção de 7 dias
      </p>
    </div>
  );
}
