import { TrendingUp, RotateCcw } from 'lucide-react';
import { Student, CancellationCase } from '@/types';
import { calculateRendaExtraMetrics } from '@/store/useAppStore';

interface RendaExtraMetricsCardProps {
  students: Student[];
  cancellationCases: CancellationCase[];
}

export default function RendaExtraMetricsCard({ students, cancellationCases }: RendaExtraMetricsCardProps) {
  const metrics = calculateRendaExtraMetrics(students, cancellationCases);

  return (
    <div className="flex gap-2 flex-wrap">
      {/* Renda Extra Direcionados */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
        <TrendingUp size={12} className="text-blue-600" />
        <div>
          <p className="text-[10px] text-blue-700 font-semibold uppercase">Renda Extra</p>
          <p className="text-xs font-bold text-blue-900">{metrics.directedToRendaExtra}</p>
        </div>
      </div>

      {/* Cancelamentos Revertidos */}
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
        <RotateCcw size={12} className="text-emerald-600" />
        <div>
          <p className="text-[10px] text-emerald-700 font-semibold uppercase">Revertidos</p>
          <p className="text-xs font-bold text-emerald-900">
            {metrics.revertedCancellations}/{metrics.totalCancellationCases}
          </p>
        </div>
      </div>

      {/* Taxa de Reversão */}
      {metrics.reversionRate > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <div>
            <p className="text-[10px] text-purple-700 font-semibold uppercase">Taxa Rev.</p>
            <p className="text-xs font-bold text-purple-900">{metrics.reversionRate}%</p>
          </div>
        </div>
      )}
    </div>
  );
}
