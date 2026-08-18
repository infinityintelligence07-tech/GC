import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Copy, MessageSquareText, Loader2, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';
import { useAppStore } from '@/store/useAppStore';
import { canEditTab } from '@/types';
import { toast } from '@/hooks/use-toast';
import { statusColors } from '@/lib/statusColors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Criterio = 'antes' | 'no' | 'depois';

interface ReguaItem {
  id: string;
  titulo: string;
  mensagem: string;
  status: string | null;
  ordem: number;
  criterio: Criterio;
  dias: number;
  dirty?: boolean;
  isNew?: boolean;
}

const CRITERIO_LABELS: Record<Criterio, string> = {
  antes: 'Antes do vencimento',
  no: 'No vencimento',
  depois: 'Depois do vencimento',
};

/** Deslocamento em dias em relação ao vencimento (negativo = antes). */
function offsetDias(criterio: Criterio, dias: number): number {
  if (criterio === 'no') return 0;
  const d = Math.max(0, Math.floor(dias || 0));
  return criterio === 'antes' ? -d : d;
}

/** Status de disparo derivado automaticamente do critério + dias. */
function statusFromCriterio(criterio: Criterio, dias: number): string {
  const off = offsetDias(criterio, dias);
  if (off <= 0) return 'Em Dia';
  if (off <= 30) return 'Vencido 1';
  if (off <= 60) return 'Vencido 2';
  return 'À Negativar';
}

function criterioResumo(criterio: Criterio, dias: number): string {
  if (criterio === 'no') return 'No dia do vencimento';
  const d = Math.max(0, Math.floor(dias || 0));
  return criterio === 'antes'
    ? `${d} dia${d === 1 ? '' : 's'} antes do vencimento`
    : `${d} dia${d === 1 ? '' : 's'} depois do vencimento`;
}


