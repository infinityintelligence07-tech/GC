interface FunnelStage {
  label: string;
  count: number;
  color: string;
  percentage: number;
}

interface CancellationFunnelDesignProps {
  stages: FunnelStage[];
  total: number;
}

export default function CancellationFunnelDesign({ stages, total }: CancellationFunnelDesignProps) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  const getUrgencyColor = (index: number): string => {
    if (index === 0) return 'from-blue-500 to-blue-600';
    if (index === 1) return 'from-amber-500 to-amber-600';
    if (index === 2) return 'from-slate-500 to-slate-600';
    if (index === 3) return 'from-rose-600 to-red-700';
    return 'from-emerald-500 to-emerald-600';
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-6">Funil de Cancelamentos</h3>

      <div className="space-y-3">
        {stages.map((stage, idx) => {
          const widthPercent = total > 0 ? (stage.count / maxCount) * 100 : 100;
          const urgencyColor = getUrgencyColor(idx);

          return (
            <div key={stage.label} className="flex flex-col">
              <div className="flex items-center gap-4">
                <div className="w-32 flex-shrink-0">
                  <p className="text-xs font-semibold text-foreground truncate">{stage.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{stage.count} caso{stage.count !== 1 ? 's' : ''}</p>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="relative h-10 bg-muted/30 rounded-lg overflow-hidden group">
                    <div
                      className={`h-full bg-gradient-to-r ${urgencyColor} transition-all duration-500 ease-out flex items-center justify-end pr-3`}
                      style={{ width: `${widthPercent}%` }}
                    >
                      {widthPercent > 20 && (
                        <span className="text-xs font-bold text-white drop-shadow-sm">
                          {stage.percentage}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="w-12 flex-shrink-0 text-right">
                  <p className="text-sm font-bold text-foreground">{stage.percentage}%</p>
                </div>
              </div>

              {idx < stages.length - 1 && (
                <div className="h-1 bg-gradient-to-b from-muted/20 to-transparent mt-2 mb-1" />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-[11px] text-muted-foreground">
          Total de {total} caso{total !== 1 ? 's' : ''} em pipeline
        </p>
      </div>
    </div>
  );
}
