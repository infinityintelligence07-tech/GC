import { useState } from 'react';
import { UserRoundPen, X } from 'lucide-react';
import {
  TERMO_DADOS_LABELS,
  formatCpfCnpj,
  formatWhatsappBR,
  termoDadosFaltantes,
  type TermoDadosAluno,
} from '@/lib/termoDadosAluno';

interface Props {
  initial: Partial<TermoDadosAluno>;
  /** Campos detectados como faltantes — destacados no formulário. */
  faltantes: Array<keyof TermoDadosAluno>;
  /** Se true, o formulário salva também na ficha do aluno (texto explicativo). */
  salvaNaFicha: boolean;
  onSave: (dados: TermoDadosAluno) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Preenchimento manual dos dados do aluno para o termo. Abre sozinho quando algum dado não
 * foi reconhecido (CPF, e-mail, WhatsApp ou nome) e pode ser reaberto pelo botão "Editar dados".
 */
export default function TermoDadosAlunoForm({ initial, faltantes, salvaNaFicha, onSave, onClose }: Props) {
  const [name, setName] = useState(initial.name ?? '');
  const [cpf, setCpf] = useState(formatCpfCnpj(initial.cpf ?? ''));
  const [email, setEmail] = useState(initial.email ?? '');
  const [whatsapp, setWhatsapp] = useState(formatWhatsappBR(initial.whatsapp ?? ''));
  const [saving, setSaving] = useState(false);

  const errosAtuais = termoDadosFaltantes({ name, cpf, email, whatsapp });
  // Exige nome + (e-mail ou WhatsApp) para o signatário; CPF é recomendado mas não bloqueia.
  const podeSalvar =
    name.trim().length > 2 && (!errosAtuais.includes('email') || !errosAtuais.includes('whatsapp'));

  const campo = (key: keyof TermoDadosAluno) =>
    `w-full rounded-lg border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 ${
      errosAtuais.includes(key) ? 'border-amber-400 bg-amber-50/40' : 'border-border'
    }`;

  const salvar = async () => {
    if (!podeSalvar) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), cpf: cpf.trim(), email: email.trim().toLowerCase(), whatsapp: whatsapp.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserRoundPen size={18} className="text-amber-600" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Complete os dados do aluno</h3>
              <p className="text-[11px] text-muted-foreground">
                {faltantes.length > 0
                  ? `Não reconhecido automaticamente: ${faltantes.map((f) => TERMO_DADOS_LABELS[f]).join(', ')}.`
                  : 'Ajuste os dados que saem no termo e identificam o signatário.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-muted" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Nome completo</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={campo('name')} autoFocus={faltantes[0] === 'name'} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">CPF / CNPJ</span>
            <input
              value={cpf}
              onChange={(e) => setCpf(formatCpfCnpj(e.target.value))}
              inputMode="numeric"
              placeholder="000.000.000-00"
              className={campo('cpf')}
              autoFocus={faltantes[0] === 'cpf'}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">E-mail</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="aluno@exemplo.com"
              className={campo('email')}
              autoFocus={faltantes[0] === 'email'}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">WhatsApp</span>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(formatWhatsappBR(e.target.value))}
              inputMode="tel"
              placeholder="(11) 99999-9999"
              className={campo('whatsapp')}
              autoFocus={faltantes[0] === 'whatsapp'}
            />
          </label>
        </div>

        <p className="text-[10px] text-muted-foreground leading-snug">
          {salvaNaFicha
            ? 'Os dados preenchidos são usados no termo e também salvos na ficha do aluno.'
            : 'Os dados preenchidos são usados apenas neste termo (aluno sem ficha vinculada).'}{' '}
          Para assinatura eletrônica é obrigatório e-mail ou WhatsApp.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:text-foreground"
          >
            Continuar sem alterar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!podeSalvar || saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Usar estes dados'}
          </button>
        </div>
      </div>
    </div>
  );
}
