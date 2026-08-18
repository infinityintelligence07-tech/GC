import { useRef, useState } from 'react';
import { Student, HistoryEntry, CaseNoteAttachment } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { supabase } from '@/integrations/supabase/client';
import { registrarConciliacao } from '@/store/useConciliacaoStore';
import { downloadCancellationPdf, openCancellationPdf, isViewableInBrowser } from '@/lib/openCancellationPdf';
import { toast } from 'sonner';
import {
  X, Phone, MessageCircle, Mail, Paperclip, FileText, Trash2, Loader2, Send, CheckCircle2, Download as DownloadIcon,
} from 'lucide-react';

interface Props {
  student: Student;
  onClose: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function HistoryModal({ student, onClose }: Props) {
  const { updateStudent, students, currentUser } = useAppStore();
  const [newEntry, setNewEntry] = useState('');
  const [entryType, setEntryType] = useState<HistoryEntry['type']>('WhatsApp');
  const [pending, setPending] = useState<File[]>([]);
  const [sendToConc, setSendToConc] = useState(false);
  const [pag, setPag] = useState({
    valorTotal: '',
    vencimento: '',
    valorPago: '',
    pagador: '',
    dataPagamento: '',
    forma: 'PIX' as 'PIX' | 'Cartão' | 'Boleto' | 'Dinheiro' | 'Outro',
  });
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
      const path = `${companyId}/history/${student.id}/${Date.now()}_${safeName}`;
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

  const handleAdd = async () => {
    const trimmed = newEntry.trim();
    if (!trimmed && pending.length === 0) {
      setError('Escreva um registro ou anexe um comprovante.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const attachments = await uploadAll();
      const nowIso = new Date().toISOString();
      const entry: HistoryEntry = {
        date: nowIso,
        type: entryType,
        text: trimmed || (attachments.length ? 'Comprovante anexado.' : ''),
        ...(attachments.length ? { attachments } : {}),
        ...(sendToConc
          ? { sentToConciliacaoAt: nowIso, sentToConciliacaoBy: currentUser?.name }
          : {}),
      };
      // CRÍTICO: ler o estado MAIS FRESCO da store — evita perder entradas em cliques rápidos.
      const latestStudent = useAppStore.getState().students.find((s) => s.id === student.id);
      const currentHistory = latestStudent?.history ?? student.history;
      await updateStudent(student.id, { history: [...currentHistory, entry] });

      if (sendToConc) {
        const vTotal = parseFloat(pag.valorTotal.replace(',', '.')) || 0;
        const vPago = parseFloat(pag.valorPago.replace(',', '.')) || 0;
        const desconto = Math.max(0, vTotal - vPago);
        const descPerc = vTotal > 0 ? (desconto / vTotal) * 100 : 0;
        const fmtBRL = (n: number) =>
          n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const fmtDDMM = (iso: string) => {
          if (!iso) return '';
          const [, m, d] = iso.split('-');
          return `${d}/${m}`;
        };
        const fmtDDMMYY = (iso: string) => {
          if (!iso) return '';
          const [y, m, d] = iso.split('-');
          return `${d}/${m}/${y.slice(2)}`;
        };
        const linhas: string[] = ['PAGAMENTO DE PARCELA', ''];
        linhas.push(`ALUNO: ${student.name}`);
        if (student.product) linhas.push(`TREINAMENTO: ${student.product}`);
        if (vTotal > 0) {
          linhas.push(
            `VALOR TOTAL: ${fmtBRL(vTotal)}${pag.vencimento ? ` ${fmtDDMM(pag.vencimento)}` : ''}`,
          );
        }
        if (vPago > 0) linhas.push(`VALOR PAGO: ${fmtBRL(vPago)}`);
        if (desconto > 0) {
          linhas.push(
            `DSC: ${fmtBRL(desconto)} = ${descPerc.toFixed(2).replace('.', ',')}% desconto`,
          );
        }
        if (pag.pagador || pag.dataPagamento) {
          linhas.push('');
          linhas.push(
            `${pag.forma.toUpperCase()} EM NOME DE: ${pag.pagador || '—'}${pag.dataPagamento ? ` - DIA ${fmtDDMMYY(pag.dataPagamento)}` : ''}`,
          );
        }
        if (trimmed) {
          linhas.push('');
          linhas.push(`OBS: ${trimmed}`);
        }
        const bloco = linhas.join('\n');

        const depois: Record<string, unknown> = {};
        if (vTotal > 0) depois.valorTotalParcela = vTotal;
        if (vPago > 0) depois.valorPago = vPago;
        if (desconto > 0) depois.descontoConcedido = desconto;
        if (pag.vencimento) depois.vencimento = pag.vencimento;
        if (pag.dataPagamento) depois.dataPagamento = pag.dataPagamento;
        if (pag.pagador) depois.pagador = pag.pagador;
        depois.formaPagamento = pag.forma;
        if (attachments.length) depois._attachments = attachments;

        registrarConciliacao({
          tipo: 'pagamento_parcela',
          studentId: student.id,
          studentName: student.name,
          ac: student.ac,
          resumo: vPago > 0
            ? `Pagamento ${pag.forma} de ${fmtBRL(vPago)} informado pelo AC — conferir comprovante`
            : `Pagamento informado pelo AC — conferir comprovante (${entryType})`,
          antes: {},
          depois,
          autorObservacao: bloco,
        });
        toast.success('Registro enviado para Conciliação.');
      } else {
        toast.success('Registro gravado.');
      }

      setNewEntry('');
      setPending([]);
      setSendToConc(false);
      setPag({ valorTotal: '', vencimento: '', valorPago: '', pagador: '', dataPagamento: '', forma: 'PIX' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gravar registro.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const openAttachment = async (a: CaseNoteAttachment) => {
    try {
      if ((a.mime ?? '').toLowerCase() === 'application/pdf' || (a.mime ?? '').toLowerCase().startsWith('image/') || isViewableInBrowser(a.name) || isViewableInBrowser(a.url)) {
        await openCancellationPdf(a.url, a.name);
      } else {
        await downloadCancellationPdf(a.url, a.name);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.';
      toast.error(msg);
    }
  };

  const typeIcons = {
    Ligação: <Phone size={12} />,
    WhatsApp: <MessageCircle size={12} />,
    'E-mail': <Mail size={12} />,
    Sistema: <span className="text-[10px]">⚙</span>,
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4">
      <div className="bg-card rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Histórico</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-3 max-h-80 overflow-auto no-scrollbar">
          {(() => {
            const liveHistory = (students.find((s) => s.id === student.id)?.history ?? student.history);
            return liveHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">Nenhum registro.</p>
            ) : liveHistory.map((entry, i) => (
              <div key={i} className="flex gap-3 p-3 bg-muted/50 rounded-xl">
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  {typeIcons[entry.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-medium text-primary">{entry.type}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.date).toLocaleDateString('pt-BR')} {new Date(entry.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {entry.sentToConciliacaoAt && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-1.5 py-0.5">
                        <CheckCircle2 size={9} /> Enviado à Conciliação
                      </span>
                    )}
                  </div>
                  {entry.text && (
                    <p className="text-xs text-foreground mt-0.5 whitespace-pre-wrap">{entry.text}</p>
                  )}
                  {entry.attachments && entry.attachments.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {entry.attachments.map((a) => (
                        <li key={a.url}>
                          <button
                            type="button"
                            onClick={() => openAttachment(a)}
                            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
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
                </div>
              </div>
            ));
          })()}
        </div>

        <div className="p-6 border-t border-border space-y-3">
          <div className="flex gap-2">
            {(['Ligação', 'WhatsApp', 'E-mail'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setEntryType(type)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  entryType === type
                    ? 'iam-gradient text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          <textarea
            className="input-field w-full text-sm resize-none"
            rows={2}
            placeholder="Adicionar registro (ex.: aluno pagou parcela via PIX)…"
            value={newEntry}
            onChange={(e) => setNewEntry(e.target.value)}
          />
          {pending.length > 0 && (
            <ul className="space-y-1">
              {pending.map((f, idx) => (
                <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 text-[11px] bg-muted/60 border border-border rounded-lg px-2 py-1">
                  <span className="flex items-center gap-1.5 truncate">
                    <FileText size={12} className="text-primary shrink-0" />
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted transition-colors disabled:opacity-60"
              title="Anexar comprovante (até 10 MB)"
            >
              <Paperclip size={12} /> Anexar comprovante
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendToConc}
                onChange={(e) => setSendToConc(e.target.checked)}
                className="rounded border-border"
              />
              <span className="inline-flex items-center gap-1">
                <Send size={11} /> Enviar para Conciliação
              </span>
            </label>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="ml-auto inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold iam-gradient text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              Gravar
            </button>
          </div>
          {sendToConc && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Send size={11} className="text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Dados do pagamento (para a Conciliação)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Valor total da parcela (R$)
                  <input
                    type="number" step="0.01" min="0" inputMode="decimal"
                    className="input-field text-xs" placeholder="1833,33"
                    value={pag.valorTotal}
                    onChange={(e) => setPag((p) => ({ ...p, valorTotal: e.target.value }))}
                  />
                </label>
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Vencimento
                  <input
                    type="date" className="input-field text-xs"
                    value={pag.vencimento}
                    onChange={(e) => setPag((p) => ({ ...p, vencimento: e.target.value }))}
                  />
                </label>
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Valor pago (R$)
                  <input
                    type="number" step="0.01" min="0" inputMode="decimal"
                    className="input-field text-xs" placeholder="1817,20"
                    value={pag.valorPago}
                    onChange={(e) => setPag((p) => ({ ...p, valorPago: e.target.value }))}
                  />
                </label>
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Data do pagamento
                  <input
                    type="date" className="input-field text-xs"
                    value={pag.dataPagamento}
                    onChange={(e) => setPag((p) => ({ ...p, dataPagamento: e.target.value }))}
                  />
                </label>
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Forma
                  <select
                    className="input-field text-xs"
                    value={pag.forma}
                    onChange={(e) => setPag((p) => ({ ...p, forma: e.target.value as typeof p.forma }))}
                  >
                    <option value="PIX">PIX</option>
                    <option value="Cartão">Cartão</option>
                    <option value="Boleto">Boleto</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Outro">Outro</option>
                  </select>
                </label>
                <label className="text-[10px] font-medium text-muted-foreground flex flex-col gap-0.5">
                  Pago em nome de
                  <input
                    type="text" className="input-field text-xs" placeholder="Ex.: Davi Pereira da Silva"
                    value={pag.pagador}
                    onChange={(e) => setPag((p) => ({ ...p, pagador: e.target.value }))}
                  />
                </label>
              </div>
              {(() => {
                const vT = parseFloat(pag.valorTotal.replace(',', '.')) || 0;
                const vP = parseFloat(pag.valorPago.replace(',', '.')) || 0;
                const d = Math.max(0, vT - vP);
                if (vT <= 0 || d <= 0) return null;
                const perc = (d / vT) * 100;
                const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                return (
                  <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                    Desconto calculado: <strong>{fmt(d)}</strong> ({perc.toFixed(2).replace('.', ',')}%)
                  </p>
                );
              })()}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Marque <strong>Enviar para Conciliação</strong> para que o setor visualize a movimentação e o comprovante (ex.: parcela paga via PIX).
          </p>
        </div>
      </div>
    </div>
  );
}
