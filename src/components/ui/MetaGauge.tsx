/**
 * MetaGauge — velocímetro semicircular minimalista, inspirado no modelo
 * de referência: arco com gradiente vermelho → laranja → amarelo → verde,
 * separado em 4 segmentos iguais por finos gaps brancos. Os rótulos das
 * metas (Meta não batida, Meta 1, Meta 2, Meta 3) aparecem do lado de fora
 * do arco, abaixo de cada segmento, junto do percentual.
 */
interface MetaGaugeProps {
  value: number;          // 0–100 (Liquidez %)
  meta1: number;
  meta2: number;
  meta3: number;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

const SEG_COLORS = ['#ef4444', '#93c5fd', '#3b82f6', '#1e40af'];
const LEVEL_LABELS = ['Meta não batida', 'Meta 1', 'Meta 2', 'Meta 3'];

export default function MetaGauge({
  value,
  meta1,
  meta2,
  meta3,
  size = 220,
  showLabel = true,
  className,
}: MetaGaugeProps) {
  // padding extra para os rótulos externos não serem cortados
  const padX = size * 0.16;
  const W = size + padX * 2;
  const cx = W / 2;
  const cy = size * 0.62;
  const r = size * 0.40;
  const stroke = Math.max(14, size * 0.13);
  const H = cy + size * 0.38;

  const m1 = Math.max(1, Math.min(98, meta1));
  const m2 = Math.max(m1 + 1, Math.min(99, meta2));
  const m3 = Math.max(m2 + 1, Math.min(100, meta3));
  const metaValues = [0, m1, m2, m3];

  const polar = (angDeg: number, radius = r) => {
    const rad = ((angDeg - 180) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const arcPath = (startDeg: number, endDeg: number, radius = r) => {
    const p1 = polar(startDeg, radius);
    const p2 = polar(endDeg, radius);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };

  const v = Math.max(0, Math.min(100, value));
  const level = v < m1 ? 0 : v < m2 ? 1 : v < m3 ? 2 : 3;
  const currentColor = SEG_COLORS[level];

  // 4 segmentos de igual tamanho (45° cada) sobre o arco de 180°
  const GAP = 2;
  const pctToDeg = (p: number) => (p / 100) * 180;
  const SEG_DEG = 180 / 4; // 45° cada segmento
  const segs = [0, 1, 2, 3].map((i) => {
    const rawStart = i * SEG_DEG;
    const rawEnd = (i + 1) * SEG_DEG;
    const start = rawStart + (i === 0 ? 0 : GAP / 2);
    const end = rawEnd - (i === 3 ? 0 : GAP / 2);
    return { start, end, mid: (rawStart + rawEnd) / 2, color: SEG_COLORS[i] };
  });

  // Ponteiro: linear sobre o arco completo (0% → 0°, 100% → 180°).
  const valueDeg = pctToDeg(v);

  const needleLen = r - stroke / 2 - 4;
  const needleRad = ((valueDeg - 180) * Math.PI) / 180;
  const tipX = cx + needleLen * Math.cos(needleRad);
  const tipY = cy + needleLen * Math.sin(needleRad);
  const baseRad1 = ((valueDeg - 180 + 90) * Math.PI) / 180;
  const baseRad2 = ((valueDeg - 180 - 90) * Math.PI) / 180;
  const baseW = Math.max(2, size * 0.018);
  const b1 = { x: cx + baseW * Math.cos(baseRad1), y: cy + baseW * Math.sin(baseRad1) };
  const b2 = { x: cx + baseW * Math.cos(baseRad2), y: cy + baseW * Math.sin(baseRad2) };

  const fontPct = Math.max(10, size * 0.062);

  const uid = `mg-${Math.round(size)}-${Math.round(v * 10)}`;

  const outerLabelRadius = r + stroke / 2 + size * 0.11;
  return (
    <div className={className} style={{ width: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Liquidez ${v.toFixed(1)}%`}>
        <defs>
          <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation={size * 0.01} />
            <feOffset dx="0" dy={size * 0.006} result="off" />
            <feComponentTransfer><feFuncA type="linear" slope="0.3" /></feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 4 segmentos iguais com cor sólida */}
        {segs.map((s, i) => (
          <path
            key={i}
            d={arcPath(s.start, s.end)}
            stroke={s.color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="butt"
            opacity={i === level ? 1 : 0.85}
          />
        ))}

        {/* Rótulos externos: apenas o número da meta. Sem rótulo no segmento "meta não batida" (i===0). */}
        {segs.map((s, i) => {
          if (i === 0) return null;
          const pos = polar(s.mid, outerLabelRadius);
          return (
            <text
              key={i}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fontPct}
              fontWeight={700}
              fill="hsl(var(--foreground))"
              style={{ letterSpacing: '-0.01em' }}
            >
              {fmt(metaValues[i])}%
            </text>
          );
        })}

        {/* Ponteiro */}
        <g filter={`url(#${uid}-shadow)`}>
          <polygon
            points={`${b1.x},${b1.y} ${tipX},${tipY} ${b2.x},${b2.y}`}
            fill="hsl(var(--foreground))"
          />
        </g>

        {/* Hub central */}
        <circle cx={cx} cy={cy} r={Math.max(5, size * 0.045)} fill="hsl(var(--foreground))" />
        <circle cx={cx} cy={cy} r={Math.max(2, size * 0.018)} fill={currentColor} />

        {/* Valor central abaixo do hub */}
        {showLabel && (
          <text
            x={cx}
            y={cy + size * 0.18}
            textAnchor="middle"
            fontSize={Math.max(14, size * 0.13)}
            fontWeight={800}
            fill="hsl(var(--foreground))"
            style={{ letterSpacing: '-0.02em' }}
          >
            {v.toFixed(1).replace('.', ',')}%
          </text>
        )}
      </svg>
    </div>
  );
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}
