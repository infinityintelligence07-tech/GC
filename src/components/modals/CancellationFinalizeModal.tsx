import { useMemo, useState } from 'react';
import { CancellationCase, Student } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { getStudentTotalPaid, resolveStudentFinance } from '@/lib/studentFinance';
import {
  buildCancellationTermoDocument,
  buildCancellationTermoInputFromCase,
  buildCancellationTermoPrintHtml,
  cancellationTermoToPlainText,
} from '@/lib/cancellationTermoDocument';
import {
  buildCancelamentoTermoMarkdown,
  checkStudentZapSignSigner,
  createZapSignTermo,
  describeEnvioAutomatico,
} from '@/lib/zapsignTermo';
import ZapSignLinkActions from '@/components/ui/ZapSignLinkActions';
import ZapSignEnvioAutomatico from '@/components/ui/ZapSignEnvioAutomatico';
import TermoDadosAlunoForm from '@/components/ui/TermoDadosAlunoForm';
import { useTermoDadosAluno } from '@/hooks/useTermoDadosAluno';
import { toast } from 'sonner';
import { X, FileText, Download, Check, Link2, UserRoundPen } from 'lucide-react';
import logoIAM from '@/assets/logo-iam-blue.png';

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
 *  - cancelar: Termo de Cancelamento institucional (com/sem multa)
 */