export default function ReguaPage() {
  const { activeCompanyId } = useCompanyStore();
  const currentUser = useAppStore((s) => s.currentUser);
  const canEdit = canEditTab(currentUser, 'config');

  const [items, setItems] = useState<ReguaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('regua_mensagens')
        .select('*')
        .order('ordem', { ascending: true })
        .order('created_at', { ascending: true });
      if (!alive) return;
      if (error) {
        toast({ title: 'Erro ao carregar a régua', description: error.message, variant: 'destructive' });
      } else {
        setItems((data ?? []).map((d: any) => {
          const criterio: Criterio = (d.criterio ?? 'no') as Criterio;
          const dias = d.dias ?? 0;
          return {
            id: d.id, titulo: d.titulo, mensagem: d.mensagem ?? '', ordem: d.ordem ?? 0,
            criterio, dias, status: statusFromCriterio(criterio, dias),
          };
        }));

      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [activeCompanyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? items
      : items.filter((i) =>
          i.mensagem.toLowerCase().includes(q) ||
          criterioResumo(i.criterio, i.dias).toLowerCase().includes(q) ||
          (i.status ?? '').toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return offsetDias(a.criterio, a.dias) - offsetDias(b.criterio, b.dias);
    });
  }, [items, search]);

  const patch = (id: string, changes: Partial<ReguaItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes, dirty: true } : i)));

  const addItem = () => {
    const tempId = `new-${Date.now()}`;
    setEditingId(tempId);
    setItems((prev) => [
      { id: tempId, titulo: '', mensagem: '', status: 'Em Dia', ordem: prev.length, criterio: 'no' as Criterio, dias: 0, isNew: true, dirty: true },
      ...prev,
    ]);
  };

  const saveItem = async (item: ReguaItem) => {
    if (!activeCompanyId) return;
    const dias = item.criterio === 'no' ? 0 : Math.max(0, Math.floor(item.dias || 0));
    const status = statusFromCriterio(item.criterio, dias);
    item = { ...item, titulo: criterioResumo(item.criterio, dias) };
    setSavingId(item.id);
    if (item.isNew) {
      const { data, error } = await supabase
        .from('regua_mensagens')
        .insert({
          company_id: activeCompanyId,
          titulo: item.titulo.trim(),
          mensagem: item.mensagem,
          status,
          criterio: item.criterio,
          dias,
          ordem: item.ordem,
        })
        .select()
        .single();
      setSavingId(null);
      if (error) {
        toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === item.id
        ? {
            id: data.id, titulo: data.titulo, mensagem: data.mensagem ?? '', status,
            ordem: data.ordem ?? 0, criterio: item.criterio, dias,
          }
        : i)));
    } else {
      const { error } = await supabase
        .from('regua_mensagens')
        .update({ titulo: item.titulo.trim(), mensagem: item.mensagem, status, criterio: item.criterio, dias })
        .eq('id', item.id);

      setSavingId(null);
      if (error) {
        toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, dirty: false } : i)));
    }
    setEditingId(null);
    toast({ title: 'Mensagem salva' });
  };

  const removeItem = async (item: ReguaItem) => {
    if (item.isNew) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      return;
    }
    const { error } = await supabase.from('regua_mensagens').delete().eq('id', item.id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast({ title: 'Mensagem excluída' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Régua</h1>
          <p className="text-sm text-muted-foreground">
            Mensagens padrão ordenadas pelos dias em relação ao vencimento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar mensagem, critério ou status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[240px] rounded-xl"
          />
          {canEdit && (
            <Button onClick={addItem} className="rounded-xl gap-2">
              <Plus size={16} /> Nova mensagem
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <MessageSquareText className="w-6 h-6 mx-auto mb-3 opacity-50" />
          Nenhuma mensagem cadastrada na régua ainda.
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const isExpanded = item.isNew || editingId === item.id;
            return (
              <div key={item.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                {!isExpanded ? (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-base truncate">{criterioResumo(item.criterio, item.dias)}</h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.status && (
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium ${statusColors[item.status] ?? ''}`}>
                          {item.status}
                        </span>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-2"
                        onClick={() => {
                          navigator.clipboard.writeText(item.mensagem);
                          toast({ title: 'Mensagem copiada' });
                        }}
                      >
                        <Copy size={15} /> Copiar
                      </Button>
                      {canEdit && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl gap-2"
                            onClick={() => setEditingId(item.id)}
                          >
                            <Pencil size={15} /> Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-xl gap-2 text-destructive hover:text-destructive"
                            onClick={() => removeItem(item)}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-[1fr_240px]">
                    <div className="space-y-3">
                      <div className="text-sm font-semibold">
                        {criterioResumo(item.criterio, item.dias)}
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Mensagem</label>
                        <Textarea
                          value={item.mensagem}
                          disabled={!canEdit}
                          onChange={(e) => patch(item.id, { mensagem: e.target.value })}
                          placeholder="Mensagem que será enviada ao aluno neste caso..."
                          rows={6}
                          className="mt-1 rounded-xl resize-y"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Critério de disparo</label>
                        <div className="mt-1 grid grid-cols-1 gap-1.5">
                          {(['antes', 'no', 'depois'] as Criterio[]).map((c) => (
                            <Button
                              key={c}
                              type="button"
                              disabled={!canEdit}
                              variant={item.criterio === c ? 'default' : 'outline'}
                              className="rounded-xl justify-start text-xs h-9"
                              onClick={() => patch(item.id, {
                                criterio: c,
                                dias: c === 'no' ? 0 : item.dias,
                                status: statusFromCriterio(c, c === 'no' ? 0 : item.dias),
                              })}
                            >
                              {CRITERIO_LABELS[c]}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {item.criterio !== 'no' && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            Quantidade de dias {item.criterio === 'antes' ? 'antes' : 'depois'} do vencimento
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={item.dias}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const d = Math.max(0, Math.floor(Number(e.target.value) || 0));
                              patch(item.id, { dias: d, status: statusFromCriterio(item.criterio, d) });
                            }}
                            className="mt-1 rounded-xl"
                          />
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status de disparo (automático)</label>
                        <div className="mt-1">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium ${statusColors[statusFromCriterio(item.criterio, item.dias)] ?? ''}`}>
                            {statusFromCriterio(item.criterio, item.dias)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {criterioResumo(item.criterio, item.dias)}
                        </p>
                      </div>


                      <div className="flex flex-col gap-2 pt-1">
                        <Button
                          variant="outline"
                          className="rounded-xl gap-2"
                          onClick={() => {
                            navigator.clipboard.writeText(item.mensagem);
                            toast({ title: 'Mensagem copiada' });
                          }}
                        >
                          <Copy size={15} /> Copiar mensagem
                        </Button>
                        {canEdit && (
                          <>
                            <Button
                              className="rounded-xl gap-2"
                              disabled={!item.dirty || savingId === item.id}
                              onClick={() => saveItem(item)}
                            >
                              {savingId === item.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                              Salvar
                            </Button>
                            <Button
                              variant="ghost"
                              className="rounded-xl gap-2 text-destructive hover:text-destructive"
                              onClick={() => removeItem(item)}
                            >
                              <Trash2 size={15} /> Excluir
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
