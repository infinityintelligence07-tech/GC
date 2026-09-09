import { useMemo, useState } from 'react';
import { X, Download, Check, Link2, FileText } from 'lucide-react';
import type { CancellationCase, RefundPaymentMethod, RefundPixKeyType, Student } from '@/types';
import {
  CANCELLATION_TERMO_VARIANTS,
  buildCancellationTermoDocument,
  buildCancellationTermoInputFromCase,
  buildCancellationTermoPrintHtml,
  cancellationTermoToPlainText,
  cancellationTermoVariantLabel,
  resolveCancellationTermoVariant,
  type CancellationTermoRefundParcel,
  type CancellationTermoVariant,
} from '@/lib/cancellationTermoDocument';
import {
  buildCancelamentoTermoMarkdown,
  checkStudentZapSignSigner,
  createZapSignTermo,
  describeEnvioAutomatico,
} from '@/lib/zapsignTermo';
import ZapSignLinkActions from '@/components/ui/ZapSignLinkActions';
import ZapSignEnvioAutomatico from '@/components/ui/ZapSignEnvioAutomatico';
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
  pixOtherHolder?: boolean;
  pixHolderName?: string;
  pixHolderPhone?: string;
  legalNotes?: string;
  onClose: () => void;
  onGenerated?: (payload: {
    signUrl?: string;
    plainText: string;
    id?: string;
    status?: string;
    titulo?: string;
    variant?: string;
  }) => void;
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
  pixOtherHolder,
  pixHolderName,
  pixHolderPhone,
  legalNotes,
  onClose,
  onGenerated,
}: TermoCancelamentoModalProps) {
  const [linkBusy, setLinkBusy] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  /** ZapSign envia o link por e-mail ao aluno (grátis) além do link para copiar/WhatsApp. */
  const [enviarEmail, setEnviarEmail] = useState(true);
  /** ZapSign envia o link por WhatsApp automaticamente (consome créditos da conta ZapSign). */
  const [enviarWhatsapp, setEnviarWhatsapp] = useState(false);
  const signerCheck = checkStudentZapSignSigner(student);
  /** 'auto' = modelo escolhido pelas regras de multa/estorno; senão, modelo forçado pelo usuário. */
  const [variantChoice, setVariantChoice] = useState<'auto' | CancellationTermoVariant>('auto');

  const autoVariant = useMemo(
    () => resolveCancellationTermoVariant({ semMultaCDC7, multaPercent, estornoTotal }),
    [semMultaCDC7, multaPercent, estornoTotal],
  );
  const variantOverride = variantChoice === 'auto' ? undefined : variantChoice;

  const doc = useMemo(
    () =>
      buildCancellationTermoDocument({
        ...buildCancellationTermoInputFromCase({
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
          pixOtherHolder,
          pixHolderName,
          pixHolderPhone,
        }),
        variantOverride,
      }),
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
      pixOtherHolder,
      pixHolderName,
      pixHolderPhone,
      variantOverride,
    ],
  );

  const plainText = useMemo(() => cancellationTermoToPlainText(doc), [doc]);
  const isManualVariant = variantOverride !== undefined && variantOverride !== autoVariant;
  const contentHint = `${cancellationTermoVariantLabel(doc.variant).toLowerCase()}${
    variantOverride === undefined ? ' · seleção automática' : isManualVariant ? ' · escolhido manualmente' : ''
  }`;

  const handleGeneratePDF = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildCancellationTermoPrintHtml(doc, logoIAM));
    win.document.close();
    setTimeout(() => win.print(), 250);
  };

  /** Gera o termo na ZapSign (direto pela API); só depois libera copiar/enviar o link. */
  const handleGenerateZapSign = async () => {
    if (!student) {
      toast.error('Ficha do aluno não encontrada — não é possível gerar o termo para assinatura.');
      return;
    }
    if (!signerCheck.ok) {
      toast.error(signerCheck.motivo ?? 'Aluno sem contato para assinatura.');
      return;
    }
    if (signLink) {
      toast.message('Termo já gerado. Use Copiar Link ou WhatsApp para enviar ao aluno.');
      return;
    }

    setLinkBusy(true);
    try {
      const motivo = caseRef.motivoCancelamento || caseRef.descricaoCancelamento || caseRef.notes || '';
      const result = await createZapSignTermo({
        tipo: 'cancelamento',
        nomeDocumento: `${doc.titulo} — ${doc.studentName}`,
        markdown: buildCancelamentoTermoMarkdown(doc, { motivo, legalNotes: legalNotes ?? caseRef.legalNotes }),
        student,
        cancellationCaseId: caseRef.id,
        enviarEmail: enviarEmail && !!signerCheck.email,
        enviarWhatsapp: enviarWhatsapp && !!signerCheck.whatsapp,
      });
      if (!result.ok) throw new Error(result.error || 'Falha ao gerar termo na ZapSign.');
      const url = result.url_assinatura || result.file_url;
      if (!url) throw new Error('Link de assinatura não disponível.');
      setSignLink(url);
      toast.success(
        describeEnvioAutomatico({
          email: enviarEmail && signerCheck.email ? signerCheck.email : undefined,
          whatsapp: enviarWhatsapp && signerCheck.whatsapp ? signerCheck.whatsapp : undefined,
        }),
      );
      onGenerated?.({
        signUrl: url,
        plainText,
        id: result.id,
        status: result.status,
        titulo: doc.titulo,
        variant: doc.variant,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar termo na ZapSign.');
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between gap-3 p-6 border-b border-border sticky top-0 bg-card z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground truncate">{doc.titulo}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Base institucional · {contentHint}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="inline-flex items-center rounded-lg border border-border bg-muted/40 overflow-hidden text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-foreground border-r border-border bg-muted/60">
                <FileText size={13} />
                Modelo
              </span>
              <select
                value={variantChoice}
                onChange={(e) => {
                  setVariantChoice(e.target.value as 'auto' | CancellationTermoVariant);
                  setSignLink(null);
                }}
                className="bg-transparent px-2.5 py-1.5 text-xs text-foreground focus:outline-none cursor-pointer max-w-[15rem]"
                aria-label="Modelo do termo"
              >
                <option value="auto">Automático — {cancellationTermoVariantLabel(autoVariant)}</option>
                {CANCELLATION_TERMO_VARIANTS.map((v) => (
                  <option key={v} value={v}>
                    {cancellationTermoVariantLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
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

          {isManualVariant ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs text-amber-800">
                Modelo escolhido manualmente. Pelas regras de multa/% e saldo a devolver, o automático seria{' '}
                <strong>{cancellationTermoVariantLabel(autoVariant)}</strong>. O PDF e o termo no ZapSign usam o
                modelo selecionado acima.
              </p>
            </div>
          ) : (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-xs text-blue-800">
                O modelo é escolhido automaticamente conforme a multa/% e o saldo a devolver: só estorno, só multa,
                multa + estorno ou sem multa. Se precisar, troque o modelo no seletor ao lado do título antes de gerar
                o PDF ou o termo no ZapSign.
              </p>
            </div>
          )}

          {!signerCheck.ok && (
            <p className="text-[11px] text-amber-700">{signerCheck.motivo}</p>
          )}

          {!signLink && (
            <ZapSignEnvioAutomatico
              signer={signerCheck}
              enviarEmail={enviarEmail}
              enviarWhatsapp={enviarWhatsapp}
              onChangeEmail={setEnviarEmail}
              onChangeWhatsapp={setEnviarWhatsapp}
              disabled={linkBusy}
            />
          )}

          {signLink && (
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700 break-all">
              Termo gerado na ZapSign. Se não escolheu envio automático, envie o link ao aluno (Copiar Link ou
              WhatsApp). Quando ele assinar, o Confirmar é liberado automaticamente e o PDF assinado fica anexado ao
              caso.
              <div className="mt-1 text-emerald-800/80 font-mono text-[10px]">{signLink}</div>
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
            onClick={() => void handleGenerateZapSign()}
            disabled={linkBusy || !signerCheck.ok || !!signLink}
            title={signerCheck.ok ? 'Gerar o termo na ZapSign e obter o link de assinatura' : signerCheck.motivo}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {linkBusy ? (
              <>
                <Link2 size={16} /> Gerando termo…
              </>
            ) : signLink ? (
              <>
                <Check size={16} /> Termo gerado
              </>
            ) : (
              <>
                <FileText size={16} /> Gerar Termo (ZapSign)
              </>
            )}
          </button>
          <ZapSignLinkActions
            signLink={signLink}
            nomeAluno={doc.studentName}
            whatsapp={student?.whatsapp ?? caseRef.studentWhatsapp}
            titulo={doc.titulo}
            disabled={linkBusy}
          />
        </div>
      </div>
    </div>
  );
}
