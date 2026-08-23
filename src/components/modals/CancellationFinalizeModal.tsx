import { useMemo, useState } from 'react';
import { CancellationCase, Student } from '@/types';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { createIamCancelamentoTermo } from '@/lib/iamControlTermo';
import { toast } from 'sonner';
import { X, FileText, Download, Send, Check } from 'lucide-react';

interface Props {
  caseRef: CancellationCase;
  type: 'reverter' | 'cancelar';
  student?: Student;
  onClose: () => void;
  onConfirm: (finalOutcome: 'reverter' | 'cancelar') => void;
  allowChooseOutcome?: boolean;
}

/**
 * Modal de finalização — gera o documento adequado:
 *  - reverter: Aditivo de Contrato (mantém o vínculo)
 *  - cancelar: Termo de Cancelamento (encerra o vínculo)
 *
 * Permite preview, download (impressão) e envio do link ao aluno.
 * Sincroniza com ZapSign via IAM Control (termo de cancelamento).
 */
export default function CancellationFinalizeModal({ caseRef, type, student, onClose, onConfirm, allowChooseOutcome = false }: Props) {
  const { updateCancellationCase } = useAppStore();
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<'reverter' | 'cancelar'>(type);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Cálculo de valores para o documento
  const valores = useMemo(() => {
    if (!student) return { vencido: 0, aVencer: 0, total: caseRef.value ?? 0 };
    let vencido = 0, aVencer = 0;
    student.installments.forEach((i) => {
      if (i.paid) return;
      if (new Date(i.dueDate) < today) vencido += i.value;
      else aVencer += i.value;
    });
    return { vencido, aVencer, total: vencido + aVencer };
  }, [student, caseRef]);

  const isReverter = selectedOutcome === 'reverter';
  const titulo = isReverter ? 'Aditivo de Contrato' : 'Termo de Cancelamento';
  const iconColorClass = isReverter ? 'text-emerald-600' : 'text-rose-600';

  const documento = useMemo(() => {
    const linhas = [
      `${titulo.toUpperCase()}`,
      ``,
      `ALUNO: ${caseRef.studentName}`,
      student?.cpf ? `CPF: ${student.cpf}` : '',
      student?.whatsapp ? `WhatsApp: ${student.whatsapp}` : '',
      student?.product ? `Treinamento: ${student.product}` : '',
      ``,
      `Valor do contrato: ${formatCurrency(student?.saleValue ?? 0)}`,
      `Valor pendente (vencido + a vencer): ${formatCurrency(valores.total)}`,
      `Valor vencido: ${formatCurrency(valores.vencido)}`,
      ``,
      isReverter
        ? 'Pelo presente ADITIVO, as partes acordam a REVERSÃO da solicitação de cancelamento, mantendo todas as cláusulas e condições do contrato original em pleno vigor.'
        : 'Pelo presente TERMO, as partes formalizam o CANCELAMENTO do contrato firmado entre o aluno e a instituição, observando os valores acima descritos.',
      ``,
      `Motivo informado: ${caseRef.motivoCancelamento ?? '—'}`,
      caseRef.descricaoCancelamento ? `Descrição: ${caseRef.descricaoCancelamento}` : '',
      ``,
      `Data: ${today.toLocaleDateString('pt-BR')}`,
      ``,
      `_______________________________`,
      `Assinatura do aluno`,
    ].filter(Boolean).join('\n');
    return linhas;
  }, [caseRef, student, valores, isReverter, titulo]);

  // Download / impressão como PDF (usando window.print numa janela nova)
  const handleDownloadPdf = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>${titulo} — ${caseRef.studentName}</title>
          <style>
            body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.6; color: #222; }
            pre { white-space: pre-wrap; font-family: Georgia, serif; font-size: 13px; }
            h1 { font-size: 18px; text-align: center; }
          </style>
        </head>
        <body>
          <pre>${documento.replace(/</g, '&lt;')}</pre>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  const handleSendToZapsign = async () => {
    if (isReverter) {
      toast.error('Aditivo de contrato ainda não está integrado à ZapSign. Use Gerar PDF.');
      return;
    }
    if (!student?.iamControlAlunoId) {
      toast.error('Aluno sem vínculo com IAM Control.');
      return;
    }

    const totalPaid = (student.installments ?? []).filter((i) => i.paid).reduce((s, i) => s + i.value, 0)
      + (Number(student.downPayment) || 0);
    const fineValue = caseRef.cancellationFineValue ?? caseRef.multaValue ?? 0;
    const balance = Math.round((fineValue - totalPaid) * 100) / 100;

    setSending(true);
    try {
      const result = await createIamCancelamentoTermo({
        student,
        caseRef,
        fineValue,
        totalPaid,
        totalContract: student.saleValue ?? caseRef.value ?? 0,
        balance,
        semMultaCDC7: caseRef.dentro7Dias === true && (caseRef.multaPercent ?? -1) === 0,
      });
      if (!result.ok) throw new Error(result.error || 'Falha ao enviar para ZapSign.');

      const signUrl = result.url_assinatura || result.file_url;
      if (signUrl) window.open(signUrl, '_blank', 'noopener,noreferrer');

      await updateCancellationCase(caseRef.id, {
        termTemplate: documento,
        termAttachments: [
          ...(caseRef.termAttachments ?? []),
          {
            name: `ZapSign — ${result.nome_documento || titulo}`,
            url: signUrl || `zapsign:${result.id}`,
            uploadedAt: new Date().toISOString(),
            type: 'outro',
          },
        ],
      });
      setSent(true);
      toast.success('Termo enviado para assinatura na ZapSign.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar para ZapSign.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = () => {
    // Salva o template antes de confirmar a ação final
    updateCancellationCase(caseRef.id, { termTemplate: documento });
    onConfirm(selectedOutcome);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className={iconColorClass} />
            <h2 className="text-sm font-bold text-foreground">{titulo}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4 max-h-[280px] overflow-y-auto">
          <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">{documento}</pre>
        </div>

        {/* Ações documento */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-all">
            <Download size={12} /> Gerar PDF
          </button>
          <button onClick={handleSendToZapsign} disabled={sent || sending || isReverter || !student?.iamControlAlunoId}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-all disabled:opacity-50">
            {sent ? <><Check size={12} /> Enviado para ZapSign</> : <><Send size={12} /> {sending ? 'Enviando…' : 'Enviar via ZapSign'}</>}
          </button>
        </div>

        {sent && (
          <div className="mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700">
            Termo gerado na ZapSign. O link de assinatura foi aberto em nova aba.
          </div>
        )}
        {!isReverter && !student?.iamControlAlunoId && (
          <p className="mb-4 text-[11px] text-amber-700">Vincule o aluno ao IAM Control para enviar via ZapSign.</p>
        )}

        {/* Escolher resultado e finalizar */}
        {allowChooseOutcome ? (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <label className="block text-[11px] font-semibold text-blue-900 mb-2">Escolha o resultado da finalização:</label>
            <div className="flex gap-2">
              <button
                onClick={() => { setSelectedOutcome('reverter'); updateCancellationCase(caseRef.id, { termTemplate: documento }); onConfirm('reverter'); }}
                className="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold transition-all bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-600 hover:text-white"
              >
                Revertido
              </button>
              <button
                onClick={() => { setSelectedOutcome('cancelar'); updateCancellationCase(caseRef.id, { termTemplate: documento }); onConfirm('cancelar'); }}
                className="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold transition-all bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-600 hover:text-white"
              >
                Cancelado
              </button>
            </div>
          </div>
        ) : (
          <button onClick={handleConfirm}
            className={`w-full py-2.5 rounded-xl text-sm font-medium text-white shadow-md hover:shadow-lg transition-all ${
              isReverter ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}>
            {isReverter ? 'Confirmar Reversão' : 'Confirmar Cancelamento'}
          </button>
        )}
      </div>
    </div>
  );
}
