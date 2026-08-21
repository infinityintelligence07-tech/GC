import { FileText, Printer, Download, X } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';

export type DashboardReportKpi = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent';
};

export type DashboardReportSection = {
  title: string;
  kpis: DashboardReportKpi[];
};

type Props = {
  generatedAt: string;
  contextLines: string[];
  sections: DashboardReportSection[];
  onClose: () => void;
};

const toneClass: Record<NonNullable<DashboardReportKpi['tone']>, string> = {
  default: 'border-border bg-card',
  good: 'border-emerald-200 bg-emerald-50/80',
  warn: 'border-amber-200 bg-amber-50/80',
  bad: 'border-rose-200 bg-rose-50/80',
  accent: 'border-violet-200 bg-violet-50/80',
};

function downloadCsv(sections: DashboardReportSection[], contextLines: string[], generatedAt: string) {
  const rows: string[][] = [
    ['IAM Gestão de Contas — Relatório Dashboard'],
    [`Gerado em`, generatedAt],
    ...contextLines.map((l) => ['Contexto', l]),
    [],
    ['Seção', 'Indicador', 'Valor', 'Detalhe'],
  ];
  for (const sec of sections) {
    for (const k of sec.kpis) {
      rows.push([sec.title, k.label, k.value, k.detail ?? '']);
    }
  }
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `relatorio-dashboard-${generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardReportModal({
  generatedAt,
  contextLines,
  sections,
  onClose,
}: Props) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-3 sm:p-6 print:static print:bg-transparent print:p-0 print:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col print:max-w-none print:max-h-none print:shadow-none print:border-0 print:rounded-none"
        onClick={(e) => e.stopPropagation()}
        id="dashboard-report-print"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border print:border-b-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 print:hidden">
              <FileText size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">
                Relatório — Dashboard
              </h2>
              <p className="text-[11px] text-muted-foreground truncate">
                Gerado em {generatedAt}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => downloadCsv(sections, contextLines, generatedAt)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-muted transition-colors"
            >
              <Download size={13} />
              CSV
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold iam-gradient text-primary-foreground shadow-sm"
            >
              <Printer size={13} />
              Imprimir / PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="Fechar"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5 print:overflow-visible">
          {contextLines.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                Contexto do relatório
              </p>
              <ul className="space-y-0.5">
                {contextLines.map((line) => (
                  <li key={line} className="text-[12px] text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sections.map((sec) => (
            <section key={sec.title} className="space-y-2 break-inside-avoid">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {sec.title}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {sec.kpis.map((k) => (
                  <div
                    key={`${sec.title}-${k.label}`}
                    className={`rounded-xl border px-3 py-2.5 ${toneClass[k.tone ?? 'default']}`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                      {k.label}
                    </p>
                    <p className="text-base sm:text-lg font-bold text-foreground tabular-nums mt-0.5 leading-tight">
                      {k.value}
                    </p>
                    {k.detail && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={k.detail}>
                        {k.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="text-[10px] text-muted-foreground text-center pt-2 print:pt-6">
            IAM Gestão de Contas · Relatório gerado automaticamente a partir dos filtros ativos no Dashboard
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #dashboard-report-print, #dashboard-report-print * { visibility: visible !important; }
          #dashboard-report-print {
            position: absolute !important;
            left: 0; top: 0; width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

/** Helper opcional para montar valor monetário no relatório. */
export function reportMoney(n: number): string {
  return formatCurrency(n);
}
