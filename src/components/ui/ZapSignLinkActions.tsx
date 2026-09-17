import { useState } from 'react';
import { Check, Copy, MessageCircle, ExternalLink, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { buildTermoWhatsAppMessage, buildWhatsAppShareUrl, whatsappDigitsBR } from '@/lib/zapsignTermo';

interface Props {
  /** Link de assinatura do aluno. Sem link, os botões do aluno ficam desabilitados. */
  signLink: string | null | undefined;
  /** Link de assinatura do Instituto (IAM). Opcional — termos antigos podem não ter. */
  signLinkIam?: string | null;
  nomeAluno: string;
  whatsapp?: string | null;
  /** Ex.: "Termo de Cancelamento" — entra na mensagem do WhatsApp. */
  titulo: string;
  disabled?: boolean;
  /** Mostra também o botão de abrir o link (útil para conferir o documento). */
  showOpen?: boolean;
  /** Botão WhatsApp (wa.me). Padrão true; o modal de renegociação oculta. */
  showWhatsApp?: boolean;
}

/**
 * Ações para enviar o link de assinatura ao aluno e copiar o link da IAM.
 * Usado nos modais de termo (cancelamento e renegociação).
 */
export default function ZapSignLinkActions({
  signLink,
  signLinkIam,
  nomeAluno,
  whatsapp,
  titulo,
  disabled,
  showOpen,
  showWhatsApp = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copiedIam, setCopiedIam] = useState(false);
  const off = disabled || !signLink;
  const offIam = disabled || !signLinkIam;
  const waDigits = whatsappDigitsBR(whatsapp);

  const copiar = async () => {
    if (!signLink) {
      toast.error('Gere o termo na ZapSign antes de copiar o link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(signLink);
      setCopied(true);
      toast.success('Link do aluno copiado. Envie para ele assinar.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  };

  const copiarIam = async () => {
    if (!signLinkIam) {
      toast.error('Link da IAM não disponível neste termo.');
      return;
    }
    try {
      await navigator.clipboard.writeText(signLinkIam);
      setCopiedIam(true);
      toast.success('Link da IAM copiado. Use para a assinatura do Instituto.');
    } catch {
      toast.error('Não foi possível copiar o link da IAM.');
    }
  };

  const enviarWhatsApp = () => {
    if (!signLink) {
      toast.error('Gere o termo na ZapSign antes de enviar.');
      return;
    }
    const msg = buildTermoWhatsAppMessage({ nomeAluno, titulo, link: signLink });
    const url = buildWhatsAppShareUrl(whatsapp, msg);
    if (!url) {
      toast.error('Aluno sem WhatsApp cadastrado. Use Copiar Link.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copiar()}
        disabled={off}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-colors flex items-center gap-2 disabled:opacity-50"
      >
        {copied ? (
          <>
            <Check size={16} /> Link aluno
          </>
        ) : (
          <>
            <Copy size={16} /> Copiar Link Aluno
          </>
        )}
      </button>
      <button
        type="button"
        onClick={() => void copiarIam()}
        disabled={offIam}
        title={signLinkIam ? 'Copiar link de assinatura do Instituto (IAM)' : 'Gere o termo novamente para obter o link da IAM'}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-50 border border-sky-200 text-sky-800 hover:bg-sky-100 transition-colors flex items-center gap-2 disabled:opacity-50"
      >
        {copiedIam ? (
          <>
            <Check size={16} /> Link IAM
          </>
        ) : (
          <>
            <Building2 size={16} /> Copiar Link IAM
          </>
        )}
      </button>
      {showWhatsApp && (
        <button
          type="button"
          onClick={enviarWhatsApp}
          disabled={off || !waDigits}
          title={waDigits ? `Abrir WhatsApp de ${nomeAluno} com o link de assinatura` : 'Aluno sem WhatsApp cadastrado'}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <MessageCircle size={16} /> WhatsApp
        </button>
      )}
      {showOpen && (
        <button
          type="button"
          onClick={() => signLink && window.open(signLink, '_blank', 'noopener,noreferrer')}
          disabled={off}
          title="Abrir o link de assinatura do aluno"
          className="px-3 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <ExternalLink size={16} />
        </button>
      )}
    </>
  );
}
