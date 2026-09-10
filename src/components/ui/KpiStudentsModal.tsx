import { useState } from 'react';
import { Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { getTodayBrasilia } from '@/lib/brasiliaDate';

import {
  resolveStudentDisplayStatus,
  getOperationalPendenteInstallments,
  isEntradaPendenciaInstallment,
  getOperationalPendenteTipoLabel,
} from '@/lib/studentDisplayStatus';
import { isInstallmentExcludedFromFinancialTotals } from '@/lib/iamPendenteConciliacao';
import { ANTECIPADA_BADGE_CLASS, ANTECIPADA_LABEL, isParcelaAntecipada } from '@/lib/parcelaAntecipada';

/**
 * - unpaid: parcelas em aberto
 * - overdue: parcelas em aberto já vencidas
 * - operational_pendente: pendências operacionais (entrada/PIX/link)
 * - boletos_antecipados: parcelas em aberto + parcelas marcadas como boleto antecipado (já baixadas)
 */
export type KpiValueMode = 'unpaid' | 'overdue' | 'operational_pendente' | 'boletos_antecipados';

export default function KpiStudentsModal({
  title,
  students,
  instInRange,
  valueMode,
  todayMs,
  futureOnlyStudentIds,
  onClose,
}: {
  title: string;
  students: Student[];
  instInRange: (i: { dueDate: string }) => boolean;
  valueMode: KpiValueMode;
  todayMs: number;
  /**
   * Alunos cujas parcelas JÁ VENCIDAS ficam de fora (só as a vencer entram).
   * Usado no card "Em Dia + Novos": os Vencido 1/2 entram só com o que ainda
   * não venceu — a parte vencida está nos cards Vencido 1 / Vencido 2.
   */
  futureOnlyStudentIds?: ReadonlySet<string>;
  onClose: () => void;
}) {
  type Row = {
    studentId: string;
    studentName: string;
    ac: string;
    status: string;
    tipo: string;
    installmentNumber: number;
    dueDate: string;
    entradaValor: number;
    pendenciaValor: number;
    antecipada: boolean;
  };
  type SortKey = 'studentName' | 'dueDate' | 'valor';
  type SortDir = 'asc' | 'desc';
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dueDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };
  const sortIndicator = (key: SortKey) => (
    <span className={`ml-1 ${sortKey === key ? 'text-primary' : 'text-muted-foreground/40'}`} aria-hidden>
      {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
    </span>
  );
  const sortTitle = (key: SortKey, asc: string, desc: string) =>
    sortKey === key
      ? `Ordenado ${sortDir === 'asc' ? asc : desc} — clique para inverter`
      : `Clique para ordenar ${asc}`;
  const allRows: Row[] = [];
  students.forEach((s) => {
    const source =
      valueMode === 'operational_pendente'
        ? getOperationalPendenteInstallments(s)
        : s.installments;
    const unpaid = source.filter((i) => {
      if (!instInRange(i)) return false;
      // Boletos antecipados já constam como pagos para a empresa, mas seguem no KPI.
      if (i.paid && !(valueMode === 'boletos_antecipados' && isParcelaAntecipada(i))) return false;
      if (valueMode !== 'operational_pendente' && isInstallmentExcludedFromFinancialTotals(s, i)) return false;
      if (valueMode === 'overdue') {
        return new Date(i.dueDate + 'T00:00:00').getTime() < todayMs;
      }
      if (futureOnlyStudentIds?.has(s.id)) {
        return new Date(i.dueDate + 'T00:00:00').getTime() >= todayMs;
      }
      return true;
    });
    const paidEntrada = Number(s.downPayment) || 0;
    unpaid.forEach((i) => {
      const isEntrada = valueMode === 'operational_pendente' && isEntradaPendenciaInstallment(i);
      allRows.push({
        studentId: s.id,
        studentName: s.name,
        ac: s.ac || '—',
        status: resolveStudentDisplayStatus(s),
        tipo: valueMode === 'operational_pendente' ? getOperationalPendenteTipoLabel(s) : '—',
        installmentNumber: i.number,
        dueDate: i.dueDate,
        entradaValor: isEntrada ? i.value : valueMode === 'operational_pendente' && paidEntrada > 0.0049 ? paidEntrada : 0,
        pendenciaValor: isEntrada ? 0 : i.value,
        antecipada: isParcelaAntecipada(i),
      });
    });
  });
  const rows = allRows.filter((r) => {
    if (dateFrom && (!r.dueDate || r.dueDate < dateFrom)) return false;
    if (dateTo && (!r.dueDate || r.dueDate > dateTo)) return false;
    return true;
  });
  const studentCount = new Set(rows.map((r) => r.studentId)).size;
  const byName = (a: Row, b: Row) => a.studentName.localeCompare(b.studentName, 'pt-BR', { sensitivity: 'base' });
  const byDue = (a: Row, b: Row) => (a.dueDate || '').localeCompare(b.dueDate || '');
  const byValor = (a: Row, b: Row) => (a.entradaValor + a.pendenciaValor) - (b.entradaValor + b.pendenciaValor);
  const primary = (a: Row, b: Row): number => {
    switch (sortKey) {
      case 'studentName':
        return byName(a, b);
      case 'dueDate':
        return byDue(a, b);
      case 'valor':
        return byValor(a, b);
      default: {
        const _exhaustive: never = sortKey;
        return _exhaustive;
      }
    }
  };
  rows.sort((a, b) => {
    const cmp = primary(a, b);
    if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
    // Desempate estável: nome → vencimento → nº da parcela.
    return byName(a, b) || byDue(a, b) || a.installmentNumber - b.installmentNumber;
  });
  const totalEntrada = rows.reduce((acc, r) => acc + r.entradaValor, 0);
  const totalPendencia = rows.reduce((acc, r) => acc + r.pendenciaValor, 0);
  const total = totalEntrada + totalPendencia;
  const totalAntecipado = rows.filter((r) => r.antecipada).reduce((acc, r) => acc + r.entradaValor + r.pendenciaValor, 0);
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
              {studentCount} {studentCount === 1 ? 'aluno' : 'alunos'} · {rows.length} {valueMode === 'operational_pendente' ? 'pendência(s)' : 'parcela(s)'}
              {valueMode === 'operational_pendente' ? (
                <>
                  {' · '}
                  Entrada: <span className="font-semibold text-amber-700">{formatCurrency(totalEntrada)}</span>
                  {' · '}
                  Pendência: <span className="font-semibold text-primary">{formatCurrency(totalPendencia)}</span>
                </>
              ) : (
                <>
                  {' · '}Total: <span className="font-semibold text-primary">{formatCurrency(total)}</span>
                  {valueMode === 'boletos_antecipados' && totalAntecipado > 0.0049 && (
                    <> · Antecipado: <span className="font-semibold text-sky-700">{formatCurrency(totalAntecipado)}</span></>
                  )}
                </>
              )}
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
                <th className="text-left font-semibold px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort('studentName')}
                    title={sortTitle('studentName', 'de A a Z', 'de Z a A')}
                    className="uppercase tracking-wider hover:text-foreground transition-colors"
                  >
                    Aluno{sortIndicator('studentName')}
                  </button>
                </th>
                <th className="text-left font-semibold px-4 py-2">AC</th>
                <th className="text-left font-semibold px-4 py-2">Status</th>
                {valueMode === 'operational_pendente' && (
                  <th className="text-left font-semibold px-4 py-2">Tipo</th>
                )}
                <th className="text-center font-semibold px-4 py-2">Parc.</th>
                <th className="text-left font-semibold px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort('dueDate')}
                    title={sortTitle('dueDate', 'do mais antigo ao mais recente', 'do mais recente ao mais antigo')}
                    className="uppercase tracking-wider hover:text-foreground transition-colors"
                  >
                    Vencimento{sortIndicator('dueDate')}
                  </button>
                </th>
                {valueMode === 'operational_pendente' ? (
                  <>
                    <th className="text-right font-semibold px-4 py-2">Valor Entrada</th>
                    <th className="text-right font-semibold px-4 py-2">Valor Pendência</th>
                  </>
                ) : (
                  <th className="text-right font-semibold px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSort('valor')}
                      title={sortTitle('valor', 'do menor ao maior', 'do maior ao menor')}
                      className="uppercase tracking-wider hover:text-foreground transition-colors"
                    >
                      Valor Parcela{sortIndicator('valor')}
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={valueMode === 'operational_pendente' ? 8 : 6} className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhum registro.</td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.studentId}-${r.installmentNumber}-${idx}`} className="border-t border-border/60 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2 text-foreground font-medium">{r.studentName}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.ac}</td>
                    <td className="px-4 py-2">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-muted text-foreground border border-border">{r.status}</span>
                    </td>
                    {valueMode === 'operational_pendente' && (
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.tipo}</td>
                    )}
                    <td className="px-4 py-2 text-xs text-center text-muted-foreground tabular-nums">
                      {r.installmentNumber || '—'}
                      {r.antecipada && (
                        <span className={`ml-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded ${ANTECIPADA_BADGE_CLASS}`}>{ANTECIPADA_LABEL}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-foreground tabular-nums">{fmtDate(r.dueDate)}</td>
                    {valueMode === 'operational_pendente' ? (
                      <>
                        <td className="px-4 py-2 text-right font-semibold text-amber-700 tabular-nums">
                          {r.entradaValor > 0 ? formatCurrency(r.entradaValor) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-foreground tabular-nums">
                          {r.pendenciaValor > 0 ? formatCurrency(r.pendenciaValor) : '—'}
                        </td>
                      </>
                    ) : (
                      <td className="px-4 py-2 text-right font-semibold text-foreground tabular-nums">
                        {(r.entradaValor + r.pendenciaValor) > 0 ? formatCurrency(r.entradaValor + r.pendenciaValor) : '—'}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0 bg-muted/70 backdrop-blur border-t border-border">
                <tr>
                  <td colSpan={valueMode === 'operational_pendente' ? 6 : 5} className="px-4 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total</td>
                  {valueMode === 'operational_pendente' ? (
                    <>
                      <td className="px-4 py-2 text-right text-sm font-bold text-amber-700 tabular-nums">{formatCurrency(totalEntrada)}</td>
                      <td className="px-4 py-2 text-right text-sm font-bold text-primary tabular-nums">{formatCurrency(totalPendencia)}</td>
                    </>
                  ) : (
                    <td className="px-4 py-2 text-right text-sm font-bold text-primary tabular-nums">{formatCurrency(total)}</td>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
