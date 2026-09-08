import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';
import type { ForecastExportRow } from '@/lib/exportForecastSpreadsheet';

interface PagoAlunosModalProps {
  /** Linhas do detalhamento da Previsão (só as do bucket "pago" são usadas). */
  details: ForecastExportRow[];
  /** Total exibido no card Pago (valor nominal), para o cabeçalho bater com o card. */
  totalPago: number;
  /** Texto do período/filtro ativo, ex.: "01/09/2026 a 08/09/2026" ou "Toda a carteira". */
  periodoLabel?: string;
  onClose: () => void;
}

interface AlunoPago {
  studentId: string;
  studentName: string;
  ac: string;
  product: string;
  qtd: number;
  valorPago: number;
  recebido: number;
  titulos: ForecastExportRow[];
}

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

/** Rótulo do título dentro do detalhamento de um aluno. */
const tituloLabel = (row: ForecastExportRow) => {
  if (row.installmentNumber > 0) return `Parcela ${row.installmentNumber}`;
  // installmentNumber 0 = entrada (cadastro/IAM) ou valor retido de cancelamento.
  return row.displayStatus === 'Cancelado' ? 'Retido no cancelamento' : 'Entrada';
};

/**
 * Modal do card "Pago" (Previsão de Recebimento, base Data de Vencimento):
 * lista os alunos que geraram recebimento no período e quanto cada um pagou.
 * Cada linha expande para mostrar os títulos (parcelas, entrada, retido).
 */
export default function PagoAlunosModal({ details, totalPago, periodoLabel, onClose }: PagoAlunosModalProps) {
  const [busca, setBusca] = useState('');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const alunos = useMemo<AlunoPago[]>(() => {
    const map = new Map<string, AlunoPago>();
    for (const row of details) {
      if (row.bucket !== 'pago') continue;
      const atual = map.get(row.studentId) ?? {
        studentId: row.studentId,
        studentName: row.studentName,
        ac: row.ac || 'Sem Assessor',
        product: row.product || '',
        qtd: 0,
        valorPago: 0,
        recebido: 0,
        titulos: [],
      };
      atual.qtd += 1;
      atual.valorPago += Number(row.value) || 0;
      atual.recebido += Number(row.paidValue) || 0;
      atual.titulos.push(row);
      map.set(row.studentId, atual);
    }
    return [...map.values()]
      .map((a) => ({
        ...a,
        titulos: [...a.titulos].sort((x, y) => (x.paidDate || x.dueDate).localeCompare(y.paidDate || y.dueDate)),
      }))
      .sort((a, b) => b.valorPago - a.valorPago || a.studentName.localeCompare(b.studentName));
  }, [details]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return alunos;
    return alunos.filter((a) => a.studentName.toLowerCase().includes(q) || a.ac.toLowerCase().includes(q));
  }, [alunos, busca]);

  const totalFiltrado = filtrados.reduce((s, a) => s + a.valorPago, 0);
  const totalTitulos = alunos.reduce((s, a) => s + a.qtd, 0);

  const toggle = (id: string) => {
    setAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl border border-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Pago — Alunos</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {alunos.length} {alunos.length === 1 ? 'aluno' : 'alunos'} · {totalTitulos} {totalTitulos === 1 ? 'título' : 'títulos'} · Total Pago:{' '}
              <span className="font-semibold text-emerald-700">{formatCurrency(totalPago)}</span>
              {periodoLabel ? <span className="text-muted-foreground"> · {periodoLabel}</span> : null}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              className="input-field w-full pl-8"
              placeholder="Buscar aluno ou assessor…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoFocus
            />
          </div>
          {busca.trim() && (
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              {filtrados.length} {filtrados.length === 1 ? 'aluno' : 'alunos'} ·{' '}
              <span className="font-semibold text-emerald-700">{formatCurrency(totalFiltrado)}</span>
            </p>
          )}
        </div>

        <div className="overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2">Aluno</th>
                <th className="text-left font-semibold px-4 py-2">Assessor</th>
                <th className="text-center font-semibold px-4 py-2">Títulos</th>
                <th className="text-right font-semibold px-4 py-2">Valor Pago</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-muted-foreground">
                    {alunos.length === 0 ? 'Nenhum recebimento no período.' : 'Nenhum aluno encontrado.'}
                  </td>
                </tr>
              ) : (
                filtrados.map((a) => {
                  const aberto = abertos.has(a.studentId);
                  return (
                    <FragmentRow key={a.studentId} aluno={a} aberto={aberto} onToggle={() => toggle(a.studentId)} />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ aluno, aberto, onToggle }: { aluno: AlunoPago; aberto: boolean; onToggle: () => void }) {
  const mostraRecebido = Math.abs(aluno.recebido - aluno.valorPago) >= 0.01;
  return (
    <>
      <tr className="border-t border-border/60 hover:bg-muted/30 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2 text-foreground">
          <div className="flex items-center gap-1.5 min-w-0">
            {aberto ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
            <div className="min-w-0">
              <p className="font-medium truncate">{aluno.studentName}</p>
              {aluno.product && <p className="text-[10px] text-muted-foreground truncate">{aluno.product}</p>}
            </div>
          </div>
        </td>
        <td className="px-4 py-2 text-xs text-muted-foreground">{aluno.ac}</td>
        <td className="px-4 py-2 text-center text-xs text-muted-foreground tabular-nums">{aluno.qtd}</td>
        <td className="px-4 py-2 text-right font-semibold text-emerald-700 tabular-nums">
          {formatCurrency(aluno.valorPago)}
          {mostraRecebido && (
            <p className="text-[10px] font-normal text-muted-foreground" title="Valor efetivamente recebido">
              recebido {formatCurrency(aluno.recebido)}
            </p>
          )}
        </td>
      </tr>
      {aberto && (
        <tr className="bg-muted/20">
          <td colSpan={4} className="px-4 pb-3 pt-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-semibold px-3 py-1">Título</th>
                  <th className="text-left font-semibold px-3 py-1">Vencimento</th>
                  <th className="text-left font-semibold px-3 py-1">Pagamento</th>
                  <th className="text-right font-semibold px-3 py-1">Valor</th>
                </tr>
              </thead>
              <tbody>
                {aluno.titulos.map((t, idx) => (
                  <tr key={`${t.studentId}-${t.installmentNumber}-${idx}`} className="border-t border-border/40">
                    <td className="px-3 py-1 text-foreground">{tituloLabel(t)}</td>
                    <td className="px-3 py-1 tabular-nums text-foreground">{fmtDate(t.dueDate)}</td>
                    <td className="px-3 py-1 tabular-nums text-foreground">{fmtDate(t.paidDate)}</td>
                    <td className="px-3 py-1 text-right tabular-nums font-medium text-emerald-700">{formatCurrency(t.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
