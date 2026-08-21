import { useMemo, useState } from 'react';
import { Activity, History, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAppStore, calculateAutoStatus, calculateAutoStatusAt } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import ACRankingCard from '@/components/ui/ACRankingCard';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getHiddenFromAcPortfolioKeys, studentsForAcRanking } from '@/lib/acPortfolioVisibility';
import type { Student, ConciliacaoItem } from '@/types';

/**
 * Quantidade de alunos distintos transferidos por Renegociação por AC,
 * opcionalmente dentro de um intervalo. Considera os itens de conciliação
 * do tipo `parcela_quantidade` (registrados no fluxo de Renegociação).
 */
function computeRenegByAc(
  items: ConciliacaoItem[],
  range?: { start?: Date; end: Date },
): Record<string, number> {
  const sets: Record<string, Set<string>> = {};
  items.forEach((it) => {
    if (it.tipo !== 'parcela_quantidade') return;
    if (!it.ac) return;
    if (range) {
      const created = new Date(it.createdAt);
      if (range.start && created < range.start) return;
      if (created > range.end) return;
    }
    const key = it.studentId || it.studentName;
    if (!key) return;
    (sets[it.ac] ??= new Set()).add(key);
  });
  const map: Record<string, number> = {};
  Object.entries(sets).forEach(([k, v]) => (map[k] = v.size));
  return map;
}

type RankingMode = 'performance' | 'historico';

function firstDayOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

export default function RankingPage() {
  const { acs, students, cancellationCases } = useAppStore();
  const conciliacaoItems = useConciliacaoStore((s) => s.items);

  const [mode, setMode] = useState<RankingMode>('performance');
  const [startDate, setStartDate] = useState<Date | undefined>(firstDayOfMonth());
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  const hiddenKeys = useMemo(
    () => getHiddenFromAcPortfolioKeys(cancellationCases, conciliacaoItems, students),
    [cancellationCases, conciliacaoItems, students],
  );

  const performanceStudents: Student[] = useMemo(
    () =>
      studentsForAcRanking(
        students.map((s) =>
          s.statusMode === 'Automático' &&
          s.status !== 'Negativado' &&
          s.status !== 'Solicitação Cancelamento'
            ? { ...s, status: calculateAutoStatus(s.installments) }
            : s,
        ),
        hiddenKeys,
      ),
    [students, hiddenKeys],
  );

  const historicoStudents: Student[] = useMemo(() => {
    if (!endDate) return [];
    const ref = endOfDay(endDate);
    return studentsForAcRanking(
      students
        .filter((s) => {
          if (!s.enrollmentDate) return true;
          const enroll = new Date(s.enrollmentDate + 'T00:00:00');
          return enroll <= ref;
        })
        .map((s) => ({
          ...s,
          status:
            s.status === 'Negativado' || s.status === 'Solicitação Cancelamento'
              ? s.status
              : calculateAutoStatusAt(s.installments, ref),
        })),
      hiddenKeys,
    );
  }, [students, endDate, hiddenKeys]);

  const dataset = mode === 'performance' ? performanceStudents : historicoStudents;
  const referenceDate = mode === 'historico' && endDate ? endOfDay(endDate) : undefined;

  const renegByAc = useMemo(() => {
    if (mode === 'historico' && endDate) {
      return computeRenegByAc(conciliacaoItems, {
        start: startDate ?? undefined,
        end: endOfDay(endDate),
      });
    }
    return computeRenegByAc(conciliacaoItems);
  }, [conciliacaoItems, mode, startDate, endDate]);

  return (
    <div className="space-y-6">
      {/* Toolbar — Modo de análise */}
      <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Modo de análise
            </p>
            <h3 className="text-sm font-semibold text-foreground mt-0.5">
              {mode === 'performance' ? 'Performance' : 'Histórico'}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {mode === 'performance'
                ? 'Dados ao vivo, com base nos filtros correntes do sistema.'
                : 'Snapshot reconstruído com os dados congelados na data final do período.'}
            </p>
          </div>

          {/* Seletor de modo */}
          <div className="inline-flex items-center bg-muted/60 border border-border rounded-xl p-1 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setMode('performance')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                mode === 'performance'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Activity size={13} />
              Performance
            </button>
            <button
              type="button"
              onClick={() => setMode('historico')}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                mode === 'historico'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <History size={13} />
              Histórico
            </button>
          </div>
        </div>

        {/* Filtro de período (somente Histórico) */}
        {mode === 'historico' && (
          <div className="mt-4 pt-4 border-t border-border/60 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                De
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[180px] justify-start text-left font-normal text-xs',
                      !startDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {startDate ? format(startDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecione'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    locale={ptBR}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Até
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-[180px] justify-start text-left font-normal text-xs',
                      !endDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {endDate ? format(endDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecione'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    locale={ptBR}
                    initialFocus
                    className={cn('p-3 pointer-events-auto')}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <p className="text-[11px] text-muted-foreground sm:ml-2 sm:pb-2">
              O ranking é reconstruído usando o status de cada aluno na data final selecionada.
            </p>
          </div>
        )}
      </div>

      <ACRankingCard acs={acs} students={dataset} referenceDate={referenceDate} renegByAc={renegByAc} />
    </div>
  );
}
