import { CancellationCase } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { X } from 'lucide-react';

export default function CancellationCasesModal({
  title,
  subtitle,
  cases,
  onClose,
}: {
  title: string;
  subtitle?: string;
  cases: CancellationCase[];
  onClose: () => void;
}) {
  const totalValue = cases.reduce((acc, c) => acc + (c.value ?? 0), 0);
  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      const [y, m, day] = iso.slice(0, 10).split('-');
      return y && m && day ? `${day}/${m}/${y}` : '—';
    }
    return d.toLocaleDateString('pt-BR');
  };

  const sorted = [...cases].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div
      className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl border border-border flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {subtitle ?? `${cases.length} caso${cases.length === 1 ? '' : 's'} · ${formatCurrency(totalValue)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Nenhum caso neste período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-semibold px-4 py-2.5">Aluno</th>
                  <th className="text-left font-semibold px-4 py-2.5">Assessor</th>
                  <th className="text-left font-semibold px-4 py-2.5">Pedido</th>
                  <th className="text-left font-semibold px-4 py-2.5">Status</th>
                  <th className="text-right font-semibold px-4 py-2.5">Valor</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-4 py-2.5 font-medium text-foreground">{c.studentName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.ac || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {c.acao === 'Revertido'
                        ? 'Revertido'
                        : c.funnelStage || c.stage || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatCurrency(c.value ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
