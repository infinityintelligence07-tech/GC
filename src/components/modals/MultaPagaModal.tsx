import { useState } from 'react';
import { X, BadgeCheck, AlertTriangle, Upload, FileText, Trash2, Loader2 } from 'lucide-react';
import { CancellationCase } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import CurrencyInput from '@/components/ui/CurrencyInput';
import { getTodayStringBrasilia } from '@/lib/brasiliaDate';
import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';

interface Props {
  caseRef: CancellationCase;
  /** Valor que estava pendente de negativação (multa − pago). */
  valorNegativado: number;
  onClose: () => void;
  onConfirm: (payload: {
    valorPago: number;
    dataPagamento: string;
    observacao: string;
    comprovanteUrl?: string;
    comprovanteNome?: string;
  }) => void;
}

/**
 * Modal "Aluno pagou a multa" — usado apenas em casos FINALIZADOS que tiveram
 * valor enviado para negativação. Registra o valor pago pelo aluno e devolve o
 * card para a Conciliação com a observação de retirada da negativação em até
 * 5 dias.
 */
export default function MultaPagaModal({ caseRef, valorNegativado, onClose, onConfirm }: Props) {
  const [valorPago, setValorPago] = useState<number>(valorNegativado);
  const [dataPagamento, setDataPagamento] = useState<string>(getTodayStringBrasilia());
  const [observacao, setObservacao] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const invalid = !(valorPago > 0) || !dataPagamento || !file || uploading;

  const handleConfirm = async () => {
    if (invalid || !file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const activeCompanyId = useCompanyStore.getState().activeCompanyId;
      if (!activeCompanyId) throw new Error('Empresa ativa não identificada.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${activeCompanyId}/comprovantes-multa/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from('cancellation-docs').upload(path, file, {
        contentType: file.type || 'application/pdf',
        upsert: false,
      });
      if (error) throw error;
      onConfirm({
        valorPago,
        dataPagamento,
        observacao: observacao.trim(),
        comprovanteUrl: path,
        comprovanteNome: file.name,
      });
    } catch (err: any) {
      setUploadError(err?.message ?? 'Falha ao enviar o comprovante.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <BadgeCheck size={16} className="text-emerald-600" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Aluno pagou a multa</h2>
              <p className="text-[11px] text-muted-foreground">{caseRef.studentName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
          Valor que foi para negativação: <strong>{formatCurrency(valorNegativado)}</strong>
        </div>

        <label className="block text-[11px] font-semibold text-foreground mb-1">Valor pago de multa</label>
        <CurrencyInput
          value={valorPago}
          onChange={setValorPago}
          autoFocus
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm mb-3"
        />

        <label className="block text-[11px] font-semibold text-foreground mb-1">Data do pagamento</label>
        <input
          type="date"
          value={dataPagamento}
          onChange={(e) => setDataPagamento(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm mb-3"
        />

        <label className="block text-[11px] font-semibold text-foreground mb-1">Observação (opcional)</label>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={3}
          placeholder="Ex.: pagamento via PIX, comprovante enviado no chat."
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs mb-3 resize-none"
        />

        <label className="block text-[11px] font-semibold text-foreground mb-1">
          Comprovante de pagamento da multa <span className="text-rose-600">*</span>
        </label>
        {!file ? (
          <label className="mb-3 flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-dashed border-border bg-muted/30 text-[11px] text-muted-foreground cursor-pointer hover:bg-muted transition-colors">
            <Upload size={14} />
            Anexar comprovante (PDF ou imagem)
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setUploadError(null); }
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={14} className="text-primary shrink-0" />
              <span className="text-[11px] font-medium text-foreground truncate">{file.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-muted-foreground hover:text-rose-600 transition-colors shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {uploadError && (
          <p className="mb-3 text-[11px] text-rose-600">{uploadError}</p>
        )}

        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-700 flex gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Ao confirmar, o caso volta para a aba <strong>Conciliação</strong> com a informação do pagamento e a
            observação de que a <strong>negativação precisa ser retirada em no máximo 5 dias</strong>. O
            comprovante anexado ficará disponível para consulta na Conciliação.
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={invalid}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {uploading && <Loader2 size={13} className="animate-spin" />}
            {uploading ? 'Enviando...' : 'Confirmar pagamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
