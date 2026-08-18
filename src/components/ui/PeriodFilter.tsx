import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type PeriodMode = 'mes' | 'trimestre' | 'ano' | 'tudo';

interface WeekRange {
  index: number;
  startDay: number;
  endDay: number;
  start: Date;
  end: Date;
}

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Weeks (Mon-Sun) clipped to month boundaries. */
export function getWeeksOfMonth(year: number, month: number): WeekRange[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const weeks: WeekRange[] = [];
  let cursor = new Date(first);
  let idx = 1;
  while (cursor <= last) {
    // Week end = next Sunday (getDay: 0=Sun ... 1=Mon)
    const dow = cursor.getDay(); // 0..6
    const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + daysUntilSunday);
    const end = weekEnd > last ? last : weekEnd;
    weeks.push({
      index: idx++,
      startDay: cursor.getDate(),
      endDay: end.getDate(),
      start: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
      end: new Date(end.getFullYear(), end.getMonth(), end.getDate()),
    });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return weeks;
}

export function getPeriodRange(
  mode: PeriodMode,
  anchor: Date,
  weekIdx: number | null,
): { start: string; end: string } | null {
  if (mode === 'tudo') return null;
  if (mode === 'ano') {
    const y = anchor.getFullYear();
    return { start: fmt(new Date(y, 0, 1)), end: fmt(new Date(y, 11, 31)) };
  }
  if (mode === 'trimestre') {
    const q = Math.floor(anchor.getMonth() / 3);
    const startMonth = q * 3;
    return {
      start: fmt(new Date(anchor.getFullYear(), startMonth, 1)),
      end: fmt(new Date(anchor.getFullYear(), startMonth + 3, 0)),
    };
  }
  // mes
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (weekIdx != null) {
    const weeks = getWeeksOfMonth(y, m);
    const w = weeks.find((x) => x.index === weekIdx);
    if (w) return { start: fmt(w.start), end: fmt(w.end) };
  }
  return { start: fmt(new Date(y, m, 1)), end: fmt(new Date(y, m + 1, 0)) };
}

interface Props {
  mode: PeriodMode;
  setMode: (m: PeriodMode) => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  weekIdx: number | null;
  setWeekIdx: (n: number | null) => void;
}

export default function PeriodFilter({ mode, setMode, anchor, setAnchor, weekIdx, setWeekIdx }: Props) {
  const weeks = useMemo(
    () => getWeeksOfMonth(anchor.getFullYear(), anchor.getMonth()),
    [anchor],
  );

  const shift = (dir: -1 | 1) => {
    const next = new Date(anchor);
    if (mode === 'mes') next.setMonth(next.getMonth() + dir);
    else if (mode === 'trimestre') next.setMonth(next.getMonth() + dir * 3);
    else if (mode === 'ano') next.setFullYear(next.getFullYear() + dir);
    setAnchor(next);
    setWeekIdx(null);
  };

  const label = () => {
    if (mode === 'tudo') return 'Todo o período';
    if (mode === 'ano') return String(anchor.getFullYear());
    if (mode === 'trimestre') {
      const q = Math.floor(anchor.getMonth() / 3) + 1;
      return `${q}º trimestre · ${anchor.getFullYear()}`;
    }
    return `${MONTH_NAMES[anchor.getMonth()]} · ${anchor.getFullYear()}`;
  };

  const setPreset = (preset: 'este-mes' | 'mes-passado' | 'trimestre-atual' | 'ultimo-trimestre' | 'este-ano') => {
    const now = new Date();
    if (preset === 'este-mes') { setMode('mes'); setAnchor(new Date(now.getFullYear(), now.getMonth(), 1)); setWeekIdx(null); }
    else if (preset === 'mes-passado') { setMode('mes'); setAnchor(new Date(now.getFullYear(), now.getMonth() - 1, 1)); setWeekIdx(null); }
    else if (preset === 'trimestre-atual') { setMode('trimestre'); setAnchor(new Date(now.getFullYear(), now.getMonth(), 1)); setWeekIdx(null); }
    else if (preset === 'ultimo-trimestre') { setMode('trimestre'); setAnchor(new Date(now.getFullYear(), now.getMonth() - 3, 1)); setWeekIdx(null); }
    else if (preset === 'este-ano') { setMode('ano'); setAnchor(new Date(now.getFullYear(), 0, 1)); setWeekIdx(null); }
  };

  const modes: { key: PeriodMode; label: string }[] = [
    { key: 'mes', label: 'Mês' },
    { key: 'trimestre', label: 'Trimestre' },
    { key: 'ano', label: 'Ano' },
    { key: 'tudo', label: 'Tudo' },
  ];

  const presets: { key: Parameters<typeof setPreset>[0]; label: string }[] = [
    { key: 'este-mes', label: 'Este mês' },
    { key: 'mes-passado', label: 'Mês passado' },
    { key: 'trimestre-atual', label: 'Trimestre atual' },
    { key: 'ultimo-trimestre', label: 'Último trimestre' },
    { key: 'este-ano', label: 'Este ano' },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card saas-shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => { setMode(m.key); setWeekIdx(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === m.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Navigator */}
        {mode !== 'tudo' && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shift(-1)}
              className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted"
              aria-label="Anterior"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold text-foreground min-w-[110px] text-center">{label()}</span>
            <button
              type="button"
              onClick={() => shift(1)}
              className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted"
              aria-label="Próximo"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        {mode === 'tudo' && <span className="text-xs font-semibold text-foreground">Todo o período</span>}

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-1 ml-auto">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Week sub-row */}
      {mode === 'mes' && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-t border-border bg-muted/20">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1">Semana:</span>
          <button
            type="button"
            onClick={() => setWeekIdx(null)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
              weekIdx == null ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Todas
          </button>
          {weeks.map((w) => {
            const active = weekIdx === w.index;
            return (
              <button
                key={w.index}
                type="button"
                onClick={() => setWeekIdx(w.index)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-foreground hover:bg-muted'
                }`}
              >
                <span className="font-semibold">Semana {w.index}</span>
                <span className={active ? 'text-primary-foreground/80' : 'text-muted-foreground'}>
                  ({String(w.startDay).padStart(2, '0')}–{String(w.endDay).padStart(2, '0')})
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
