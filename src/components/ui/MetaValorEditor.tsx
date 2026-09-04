import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';

/** Meta padrão (R$) da fita "Em Dia + Novos · mês vigente" quando ainda não há meta salva. */
export const EM_DIA_NOVOS_META_PADRAO = 144500;

interface MetaValorEditorProps {
  /** Meta atual (R$). */
  value: number;
  /** Título do popover (ex.: "Dashboard geral" ou nome do assessor). */
  titulo: string;
  canEdit: boolean;
  onSave: (meta: number) => void;
  /** Rótulo curto exibido ao lado do lápis. */
  label?: string;
}

/**
 * Botão de lápis + popover para editar uma meta em reais. Usado no card
 * "Em Dia + Novos · mês vigente" (Dashboard e Carteira do Assessor).
 */
export default function MetaValorEditor({ value, titulo, canEdit, onSave, label = 'Meta' }: MetaValorEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const abrir = () => {
    setDraft(String(value));
    setOpen(true);
  };

  const salvar = () => {
    const n = Number(String(draft).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    onSave(Math.round(n * 100) / 100);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') salvar();
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap" title={`${label} do mês: ${formatCurrency(value)}`}>
        {label} <span className="font-semibold text-foreground">{formatCurrency(value)}</span>
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : abrir())}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
          title={`Editar ${label.toLowerCase()}`}
        >
          <Pencil size={11} />
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          <p className="text-[11px] font-semibold text-foreground mb-2">{label} Em Dia + Novos — {titulo}</p>
          <label className="block text-[10px] text-muted-foreground">
            {label} do mês (R$)
            <input
              type="number"
              step="100"
              min={0}
              className="input-field w-full mt-1"
              value={draft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
            A fita vai de R$ 0 até 150% da meta (o traço marca a meta em 2/3 da escala); o ponteiro mostra quanto da meta o acumulado "Em Dia + Novos" do dia 01 até hoje já alcança.
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] bg-muted hover:bg-muted/70"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground"
            >
              Salvar meta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
