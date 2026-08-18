import { ReactNode } from 'react';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  gradient?: boolean;
  trend?: { value: string; positive: boolean };
  colorAccent?: 'green' | 'yellow' | 'red' | 'gray' | 'fullGreen' | 'fullRed';
}

const accentStyles: Record<string, { border: string; indicator: string; bg?: string; text?: string }> = {
  green: { border: 'border-l-4 border-l-emerald-400', indicator: 'text-emerald-600' },
  yellow: { border: 'border-l-4 border-l-amber-400', indicator: 'text-amber-600' },
  red: { border: 'border-l-4 border-l-red-400', indicator: 'text-red-600' },
  gray: { border: 'border-l-4 border-l-slate-300', indicator: 'text-slate-500' },
  fullGreen: { border: '', indicator: '', bg: 'bg-emerald-500 border-emerald-500', text: 'text-white' },
  fullRed: { border: '', indicator: '', bg: 'bg-red-500 border-red-500', text: 'text-white' },
};

export default function KpiCard({ title, value, subtitle, icon, gradient, trend, colorAccent }: KpiCardProps) {
  const accent = colorAccent ? accentStyles[colorAccent] : null;
  const isFullColor = colorAccent === 'fullGreen' || colorAccent === 'fullRed';

  return (
    <div
      className={`rounded-2xl p-5 saas-shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
        gradient
          ? 'iam-gradient text-primary-foreground'
          : isFullColor
            ? `${accent?.bg} border`
            : `bg-card border border-border/60 ${accent?.border || ''}`
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <p className={`text-[8px] font-semibold uppercase tracking-wider ${
          gradient ? 'text-primary-foreground/70' : isFullColor ? 'text-white/80' : 'text-muted-foreground/70'
        }`}>
          {title}
        </p>
        {icon && <span className={`${
          gradient ? 'text-primary-foreground/40' : isFullColor ? 'text-white/50' : accent?.indicator || 'text-muted-foreground/30'
        }`}>{icon}</span>}
      </div>
      <p
        className={`font-bold tracking-tight leading-tight break-words ${
          value.length > 22
            ? 'text-[9px] xl:text-[11px]'
            : value.length > 19
              ? 'text-[11px] xl:text-[13px]'
              : value.length > 16
                ? 'text-[13px] xl:text-sm'
                : value.length > 13
                  ? 'text-sm xl:text-base'
                  : value.length > 11
                    ? 'text-base xl:text-lg'
                    : 'text-lg xl:text-[1.08rem]'
        } ${
          gradient ? '' : isFullColor ? 'text-white' : accent?.indicator || 'text-foreground'
        }`}
        title={value}
      >
        {value}
      </p>
      <div className="flex items-center justify-between mt-2">
        {subtitle && (
          <p className={`text-[9px] font-medium ${
            gradient ? 'text-primary-foreground/60' : isFullColor ? 'text-white/70' : 'text-muted-foreground/60'
          }`}>
            {subtitle}
          </p>
        )}
        {trend && (
          <span className={`text-[9px] font-semibold ${
            isFullColor ? 'text-white/90' : trend.positive ? 'text-emerald-500' : 'text-red-500'
          }`}>
            {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
