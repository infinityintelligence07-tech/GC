import { useRef, useState } from 'react';
import { Paperclip, Trash2, Download as DownloadIcon, MessageSquarePlus, FileText, Loader2 } from 'lucide-react';
import { CancellationCase, CaseNote, CaseNoteAttachment } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { supabase } from '@/integrations/supabase/client';
import { saveCancellationCaseNotesDb } from '@/lib/supabaseMutations';
import { downloadCancellationPdf, openCancellationPdf, isViewableInBrowser } from '@/lib/openCancellationPdf';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

interface Props {
  caseRef: CancellationCase;
}

export default function CaseNotesPanel({ caseRef }: Props) {
  const { updateCancellationCase, currentUser } = useAppStore();
  const notes: CaseNote[] = caseRef.caseNotes ?? [];
  const [text, setText] = useState('');
  const [pending, setPending] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const accepted: File[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`"${f.name}" excede o limite de 10 MB.`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length) setError(null);
    setPending((prev) => [...prev, ...accepted]);
  };

  const removePending = (idx: number) =>
    setPending((prev) => prev.filter((_, i) => i !== idx));

  const uploadAll = async (): Promise<CaseNoteAttachment[]> => {
    const companyId = useCompanyStore.getState().activeCompanyId;
    if (!companyId) throw new Error('Empresa ativa não identificada.');
    const uploaded: CaseNoteAttachment[] = [];
    for (const file of pending) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${companyId}/case-notes/${caseRef.id}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('cancellation-docs')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) throw upErr;
      uploaded.push({
        name: file.name,
        url: path,
        size: file.size,
        mime: file.type || undefined,
        uploadedAt: new Date().toISOString(),
      });
    }
    return uploaded;
  };

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed && pending.length === 0) {
      setError('Adicione uma observação ou anexe um arquivo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const attachments = await uploadAll();
      const note: CaseNote = {
        id: crypto.randomUUID(),
        text: trimmed,
        authorId: currentUser?.id ?? null,
        authorName: currentUser?.name ?? 'Usuário',
        createdAt: new Date().toISOString(),
        attachments: attachments.length ? attachments : undefined,
      };
      const next = [note, ...notes];
      updateCancellationCase(caseRef.id, { caseNotes: next });
      await saveCancellationCaseNotesDb(caseRef.id, next);
      setText('');
      setPending([]);
      toast.success('Observação registrada.');
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao salvar observação.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (!window.confirm('Excluir esta observação? Os arquivos anexados também serão removidos.')) return;
    const target = notes.find((n) => n.id === id);
    if (target?.attachments?.length) {
      try {
        await supabase.storage
          .from('cancellation-docs')
          .remove(target.attachments.map((a) => a.url));
      } catch { /* ignore */ }
    }
    const next = notes.filter((n) => n.id !== id);
    updateCancellationCase(caseRef.id, { caseNotes: next });
    await saveCancellationCaseNotesDb(caseRef.id, next);
  };

  const openAttachment = async (a: CaseNoteAttachment) => {
    try {
      if ((a.mime ?? '').toLowerCase() === 'application/pdf' || (a.mime ?? '').toLowerCase().startsWith('image/') || isViewableInBrowser(a.name) || isViewableInBrowser(a.url)) {
        await openCancellationPdf(a.url, a.name);
      } else {
        await downloadCancellationPdf(a.url, a.name);
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Não foi possível abrir o arquivo.');
    }
  };

  return (
    <div className="bg-amber-50/40 border border-amber-200 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-amber-800 mb-3 uppercase tracking-wider flex items-center gap-1.5">
        <MessageSquarePlus size={12} /> Observações Manuais do Caso
      </h3>

      {/* Editor */}
      <div className="space-y-2 mb-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Registre uma observação manual sobre este caso…"
          className="w-full text-sm rounded-lg border border-amber-200 bg-card p-2 focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
        {pending.length > 0 && (
          <ul className="space-y-1">
            {pending.map((f, idx) => (
              <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 text-[11px] bg-card border border-amber-200 rounded-lg px-2 py-1">
                <span className="flex items-center gap-1.5 truncate">
                  <FileText size={12} className="text-amber-700 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-muted-foreground shrink-0">({formatBytes(f.size)})</span>
                </span>
                <button
                  type="button"
                  onClick={() => removePending(idx)}
                  className="text-rose-600 hover:text-rose-800 shrink-0"
                  title="Remover"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-[11px] text-rose-700">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-amber-300 bg-card hover:bg-amber-100 transition-colors disabled:opacity-60"
          >
            <Paperclip size={12} /> Anexar arquivo
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <span className="text-[10px] text-muted-foreground">Até 10 MB por arquivo.</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="ml-auto flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <MessageSquarePlus size={12} />}
            Salvar observação
          </button>
        </div>
      </div>

      {/* Lista */}
      {notes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhuma observação registrada.</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-amber-300 pl-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] text-amber-800 font-semibold uppercase tracking-wider">
                  {formatDateTime(n.createdAt)} · {n.authorName ?? 'Usuário'}
                </p>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(n.id)}
                  className="text-rose-600 hover:text-rose-800"
                  title="Excluir observação"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {n.text && (
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed mt-0.5">{n.text}</p>
              )}
              {n.attachments && n.attachments.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {n.attachments.map((a) => (
                    <li key={a.url}>
                      <button
                        type="button"
                        onClick={() => openAttachment(a)}
                        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-amber-300 bg-card hover:bg-amber-100 transition-colors"
                        title={`${a.name} (${formatBytes(a.size)})`}
                      >
                        <DownloadIcon size={10} />
                        <span className="max-w-[160px] truncate">{a.name}</span>
                        <span className="text-muted-foreground">· {formatBytes(a.size)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
