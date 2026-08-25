import { useState } from 'react';
import { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { getTodayBrasilia } from '@/lib/brasiliaDate';

import { resolveStudentDisplayStatus, getOperationalPendenteInstallments } from '@/lib/studentDisplayStatus';

export type KpiValueMode = 'unpaid' | 'overdue' | 'operational_pendente';

export default function KpiStudentsModal({
  title,
  students,
  instInRange,
  valueMode,
  todayMs,
  onClose,
}: {
  title: string;
  students: Student[];
  instInRange: (i: { dueDate: string }) => boolean;
  valueMode: KpiValueMode;
  todayMs: number;
  onClose: () => void;
}) {
  type Row = { studentId: string; studentName: string; ac: string; status: string; installmentNumber: number; dueDate: string; value: number };
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const allRows: Row[] = [];
  students.forEach((s) => {
    const source =
      valueMode === 'operational_pendente'
        ? getOperationalPendenteInstallments(s)
        : s.installments;
    const unpaid = source.filter((i) => {
      if (i.paid || !instInRange(i)) return false;
      if (valueMode === 'overdue') {
        return new Date(i.dueDate + 'T00:00:00').getTime() < todayMs;
      }
      return true;
    });
    unpaid.forEach((i) => {
      allRows.push({
        studentId: s.id,
        studentName: s.name,
        ac: s.ac || '—',
        status: resolveStudentDisplayStatus(s),
        installmentNumber: i.number,
        dueDate: i.dueDate,
        value: i.value,
      });
    });
  });
  const rows = allRows.filter((r) => {
    if (dateFrom && (!r.dueDate || r.dueDate < dateFrom)) return false;
    if (dateTo && (!r.dueDate || r.dueDate > dateTo)) return false;
    return true;
  });
  const studentCount = new Set(rows.map((r) => r.studentId)).size;
  rows.sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.studentName.localeCompare(b.studentName);
  });
  const total = rows.reduce((acc, r) => acc + r.value, 0);
  const fmtDate = (iso: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const isoOffset = (days: number) => {
    const d = getTodayBrasilia();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };
  const setPreset = (from: string, to: string) => { setDateFrom(from); setDateTo(to); };
  const presetActive = (from: string, to: string) => dateFrom === from && dateTo === to;
  const presets: { label: string; from: string; to: string }[] = [
    { label: 'Todos', from: '', to: '' },
    { label: 'Hoje', from: isoOffset(0), to: isoOffset(0) },
    { label: 'Amanhã', from: isoOffset(1), to: isoOffset(1) },
    { label: 'Próx. 7 dias', from: isoOffset(0), to: isoOffset(7) },
    { label: 'Vencidos', from: '', to: isoOffset(-1) },
  ];
  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl border border-border flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {studentCount} {studentCount === 1 ? 'aluno' : 'alunos'} · {rows.length} {valueMode === 'operational_pendente' ? 'pendência(s)' : 'parcela(s)'} · Total: <span className="font-semibold text-primary">{formatCurrency(total)}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground" aria-label="Fechar">✕</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border bg-muted/30">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.from, p.to)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${presetActive(p.from, p.to) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-[11px] bg-card border border-border rounded-lg px-2 py-1.5 text-foreground" />
            <span className="text-[11px] text-muted-foreground">até</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-[11px] bg-card border border-border rounded-lg px-2 py-1.5 text-foreground" />
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2">Aluno</th>
                <th className="text-left font-semibold px-4 py-2">AC</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                <th className="text-center font-semibold px-4 py-2">Parc.</th>
                <th className="text-left font-semibold px-4 py-2">Vencimento</th>
                <th className="text-right font-semibold px-4 py-2">{valueMode === 'operational_pendente' ? 'Valor Pendência' : 'Valor Parcela'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhum registro.</td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.studentId}-${r.installmentNumber}-${idx}`} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2 text-foreground font-medium">{r.studentName}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.ac}</td>
                    <td className="px-4 py-2">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-muted text-foreground border border-border">{r.status}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-center text-muted-foreground tabular-nums">{r.installmentNumber || '—'}</td>
                    <td className="px-4 py-2 text-xs text-foreground tabular-nums">{fmtDate(r.dueDate)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-foreground tabular-nums">{r.value > 0 ? formatCurrency(r.value) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-muted/70 backdrop-blur border-t border-border">
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total</td>
                  <td className="px-4 py-2 text-right text-sm font-bold text-primary tabular-nums">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
