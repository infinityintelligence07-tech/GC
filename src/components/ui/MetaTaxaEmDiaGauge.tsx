/**
 * MetaTaxaEmDiaGauge — velocímetro da meta mensal de Taxa em Dia.
 *
 * Escala (da esquerda para a direita), sempre nesta ordem:
 *   0°    = partida — Taxa em Dia do dia 01 do mês (`base`)
 *   45°   = metade do caminho até a meta — partida + (meta − partida) / 2
 *           (ex.: meta 5 p.p. acima → este marco fica 2,5 p.p. acima da partida)
 *   90°   = meta do mês
 *   135°  = penúltimo — meta + (100% − meta) / 2
 *           (ex.: meta 50% → falta 50% até 100%, metade = 25% → marco em 75%)
 *   180°  = sempre 100%
 *
 * Cores: vermelho → amarelo → verde claro → verde escuro.
 * O ponteiro marca a taxa em dia atual sobre essa escala.
 */
interface MetaTaxaEmDiaGaugeProps {
  /** Taxa em Dia atual (%). */
  value: number;
  /** Ponto de partida da escala (%). */
  base: number;
  /** Meta do mês (%). */
  meta: number;
  size?: number;
  className?: string;
}

const SEG_COLORS = ['#dc2626', '#facc15', '#4ade80', '#15803d'];
const SEG_TITLES = [
  'Abaixo da metade do caminho até a meta',
  'A caminho da meta',
  'Meta batida',
  'Acima da meta — rumo a 100%',
];

