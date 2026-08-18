import { useEffect, useMemo, useState } from 'react';
import { Trophy, TrendingUp, CalendarDays, X } from 'lucide-react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { useCommissionsStore } from '@/store/useCommissionsStore';
import { computeAcReversalMetrics } from '@/lib/acReversalMetrics';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import MetaGauge from '@/components/ui/MetaGauge';

/**
 * Espelho em tempo real do ranking de reversões da aba Comissões.
 * Lê as mesmas stores, então qualquer atualização lá reflete aqui.
 * Layout idêntico ao Ranking Por Liquidez % (alunos) do Dashboard.
 */
export default function ReversalRankingMirror() {
  const { acs, cancellationCases, rules } = useAppStore();
  const { commissions, loaded, loadAll } = useCommissionsStore();
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [activePreset, setActivePreset] = useState<'este-mes' | 'mes-passado' | null>(null);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  const acStats = useMemo(() => {
    const metrics = computeAcReversalMetrics({
      cancellationCases, commissions, acs, rules,
      dateStart,
      dateEnd,
    });
    return metrics
      .filter((m) => m.inscricoesTotal > 0)
      .sort((a, b) => b.financeiroRevertido - a.financeiroRevertido || b.reversalPercent - a.reversalPercent);
  }, [cancellationCases, commissions, acs, rules, dateStart, dateEnd]);

  if (acStats.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
        <Header
          dateStart={dateStart}
          dateEnd={dateEnd}
          setDateStart={setDateStart}
          setDateEnd={setDateEnd}
          activePreset={activePreset}
          setActivePreset={setActivePreset}
        />
        <p className="text-xs text-muted-foreground text-center py-10">
          Sem dados suficientes para gerar o ranking. Reverta alunos em <b>Em Tratativas</b> para gerar comissões.
        </p>
      </div>
    );
  }

  const podium = acStats.slice(0, 3);
  const rest = acStats.slice(3);

  const second = podium[1];
  const first = podium[0];
  const third = podium[2];
  const visualOrder = [second, first, third].filter(Boolean) as typeof podium;

  return (
    <div className="relative overflow-hidden bg-card border border-border rounded-2xl p-6 saas-shadow">
      <Header
        dateStart={dateStart}
        dateEnd={dateEnd}
        setDateStart={setDateStart}
        setDateEnd={setDateEnd}
        activePreset={activePreset}
        setActivePreset={setActivePreset}
      />

      {/* Pódio */}
      <div className="relative mt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-72 h-64 rounded-full blur-3xl opacity-25 dark:opacity-35"
          style={{ background: 'radial-gradient(circle, hsl(38 45% 65% / 0.55), transparent 70%)' }}
        />

        <div className="relative flex items-end justify-center gap-4 sm:gap-8 pb-1">
          {visualOrder.map((m) => {
            const place = m.acName === first?.acName ? 1 : m.acName === second?.acName ? 2 : 3;
            return <PodiumColumn key={m.acName} metric={m} place={place} />;
          })}
        </div>

        <div
          aria-hidden
          className="absolute left-6 right-6 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
        />
      </div>

      {/* Demais posições */}
      {rest.length > 0 && (
        <div className="mt-10 pt-5 border-t border-border/60">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Demais posições
          </p>
          <ul className="space-y-1.5">
            {rest.map((m, idx) => {
              const place = idx + 4;
              return (
                <li
                  key={m.acName}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/60 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-[11px] font-bold flex items-center justify-center">
                    {place}
                  </span>
                  {m.acPhoto ? (
                    <img
                      src={m.acPhoto}
                      alt={m.acName}
                      className="w-8 h-8 rounded-full object-cover border border-border"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground border border-border">
                      {m.acName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{m.acName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {m.inscricoesRevertidas} revertidas / {m.inscricoesTotal} {m.inscricoesTotal === 1 ? 'inscrição' : 'inscrições'}
                    </p>
                  </div>
                  <MetaGauge
                    value={m.reversalPercent}
                    meta1={m.meta1}
                    meta2={m.meta2}
                    meta3={m.meta3}
                    size={70}
                    showLabel={false}
                  />
                  <RateBadge rate={m.reversalPercent} />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rodapé — fórmula */}
      <p className="mt-5 text-[10px] text-muted-foreground text-center">
        Reversão % = Inscrições revertidas ÷ Inscrições para cancelamento · Ranking por valor revertido
      </p>
    </div>
  );
}

interface HeaderProps {
  dateStart: string;
  dateEnd: string;
  setDateStart: (v: string) => void;
  setDateEnd: (v: string) => void;
  activePreset: 'este-mes' | 'mes-passado' | null;
  setActivePreset: (p: 'este-mes' | 'mes-passado' | null) => void;
}

function Header({ dateStart, dateEnd, setDateStart, setDateEnd, activePreset, setActivePreset }: HeaderProps) {
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const applyPreset = (preset: 'este-mes' | 'mes-passado') => {
    const today = getTodayBrasilia();
    if (preset === 'este-mes') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setDateStart(fmt(start));
      setDateEnd(fmt(today));
    } else {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      setDateStart(fmt(start));
      setDateEnd(fmt(end));
    }
    setActivePreset(preset);
  };

  const clearDates = () => {
    setDateStart('');
    setDateEnd('');
    setActivePreset(null);
  };

  const hasFilter = Boolean(dateStart || dateEnd);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(38_40%_55%/0.12)] flex items-center justify-center shrink-0">
          <Trophy size={20} className="text-[hsl(36_45%_55%)]" strokeWidth={1.8} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground tracking-tight">Ranking</h3>
          <p className="text-[10px] text-muted-foreground">de reversões</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => applyPreset('este-mes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activePreset === 'este-mes'
                ? 'iam-gradient text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Este mês
          </button>
          <button
            onClick={() => applyPreset('mes-passado')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activePreset === 'mes-passado'
                ? 'iam-gradient text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            Mês passado
          </button>
        </div>

        <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2.5 py-1.5">
          <CalendarDays size={12} className="text-muted-foreground" />
          <input
            type="date"
            value={dateStart}
            onChange={(e) => { setDateStart(e.target.value); setActivePreset(null); }}
            className="bg-transparent border-none p-0 text-xs focus:ring-0 w-[110px]"
          />
          <span className="text-xs text-muted-foreground">—</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => { setDateEnd(e.target.value); setActivePreset(null); }}
            className="bg-transparent border-none p-0 text-xs focus:ring-0 w-[110px]"
          />
        </div>

        {hasFilter && (
          <button
            onClick={clearDates}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Limpar filtro de data"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function RateBadge({ rate }: { rate: number }) {
  const tone =
    rate >= 80
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
      : rate >= 60
        ? 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
        : 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${tone}`}>
      <TrendingUp size={10} strokeWidth={2.2} />
      {rate.toFixed(1).replace('.', ',')}%
    </span>
  );
}

interface PodiumColumnProps {
  metric: {
    acName: string;
    acPhoto?: string;
    inscricoesTotal: number;
    inscricoesRevertidas: number;
    financeiroRevertido: number;
    reversalPercent: number;
    meta1: number;
    meta2: number;
    meta3: number;
  };
  place: 1 | 2 | 3;
}

function PodiumColumn({ metric: m, place }: PodiumColumnProps) {
  const palette = {
    1: {
      ringStyle: { boxShadow: '0 0 0 3px hsl(38 50% 60%), 0 0 28px -4px hsl(38 55% 55% / 0.55)' },
      cylinderTop: 'hsl(40 55% 78%)',
      cylinderMid: 'hsl(38 48% 60%)',
      cylinderBot: 'hsl(34 38% 38%)',
      cylinderEdge: 'hsl(38 45% 50%)',
      podiumHeight: 'h-28',
      avatarSize: 'w-24 h-24 sm:w-28 sm:h-28',
      badgeBg: 'bg-[hsl(38_50%_60%)] text-[hsl(36_60%_15%)]',
      badgeRing: 'ring-2 ring-[hsl(40_60%_75%)]',
      nameClass: 'text-base sm:text-lg font-bold text-foreground',
      valueColor: 'hsl(36 50% 45%)',
      darkValueColor: 'hsl(40 55% 70%)',
      wrapper: 'order-2 z-10',
    },
    2: {
      ringStyle: { boxShadow: '0 0 0 2px hsl(220 12% 70%)' },
      cylinderTop: 'hsl(220 14% 88%)',
      cylinderMid: 'hsl(220 12% 72%)',
      cylinderBot: 'hsl(220 10% 48%)',
      cylinderEdge: 'hsl(220 10% 60%)',
      podiumHeight: 'h-20',
      avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
      badgeBg: 'bg-[hsl(220_12%_75%)] text-[hsl(220_25%_25%)]',
      badgeRing: 'ring-2 ring-[hsl(220_15%_85%)]',
      nameClass: 'text-sm sm:text-base font-semibold text-foreground',
      valueColor: 'hsl(220 12% 45%)',
      darkValueColor: 'hsl(220 15% 75%)',
      wrapper: 'order-1',
    },
    3: {
      ringStyle: { boxShadow: '0 0 0 2px hsl(22 40% 55%)' },
      cylinderTop: 'hsl(22 45% 70%)',
      cylinderMid: 'hsl(22 42% 52%)',
      cylinderBot: 'hsl(20 35% 32%)',
      cylinderEdge: 'hsl(22 40% 45%)',
      podiumHeight: 'h-14',
      avatarSize: 'w-20 h-20 sm:w-24 sm:h-24',
      badgeBg: 'bg-[hsl(22_42%_55%)] text-[hsl(22_60%_15%)]',
      badgeRing: 'ring-2 ring-[hsl(22_45%_70%)]',
      nameClass: 'text-sm sm:text-base font-semibold text-foreground',
      valueColor: 'hsl(22 45% 42%)',
      darkValueColor: 'hsl(22 50% 65%)',
      wrapper: 'order-3',
    },
  }[place];

  return (
    <div className={`flex flex-col items-center flex-1 max-w-[180px] ${palette.wrapper}`}>
      <div className="relative">
        {m.acPhoto ? (
          <img
            src={m.acPhoto}
            alt={m.acName}
            className={`${palette.avatarSize} rounded-full object-cover bg-muted`}
            style={palette.ringStyle}
          />
        ) : (
          <div
            className={`${palette.avatarSize} rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center text-2xl font-bold text-muted-foreground`}
            style={palette.ringStyle}
          >
            {m.acName.charAt(0).toUpperCase()}
          </div>
        )}
        <span
          className={`absolute -top-2 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full ${palette.badgeBg} ${palette.badgeRing} text-xs font-extrabold flex items-center justify-center shadow-md`}
        >
          {place}
        </span>
      </div>

      <div className="mt-3 text-center min-w-0 w-full">
        <p className={`${palette.nameClass} truncate`}>{m.acName}</p>
        <p
          className="mt-0.5 text-base sm:text-lg font-bold tabular-nums"
          style={{ color: `var(--ranking-value, ${palette.valueColor})` }}
        >
          <span className="dark:hidden">{formatCurrency(m.financeiroRevertido)}</span>
          <span className="hidden dark:inline" style={{ color: palette.darkValueColor }}>
            {formatCurrency(m.financeiroRevertido)}
          </span>
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
          {m.inscricoesRevertidas} / {m.inscricoesTotal} {m.inscricoesTotal === 1 ? 'inscrição' : 'inscrições'}
        </p>
      </div>

      <div className="mt-2">
        <MetaGauge
          value={m.reversalPercent}
          meta1={m.meta1}
          meta2={m.meta2}
          meta3={m.meta3}
          size={place === 1 ? 150 : 130}
          showLabel={false}
        />
      </div>
      <Cylinder
        height={palette.podiumHeight}
        topColor={palette.cylinderTop}
        midColor={palette.cylinderMid}
        botColor={palette.cylinderBot}
        edgeColor={palette.cylinderEdge}
        place={place}
      />
    </div>
  );
}

function Cylinder({
  height,
  topColor,
  midColor,
  botColor,
  edgeColor,
  place,
}: {
  height: string;
  topColor: string;
  midColor: string;
  botColor: string;
  edgeColor: string;
  place: number;
}) {
  return (
    <div className="relative mt-4 w-full">
      <div
        aria-hidden
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[85%] h-3 rounded-[50%] blur-md opacity-40"
        style={{ background: 'hsl(220 20% 15% / 0.45)' }}
      />
      <div className={`relative w-full ${height}`}>
        <div
          className="absolute inset-0 rounded-b-md overflow-hidden"
          style={{
            background: `linear-gradient(180deg, ${midColor} 0%, ${midColor} 55%, ${botColor} 100%)`,
            boxShadow: `inset 0 -4px 12px ${botColor}, inset 0 0 0 1px ${edgeColor}`,
          }}
        >
          <div
            className="absolute top-0 bottom-0 left-0 w-[18%]"
            style={{ background: `linear-gradient(90deg, ${topColor}40 0%, transparent 100%)` }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 w-[20%]"
            style={{ background: `linear-gradient(270deg, ${botColor}55 0%, transparent 100%)` }}
          />
          <span
            className="absolute inset-0 flex items-center justify-center text-white/90 font-bold tracking-wide drop-shadow-sm"
            style={{ fontSize: place === 1 ? '0.9rem' : '0.78rem' }}
          >
            {place}º
          </span>
        </div>
        <div
          className="absolute -top-[10px] left-0 right-0 h-[20px] rounded-[50%]"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${topColor} 0%, ${midColor} 75%, ${edgeColor} 100%)`,
            boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.4), inset 0 -2px 4px ${edgeColor}`,
          }}
        />
      </div>
    </div>
  );
}