export default function CancellationFinalizeModal({
  caseRef,
  type,
  student,
  onClose,
  onConfirm,
  allowChooseOutcome = false,
}: Props) {
  const { updateCancellationCase } = useAppStore();
  const [linkBusy, setLinkBusy] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<'reverter' | 'cancelar'>(type);
  const [enviarEmail, setEnviarEmail] = useState(true);
  const [enviarWhatsapp, setEnviarWhatsapp] = useState(false);
  // Dados do aluno para o termo — abre preenchimento manual se CPF/e-mail/WhatsApp/nome não forem reconhecidos.
  const dadosAluno = useTermoDadosAluno({
    student,
    fallback: { name: caseRef.studentName, whatsapp: caseRef.studentWhatsapp },
  });
  const { studentEfetivo, dados: dadosTermo } = dadosAluno;
  const studentTermo = useMemo<Pick<Student, 'name' | 'cpf' | 'email' | 'whatsapp' | 'product'> | null>(
    () =>
      studentEfetivo ??
      (dadosTermo.name
        ? {
            name: dadosTermo.name ?? '',
            cpf: dadosTermo.cpf ?? '',
            email: dadosTermo.email,
            whatsapp: dadosTermo.whatsapp ?? '',
            product: caseRef.treinamento,
          }
        : null),
    [studentEfetivo, dadosTermo, caseRef.treinamento],
  );
  const signerCheck = checkStudentZapSignSigner(studentTermo);

  const isReverter = selectedOutcome === 'reverter';
  const titulo = isReverter ? 'Aditivo de Contrato' : 'Termo de Cancelamento';
  const iconColorClass = isReverter ? 'text-emerald-600' : 'text-rose-600';

  const semMultaCDC7 = caseRef.dentro7Dias === true && (caseRef.multaPercent ?? -1) === 0;
  const finance = student ? resolveStudentFinance(student, { kaminoPaid: caseRef.totalPagoAteMomento }) : null;
  const totalPaid =
    finance?.totalPaid ??
    (student
      ? getStudentTotalPaid(student, { kaminoPaid: caseRef.totalPagoAteMomento })
      : Number(caseRef.totalPagoAteMomento) || 0);
  const fineValue = caseRef.cancellationFineValue ?? caseRef.multaValue ?? 0;
  const balance = Math.round((fineValue - totalPaid) * 100) / 100;
  const estornoTotal = balance < 0 ? Math.abs(balance) : 0;
  const multaPercent = caseRef.multaPercent ?? 0;
  const totalContract = student?.saleValue ?? caseRef.value ?? 0;

  const cancelDoc = useMemo(() => {
    if (isReverter) return null;
    return buildCancellationTermoDocument(
      buildCancellationTermoInputFromCase({
        caseRef,
        student: studentTermo,
        semMultaCDC7,
        multaPercent,
        multaValue: fineValue,
        totalPago: totalPaid,
        estornoTotal,
      }),
    );
  }, [isReverter, caseRef, studentTermo, semMultaCDC7, multaPercent, fineValue, totalPaid, estornoTotal]);

  const reverterText = useMemo(() => {
    const today = new Date();
    return [
      'ADITIVO DE CONTRATO',
      '',
      `ALUNO: ${caseRef.studentName}`,
      student?.cpf ? `CPF: ${student.cpf}` : '',
      student?.whatsapp ? `WhatsApp: ${student.whatsapp}` : '',
      student?.product ? `Treinamento: ${student.product}` : '',
      '',
      'Pelo presente ADITIVO, as partes acordam a REVERSÃO da solicitação de cancelamento, mantendo todas as cláusulas e condições do contrato original em pleno vigor.',
      '',
      `Motivo informado: ${caseRef.motivoCancelamento ?? '—'}`,
      caseRef.descricaoCancelamento ? `Descrição: ${caseRef.descricaoCancelamento}` : '',
      '',
      `Data: ${today.toLocaleDateString('pt-BR')}`,
      '',
      '_______________________________',
      'Assinatura do aluno',
    ]
      .filter(Boolean)
      .join('\n');
  }, [caseRef, student]);

  const documento = isReverter ? reverterText : cancelDoc ? cancellationTermoToPlainText(cancelDoc) : '';

  const handleDownloadPdf = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    if (!isReverter && cancelDoc) {
      win.document.write(buildCancellationTermoPrintHtml(cancelDoc, logoIAM));
    } else {
      win.document.write(`
        <html>
          <head>
            <title>${titulo} — ${caseRef.studentName}</title>
            <style>
              body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.6; color: #222; }
              pre { white-space: pre-wrap; font-family: Georgia, serif; font-size: 13px; }
            </style>
          </head>
          <body>
            <pre>${documento.replace(/</g, '&lt;')}</pre>
            <script>window.onload = () => window.print();</script>
          </body>
        </html>
      `);
    }
    win.document.close();
    if (!isReverter && cancelDoc) setTimeout(() => win.print(), 250);
  };

  const handleGenerateZapSign = async () => {
    if (isReverter) {
      toast.error('Aditivo de contrato ainda não está integrado à ZapSign. Use Gerar PDF.');
      return;
    }
    if (!studentTermo || !cancelDoc) {
      toast.error('Dados do aluno não encontrados — preencha os dados para gerar o termo.');
      dadosAluno.setFormOpen(true);
      return;
    }
    if (!signerCheck.ok) {
      toast.error(signerCheck.motivo ?? 'Aluno sem contato para assinatura.');
      dadosAluno.setFormOpen(true);
      return;
    }
    if (signLink) {
      toast.message('Termo já gerado. Use Copiar Link ou WhatsApp para enviar ao aluno.');
      return;
    }

    setLinkBusy(true);
    try {
      const result = await createZapSignTermo({
        tipo: 'cancelamento',
        nomeDocumento: `${cancelDoc.titulo} — ${cancelDoc.studentName}`,
        markdown: buildCancelamentoTermoMarkdown(cancelDoc),
        student: { id: student?.id, ...studentTermo },
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
      await updateCancellationCase(caseRef.id, {
        termTemplate: documento,
        termAttachments: [
          ...(caseRef.termAttachments ?? []),
          {
            name: `ZapSign — ${result.nome_documento || titulo}`,
            url,
            uploadedAt: new Date().toISOString(),
            type: 'outro',
          },
        ],
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar termo na ZapSign.');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleConfirm = () => {
    updateCancellationCase(caseRef.id, { termTemplate: documento });
    onConfirm(selectedOutcome);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className={iconColorClass} />
            <h2 className="text-sm font-bold text-foreground">
              {isReverter ? titulo : cancelDoc?.titulo ?? titulo}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isReverter && (
              <button
                type="button"
                onClick={() => dadosAluno.setFormOpen(true)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors ${
                  dadosAluno.faltantes.length > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-white border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title="Preencher/corrigir nome, CPF, e-mail e WhatsApp do aluno"
              >
                <UserRoundPen size={11} />
                {dadosAluno.faltantes.length > 0
                  ? `Completar dados (${dadosAluno.faltantes.length})`
                  : 'Editar dados'}
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {!isReverter && dadosAluno.formOpen && (
          <TermoDadosAlunoForm
            initial={dadosAluno.dados}
            faltantes={dadosAluno.faltantes}
            salvaNaFicha={!!student}
            onSave={dadosAluno.salvar}
            onClose={() => dadosAluno.setFormOpen(false)}
          />
        )}

        <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4 max-h-[320px] overflow-y-auto">
          <pre className="text-[11px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">{documento}</pre>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-all"
          >
            <Download size={12} /> Gerar PDF
          </button>
          <button
            onClick={() => void handleGenerateZapSign()}
            disabled={linkBusy || isReverter || !signerCheck.ok || !!signLink}
            title={signerCheck.ok ? 'Gerar o termo na ZapSign e obter o link de assinatura' : signerCheck.motivo}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-50"
          >
            {linkBusy ? (
              <>
                <Link2 size={12} /> Gerando…
              </>
            ) : signLink ? (
              <>
                <Check size={12} /> Termo gerado
              </>
            ) : (
              <>
                <FileText size={12} /> Gerar Termo (ZapSign)
              </>
            )}
          </button>
          <ZapSignLinkActions
            signLink={signLink}
            nomeAluno={caseRef.studentName}
            whatsapp={studentTermo?.whatsapp || caseRef.studentWhatsapp}
            titulo={cancelDoc?.titulo ?? titulo}
            disabled={linkBusy}
          />
        </div>

        {!isReverter && !signLink && (
          <div className="mb-4">
            <ZapSignEnvioAutomatico
              signer={signerCheck}
              enviarEmail={enviarEmail}
              enviarWhatsapp={enviarWhatsapp}
              onChangeEmail={setEnviarEmail}
              onChangeWhatsapp={setEnviarWhatsapp}
              disabled={linkBusy}
            />
          </div>
        )}
        {signLink && (
          <div className="mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700 break-all">
            Termo gerado na ZapSign. Se não escolheu envio automático, envie o link ao aluno (Copiar Link ou
            WhatsApp). Ao assinar, o PDF assinado é anexado ao caso automaticamente.
          </div>
        )}
        {!isReverter && !signerCheck.ok && (
          <p className="mb-4 text-[11px] text-amber-700">{signerCheck.motivo}</p>
        )}

        {allowChooseOutcome ? (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <label className="block text-[11px] font-semibold text-blue-900 mb-2">Escolha o resultado da finalização:</label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedOutcome('reverter');
                  updateCancellationCase(caseRef.id, { termTemplate: documento });
                  onConfirm('reverter');
                }}
                className="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold transition-all bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-600 hover:text-white"
              >
                Revertido
              </button>
              <button
                onClick={() => {
                  setSelectedOutcome('cancelar');
                  updateCancellationCase(caseRef.id, { termTemplate: documento });
                  onConfirm('cancelar');
                }}
                className="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold transition-all bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-600 hover:text-white"
              >
                Cancelado
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConfirm}
            className={`w-full py-2.5 rounded-xl text-sm font-medium text-white shadow-md hover:shadow-lg transition-all ${
              isReverter ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            Confirmar {isReverter ? 'Reversão' : 'Cancelamento'}
          </button>
        )}
      </div>
    </div>
  );
}
