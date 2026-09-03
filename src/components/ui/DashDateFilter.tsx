/**
 * DashDateFilter — filtro de data para Dashboard e GC
 * Dois modos:
 *   Performance: filtro por data de vencimento (foco operacional)
 *   Histórico:   período de referência para reconstruir carteira (foco gerencial)
 */
import { CalendarDays, Activity, Clock } from 'lucide-react';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import { getEffectiveTodayStart } from '@/lib/holidaysBR';

export type DashFilterMode = 'performance' | 'historico';

export type PerfPreset =
  | 'todos'
  | 'ontem'
  | 'hoje'
  | 'amanha'
  | '1d'
  | '2d'
  | '3d'
  | '7d'
  | 'este-mes'
  | 'mes-passado'
  | 'custom';

const PERF_LABELS: Record<PerfPreset, string> = {
  todos: 'Todos',
  ontem: 'Ontem',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  '1d': '1 Dia',
  '2d': '2 Dias',
  '3d': '3 Dias',
  '7d': '5 Dias',
  'este-mes': 'Este mês',
  'mes-passado': 'Mês passado',
  custom: 'Personalizado',
};

const PERF_PRESETS = Object.keys(PERF_LABELS) as PerfPreset[];

/**
 * Returns the [start, end] date range for a given performance preset.
 * Dates are based on installment due dates (vencimento).
 */
export function getPerfRange(
  preset: PerfPreset,
  customStart: string,
  customEnd: string,
): { start: Date; end: Date } {
  const today = getTodayBrasilia();
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  const now = today; // alias para compatibilidade

  switch (preset) {
    case 'todos': {
      const s = new Date(2000, 0, 1);
      const e = new Date(2099, 11, 31, 23, 59, 59);
      return { start: s, end: e };
    }
    case '1d': {
      // Inclui retroativamente fds/feriados anteriores até o último dia útil
      const s = getEffectiveTodayStart(today);
      const e = new Date(endOfToday); e.setDate(e.getDate() + 1);
      return { start: s, end: e };
    }
    case 'ontem': {
      const s = new Date(today); s.setDate(s.getDate() - 1);
      const e = new Date(endOfToday); e.setDate(e.getDate() - 1);
      return { start: s, end: e };
    }
    case 'hoje': {
      // Inclui retroativamente fds/feriados anteriores até o último dia útil
      const s = getEffectiveTodayStart(today);
      return { start: s, end: endOfToday };
    }
    case 'amanha': {
      const s = new Date(today); s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday); e.setDate(e.getDate() + 1);
      return { start: s, end: e };
    }
    case '2d': {
      const s = new Date(today); s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday); e.setDate(e.getDate() + 2);
      return { start: s, end: e };
    }
    case '3d': {
      const s = new Date(today); s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday); e.setDate(e.getDate() + 3);
      return { start: s, end: e };
    }
    case '7d': {
      const s = new Date(today); s.setDate(s.getDate() + 1);
      const e = new Date(endOfToday); e.setDate(e.getDate() + 5);
      return { start: s, end: e };
    }
    case 'este-mes': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { start: s, end: e };
    }
    case 'mes-passado': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start: s, end: e };
    }
    case 'custom': {
      const s = customStart ? new Date(customStart + 'T00:00:00') : today;
      const e = customEnd ? new Date(customEnd + 'T23:59:59') : endOfToday;
      return { start: s, end: e };
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  mode: DashFilterMode;
  setMode: (m: DashFilterMode) => void;
  perfPreset: PerfPreset;
  setPerfPreset: (p: PerfPreset) => void;
  perfCustomStart: string;
  setPerfCustomStart: (v: string) => void;
  perfCustomEnd: string;
  setPerfCustomEnd: (v: string) => void;
  historicoStart: string;
  setHistoricoStart: (d: string) => void;
  historicoEnd: string;
  setHistoricoEnd: (d: string) => void;
  variant?: 'dashboard' | 'ac';
  /**
   * When true, hides the Performance presets row. Used by the Dashboard to
   * avoid duplicating the "Previsão de Recebimento" date filter which lives
   * in its own card. Histórico mode date range remains visible.
   */
  hidePerformancePresets?: boolean;
  /**
   * No desktop os botões de modo sobem para o cabeçalho, ao lado do seletor de
   * empresa. Aqui eles continuam existindo só para telas pequenas, onde o
   * cabeçalho não tem espaço.
   */
  moveModeToHeader?: boolean;
}

