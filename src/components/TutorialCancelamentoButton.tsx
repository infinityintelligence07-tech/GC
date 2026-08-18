import { useEffect, useState } from 'react';
import { PlayCircle, X, Plus, Trash2, Link2, Loader2 } from 'lucide-react';
import tutorialAsset from '@/assets/tutorial-cancelamento.mp4.asset.json';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

type TutorialRow = {
  id: string;
  title: string;
  description: string | null;
  url: string;
};

type TutorialItem = {
  id: string;
  title: string;
  description: string;
  url: string;
  builtin?: boolean;
};

const BUILTIN: TutorialItem = {
  id: '__builtin__',
  title: 'Como subir um aluno para cancelamento',
  description: 'Passo a passo do Assessor de Conta: da carteira até a coluna Entrada',
  url: tutorialAsset.url,
  builtin: true,
};

/** Converte links de YouTube, Google Drive, Vimeo e Loom em URL de embed. */
export function toEmbedUrl(raw: string): { kind: 'iframe' | 'video'; src: string } | null {
  const url = (raw || '').trim();
  if (!url) return null;

  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };

  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/i);
  if (drive) return { kind: 'iframe', src: `https://drive.google.com/file/d/${drive[1]}/preview` };

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };

  const loom = url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i);
  if (loom) return { kind: 'iframe', src: `https://www.loom.com/embed/${loom[1]}` };

  if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || url.startsWith('/__l5e/')) {
    return { kind: 'video', src: url };
  }

  if (/^https?:\/\//i.test(url)) return { kind: 'iframe', src: url };
  return null;
}

export default function TutorialCancelamentoButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TutorialItem[]>([BUILTIN]);
  const [selectedId, setSelectedId] = useState(BUILTIN.id);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', url: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tutorials' as any)
      .select('id, title, description, url')
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      console.error('Erro ao carregar tutoriais:', error);
      return;
    }
    const rows = ((data ?? []) as unknown as TutorialRow[]).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? '',
      url: r.url,
    }));
    setItems([BUILTIN, ...rows]);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = items.find((i) => i.id === selectedId) ?? BUILTIN;
  const embed = toEmbedUrl(selected.url);

  const handleSave = async () => {
    const title = form.title.trim();
    const url = form.url.trim();
    if (!title) return toast({ title: 'Informe o título do tutorial', variant: 'destructive' });
    if (!toEmbedUrl(url)) return toast({ title: 'Link inválido', description: 'Cole um link do YouTube, Google Drive, Vimeo, Loom ou de um vídeo (.mp4).', variant: 'destructive' });

    setSaving(true);
    const { data, error } = await supabase
      .from('tutorials' as any)
      .insert({ title, description: form.description.trim() || null, url } as any)
      .select('id, title, description, url')
      .single();
    setSaving(false);
    if (error) {
      console.error(error);
      return toast({ title: 'Não foi possível salvar', description: error.message, variant: 'destructive' });
    }
    const row = data as unknown as TutorialRow;
    setItems((prev) => [...prev, { id: row.id, title: row.title, description: row.description ?? '', url: row.url }]);
    setSelectedId(row.id);
    setForm({ title: '', description: '', url: '' });
    setAdding(false);
    toast({ title: 'Tutorial adicionado' });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('tutorials' as any).delete().eq('id', id);
    if (error) {
      console.error(error);
      return toast({ title: 'Não foi possível excluir', description: error.message, variant: 'destructive' });
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(BUILTIN.id);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border border-primary/25 bg-primary/8 text-primary hover:bg-primary/15 transition-all"
        title="Abrir tutoriais da aba Cancelamentos"
      >
        <PlayCircle size={14} strokeWidth={2} />
        Ver tutorial
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-6xl max-h-[92vh] bg-card rounded-2xl border border-border overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Tutoriais — Cancelamentos</h3>
                <p className="text-[11px] text-muted-foreground">
                  Assista aos vídeos ou anexe novos tutoriais por link (YouTube, Google Drive, Vimeo, Loom)
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col md:flex-row min-h-0 flex-1">
              {/* Lista */}
              <aside className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-y-auto max-h-56 md:max-h-none">
                <div className="p-3 space-y-1.5">
                  {loading && (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-2 py-1">
                      <Loader2 size={12} className="animate-spin" /> Carregando…
                    </div>
                  )}
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className={`group rounded-xl px-3 py-2 cursor-pointer border transition-all ${
                        it.id === selectedId
                          ? 'border-primary/30 bg-primary/10'
                          : 'border-transparent hover:bg-muted'
                      }`}
                      onClick={() => setSelectedId(it.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-foreground truncate">{it.title}</p>
                          {it.description && (
                            <p className="text-[10px] text-muted-foreground line-clamp-2">{it.description}</p>
                          )}
                        </div>
                        {!it.builtin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(it.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground hover:text-destructive"
                            aria-label="Excluir tutorial"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!adding ? (
                    <button
                      onClick={() => setAdding(true)}
                      className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    >
                      <Plus size={13} /> Adicionar tutorial
                    </button>
                  ) : (
                    <div className="mt-2 space-y-2 rounded-xl border border-border p-3">
                      <input
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        placeholder="Título"
                        maxLength={120}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-[12px]"
                      />
                      <input
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="Descrição (opcional)"
                        maxLength={200}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-[12px]"
                      />
                      <div className="flex items-center gap-1.5">
                        <Link2 size={13} className="text-muted-foreground shrink-0" />
                        <input
                          value={form.url}
                          onChange={(e) => setForm({ ...form, url: e.target.value })}
                          placeholder="Cole o link do vídeo"
                          maxLength={600}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-background text-[12px]"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground disabled:opacity-60"
                        >
                          {saving ? 'Salvando…' : 'Salvar'}
                        </button>
                        <button
                          onClick={() => {
                            setAdding(false);
                            setForm({ title: '', description: '', url: '' });
                          }}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-border text-muted-foreground"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              {/* Player */}
              <div className="flex-1 min-w-0 p-4 overflow-y-auto">
                <h4 className="text-sm font-semibold text-foreground">{selected.title}</h4>
                {selected.description && (
                  <p className="text-[11px] text-muted-foreground mb-3">{selected.description}</p>
                )}
                <div className="rounded-2xl overflow-hidden border border-border bg-black aspect-video">
                  {embed?.kind === 'video' ? (
                    <video key={selected.id} src={embed.src} controls className="w-full h-full" />
                  ) : embed ? (
                    <iframe
                      key={selected.id}
                      src={embed.src}
                      title={selected.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      allowFullScreen
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[12px] text-white/70">
                      Link de vídeo inválido
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
