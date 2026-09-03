/**
 * RibbonGauge — indicador de fita reta (escala linear 0–100%).
 *
 * Barra horizontal com gradiente vermelho → amarelo → verde e um ponteiro
 * (triângulo + traço) marcando o valor atual. Usado no Dashboard para o card
 * "Em Dia + Novos", ao lado do velocímetro da Taxa em Dia.
 */
interface RibbonGaugeProps {
  /** Valor atual (%), 0–100. */
  value: number;
  /** Marcas exibidas abaixo da fita (%). */
  ticks?: number[];
  /** Cor do ponteiro (CSS). */
  pointerColor?: string;
  className?: string;
}

const fmtPct = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
};

export default function RibbonGauge({
  value,
  ticks = [0, 25, 50, 75, 100],
  pointerColor = 'hsl(var(--foreground))',
  className,
}: RibbonGaugeProps) {
  const W = 300;
  const padX = 14;
  const barY = 22;
  const barH = 12;
  const H = 50;
  const innerW = W - padX * 2;

  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const px = padX + (innerW * v) / 100;
  const uid = `rg-${Math.round(v * 10)}`;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${fmtPct(v)}% da carteira`}>
        <defs>
          <linearGradient id={`${uid}-grad`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="40%" stopColor="#facc15" />
            <stop offset="70%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
        </defs>

        <rect
          x={padX}
          y={barY}
          width={innerW}
          height={barH}
          rx={barH / 2}
          fill={`url(#${uid}-grad)`}
          opacity={0.9}
        />

        {ticks.map((t) => {
          const x = padX + (innerW * Math.max(0, Math.min(100, t))) / 100;
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={barY + barH} y2={barY + barH + 3} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
              <text
                x={x}
                y={barY + barH + 12}
                textAnchor={t === 0 ? 'start' : t === 100 ? 'end' : 'middle'}
                fontSize={8}
                fontWeight={600}
                fill="hsl(var(--muted-foreground))"
              >
                {fmtPct(t)}%
              </text>
            </g>
          );
        })}

        <line x1={px} x2={px} y1={barY - 2} y2={barY + barH + 2} stroke={pointerColor} strokeWidth={2} strokeLinecap="round" />
        <polygon points={`${px - 6},${barY - 10} ${px + 6},${barY - 10} ${px},${barY - 2}`} fill={pointerColor} />
        <text
          x={px}
          y={barY - 13}
          textAnchor={v < 8 ? 'start' : v > 92 ? 'end' : 'middle'}
          fontSize={10}
          fontWeight={800}
          fill="hsl(var(--foreground))"
          style={{ letterSpacing: '-0.01em' }}
        >
          {fmtPct(v)}%
        </text>
      </svg>
    </div>
  );
}
