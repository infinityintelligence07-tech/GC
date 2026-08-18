import { Filter, Calendar } from 'lucide-react';

export type DueFilterPreset = 'todos' | '1d' | '2d' | '3d' | '7d' | 'custom';

interface ACDueFilterBarProps {
  mode: 'performance' | 'historico';
  setMode: (mode: 'performance' | 'historico') => void;
  duePreset: DueFilterPreset;
  setDuePreset: (preset: DueFilterPreset) => void;
  customDueStart: string;
  setCustomDueStart: (date: string) => void;
  customDueEnd: string;
  setCustomDueEnd: (date: string) => void;
  historicoStart: string;
  setHistoricoStart: (date: string) => void;
  historicoEnd: string;
  setHistoricoEnd: (date: string) => void;
}

export default function ACDueFilterBar({
  mode,
  setMode,
  duePreset,
  setDuePreset,
  customDueStart,
  setCustomDueStart,
  customDueEnd,
  setCustomDueEnd,
  historicoStart,
  setHistoricoStart,
  historicoEnd,
  setHistoricoEnd,
}: ACDueFilterBarProps) {
  const duePresets = [
    { key: 'todos' as const, label: 'Todos' },
    { key: '1d' as const, label: '1 Dia' },
    { key: '2d' as const, label: '2 Dias' },
    { key: '3d' as const, label: '3 Dias' },
    { key: '7d' as const, label: '5 Dias' },
    { key: 'custom' as const, label: 'Personalizado' },
  ];

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-muted-foreground" />
        <button
          onClick={() => setMode('performance')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            mode === 'performance'
              ? 'iam-gradient text-primary-foreground shadow-sm'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          Performance
        </button>
        <button
          onClick={() => setMode('historico')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            mode === 'historico'
              ? 'iam-gradient text-primary-foreground shadow-sm'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          }`}
        >
          Histórico
        </button>
      </div>

      {/* Performance mode: due date filter */}
      {mode === 'performance' && (
        <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Filtro Vencimento:</span>
            {duePresets.map((f) => (
              <button
                key={f.key}
                onClick={() => setDuePreset(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  duePreset === f.key
                    ? 'iam-gradient text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
                }`}
              >
                {f.label}
              </button>
            ))}
            {duePreset === 'custom' && (
              <div className="flex items-center gap-2 ml-2">
                <Calendar size={14} className="text-muted-foreground" />
                <input
                  type="date"
                  value={customDueStart}
                  onChange={(e) => setCustomDueStart(e.target.value)}
                  className="input-field text-xs py-1"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <input
                  type="date"
                  value={customDueEnd}
                  onChange={(e) => setCustomDueEnd(e.target.value)}
                  className="input-field text-xs py-1"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historico mode: date range filter */}
      {mode === 'historico' && (
        <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground uppercase">Período de Referência:</span>
            <Calendar size={14} className="text-muted-foreground" />
            <input
              type="date"
              value={historicoStart}
              onChange={(e) => setHistoricoStart(e.target.value)}
              className="input-field text-xs py-1"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={historicoEnd}
              onChange={(e) => setHistoricoEnd(e.target.value)}
              className="input-field text-xs py-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
