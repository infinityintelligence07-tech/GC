import { useState } from 'react';
import { Check, Copy, MessageCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { buildTermoWhatsAppMessage, buildWhatsAppShareUrl, whatsappDigitsBR } from '@/lib/zapsignTermo';

interface Props {
  /** Link de assinatura devolvido pela ZapSign. Sem link, os botões ficam desabilitados. */
  signLink: string | null | undefined;
  nomeAluno: string;
  whatsapp?: string | null;
  /** Ex.: "Termo de Cancelamento" — entra na mensagem do WhatsApp. */
  titulo: string;
  disabled?: boolean;
  /** Mostra também o botão de abrir o link (útil para conferir o documento). */
  showOpen?: boolean;
}

/**
 * Ações para enviar o link de assinatura ao aluno: copiar, mandar pelo WhatsApp (wa.me com
 * mensagem pronta) e abrir. Usado nos modais de termo (cancelamento e renegociação).
 */
export default function ZapSignLinkActions({ signLink, nomeAluno, whatsapp, titulo, disabled, showOpen }: Props) {
  const [copied, setCopied] = useState(false);
  const off = disabled || !signLink;
  const waDigits = whatsappDigitsBR(whatsapp);

  const copiar = async () => {
    if (!signLink) {
      toast.error('Gere o termo na ZapSign antes de copiar o link.');
      return;
    }
    try {
      await navigator.clipboard.writeText(signLink);
      setCopied(true);
      toast.success('Link de assinatura copiado. Envie para o aluno assinar.');
    } catch {
      toast.error('Não foi possível copiar o link.');
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
            <Check size={16} /> Link copiado
          </>
        ) : (
          <>
            <Copy size={16} /> Copiar Link
          </>
        )}
      </button>
      <button
        type="button"
        onClick={enviarWhatsApp}
        disabled={off || !waDigits}
        title={waDigits ? `Abrir WhatsApp de ${nomeAluno} com o link de assinatura` : 'Aluno sem WhatsApp cadastrado'}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50"
      >
        <MessageCircle size={16} /> WhatsApp
      </button>
      {showOpen && (
        <button
          type="button"
          onClick={() => signLink && window.open(signLink, '_blank', 'noopener,noreferrer')}
          disabled={off}
          title="Abrir o link de assinatura"
          className="px-3 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <ExternalLink size={16} />
        </button>
      )}
    </>
  );
}
