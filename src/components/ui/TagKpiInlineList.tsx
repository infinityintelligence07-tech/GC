import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import { toShortName, shortNameFontClass } from '@/lib/utils';

type Preset = 'todos' | 'hoje' | 'amanha' | '5d' | 'vencidos' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'hoje', label: 'Hoje' },
  { key: 'amanha', label: 'Amanhã' },
  { key: '5d', label: 'Próx. 5 dias' },
  { key: 'vencidos', label: 'Vencidos' },
];

interface Props {
  label: string;
  students: Student[];
  onFilteredIdsChange?: (ids: string[]) => void;
  onClose: () => void;
}

export default function TagKpiInlineList({ label, students, onFilteredIdsChange, onClose }: Props) {
  const [preset, setPreset] = useState<Preset>('todos');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const rows = useMemo(() => {
    const today = getTodayBrasilia();
    const todayMs = today.getTime();
    const dayMs = 86400000;

    const inRange = (dueDate: string) => {
      const t = new Date(dueDate + 'T00:00:00').getTime();
      switch (preset) {
        case 'hoje':
          return t === todayMs;
        case 'amanha':
          return t === todayMs + dayMs;
        case '5d':
          return t >= todayMs && t <= todayMs + 5 * dayMs;
        case 'vencidos':
          return t < todayMs;
        case 'custom': {
          const s = start ? new Date(start + 'T00:00:00').getTime() : -Infinity;
          const e = end ? new Date(end + 'T00:00:00').getTime() : Infinity;
          return t >= s && t <= e;
        }
        default:
          return true;
      }
    };

    const out: { student: Student; dueDate: string; value: number; overdue: boolean }[] = [];
    students.forEach((s) => {
      (s.installments || []).forEach((i) => {
        if (i.paid || !inRange(i.dueDate)) return;
        out.push({
          student: s,
          dueDate: i.dueDate,
          value: i.value || 0,
          overdue: new Date(i.dueDate + 'T00:00:00').getTime() < todayMs,
        });
      });
    });
    out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return out;
  }, [students, preset, start, end]);

  const filteredIds = useMemo(() => Array.from(new Set(rows.map((r) => r.student.id))), [rows]);
  const idsKey = filteredIds.join(',');
  useEffect(() => {
    onFilteredIdsChange?.(filteredIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  useEffect(() => () => onFilteredIdsChange?.([]), []);

  const total = rows.reduce((a, r) => a + r.value, 0);
  const uniqueStudents = new Set(rows.map((r) => r.student.id)).size;

  return (
    <div className="rounded-2xl bg-card border border-border saas-shadow-md p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">Alunos — {label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {uniqueStudents} alunos · {rows.length} parcelas · Total {formatCurrency(total)}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
              preset === p.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="date"
            value={start}
            onChange={(e) => { setStart(e.target.value); setPreset('custom'); }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-[11px]"
          />
          <span className="text-[11px] text-muted-foreground">até</span>
          <input
            type="date"
            value={end}
            onChange={(e) => { setEnd(e.target.value); setPreset('custom'); }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-[11px]"
          />
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr className="text-left text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Aluno</th>
              <th className="px-3 py-2 font-semibold">Vencimento</th>
              <th className="px-3 py-2 font-semibold text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  Nenhuma parcela no período selecionado.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => (
              <tr key={`${r.student.id}-${r.dueDate}-${idx}`} className="border-t border-border">
                <td className={`px-3 py-2 truncate max-w-[240px] ${shortNameFontClass(r.student.name)}`} title={r.student.name}>
                  {toShortName(r.student.name)}
                </td>
                <td className={`px-3 py-2 ${r.overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                  {new Date(r.dueDate + 'T00:00:00').toLocaleDateString('pt-BR')}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
