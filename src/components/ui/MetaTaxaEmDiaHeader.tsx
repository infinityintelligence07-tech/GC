import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import MetaTaxaEmDiaGauge from '@/components/ui/MetaTaxaEmDiaGauge';

/**
 * Velocímetro da meta mensal de Taxa em Dia + leitura + edição da meta.
 * Usado no cabeçalho da Carteira do Assessor (meta por AC) e do Dashboard
 * (meta da empresa).
 *
 * Ponto de partida (ponta esquerda da escala) = Taxa em Dia no início do mês.
 * É fixado na primeira visualização de quem pode editar dentro de cada mês
 * (`baseMes` diferente do mês atual → refixa na taxa do momento) e fica
 * congelado até a próxima virada. Sem isso o início da escala acompanharia a
 * taxa ao vivo e a agulha ficaria sempre colada no começo do velocímetro.
 */
interface Props {
  /** Taxa em Dia atual (%), já calculada pela página. */
  taxaAtual: number;
  /** Meta gravada (%). Se ausente, usa `metaPadrao`. */
  meta?: number;
  /** Meta usada quando não há meta gravada (ex.: Meta 1 global). */
  metaPadrao: number;
  /** Ponto de partida gravado (%). Se ausente, usa a taxa atual. */
  base?: number;
  /** Mês (YYYY-MM) a que `base` se refere. Diferente de `mesAtual` → refixar. */
  baseMes?: string;
  /** Mês corrente (YYYY-MM, Brasília). */
  mesAtual: string;
  /** ISO — quando a meta foi definida. */
  definidaEm?: string;
  /** Título mostrado no popover (ex.: nome do assessor / "Dashboard geral"). */
  titulo: string;
  canEdit: boolean;
  /** Há dados suficientes para a taxa atual fazer sentido (evita fixar partida em 0% de carteira vazia). */
  temDados: boolean;
  /** `meta` ausente = só fixa a partida, mantendo a meta padrão em vigor. */
  onSave: (patch: { meta?: number; base: number; baseMes: string; definidaEm: string }) => void;
  size?: number;
}

const fmtPct = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

export default function MetaTaxaEmDiaHeader({
  taxaAtual,
  meta,
  metaPadrao,
  base,
  baseMes,
  mesAtual,
  definidaEm,
  titulo,
  canEdit,
  temDados,
  onSave,
  size = 170,
}: Props) {
  const [open, setOpen] = useState(false);
  const [metaDraft, setMetaDraft] = useState('');
  const [baseDraft, setBaseDraft] = useState('');

  const metaEfetiva = meta ?? metaPadrao;
  const baseEfetiva = base ?? taxaAtual;
  const taxaArred = Math.round(taxaAtual * 10) / 10;

  // Partida do mês ainda não fixada (nunca gravada ou gravada em outro mês):
  // fixa na taxa atual, uma vez por mês. Meta só é gravada se já existia — a
  // meta padrão continua vindo das Configurações.
  const fixarPartida = canEdit && temDados && (base == null || baseMes !== mesAtual);
  useEffect(() => {
    if (!fixarPartida) return;
    onSave({
      meta: meta ?? undefined,
      base: taxaArred,
      baseMes: mesAtual,
      definidaEm: definidaEm ?? new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixarPartida, mesAtual]);

  const abrir = () => {
    setMetaDraft(fmtPct(metaEfetiva));
    setBaseDraft(fmtPct(baseEfetiva));
    setOpen(true);
  };

  const salvar = () => {
    const m = Number(metaDraft.replace(',', '.'));
    if (!Number.isFinite(m) || m <= 0 || m > 100) {
      toast.error('Meta inválida — informe um percentual entre 0 e 100.');
      return;
    }
    const bRaw = baseDraft.trim() ? Number(baseDraft.replace(',', '.')) : baseEfetiva;
    const b = Number.isFinite(bRaw) ? Math.max(0, Math.min(100, bRaw)) : baseEfetiva;
    onSave({
      meta: Math.round(m * 10) / 10,
      base: Math.round(b * 10) / 10,
      baseMes: mesAtual,
      definidaEm: new Date().toISOString(),
    });
    setOpen(false);
    toast.success(`Meta de Taxa em Dia — ${titulo}: ${fmtPct(m)}% (partida ${fmtPct(b)}%).`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') salvar();
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative flex flex-col items-center">
      <MetaTaxaEmDiaGauge value={taxaAtual} base={baseEfetiva} meta={metaEfetiva} size={size} />
      <div className="flex items-center gap-1.5 -mt-2">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Taxa em Dia</span>
        <span className="text-sm font-bold text-foreground tracking-tight">{fmtPct(taxaAtual)}%</span>
        <span
          className="text-[9px] text-muted-foreground"
          title={meta != null && definidaEm
            ? `Meta definida em ${new Date(definidaEm).toLocaleDateString('pt-BR')}`
            : 'Meta padrão (Configurações → Meta 1). Defina uma meta própria.'}
        >
          · Meta {fmtPct(metaEfetiva)}%
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : abrir())}
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            title="Editar meta de Taxa em Dia"
          >
            <Pencil size={11} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full z-30 mt-1 w-64 rounded-xl border border-border bg-card p-3 shadow-lg text-left">
          <p className="text-[11px] font-semibold text-foreground mb-2">Meta de Taxa em Dia — {titulo}</p>
          <label className="block text-[10px] text-muted-foreground">
            Meta do mês (%)
            <input
              type="number" step="0.1" min={0} max={100}
              className="input-field w-full mt-1"
              value={metaDraft}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setMetaDraft(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <label className="block text-[10px] text-muted-foreground mt-2">
            Ponto de partida (%) — Taxa em Dia no início do mês
            <input
              type="number" step="0.1" min={0} max={100}
              className="input-field w-full mt-1"
              value={baseDraft}
              placeholder={fmtPct(baseEfetiva)}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setBaseDraft(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
          <p className="text-[9px] text-muted-foreground mt-1.5 leading-snug">
            A partida é refixada automaticamente na virada do mês com a taxa daquele momento; aqui você pode corrigi-la. A escala vai da partida até o dobro da meta; o amarelo marca o meio do caminho.
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
