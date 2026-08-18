import { useEffect, useMemo, useState } from 'react';
import { Target, X, ChevronLeft } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';
import {
  GOAL_YEARS, MONTH_NAMES,
  getMonthMeta, getMonthWeekCount, getWeekSegments,
  setMonthlyMeta, setWeeklyMeta, clearMonthMeta,
  subscribeGoals, migrateLegacyIfNeeded,
} from '@/lib/estornosGoals';

/** Painel de configuração de metas de estornos (ano → mês → semana). */
export default function EstornosGoalsSection() {
  const [tick, setTick] = useState(0);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<number | null>(null); // 0-11

  useEffect(() => { migrateLegacyIfNeeded(); }, []);
  useEffect(() => subscribeGoals(() => setTick((t) => t + 1)), []);

  const yearTotals = useMemo(() => {
    const map: Record<number, number> = {};
    GOAL_YEARS.forEach((y) => {
      let sum = 0;
      for (let m = 0; m < 12; m++) sum += getMonthMeta(y, m).monthly;
      map[y] = sum;
    });
    return map;
     
  }, [tick]);

  return (
    <div className="mt-6 pt-5 border-t border-border/60">
      <div className="flex items-center gap-2 mb-1">
        <Target size={14} className="text-primary" />
        <h4 className="text-sm font-semibold text-foreground">Meta máxima de estornos</h4>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Defina a meta mensal por ano. Ao clicar em um mês, é possível personalizar a meta por semana — o sistema mantém a proporção automaticamente
        (meta mensal = soma das semanas; se apenas mensal for definida, é dividida igualmente entre as semanas do mês).
      </p>

      <div className="grid grid-cols-3 gap-3 max-w-md">
        {GOAL_YEARS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => { setOpenYear(y); setOpenMonth(null); }}
            className="rounded-2xl border border-border bg-card hover:border-primary hover:bg-primary/5 saas-shadow-sm p-4 text-left transition-all"
          >
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Ano</p>
            <p className="text-lg font-bold text-foreground">{y}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Total anual: <strong className="text-foreground">{formatCurrency(yearTotals[y] ?? 0)}</strong>
            </p>
          </button>
        ))}
      </div>

      {openYear != null && (
        <YearModal
          year={openYear}
          openMonth={openMonth}
          setOpenMonth={setOpenMonth}
          onClose={() => { setOpenYear(null); setOpenMonth(null); }}
        />
      )}
    </div>
  );
}

function YearModal({
  year, openMonth, setOpenMonth, onClose,
}: {
  year: number;
  openMonth: number | null;
  setOpenMonth: (m: number | null) => void;
  onClose: () => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeGoals(() => setTick((t) => t + 1)), []);

  const [monthlyDraft, setMonthlyDraft] = useState<string>('');
  useEffect(() => {
    if (openMonth != null) {
      const meta = getMonthMeta(year, openMonth);
      setMonthlyDraft(meta.monthly > 0 ? String(meta.monthly) : '');
    }
     
  }, [openMonth, year, tick]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-card border border-border p-5 saas-shadow-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {openMonth != null && (
              <button onClick={() => setOpenMonth(null)} className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted" title="Voltar aos meses">
                <ChevronLeft size={16} />
              </button>
            )}
            <Target size={14} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">
              Meta de Estornos — {openMonth != null ? `${MONTH_NAMES[openMonth]} / ${year}` : year}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {openMonth == null ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {MONTH_NAMES.map((name, idx) => {
              const meta = getMonthMeta(year, idx);
              const weeks = getMonthWeekCount(year, idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setOpenMonth(idx)}
                  className="rounded-xl border border-border hover:border-primary hover:bg-primary/5 p-3 text-left transition-all"
                >
                  <p className="text-xs font-semibold text-foreground">{name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{weeks} sem.</p>
                  <p className="text-[11px] font-bold text-primary mt-1">{formatCurrency(meta.monthly)}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <MonthEditor
            key={`${year}-${openMonth}-${tick}`}
            year={year}
            month={openMonth}
            monthlyDraft={monthlyDraft}
            setMonthlyDraft={setMonthlyDraft}
          />
        )}
      </div>
    </div>
  );
}

function MonthEditor({
  year, month, monthlyDraft, setMonthlyDraft,
}: {
  year: number; month: number;
  monthlyDraft: string; setMonthlyDraft: (v: string) => void;
}) {
  const meta = getMonthMeta(year, month);
  const segs = getWeekSegments(year, month);
  const [weekDrafts, setWeekDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    const d: Record<number, string> = {};
    meta.weekly.forEach((v, i) => { d[i + 1] = v > 0 ? String(v.toFixed(2)) : ''; });
    setWeekDrafts(d);
     
  }, [year, month]);

  const fmtSeg = (s: { start: Date; end: Date }) => {
    const p = (d: Date) => String(d.getDate()).padStart(2, '0');
    return `${p(s.start)}–${p(s.end)}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <label className="text-[10px] font-semibold uppercase text-muted-foreground">Meta mensal (R$)</label>
        <div className="flex gap-2 mt-1">
          <input
            type="number" min={0} step="0.01"
            value={monthlyDraft}
            onChange={(e) => setMonthlyDraft(e.target.value)}
            placeholder="Ex.: 50000"
            className="input-field text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => {
              const v = Math.max(0, Number(monthlyDraft.replace(',', '.')) || 0);
              setMonthlyMeta(year, month, v);
            }}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold"
          >
            Salvar mensal
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Ao salvar mensal, as {segs.length} semanas ficam com meta igual de <strong>{formatCurrency(segs.length > 0 ? (Number(monthlyDraft.replace(',', '.')) || 0) / segs.length : 0)}</strong>.
        </p>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Meta por semana (opcional)</p>
        <div className="space-y-1.5">
          {segs.map((s, i) => {
            const idx = i + 1;
            return (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-32 shrink-0">
                  Semana {idx} <span className="text-foreground/60">({fmtSeg(s)})</span>
                </span>
                <input
                  type="number" min={0} step="0.01"
                  value={weekDrafts[idx] ?? ''}
                  onChange={(e) => setWeekDrafts((d) => ({ ...d, [idx]: e.target.value }))}
                  placeholder="R$ 0,00"
                  className="input-field text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = Math.max(0, Number((weekDrafts[idx] ?? '').replace(',', '.')) || 0);
                    setWeeklyMeta(year, month, idx, v);
                  }}
                  className="px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 text-[11px] font-semibold"
                >
                  Salvar
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Total mensal atual (soma das semanas): <strong className="text-foreground">{formatCurrency(meta.monthly)}</strong>
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => clearMonthMeta(year, month)}
          className="text-xs font-medium text-rose-600 hover:underline"
        >
          Remover meta deste mês
        </button>
      </div>
    </div>
  );
}