/** Alternância Performance / Histórico, usada no cabeçalho e no corpo da página. */
export function AnalysisModeToggle({
  mode,
  setMode,
}: {
  mode: DashFilterMode;
  setMode: (m: DashFilterMode) => void;
}) {
  return (
    <div className="flex items-center bg-muted/50 rounded-xl p-0.5 gap-0.5">
      <button
        onClick={() => setMode('performance')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
          mode === 'performance'
            ? 'iam-gradient text-primary-foreground shadow-sm'
            : 'text-muted-foreground/60 hover:text-foreground'
        }`}
      >
        <Activity size={12} strokeWidth={1.8} /> Performance
      </button>
      <button
        onClick={() => setMode('historico')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
          mode === 'historico'
            ? 'bg-amber-500 text-white shadow-sm'
            : 'text-muted-foreground/60 hover:text-foreground'
        }`}
      >
        <Clock size={12} strokeWidth={1.8} /> Histórico
      </button>
    </div>
  );
}

export default function DashDateFilter({
  mode, setMode,
  perfPreset, setPerfPreset,
  perfCustomStart, setPerfCustomStart,
  perfCustomEnd, setPerfCustomEnd,
  historicoStart, setHistoricoStart,
  historicoEnd, setHistoricoEnd,
  variant = 'dashboard',
  hidePerformancePresets = false,
  moveModeToHeader = false,
}: Props) {
  const presetsToShow = variant === 'ac'
    ? ['todos', '1d', '2d', '3d', '7d', 'custom'] as PerfPreset[]
    : PERF_PRESETS;
  // Em Performance com os presets ocultos sobra só o seletor de modo; se ele
  // subiu para o cabeçalho, a caixa ficaria vazia no desktop.
  const soRestaOModo = hidePerformancePresets && mode === 'performance';

  return (
    <div
      className={`bg-card border border-border/60 rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 saas-shadow-md space-y-2.5 ${
        moveModeToHeader && soRestaOModo ? 'sm:hidden' : ''
      }`}
    >
      {/* Mode selector */}
      <div className={`flex items-center gap-3 flex-wrap ${moveModeToHeader ? 'sm:hidden' : ''}`}>
        <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Modo de análise
        </span>
        <AnalysisModeToggle mode={mode} setMode={setMode} />
      </div>

      {/* Performance presets */}
      {mode === 'performance' && !hidePerformancePresets && (
        <div className="flex items-center gap-2.5 flex-wrap">
          <CalendarDays size={13} strokeWidth={1.8} className="text-muted-foreground/40" />
          <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{variant === 'ac' ? 'Filtro Vencimento' : 'Período de referência'}</span>
          <div className="flex gap-1 flex-wrap">
            {presetsToShow.map((p) => (
              <button
                key={p}
                onClick={() => setPerfPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  perfPreset === p
                    ? 'iam-gradient text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted'
                }`}
              >
                {PERF_LABELS[p]}
              </button>
            ))}
          </div>
          {perfPreset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/60 font-medium">Início:</span>
              <input
                type="date"
                value={perfCustomStart}
                onChange={(e) => setPerfCustomStart(e.target.value)}
                className="input-field text-xs py-1 px-2 w-32"
              />
              <span className="text-[10px] text-muted-foreground/60 ml-2 font-medium">Fim:</span>
              <input
                type="date"
                value={perfCustomEnd}
                onChange={(e) => setPerfCustomEnd(e.target.value)}
                className="input-field text-xs py-1 px-2 w-32"
              />
            </div>
          )}
        </div>
      )}

      {/* Histórico: date range picker */}
      {mode === 'historico' && (
        <div className="flex items-center gap-2.5 flex-wrap">
          <CalendarDays size={13} strokeWidth={1.8} className="text-muted-foreground/40" />
          <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Período de referência</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60 font-medium">Início:</span>
            <input
              type="date"
              value={historicoStart}
              onChange={(e) => setHistoricoStart(e.target.value)}
              className="input-field text-xs py-1.5 px-2 w-36"
            />
            <span className="text-[10px] text-muted-foreground/60 ml-2 font-medium">Fim:</span>
            <input
              type="date"
              value={historicoEnd}
              onChange={(e) => setHistoricoEnd(e.target.value)}
              className="input-field text-xs py-1.5 px-2 w-36"
            />
          </div>
          {historicoStart && historicoEnd && (
            <span className="text-[10px] text-amber-600 font-medium">
              Foto do dia {new Date(historicoEnd + 'T12:00:00').toLocaleDateString('pt-BR')}
              {historicoStart !== historicoEnd
                ? ` (período desde ${new Date(historicoStart + 'T12:00:00').toLocaleDateString('pt-BR')})`
                : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
