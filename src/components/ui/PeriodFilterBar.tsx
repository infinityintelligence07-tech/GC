import { CalendarDays, Layers } from 'lucide-react';
import { DatePreset, AnalysisMode, PRESET_LABELS, MODE_LABELS } from '@/lib/periodFilter';

interface PeriodFilterBarProps {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  mode: AnalysisMode;
  setMode: (m: AnalysisMode) => void;
  variant?: 'dashboard-cancelamentos';
}

const MODE_ACTIVE: Record<AnalysisMode, string> = {
  performance: 'iam-gradient text-primary-foreground shadow-sm',
  historico: 'bg-amber-500 text-white shadow-sm',
};

const MODES = Object.keys(MODE_LABELS) as AnalysisMode[];

// Presets for GC Performance mode: Ontem, Hoje, Amanhã, 2 Dias, 3 dias, 7 dias
const GC_PERFORMANCE_PRESETS: DatePreset[] = ['ontem', 'hoje', 'amanha', '2d', '3d', '7d', 'custom'];

// Presets for Dashboard/Cancelamentos: all historical presets
const DASHBOARD_PRESETS: DatePreset[] = ['hoje', '7d', '30d', 'este-mes', 'mes-passado', 'custom'];

// Quick presets shown as buttons on the reference-period row
const QUICK_PRESETS: DatePreset[] = ['este-mes', 'mes-passado', 'trimestre-atual', 'trimestre-passado', 'este-ano'];

export default function PeriodFilterBar({
  preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd, mode, setMode,
  variant = 'dashboard-cancelamentos',
}: PeriodFilterBarProps) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 saas-shadow space-y-3">
      {/* Row 1: Analysis mode */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <Layers size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Modo de análise</span>
        </div>
        <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === m ? MODE_ACTIVE[m] : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Period selection */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
          <CalendarDays size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Período de referência</span>
        </div>

        {/* Quick presets */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                preset === p
                  ? 'iam-gradient text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Date range inputs - always visible for dashboard-cancelamentos */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Início:</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => {
              setCustomStart(e.target.value);
              if (preset !== 'custom') setPreset('custom');
            }}
            className="input-field text-xs py-1.5 px-2 w-36"
          />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase ml-2">Fim:</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => {
              setCustomEnd(e.target.value);
              if (preset !== 'custom') setPreset('custom');
            }}
            className="input-field text-xs py-1.5 px-2 w-36"
          />
        </div>
      </div>
    </div>
  );
}
