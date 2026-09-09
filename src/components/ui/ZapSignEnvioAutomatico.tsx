import { Mail, MessageCircle } from 'lucide-react';
import type { ZapSignSignerCheck } from '@/lib/zapsignTermo';

interface Props {
  signer: ZapSignSignerCheck;
  enviarEmail: boolean;
  enviarWhatsapp: boolean;
  onChangeEmail: (v: boolean) => void;
  onChangeWhatsapp: (v: boolean) => void;
  disabled?: boolean;
}

function formatWhatsapp(digits: string): string {
  const d = digits.replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

/**
 * Escolha de envio automático do link de assinatura pela própria ZapSign
 * (e-mail grátis; WhatsApp consome créditos da conta ZapSign). Mostrado antes de gerar o termo.
 */
export default function ZapSignEnvioAutomatico({
  signer,
  enviarEmail,
  enviarWhatsapp,
  onChangeEmail,
  onChangeWhatsapp,
  disabled,
}: Props) {
  if (!signer.ok) return null;
  const temEmail = !!signer.email;
  const temWhats = !!signer.whatsapp;
  const emailOn = enviarEmail && temEmail;
  const whatsOn = enviarWhatsapp && temWhats;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-foreground">Envio automático pela ZapSign ao gerar o termo</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !temEmail}
          onClick={() => onChangeEmail(!emailOn)}
          aria-pressed={emailOn}
          title={temEmail ? `Enviar por e-mail para ${signer.email}` : 'Aluno sem e-mail cadastrado'}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50 ${
            emailOn
              ? 'bg-sky-600 border-sky-600 text-white hover:bg-sky-700'
              : 'bg-white border-border text-foreground hover:bg-muted'
          }`}
        >
          <Mail size={13} />
          E-mail {emailOn ? 'ativado' : 'desativado'}
        </button>
        <button
          type="button"
          disabled={disabled || !temWhats}
          onClick={() => onChangeWhatsapp(!whatsOn)}
          aria-pressed={whatsOn}
          title={
            temWhats
              ? `Enviar por WhatsApp para ${formatWhatsapp(signer.whatsapp!)} (consome créditos ZapSign)`
              : 'Aluno sem WhatsApp cadastrado'
          }
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50 ${
            whatsOn
              ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-white border-border text-foreground hover:bg-muted'
          }`}
        >
          <MessageCircle size={13} />
          WhatsApp {whatsOn ? 'ativado' : 'desativado'}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">
        {temEmail ? (
          <>
            E-mail: <strong>{signer.email}</strong> (grátis).{' '}
          </>
        ) : (
          'Aluno sem e-mail. '
        )}
        {temWhats ? (
          <>
            WhatsApp: <strong>{formatWhatsapp(signer.whatsapp!)}</strong> — enviado pela ZapSign, consome créditos da
            conta.{' '}
          </>
        ) : (
          'Aluno sem WhatsApp. '
        )}
        Independente disso, depois de gerar você pode copiar o link ou mandar pelo seu WhatsApp (sem custo).
      </p>
    </div>
  );
}
