import { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';
import {
  EM_DIA_NOVOS_META_PADRAO,
  type MetaPendenciaItem,
  sumMetaPendenciaItems,
  formatMetaPendenciaDue,
} from '@/lib/metaPendenciaAjustes';

export { EM_DIA_NOVOS_META_PADRAO };

interface MetaValorEditorProps {
  /** Meta efetiva (base + pendências) — valor exibido e usado na fita. */
  value: number;
  /** Meta base (sem pendências). É o que o lápis edita. */
  baseReferencia?: number;
  /** Título do popover (ex.: "Dashboard geral" ou nome do assessor). */
  titulo: string;
  canEdit: boolean;
  /** Salva a meta base (sem incluir pendências). */
  onSave: (metaBase: number) => void;
  label?: string;
  /** Pendências de entrada em aberto — acréscimo = soma exata destes itens. */
  pendencias?: MetaPendenciaItem[];
}

/**
 * Meta do mês + lápis (edita a base) + clique no valor para ver o acréscimo
 * exato por pendência (soma sem arredondar para real inteiro).
 */
export default function MetaValorEditor({
  value,
  titulo,
  canEdit,
  onSave,
  label = 'Meta',
  baseReferencia = EM_DIA_NOVOS_META_PADRAO,
  pendencias = [],
}: MetaValorEditorProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const acrescimo = sumMetaPendenciaItems(pendencias);
  const temDetalhe = acrescimo > 0 || pendencias.length > 0;

  useEffect(() => {
    if (!detailOpen && !editOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setDetailOpen(false);
        setEditOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [detailOpen, editOpen]);

  const abrirEdicao = () => {
    setDetailOpen(false);
    setDraft(String(baseReferencia));
    setEditOpen(true);
  };

  const abrirDetalhe = () => {
    if (!temDetalhe) return;
    setEditOpen(false);
    setDetailOpen((o) => !o);
  };

  const salvar = () => {
    const n = Number(String(draft).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    // Mantém centavos se o admin digitar; não força real inteiro.
    onSave(Math.round(n * 100) / 100);
    setEditOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') salvar();
    if (e.key === 'Escape') setEditOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={abrirDetalhe}
        disabled={!temDetalhe}
        className={`text-[10px] text-muted-foreground whitespace-nowrap rounded px-0.5 -mx-0.5 transition-colors ${
          temDetalhe
            ? 'hover:text-foreground hover:bg-muted/60 cursor-pointer'
            : 'cursor-default'
        }`}
        title={
          temDetalhe
            ? `Ver o que aumentou a ${label.toLowerCase()} por pendência`
            : `${label} do mês: ${formatCurrency(value)} — ${titulo}`
        }
      >
        {label}{' '}
        <span className={`font-semibold text-foreground ${temDetalhe ? 'underline decoration-dotted underline-offset-2' : ''}`}>
          {formatCurrency(value)}
        </span>
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => (editOpen ? setEditOpen(false) : abrirEdicao())}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
          title={`Editar meta base (sem pendências)`}
        >
          <Pencil size={11} />
        </button>
      )}

      {detailOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          <p className="text-[11px] font-semibold text-foreground mb-2">
            Acréscimo na {label.toLowerCase()} por pendência
          </p>
          <div className="space-y-1 text-[10px] text-muted-foreground mb-2">
            <div className="flex justify-between gap-2">
              <span>Meta base</span>
              <span className="font-medium text-foreground tabular-nums">{formatCurrency(baseReferencia)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Acréscimo (soma exata)</span>
              <span className="font-semibold text-amber-700 tabular-nums">
                {acrescimo > 0 ? `+${formatCurrency(acrescimo)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-t border-border pt-1">
              <span>Meta atual</span>
              <span className="font-semibold text-foreground tabular-nums">{formatCurrency(value)}</span>
            </div>
          </div>

          {pendencias.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
                Pendências em aberto na carteira
              </p>
              <ul className="max-h-48 overflow-y-auto space-y-1.5">
                {pendencias.map((p) => (
                  <li
                    key={`${p.studentId}-${p.dueDate}-${p.value}`}
                    className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-2 py-1.5"
                  >
                    <p className="text-[10px] font-semibold text-foreground leading-tight">{p.studentName}</p>
                    <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">
                      {p.product}
                      {p.dueDate ? ` · venc. ${formatMetaPendenciaDue(p.dueDate)}` : ''}
                      {` · ${p.tipo}`}
                    </p>
                    <p className="text-[10px] font-bold text-amber-800 tabular-nums mt-0.5">
                      {formatCurrency(p.value)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground leading-snug">
              Sem pendências em aberto — a meta está na base.
            </p>
          )}
        </div>
      )}

      {editOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          <p className="text-[11px] font-semibold text-foreground mb-2">{label} base — {titulo}</p>
          <label className="block text-[10px] text-muted-foreground">
            Meta base do mês (R$), sem pendências
            <input
              type="number"
              step="0.01"
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
            A meta exibida na fita é a base + a soma exata das pendências de entrada em aberto. O acréscimo por pendência não é arredondado.
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] bg-muted hover:bg-muted/70"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground"
            >
              Salvar meta base
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
