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
  /** Meta efetiva (base + pendências) — usada no detalhe como "Meta atual". */
  value: number;
  /**
   * Valor ao lado do rótulo "Meta". No IAM costuma ser só a base (ex.: 144.500);
   * a efetiva (com pendências) aparece ao clicar. Se omitido, usa `value`.
   */
  valorExibido?: number;
  /** Meta base (sem pendências). É o que o lápis edita em modo reais. */
  baseReferencia?: number;
  /** Título do popover (ex.: "Dashboard geral" ou nome do assessor). */
  titulo: string;
  canEdit: boolean;
  /** Salva a meta base em R$ (modo reais) ou o percentual (modo percentual). */
  onSave: (valor: number) => void;
  label?: string;
  /** Pendências de evento já pagas no mês — acréscimo = soma exata destes itens. */
  pendencias?: MetaPendenciaItem[];
  /**
   * Quando definido (ex.: Liberty % do A Vencer), o detalhe mostra esta
   * explicação. O lápis continua disponível se canEdit.
   */
  explicacaoFixa?: string;
  /**
   * `reais` (padrão): edita valor R$.
   * `percentual`: edita % sobre o A Vencer / Vencido (Liberty).
   */
  modoEdicao?: 'reais' | 'percentual';
  /** Percentual atual quando modoEdicao === 'percentual'. */
  percentualAtual?: number;
}

/**
 * Meta do mês + lápis (edita a base ou o %) + clique no valor para detalhe.
 */
export default function MetaValorEditor({
  value,
  valorExibido,
  titulo,
  canEdit,
  onSave,
  label = 'Meta',
  baseReferencia = EM_DIA_NOVOS_META_PADRAO,
  pendencias = [],
  explicacaoFixa,
  modoEdicao = 'reais',
  percentualAtual = 95,
}: MetaValorEditorProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const isPct = modoEdicao === 'percentual';
  const mostrado = valorExibido ?? value;

  const acrescimo = sumMetaPendenciaItems(pendencias);

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
    if (!canEdit) return;
    setDetailOpen(false);
    setDraft(String(isPct ? percentualAtual : baseReferencia));
    setEditOpen(true);
  };

  const abrirDetalhe = () => {
    setEditOpen(false);
    setDetailOpen((o) => !o);
  };

  const salvar = () => {
    const n = Number(String(draft).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    if (isPct) {
      if (n > 100) return;
      onSave(Math.round(n * 100) / 100);
    } else {
      onSave(Math.round(n * 100) / 100);
    }
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
        className="text-[10px] text-muted-foreground whitespace-nowrap rounded px-0.5 -mx-0.5 transition-colors hover:text-foreground hover:bg-muted/60 cursor-pointer"
        title={explicacaoFixa || `Ver o que aumentou a ${label.toLowerCase()} por pendência`}
      >
        {label}{' '}
        <span className="font-semibold text-foreground underline decoration-dotted underline-offset-2">
          {formatCurrency(mostrado)}
        </span>
        {isPct && (
          <span className="ml-1 font-medium text-muted-foreground">({String(percentualAtual).replace('.', ',')}%)</span>
        )}
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => (editOpen ? setEditOpen(false) : abrirEdicao())}
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
          title={isPct ? 'Editar percentual da meta' : 'Editar meta base (sem pendências)'}
        >
          <Pencil size={11} />
        </button>
      )}

      {detailOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          {explicacaoFixa ? (
            <>
              <p className="text-[11px] font-semibold text-foreground mb-2">
                Como a {label.toLowerCase()} é calculada — {titulo}
              </p>
              <p className="text-[10px] text-muted-foreground leading-snug whitespace-pre-line">
                {explicacaoFixa}
              </p>
              <div className="flex justify-between gap-2 border-t border-border pt-2 mt-2 text-[10px]">
                <span className="text-muted-foreground">Meta atual</span>
                <span className="font-semibold text-foreground tabular-nums">{formatCurrency(value)}</span>
              </div>
            </>
          ) : (
            <>
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
                Pendências de evento pagas no mês
              </p>
              <ul className="max-h-48 overflow-y-auto space-y-1.5">
                {pendencias.map((p) => (
                  <li
                    key={`${p.studentId}-${p.paidDate}-${p.dueDate}-${p.value}`}
                    className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2 py-1.5"
                  >
                    <p className="text-[10px] font-semibold text-foreground leading-tight">{p.studentName}</p>
                    <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">
                      {p.product}
                      {p.paidDate ? ` · pago ${formatMetaPendenciaDue(p.paidDate)}` : ''}
                      {` · ${p.tipo}`}
                    </p>
                    <p className="text-[10px] font-bold text-emerald-800 tabular-nums mt-0.5">
                      {formatCurrency(p.value)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground leading-snug">
              Nenhuma pendência de evento paga neste mês — a meta está na base.
            </p>
          )}
            </>
          )}
        </div>
      )}

      {editOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          <p className="text-[11px] font-semibold text-foreground mb-2">
            {isPct ? `${label} (%) — ${titulo}` : `${label} base — ${titulo}`}
          </p>
          <label className="block text-[10px] text-muted-foreground">
            {isPct
              ? '% sobre o A Vencer / Vencido (padrão 95)'
              : 'Meta base do mês (R$), sem pendências'}
            <input
              type="number"
              step={isPct ? '0.1' : '0.01'}
              min={0}
              max={isPct ? 100 : undefined}
              className="input-field w-full mt-1"
              value={draft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
            {isPct
              ? `A meta em R$ = ${String(percentualAtual).replace('.', ',')}% × A Vencer/Vencido. Altere o % e salve.`
              : 'Pendências de evento pagas no mês somam em cima desta base.'}
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="px-2.5 py-1 rounded-md text-[11px] border border-border hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:opacity-90"
            >
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
