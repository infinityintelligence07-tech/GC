import { useMemo, useState } from 'react';
import { X, Download, Copy, Check, Link2 } from 'lucide-react';
import type { CancellationCase, RefundPaymentMethod, RefundPixKeyType, Student } from '@/types';
import {
  buildCancellationTermoDocument,
  buildCancellationTermoInputFromCase,
  buildCancellationTermoPrintHtml,
  cancellationTermoToPlainText,
  type CancellationTermoRefundParcel,
} from '@/lib/cancellationTermoDocument';
import { createIamCancelamentoTermo } from '@/lib/iamControlTermo';
import { toast } from 'sonner';
import logoIAM from '@/assets/logo-iam-blue.png';

export interface TermoCancelamentoModalProps {
  caseRef: CancellationCase;
  student?: Student | null;
  semMultaCDC7: boolean;
  multaPercent: number;
  multaValue: number;
  totalPago: number;
  totalContract: number;
  /** Saldo líquido (positivo = aluno deve; negativo = estorno). */
  balance: number;
  estornoTotal: number;
  refundInstallments?: CancellationTermoRefundParcel[];
  refundPaymentMethod?: RefundPaymentMethod;
  pixKey?: string;
  pixKeyType?: RefundPixKeyType | string;
  legalNotes?: string;
  onClose: () => void;
  onGenerated?: (payload: { signUrl?: string; plainText: string }) => void;
}

export default function TermoCancelamentoModal({
  caseRef,
  student,
  semMultaCDC7,
  multaPercent,
  multaValue,
  totalPago,
  totalContract,
  balance,
  estornoTotal,
  refundInstallments,
  refundPaymentMethod,
  pixKey,
  pixKeyType,
  legalNotes,
  onClose,
  onGenerated,
}: TermoCancelamentoModalProps) {
  const [linkBusy, setLinkBusy] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const doc = useMemo(
    () =>
      buildCancellationTermoDocument(
        buildCancellationTermoInputFromCase({
          caseRef,
          student,
          semMultaCDC7,
          multaPercent,
          multaValue,
          totalPago,
          estornoTotal,
          refundInstallments,
          refundPaymentMethod,
          pixKey,
          pixKeyType,
        }),
      ),
    [
      caseRef,
      student,
      semMultaCDC7,
      multaPercent,
      multaValue,
      totalPago,
      estornoTotal,
      refundInstallments,
      refundPaymentMethod,
      pixKey,
      pixKeyType,
    ],
  );

  const plainText = useMemo(() => cancellationTermoToPlainText(doc), [doc]);

  const handleGeneratePDF = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildCancellationTermoPrintHtml(doc, logoIAM));
    win.document.close();
    setTimeout(() => win.print(), 250);
  };

  const copySignLink = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    toast.success('Link de assinatura copiado. Envie para o aluno assinar.');
  };

  const handleCopySignLink = async () => {
    if (!student?.iamControlAlunoId) {
      toast.error('Vincule o aluno ao IAM Control para gerar o link de assinatura.');
      return;
    }

    if (signLink) {
      try {
        await copySignLink(signLink);
      } catch {
        toast.error('Não foi possível copiar o link.');
      }
      return;
    }

    setLinkBusy(true);
    try {
      const result = await createIamCancelamentoTermo({
        student,
        caseRef: { ...caseRef, legalNotes: legalNotes ?? caseRef.legalNotes },
        fineValue: multaValue,
        totalPaid: totalPago,
        totalContract,
        balance,
        semMultaCDC7,
        document: doc,
      });
      if (!result.ok) throw new Error(result.error || 'Falha ao gerar link de assinatura.');
      const url = result.url_assinatura || result.file_url;
      if (!url) throw new Error('Link de assinatura não disponível.');
      setSignLink(url);
      await copySignLink(url);
      onGenerated?.({ signUrl: url, plainText });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar link de assinatura.');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{doc.titulo}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Base institucional · {semMultaCDC7 ? 'sem multa (CDC 7 dias)' : 'com multa e estorno'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="border border-border rounded-xl p-6 bg-muted/20 space-y-3 max-h-[28rem] overflow-y-auto text-[11px] leading-relaxed text-foreground/90">
            <div className="flex justify-center mb-2">
              <img src={logoIAM} alt="IAM" className="w-14 h-auto" />
            </div>
            <h3 className="text-center text-sm font-bold uppercase tracking-wide">{doc.titulo}</h3>

            <div className="space-y-0.5">
              <p>
                <span className="font-semibold">NOME COMPLETO:</span> {doc.studentName}
              </p>
              <p>
                <span className="font-semibold">CPF:</span> {doc.cpf}
              </p>
              <p>
                <span className="font-semibold">E-MAIL:</span> {doc.email}
              </p>
              <p>
                <span className="font-semibold">WHATSAPP:</span> {doc.whatsapp}
              </p>
            </div>

            {doc.paragraphs.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}

            {doc.showBankBlock && (
              <div className="space-y-0.5 pt-1">
                <p className="font-semibold uppercase text-[10px]">Dados Bancários</p>
                {doc.bankLines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            )}

            <p className="pt-2">{doc.localData}</p>

            <div className="grid grid-cols-2 gap-6 pt-6 text-center text-[10px]">
              <div>
                <div className="border-t border-foreground/40 mt-8 mb-1" />
                <p className="font-medium">{doc.studentName}</p>
                <p>{doc.cpf}</p>
              </div>
              <div>
                <div className="border-t border-foreground/40 mt-8 mb-1" />
                <p className="font-medium">INSTITUTO ACADEMY MIND TREINAMENTOS LTDA</p>
                <p>CNPJ 03.727.532/0001-13</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs text-blue-800">
              Termo no padrão do documento institucional (sem endereço, turma ou preço do contrato). Gere o PDF ou
              copie o link de assinatura para enviar ao aluno.
            </p>
          </div>

          {!student?.iamControlAlunoId && (
            <p className="text-[11px] text-amber-700">
              Vincule o aluno ao IAM Control para habilitar a cópia do link de assinatura.
            </p>
          )}

          {signLink && (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700">
              Link pronto para enviar ao aluno. Clique em Copiar Link novamente se precisar.
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border flex gap-3 justify-end flex-wrap">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Fechar
          </button>
          <button
            onClick={handleGeneratePDF}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Download size={16} />
            Gerar PDF
          </button>
          <button
            onClick={handleCopySignLink}
            disabled={linkBusy || !student?.iamControlAlunoId}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {linkBusy ? (
              <>
                <Link2 size={16} /> Gerando link…
              </>
            ) : linkCopied ? (
              <>
                <Check size={16} /> Link copiado
              </>
            ) : (
              <>
                <Copy size={16} /> Copiar Link
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