export default function MetaTaxaEmDiaGauge({
  value,
  base,
  meta,
  size = 220,
  className,
}: MetaTaxaEmDiaGaugeProps) {
  const padX = size * 0.18;
  const W = size + padX * 2;
  const cx = W / 2;
  const cy = size * 0.66;
  const r = size * 0.40;
  const stroke = Math.max(14, size * 0.13);
  // Espaço inferior só para os rótulos das pontas (partida / 100%).
  const H = cy + size * 0.22;

  const FIM = 100;
  const lo = Math.max(0, Math.min(FIM - 0.1, base));
  const metaReal = Math.max(0, Math.min(FIM, meta));

  // Cinco marcos fixos — mesma regra do financeiro.
  const marcaPartida = lo;
  const marcaMeioCaminho = lo + (metaReal - lo) / 2;
  const marcaMeta = metaReal;
  const marcaPenultimo = metaReal + (FIM - metaReal) / 2;
  const marcaFim = FIM;

  const labelMarks = [marcaPartida, marcaMeioCaminho, marcaMeta, marcaPenultimo, marcaFim];
  const degs = [0, 45, 90, 135, 180] as const;

  // Ponteiro exige escala não-decrescente (meta abaixo da partida comprime o 1º arco).
  const needleMarks: number[] = [];
  for (let i = 0; i < labelMarks.length; i++) {
    if (i === 0) needleMarks.push(labelMarks[i]);
    else needleMarks.push(Math.max(labelMarks[i], needleMarks[i - 1] + 0.01));
  }

  const anchors: Array<[number, number]> = needleMarks.map((v, i) => [v, degs[i]]);

  const valToDeg = (raw: number): number => {
    const v = Math.max(anchors[0][0], Math.min(anchors[anchors.length - 1][0], raw));
    for (let i = 0; i < anchors.length - 1; i++) {
      const [v0, d0] = anchors[i];
      const [v1, d1] = anchors[i + 1];
      if (v <= v1) {
        const t = v1 === v0 ? 1 : (v - v0) / (v1 - v0);
        return d0 + t * (d1 - d0);
      }
    }
    return 180;
  };

  const polar = (angDeg: number, radius = r) => {
    const rad = ((angDeg - 180) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const arcPath = (startDeg: number, endDeg: number, radius = r) => {
    const p1 = polar(startDeg, radius);
    const p2 = polar(endDeg, radius);
    return `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 1 ${p2.x} ${p2.y}`;
  };

  const v = Math.max(0, Math.min(100, value));
  const valueDeg = valToDeg(v);
  const level = Math.min(3, Math.floor(valueDeg / 45));
  const currentColor = SEG_COLORS[level];

  const GAP = 2;
  const SEG_DEG = 45;
  const segs = [0, 1, 2, 3].map((i) => ({
    start: i * SEG_DEG + (i === 0 ? 0 : GAP / 2),
    end: (i + 1) * SEG_DEG - (i === 3 ? 0 : GAP / 2),
    color: SEG_COLORS[i],
    title: SEG_TITLES[i],
  }));

  const needleLen = r - stroke / 2 - 4;
  const needleRad = ((valueDeg - 180) * Math.PI) / 180;
  const tipX = cx + needleLen * Math.cos(needleRad);
  const tipY = cy + needleLen * Math.sin(needleRad);
  const baseRad1 = ((valueDeg - 180 + 90) * Math.PI) / 180;
  const baseRad2 = ((valueDeg - 180 - 90) * Math.PI) / 180;
  const baseW = Math.max(2, size * 0.018);
  const b1 = { x: cx + baseW * Math.cos(baseRad1), y: cy + baseW * Math.sin(baseRad1) };
  const b2 = { x: cx + baseW * Math.cos(baseRad2), y: cy + baseW * Math.sin(baseRad2) };

  const fontPct = Math.max(9, size * 0.055);
  const uid = `mtg-${Math.round(size)}-${Math.round(v * 10)}`;
  const outerLabelRadius = r + stroke / 2 + size * 0.10;

  const endLabelY = cy + stroke / 2 + fontPct * 0.9;
  const labelTitles = [
    'Ponto de partida — Taxa em Dia no dia 01 do mês',
    'Metade do caminho até a meta',
    'Meta do mês',
    'Metade do caminho entre a meta e 100%',
    'Fim da escala — 100%',
  ];
  const labels: Array<{ x: number; y: number; text: string; title: string; anchor: 'start' | 'middle' | 'end' }> = [
    { x: polar(0).x, y: endLabelY, text: `${fmt(labelMarks[0])}%`, title: labelTitles[0], anchor: 'middle' },
    { ...polar(45, outerLabelRadius), text: `${fmt(labelMarks[1])}%`, title: labelTitles[1], anchor: 'middle' },
    { ...polar(90, outerLabelRadius), text: `${fmt(labelMarks[2])}%`, title: labelTitles[2], anchor: 'middle' },
    { ...polar(135, outerLabelRadius), text: `${fmt(labelMarks[3])}%`, title: labelTitles[3], anchor: 'middle' },
    { x: polar(180).x, y: endLabelY, text: `${fmt(labelMarks[4])}%`, title: labelTitles[4], anchor: 'middle' },
  ];

  return (
    <div className={className} style={{ width: W }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Taxa em Dia ${v.toFixed(1)}% — meta ${fmt(metaReal)}%`}
      >
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

        {segs.map((s, i) => (
          <path
            key={i}
            d={arcPath(s.start, s.end)}
            stroke={s.color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="butt"
            opacity={i === level ? 1 : 0.8}
          >
            <title>{s.title}</title>
          </path>
        ))}

        {labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            dominantBaseline="middle"
            fontSize={fontPct}
            fontWeight={i === 2 ? 800 : 700}
            fill="hsl(var(--foreground))"
            style={{ letterSpacing: '-0.01em' }}
          >
            <title>{l.title}</title>
            {l.text}
          </text>
        ))}

        <g filter={`url(#${uid}-shadow)`}>
          <polygon
            points={`${b1.x},${b1.y} ${tipX},${tipY} ${b2.x},${b2.y}`}
            fill="hsl(var(--foreground))"
          />
        </g>

        <circle cx={cx} cy={cy} r={Math.max(5, size * 0.045)} fill="hsl(var(--foreground))" />
        <circle cx={cx} cy={cy} r={Math.max(2, size * 0.018)} fill={currentColor} />
      </svg>
    </div>
  );
}

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}
