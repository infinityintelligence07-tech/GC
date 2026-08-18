import { AlertTriangle, TrendingDown } from 'lucide-react';
import { Student } from '@/types';
import { calculateChurnRisk } from '@/store/useAppStore';

interface ChurnRiskCardProps {
  students: Student[];
  compact?: boolean; // para dashboard compacta
}

export default function ChurnRiskCard({ students, compact = false }: ChurnRiskCardProps) {
  const atRiskStudents = students
    .map(s => ({ ...s, churnRisk: calculateChurnRisk(s) }))
    .filter(s => s.churnRisk.score >= 70) // High risk: 70+
    .sort((a, b) => b.churnRisk.score - a.churnRisk.score)
    .slice(0, compact ? 3 : 10);

  if (compact && atRiskStudents.length === 0) {
    return null;
  }

  return (
    <div className={`bg-card border border-border rounded-xl p-4 saas-shadow ${compact ? '' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown size={14} className="text-red-500" />
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          {compact ? 'Risco Churn' : 'Alunos em Risco de Churn'}
        </h3>
        {atRiskStudents.length > 0 && (
          <span className="ml-auto text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded">
            {atRiskStudents.length}
          </span>
        )}
      </div>

      {atRiskStudents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum aluno em risco detectado.</p>
      ) : (
        <div className={`space-y-2 ${compact ? 'max-h-48 overflow-y-auto' : ''}`}>
          {atRiskStudents.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded-lg"
            >
              <AlertTriangle
                size={12}
                className={`text-red-600 shrink-0 ${
                  s.churnRisk.score >= 90 ? 'fill-red-600' : ''
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-red-900 truncate">
                  {s.name}
                </p>
                <p className="text-[9px] text-red-700 truncate">
                  {s.churnRisk.reason}
                </p>
              </div>
              <span className="text-[10px] font-bold text-white bg-red-600 px-2 py-0.5 rounded whitespace-nowrap">
                {s.churnRisk.score}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
