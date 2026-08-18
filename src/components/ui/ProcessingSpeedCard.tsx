import { Activity } from 'lucide-react';
import { CancellationCase } from '@/types';
import { calculateProcessingSpeed } from '@/store/useAppStore';

interface ProcessingSpeedCardProps {
  cancellationCases: CancellationCase[];
  compact?: boolean;
}

export default function ProcessingSpeedCard({ cancellationCases, compact = false }: ProcessingSpeedCardProps) {
  const metrics = calculateProcessingSpeed(cancellationCases);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
        <Activity size={12} className="text-blue-600" />
        <div>
          <p className="text-[10px] text-blue-700 font-semibold uppercase">Status Ações</p>
          <p className="text-xs font-bold text-blue-900">{metrics.totalActive} ativos</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 saas-shadow">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={14} className="text-blue-500" />
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Velocidade de Processamento
        </h3>
        <span className="ml-auto text-sm font-bold text-blue-600">
          {metrics.totalActive} ativo{metrics.totalActive === 1 ? '' : 's'}
        </span>
      </div>

      {/* Tempo médio por coluna do funil */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {metrics.columnStatus.map(({ stage, label, avgDays }) => (
          <div key={stage} className="p-3 bg-muted/40 rounded-lg border border-border/50">
            <p className="text-[10px] text-muted-foreground font-semibold truncate mb-2" title={label}>{label}</p>
            <p className="text-sm font-bold text-blue-600" title="Tempo médio de permanência na coluna">
              {avgDays}d
              <span className="text-[10px] font-medium text-muted-foreground"> em média</span>
            </p>
          </div>
        ))}
      </div>

      {/* Ciclo completo: entrada na coluna Entrada → saída de Distrato do Contrato */}
      <div className="mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50/60 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">Tempo médio total do fluxo</p>
          <p className="text-[10px] text-muted-foreground">Da chegada em Entrada até a saída de Distrato do Contrato</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-blue-700 leading-none">{metrics.cycleAvgDays}d</p>
          <p className="text-[10px] text-muted-foreground">em média</p>
        </div>
      </div>
    </div>
  );
}
