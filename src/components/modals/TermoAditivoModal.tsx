import { useMemo, useRef, useState } from 'react';
import { X, Download, Link2, Check, Paperclip, FileText } from 'lucide-react';
import { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import {
  buildRenegociacaoTermoMarkdown,
  checkStudentZapSignSigner,
  createZapSignTermo,
  describeEnvioAutomatico,
} from '@/lib/zapsignTermo';
import ZapSignLinkActions from '@/components/ui/ZapSignLinkActions';
import ZapSignEnvioAutomatico from '@/components/ui/ZapSignEnvioAutomatico';
import {
  RENEG_ANEXO_ACCEPT as ANEXO_ACCEPT,
  uploadRenegTermoAnexado,
  type TermoAnexadoInfo,
} from '@/lib/renegTermoAnexo';
import { toast } from 'sonner';
import logoIAM from '@/assets/logo-iam-blue.png';

export type { TermoAnexadoInfo };

export interface TermoRenegociacaoOriginalValues {
  valorVenda: number;
  entrada: number;
  parcelasOriginais: number;
}

export interface TermoRenegociacaoNewValues {
  /** Saldo em aberto do contrato (antes dos encargos da renegociação). */
  novoSaldo: number;
  multaAplicada: number;
  jurosAplicados: number;
  novaEntrada: number;
  novasParcelas: number;
  novoValorParcela: number;
  saldoAposEntrada?: number;
  /** Data da 1ª parcela no formato DD/MM/AAAA */
  primeiraParcelaVencimento?: string;
  /** Taxa de juros a.m. aplicada (ex.: 1). */
  taxaJurosMes?: number;
  /** Quantidade de parcelas em aberto renegociadas. */
  qtdParcelasAberto?: number;
  /** Total já pago pelo aluno até o momento. */
  totalPago?: number;
  /** Quantidade de inscrições no treinamento. */
  quantidadeInscricoes?: number;
  /** Dia do mês das parcelas subsequentes. */
  diaVencimento?: number;
  /** Data da entrada (DD/MM/AAAA), se houver. */
  dataEntrada?: string;
}

interface Props {
  student: Student;
  originalValues: TermoRenegociacaoOriginalValues;
  newValues: TermoRenegociacaoNewValues;
  onClose: () => void;
  /** Chamado quando o termo é gerado na ZapSign (link disponível). */
  onTermoGerado?: (info: {
    id?: string;
    urlAssinatura: string;
    status?: string;
    nomeDocumento?: string;
  }) => void;
  /** Chamado quando o usuário anexa um termo/contrato já assinado (fora da ZapSign). */
  onTermoAnexado?: (info: TermoAnexadoInfo) => void;
  /**
   * Link de assinatura de um termo já gerado na ZapSign (ao reabrir o modal).
   * Com ele, o modal já abre com Copiar Link / WhatsApp liberados.
   */
  signLinkInicial?: string | null;
}

function parseBrDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const br = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR');
}

function addMonthsKeepingDay(base: Date, months: number, day?: number): Date {
  const targetDay = day ?? base.getDate();
  const d = new Date(base.getFullYear(), base.getMonth() + months, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return d;
}

function buildParcelamentoLines(
  count: number,
  value: number,
  firstDueBr?: string,
  diaVencimento?: number,
): string[] {
  if (count <= 0) return [];
  const first = parseBrDate(firstDueBr) ?? new Date();
  const day = diaVencimento ?? first.getDate();
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const due = i === 0 ? first : addMonthsKeepingDay(first, i, day);
    lines.push(
      `Parcela ${String(i + 1).padStart(2, '0')}: ${formatCurrency(value)} — vencimento ${formatDateBR(due)}`,
    );
  }
  return lines;
}

const INSTITUTO =
  'INSTITUTO ACADEMY MIND TREINAMENTOS LTDA, pessoa jurídica de direito privado, devidamente inscrita no CNPJ nº 03.727.532/0001-13, com sede na R. Major Rehder, 248 - Vila Rehder, Americana - SP, 13465-390';

