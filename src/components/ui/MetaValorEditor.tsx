import { useState, useMemo, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';
import {
  EM_DIA_NOVOS_META_PADRAO,
  type MetaPendenciaItem,
  metaAcrescimoSobrePadrao,
  pickPendenciasDoAcrescimo,
  sumMetaPendenciaItems,
  formatMetaPendenciaDue,
} from '@/lib/metaPendenciaAjustes';

export { EM_DIA_NOVOS_META_PADRAO };

interface MetaValorEditorProps {
  /** Meta atual (R$) — valor efetivo usado na fita. */
  value: number;
  /** Título do popover (ex.: "Dashboard geral" ou nome do assessor). */
  titulo: string;
  canEdit: boolean;
  onSave: (meta: number) => void;
  /** Rótulo curto exibido ao lado do lápis. */
  label?: string;
  /**
   * Meta base de referência (padrão do app). O acréscimo exibido no clique
   * é `value − baseReferencia` quando positivo.
   */
  baseReferencia?: number;
  /** Pendências de entrada em aberto na carteira (para detalhar o acréscimo). */
  pendencias?: MetaPendenciaItem[];
}

/**
 * Meta do mês + lápis (edição admin) + clique no valor para ver o que
 * aumentou por pendência em relação à meta base.
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

  const acrescimo = metaAcrescimoSobrePadrao(value, baseReferencia);
  const explicam = useMemo(
    () => pickPendenciasDoAcrescimo(pendencias, acrescimo),
    [pendencias, acrescimo],
  );
  const totalExplicam = sumMetaPendenciaItems(explicam);
  const temDetalhe = acrescimo > 0.0049 || pendencias.length > 0;

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
    setDraft(String(value));
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
          title={`Editar ${label.toLowerCase()}`}
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
              <span>Acréscimo</span>
              <span className="font-semibold text-amber-700 tabular-nums">
                {acrescimo > 0.0049 ? `+${formatCurrency(acrescimo)}` : formatCurrency(0)}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-t border-border pt-1">
              <span>Meta atual</span>
              <span className="font-semibold text-foreground tabular-nums">{formatCurrency(value)}</span>
            </div>
          </div>

          {acrescimo > 0.0049 && explicam.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">
                Composição do acréscimo
              </p>
              <ul className="max-h-48 overflow-y-auto space-y-1.5">
                {explicam.map((p) => (
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
              {Math.abs(totalExplicam - acrescimo) > 0.05 && (
                <p className="text-[9px] text-muted-foreground">
                  Soma listada: {formatCurrency(totalExplicam)}
                </p>
              )}
            </div>
          ) : acrescimo > 0.0049 ? (
            <div className="space-y-1.5">
              <p className="text-[9px] text-muted-foreground leading-snug">
                Há acréscimo de {formatCurrency(acrescimo)} na meta, mas nenhuma pendência em aberto
                fecha esse valor sozinha.
              </p>
              {pendencias.length > 0 && (
                <>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold pt-1">
                    Pendências em aberto na carteira
                  </p>
                  <ul className="max-h-40 overflow-y-auto space-y-1.5">
                    {pendencias.map((p) => (
                      <li
                        key={`${p.studentId}-${p.dueDate}-${p.value}`}
                        className="rounded-lg border border-border bg-muted/40 px-2 py-1.5"
                      >
                        <p className="text-[10px] font-semibold text-foreground leading-tight">{p.studentName}</p>
                        <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">
                          {p.product}
                          {p.dueDate ? ` · venc. ${formatMetaPendenciaDue(p.dueDate)}` : ''}
                        </p>
                        <p className="text-[10px] font-bold text-foreground tabular-nums mt-0.5">
                          {formatCurrency(p.value)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground leading-snug">
              Sem acréscimo sobre a meta base{pendencias.length === 0 ? '.' : '. Há pendências em aberto, mas a meta ainda não foi elevada.'}
            </p>
          )}
        </div>
      )}

      {editOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left cursor-default">
          <p className="text-[11px] font-semibold text-foreground mb-2">{label} Pago do mês — {titulo}</p>
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
            A fita vai de R$ 0 até 150% da meta (o traço marca a meta em 2/3 da escala); o ponteiro mostra quanto da meta o Pago do dia 01 até hoje (baixas feitas no GC e conciliadas) já alcança.
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
              Salvar meta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
