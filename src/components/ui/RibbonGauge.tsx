import type { ReactNode } from 'react';

/**
 * RibbonGauge — indicador de fita reta (escala linear 0–100%).
 *
 * Barra horizontal com gradiente vermelho → amarelo → verde. O ponteiro
 * (triângulo + traço) marca o valor atual; opcionalmente uma marca fina
 * indica a referência (ex.: valor no início do mês). Usado no card
 * "Em Dia + Novos" do Dashboard e da Carteira do Assessor.
 *
 * A escala interna é sempre 0–100 (%). Para exibir outra unidade (ex.: R$
 * em relação a uma meta), converta o valor para % antes e use `formatValue`
 * / `formatTick` para rotular.
 */
interface RibbonGaugeProps {
  /** Valor atual (%), 0–100. */
  value: number;
  /** Referência (%) exibida como marca fina — ex.: início do mês. */
  baseline?: number;
  /** Texto do tooltip da marca de referência. */
  baselineLabel?: string;
  /** Marcas exibidas abaixo da fita (%). */
  ticks?: number[];
  /** Posição (%) de uma marca de meta — traço sólido com rótulo acima da fita. */
  goal?: number;
  /** Rótulo da marca de meta. */
  goalLabel?: string;
  /** Cor do ponteiro (CSS). */
  pointerColor?: string;
  /** Rótulo do ponteiro e dos tooltips (recebe o % da escala). Padrão: "59,4%". */
  formatValue?: (pct: number) => string;
  /** Texto exibido acima do ponteiro. Se ausente, usa `formatValue(value)`. */
  pointerLabel?: string;
  /** Cor do texto do ponteiro. `'gradient'` = cor da fita na posição do ponteiro. Padrão: foreground. */
  pointerLabelColor?: string | 'gradient';
  /** Rótulo das marcas (recebe o % da escala). Padrão: "50%". */
  formatTick?: (pct: number) => string;
  /** Rodapé customizado. `null` oculta; ausente usa o rodapé padrão (início do mês · Δ pp). */
  footer?: ReactNode;
  className?: string;
}

const fmtPct = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
};
const defaultFormat = (p: number) => `${fmtPct(p)}%`;

/** Paradas do gradiente da fita (posição % → cor), na ordem. */
const GRADIENT_STOPS: Array<[number, string]> = [
  [0, '#dc2626'],
  [40, '#facc15'],
  [70, '#4ade80'],
  [100, '#15803d'],
];

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Cor da fita na posição `pct` (0–100), interpolando as paradas do gradiente. */
function ribbonColorAt(pct: number): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const [p0, c0] = GRADIENT_STOPS[i - 1];
    const [p1, c1] = GRADIENT_STOPS[i];
    if (p > p1) continue;
    const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
    const a = hexToRgb(c0);
    const b = hexToRgb(c1);
    const mix = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
  }
  return GRADIENT_STOPS[GRADIENT_STOPS.length - 1][1];
}