export default function TermoAditivoModal({
  student,
  originalValues,
  newValues,
  onClose,
  onTermoGerado,
  onTermoAnexado,
  signLinkInicial,
}: Props) {
  const [linkBusy, setLinkBusy] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(signLinkInicial ?? null);
  const [enviarEmail, setEnviarEmail] = useState(true);
  const [enviarWhatsapp, setEnviarWhatsapp] = useState(false);
  const [anexoBusy, setAnexoBusy] = useState(false);
  const anexoInputRef = useRef<HTMLInputElement>(null);
  const signerCheck = checkStudentZapSignSigner(student);

  const today = useMemo(() => new Date(), []);
  const dateStr = formatDateBR(today);

  const totalPago =
    newValues.totalPago ??
    (student.downPayment ?? 0) +
      (student.installments ?? []).filter((i) => i.paid).reduce((s, i) => s + (i.value || 0), 0);

  const totalAposReneg =
    newValues.saldoAposEntrada != null
      ? newValues.novaEntrada + newValues.saldoAposEntrada
      : newValues.novoSaldo + newValues.multaAplicada + newValues.jurosAplicados;

  const qtdInscricoes = newValues.quantidadeInscricoes ?? 1;
  const qtdParcelasAberto =
    newValues.qtdParcelasAberto ??
    (student.installments ?? []).filter((i) => !i.paid).length;
  const taxaJuros = newValues.taxaJurosMes ?? 0;
  const contratoAssinado = student.enrollmentDate
    ? formatDateBR(new Date(student.enrollmentDate + (student.enrollmentDate.includes('T') ? '' : 'T12:00:00')))
    : '—';
  const diaVencimento =
    newValues.diaVencimento ??
    parseBrDate(newValues.primeiraParcelaVencimento)?.getDate() ??
    student.dueDay ??
    today.getDate();

  const parcelamentoLines = useMemo(
    () =>
      buildParcelamentoLines(
        newValues.novasParcelas,
        newValues.novoValorParcela,
        newValues.primeiraParcelaVencimento,
        diaVencimento,
      ),
    [newValues.novasParcelas, newValues.novoValorParcela, newValues.primeiraParcelaVencimento, diaVencimento],
  );

  const entradaLinha =
    newValues.novaEntrada > 0.0049
      ? `Entrada: ${formatCurrency(newValues.novaEntrada)}${
          newValues.dataEntrada ? ` em ${newValues.dataEntrada}` : ` em ${dateStr}`
        }`
      : 'Entrada: R$ 0,00 (sem entrada)';

  const handleGeneratePDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const parcelamentoHtml = parcelamentoLines
      .map((l) => `<p class="line">${l}</p>`)
      .join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Termo de Renegociação — ${student.name}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Times New Roman', Times, serif;
            background: #fff;
            color: #111;
            padding: 40px 24px;
            line-height: 1.55;
            font-size: 13px;
          }
          .container { max-width: 780px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 28px; }
          .logo { max-width: 110px; margin: 0 auto 12px; }
          .logo img { max-width: 100%; height: auto; }
          .title {
            font-size: 18px; font-weight: bold; text-transform: uppercase;
            letter-spacing: 0.5px; margin-top: 8px;
          }
          p { margin-bottom: 10px; text-align: justify; }
          .line { margin-bottom: 4px; text-align: left; }
          .label { font-weight: bold; }
          .block { margin: 16px 0; }
          .section-title {
            font-weight: bold; text-transform: uppercase;
            margin: 18px 0 8px; text-align: left;
          }
          .field { margin-bottom: 4px; }
          .signature {
            margin-top: 40px; display: flex; justify-content: space-between; gap: 24px;
          }
          .sig-box { width: 46%; text-align: center; }
          .sig-line {
            border-top: 1px solid #111; margin: 48px 0 6px; min-height: 1px;
          }
          .sig-label { font-size: 12px; }
          .place { margin-top: 28px; text-align: left; }
          @media print {
            body { padding: 0; }
            .container { max-width: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo"><img src="${logoIAM}" alt="IAM"></div>
            <div class="title">Termo de Renegociação</div>
          </div>

          <p>Pelo presente instrumento, o(a) ALUNO(A):</p>
          <div class="block">
            <p class="field"><span class="label">NOME COMPLETO:</span> ${student.name || '—'}</p>
            <p class="field"><span class="label">CPF/CNPJ:</span> ${student.cpf || '—'}</p>
            <p class="field"><span class="label">WHATSAPP:</span> ${student.whatsapp || '—'}</p>
            <p class="field"><span class="label">EMAIL:</span> ${student.email || '—'}</p>
          </div>

          <p>E o ${INSTITUTO}, <strong>AJUSTAM SUA RELAÇÃO CONTRATUAL CONFORME A SEGUIR EXPOSTO.</strong></p>

          <p>
            O(A) ALUNO(A) possui <strong>${qtdInscricoes}</strong> inscrição(ões) no treinamento
            <strong>${student.product || '—'}</strong>, contrato assinado em <strong>${contratoAssinado}</strong>.
          </p>

          <p>
            O presente instrumento visa formalizar a renegociação realizada entre as partes referente ao montante
            pendente de pagamento pelo(a) ALUNO(a), de modo que as alterações de valores refletem a nova forma de
            pagamento, estando o(a) ALUNO(a) ciente e de acordo com as novas condições.
          </p>

          <p>
            Os demais termos aqui descritos seguem todo o disposto no contrato principal, em especial em relação a
            multa, correção monetária, juros e atualizações.
          </p>

          <p>As partes acordam a seguinte negociação:</p>
          <p class="section-title">Renegociação das parcelas ficando da seguinte forma:</p>

          <p class="field"><span class="label">TREINAMENTO:</span> ${student.product || '—'}</p>
          <p class="field"><span class="label">TOTAL CONTRATADO:</span> ${formatCurrency(originalValues.valorVenda)}</p>
          <p class="field"><span class="label">TOTAL PAGO PELO ALUNO(A) ATÉ O MOMENTO:</span> ${formatCurrency(totalPago)}</p>
          <p class="field"><span class="label">SALDO EM ABERTO DO CONTRATO:</span> ${formatCurrency(newValues.novoSaldo)}</p>
          <p class="field"><span class="label">QUANTIDADE DE PARCELAS EM ABERTO:</span> ${qtdParcelasAberto}</p>
          <p class="field"><span class="label">TOTAL A SER PAGO APÓS A RENEGOCIAÇÃO:</span> ${formatCurrency(totalAposReneg)}</p>

          <p class="section-title">Novo parcelamento acordado:</p>
          <p class="field">${entradaLinha}</p>
          <p>
            As demais parcelas serão conforme descrito abaixo e o primeiro vencimento será dia
            <strong>${newValues.primeiraParcelaVencimento || '—'}</strong> e as demais parcelas vencerão no dia
            <strong>${diaVencimento}</strong> dos meses subsequentes.
          </p>
          <div class="block">${parcelamentoHtml || '<p class="line">—</p>'}</div>
          <p class="field"><span class="label">Taxa de juros aplicada ao mês:</span> ${taxaJuros.toLocaleString('pt-BR')}%</p>

          <p>
            Permanecem vigentes as demais cláusulas contratuais do instrumento anteriormente celebrado pelas partes
            naquilo que não estiver disposto no presente termo de renegociação.
          </p>
          <p>
            O INSTITUTO, somente após o recebimento da importância total dará ao ALUNO(A) a mais ampla, rasa, geral e
            irrevogável quitação de suas obrigações em relação ao treinamento contratado.
          </p>

          <p class="place">Americana, ${dateStr}.</p>

          <div class="signature">
            <div class="sig-box">
              <div class="sig-line"></div>
              <div class="sig-label">${student.name || 'ALUNO(A)'}<br>${student.cpf || ''}</div>
            </div>
            <div class="sig-box">
              <div class="sig-line"></div>
              <div class="sig-label">INSTITUTO ACADEMY MIND TREINAMENTOS LTDA.<br>CNPJ 03.727.532/0001-13</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  /** Gera o termo na ZapSign (direto pela API); só depois libera copiar/enviar o link. */
  const handleGenerateZapSign = async () => {
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
      const markdown = buildRenegociacaoTermoMarkdown({
        student,
        dateStr,
        contratoAssinado,
        qtdInscricoes,
        totalContratado: originalValues.valorVenda,
        totalPago,
        saldoAberto: newValues.novoSaldo,
        qtdParcelasAberto,
        totalAposReneg,
        entradaLinha,
        primeiraParcelaVencimento: newValues.primeiraParcelaVencimento,
        diaVencimento,
        parcelamentoLines,
        taxaJurosMes: taxaJuros,
      });
      const result = await createZapSignTermo({
        tipo: 'renegociacao',
        nomeDocumento: `Termo de Renegociação — ${student.name}`,
        markdown,
        student,
        enviarEmail: enviarEmail && !!signerCheck.email,
        enviarWhatsapp: enviarWhatsapp && !!signerCheck.whatsapp,
      });
      if (!result.ok) throw new Error(result.error || 'Falha ao gerar termo na ZapSign.');

      const signUrl = result.url_assinatura || result.file_url;
      if (!signUrl) throw new Error('Link de assinatura não disponível.');

      setSignLink(signUrl);
      toast.success(
        describeEnvioAutomatico({
          email: enviarEmail && signerCheck.email ? signerCheck.email : undefined,
          whatsapp: enviarWhatsapp && signerCheck.whatsapp ? signerCheck.whatsapp : undefined,
        }),
      );
      onTermoGerado?.({
        id: result.id,
        urlAssinatura: signUrl,
        status: result.status,
        nomeDocumento: result.nome_documento,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar termo na ZapSign.');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleAnexarAssinado = async (file: File | undefined) => {
    if (!file) return;
    setAnexoBusy(true);
    try {
      const info = await uploadRenegTermoAnexado(student.id, file);
      toast.success('Termo assinado anexado. Confirmar liberado.');
      onTermoAnexado?.(info);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Falha ao anexar o termo.');
    } finally {
      setAnexoBusy(false);
      if (anexoInputRef.current) anexoInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-lg font-semibold text-foreground">Termo de Renegociação</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="border border-border rounded-xl p-6 bg-muted/20 space-y-3 max-h-[28rem] overflow-y-auto text-[11px] leading-relaxed text-foreground/90">
            <div className="flex justify-center mb-2">
              <img src={logoIAM} alt="IAM" className="w-14 h-auto" />
            </div>
            <h3 className="text-center text-sm font-bold uppercase tracking-wide">Termo de Renegociação</h3>

            <p>Pelo presente instrumento, o(a) ALUNO(A):</p>
            <div className="space-y-0.5 pl-1">
              <p>
                <span className="font-semibold">NOME COMPLETO:</span> {student.name || '—'}
              </p>
              <p>
                <span className="font-semibold">CPF/CNPJ:</span> {student.cpf || '—'}
              </p>
              <p>
                <span className="font-semibold">WHATSAPP:</span> {student.whatsapp || '—'}
              </p>
              <p>
                <span className="font-semibold">EMAIL:</span> {student.email || '—'}
              </p>
            </div>

            <p>
              E o {INSTITUTO}, <strong>AJUSTAM SUA RELAÇÃO CONTRATUAL CONFORME A SEGUIR EXPOSTO.</strong>
            </p>

            <p>
              O(A) ALUNO(A) possui <strong>{qtdInscricoes}</strong> inscrição(ões) no treinamento{' '}
              <strong>{student.product || '—'}</strong>, contrato assinado em <strong>{contratoAssinado}</strong>.
            </p>

            <p>
              O presente instrumento visa formalizar a renegociação realizada entre as partes referente ao montante
              pendente de pagamento pelo(a) ALUNO(a), de modo que as alterações de valores refletem a nova forma de
              pagamento, estando o(a) ALUNO(a) ciente e de acordo com as novas condições.
            </p>

            <p>
              Os demais termos aqui descritos seguem todo o disposto no contrato principal, em especial em relação a
              multa, correção monetária, juros e atualizações.
            </p>

            <p>As partes acordam a seguinte negociação:</p>
            <p className="font-bold uppercase text-[10px] pt-1">Renegociação das parcelas ficando da seguinte forma:</p>

            <div className="space-y-0.5">
              <p>
                <span className="font-semibold">TREINAMENTO:</span> {student.product || '—'}
              </p>
              <p>
                <span className="font-semibold">TOTAL CONTRATADO:</span> {formatCurrency(originalValues.valorVenda)}
              </p>
              <p>
                <span className="font-semibold">TOTAL PAGO PELO ALUNO(A) ATÉ O MOMENTO:</span> {formatCurrency(totalPago)}
              </p>
              <p>
                <span className="font-semibold">SALDO EM ABERTO DO CONTRATO:</span>{' '}
                {formatCurrency(newValues.novoSaldo)}
              </p>
              <p>
                <span className="font-semibold">QUANTIDADE DE PARCELAS EM ABERTO:</span> {qtdParcelasAberto}
              </p>
              <p>
                <span className="font-semibold">TOTAL A SER PAGO APÓS A RENEGOCIAÇÃO:</span>{' '}
                {formatCurrency(totalAposReneg)}
              </p>
            </div>

            <p className="font-bold uppercase text-[10px] pt-1">Novo parcelamento acordado:</p>
            <p>{entradaLinha}</p>
            <p>
              As demais parcelas serão conforme descrito abaixo e o primeiro vencimento será dia{' '}
              <strong>{newValues.primeiraParcelaVencimento || '—'}</strong> e as demais parcelas vencerão no dia{' '}
              <strong>{diaVencimento}</strong> dos meses subsequentes.
            </p>
            <div className="space-y-0.5 pl-1">
              {parcelamentoLines.length > 0 ? (
                parcelamentoLines.map((l) => <p key={l}>{l}</p>)
              ) : (
                <p>—</p>
              )}
            </div>
            <p>
              <span className="font-semibold">Taxa de juros aplicada ao mês:</span>{' '}
              {taxaJuros.toLocaleString('pt-BR')}%
            </p>

            <p>
              Permanecem vigentes as demais cláusulas contratuais do instrumento anteriormente celebrado pelas partes
              naquilo que não estiver disposto no presente termo de renegociação.
            </p>
            <p>
              O INSTITUTO, somente após o recebimento da importância total dará ao ALUNO(A) a mais ampla, rasa, geral e
              irrevogável quitação de suas obrigações em relação ao treinamento contratado.
            </p>

            <p className="pt-2">Americana, {dateStr}.</p>
            <div className="grid grid-cols-2 gap-4 pt-6 text-center text-[10px]">
              <div>
                <div className="border-t border-foreground/40 mt-8 mb-1" />
                <p className="font-medium">{student.name}</p>
                <p>{student.cpf || ''}</p>
              </div>
              <div>
                <div className="border-t border-foreground/40 mt-8 mb-1" />
                <p className="font-medium">INSTITUTO ACADEMY MIND TREINAMENTOS LTDA.</p>
                <p>CNPJ 03.727.532/0001-13</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-xs text-blue-800">
              Este termo documenta formalmente a renegociação, no mesmo padrão do documento institucional. Gere o PDF
              para impressão, gere o termo no ZapSign para obter o link de assinatura ou anexe o termo já assinado.
            </p>
          </div>

          {!signerCheck.ok && (
            <p className="text-[11px] text-amber-700">
              {signerCheck.motivo} Sem contato, use <strong>Anexar assinado</strong> para enviar o termo/contrato já
              assinado.
            </p>
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
              WhatsApp). Quando ele assinar, o Confirmar da renegociação é liberado automaticamente.
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
          {/* Depois de gerar o termo na ZapSign, o documento oficial é o dela:
              Gerar PDF e Gerar Termo saem e ficam só as ações de envio do link. */}
          {!signLink && (
            <button
              onClick={handleGeneratePDF}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <Download size={16} />
              Gerar PDF
            </button>
          )}
          <input
            ref={anexoInputRef}
            type="file"
            accept={ANEXO_ACCEPT}
            className="hidden"
            onChange={(e) => void handleAnexarAssinado(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => anexoInputRef.current?.click()}
            disabled={anexoBusy}
            title="Anexar termo/contrato já assinado (PDF ou imagem, até 10 MB). Libera o Confirmar."
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Paperclip size={16} />
            {anexoBusy ? 'Enviando…' : 'Anexar assinado'}
          </button>
          {signLink ? (
            <span className="px-3 py-2 rounded-lg text-sm font-medium bg-violet-50 border border-violet-200 text-violet-700 flex items-center gap-2">
              <Check size={16} /> Termo gerado
            </span>
          ) : (
            <button
              onClick={() => void handleGenerateZapSign()}
              disabled={linkBusy || !signerCheck.ok}
              title={signerCheck.ok ? 'Gerar o termo na ZapSign e obter o link de assinatura' : signerCheck.motivo}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {linkBusy ? (
                <>
                  <Link2 size={16} /> Gerando termo…
                </>
              ) : (
                <>
                  <FileText size={16} /> Gerar Termo (ZapSign)
                </>
              )}
            </button>
          )}
          <ZapSignLinkActions
            signLink={signLink}
            nomeAluno={student.name}
            whatsapp={student.whatsapp}
            titulo="Termo de Renegociação"
            disabled={linkBusy}
          />
        </div>
      </div>
    </div>
  );
}
