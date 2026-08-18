import { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { TrendingUp } from 'lucide-react';
import { getTodayBrasilia } from '@/lib/brasiliaDate';

interface ForecastPeriod {
  label: string;
  days: number;
  value: number;
}

interface PaymentForecastCardProps {
  students: Student[];
}

export default function PaymentForecastCard({ students }: PaymentForecastCardProps) {
  const today = getTodayBrasilia();

  const periods: ForecastPeriod[] = [
    { label: 'Hoje', days: 0, value: 0 },
    { label: 'Amanhã', days: 1, value: 0 },
    { label: '2 Dias', days: 2, value: 0 },
    { label: '3 Dias', days: 3, value: 0 },
    { label: '5 Dias', days: 5, value: 0 },
    { label: '15 Dias', days: 15, value: 0 },
    { label: '30 Dias', days: 30, value: 0 },
  ];

  periods.forEach((period) => {
    const startOfDay = new Date(today);
    const endOfDay = new Date(today);
    endOfDay.setDate(endOfDay.getDate() + period.days);
    endOfDay.setHours(23, 59, 59, 999);

    students.forEach((student) => {
      student.installments.forEach((installment) => {
        if (!installment.paid) {
          const dueDate = new Date(installment.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          if (dueDate >= startOfDay && dueDate <= endOfDay) {
            period.value += installment.value;
          }
        }
      });
    });
  });

  const maxValue = Math.max(...periods.map((p) => p.value), 1);

  return (
    <div className="bg-card border border-border rounded-2xl p-6 saas-shadow">
      <div className="flex items-center gap-2 mb-5">
        <TrendingUp size={16} className="text-emerald-600" />
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Previsão de Recebimento</h3>
      </div>

      <div className="space-y-3">
        {periods.map((period) => {
          const percentage = maxValue > 0 ? (period.value / maxValue) * 100 : 0;

          return (
            <div key={period.label} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">{period.label}</span>
                <span className="text-sm font-bold text-emerald-600">{formatCurrency(period.value)}</span>
              </div>

              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500 ease-out"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Total esperado (30 dias)</p>
          <p className="text-base font-bold text-emerald-600">
            {formatCurrency(periods[periods.length - 1].value)}
          </p>
        </div>
      </div>
    </div>
  );
}