export default function RibbonGauge({
  value,
  baseline,
  baselineLabel = 'Referência',
  ticks = [0, 50, 100],
  goal,
  goalLabel = 'Meta',
  pointerColor = 'hsl(var(--foreground))',
  formatValue = defaultFormat,
  formatTick = defaultFormat,
  pointerLabel,
  pointerLabelColor,
  footer,
  className,
}: RibbonGaugeProps) {
  const W = 300;
  const padX = 10;
  const barY = 18;
  const barH = 9;
  const H = 40;
  const innerW = W - padX * 2;

  const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  const xOf = (p: number) => padX + (innerW * clamp(p)) / 100;

  const v = clamp(value);
  const px = xOf(v);
  const hasBase = baseline != null && Number.isFinite(baseline);
  const bx = hasBase ? xOf(baseline as number) : 0;
  const hasGoal = goal != null && Number.isFinite(goal);
  const gx = hasGoal ? xOf(goal as number) : 0;
  // Evita o rótulo da meta colidir com o do ponteiro quando estão próximos.
  const goalLabelNearPointer = hasGoal && Math.abs(gx - px) < 38;
  const delta = hasBase ? v - clamp(baseline as number) : 0;
  const labelText = pointerLabel ?? formatValue(v);
  const labelFill =
    pointerLabelColor === 'gradient' ? ribbonColorAt(v) : pointerLabelColor ?? 'hsl(var(--foreground))';
  // Rótulos longos (ex.: "R$ 387.570,80") precisam de mais folga nas bordas
  // para não sair da viewBox.
  const longLabel = labelText.length > 8;
  const labelAnchor = v < (longLabel ? 22 : 10) ? 'start' : v > (longLabel ? 78 : 90) ? 'end' : 'middle';
  const uid = `rg-${Math.round(v * 10)}-${hasBase ? Math.round((baseline as number) * 10) : 'x'}`;

  const aria = hasBase
    ? `${formatValue(v)} — ${baselineLabel} ${formatValue(baseline as number)}`
    : formatValue(v);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={aria}>
        <defs>
          <linearGradient id={`${uid}-grad`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="40%" stopColor="#facc15" />
            <stop offset="70%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
        </defs>

        <rect x={padX} y={barY} width={innerW} height={barH} rx={barH / 2} fill={`url(#${uid}-grad)`} opacity={0.9} />

        {ticks.map((t) => {
          const x = xOf(t);
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={barY + barH} y2={barY + barH + 2.5} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
              <text
                x={x}
                y={barY + barH + 10}
                textAnchor={t <= 0 ? 'start' : t >= 100 ? 'end' : 'middle'}
                fontSize={7}
                fontWeight={600}
                fill="hsl(var(--muted-foreground))"
              >
                {formatTick(t)}
              </text>
            </g>
          );
        })}

        {hasGoal && (
          <g>
            <title>{`${goalLabel}: ${formatValue(goal as number)}`}</title>
            <line
              x1={gx}
              x2={gx}
              y1={barY - 4}
              y2={barY + barH + 4}
              stroke="hsl(var(--foreground))"
              strokeWidth={1.75}
              strokeLinecap="round"
            />
            {goalLabel && !goalLabelNearPointer && (
              <text
                x={gx}
                y={barY - 6.5}
                textAnchor="middle"
                fontSize={7}
                fontWeight={700}
                fill="hsl(var(--foreground))"
                style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {goalLabel}
              </text>
            )}
          </g>
        )}

        {hasBase && (
          <g>
            <title>{`${baselineLabel}: ${formatValue(baseline as number)}`}</title>
            <line
              x1={bx}
              x2={bx}
              y1={barY - 3}
              y2={barY + barH + 3}
              stroke="hsl(var(--foreground))"
              strokeWidth={1.5}
              strokeDasharray="2 1.5"
              opacity={0.7}
            />
            <polygon
              points={`${bx - 3.5},${barY + barH + 3} ${bx + 3.5},${barY + barH + 3} ${bx},${barY + barH}`}
              fill="hsl(var(--foreground))"
              opacity={0.7}
            />
          </g>
        )}

        <g>
          <title>{hasBase ? `Agora ${formatValue(v)} (${baselineLabel.toLowerCase()} ${formatValue(baseline as number)})` : `Agora ${formatValue(v)}`}</title>
          <line x1={px} x2={px} y1={barY - 2} y2={barY + barH + 2} stroke={pointerColor} strokeWidth={2} strokeLinecap="round" />
          <polygon points={`${px - 5},${barY - 9} ${px + 5},${barY - 9} ${px},${barY - 2}`} fill={pointerColor} />
          <text
            x={px}
            y={barY - 11.5}
            textAnchor={labelAnchor}
            fontSize={9}
            fontWeight={800}
            fill={labelFill}
            style={{ letterSpacing: '-0.01em' }}
          >
            {labelText}
          </text>
        </g>
      </svg>
      {footer !== undefined ? footer : hasBase && (
        <p className="text-[9px] text-muted-foreground text-center -mt-0.5 leading-tight">
          {baselineLabel} {fmtPct(baseline as number)}% ·{' '}
          <span className={delta >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
            {delta >= 0 ? '+' : ''}{fmtPct(delta)} pp
          </span>
        </p>
      )}
    </div>
  );
}
