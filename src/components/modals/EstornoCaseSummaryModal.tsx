import { X } from 'lucide-react';
import { formatCurrency } from '@/store/useAppStore';
import type { CancellationCase } from '@/types';

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('pt-BR');
    }
    return new Date(v).toLocaleDateString('pt-BR');
  } catch {
    return v;
  }
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-xs text-right ${strong ? 'font-semibold text-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  caseData?: CancellationCase | null;
}

export default function EstornoCaseSummaryModal({ open, onClose, caseData }: Props) {
  if (!open) return null;
  const c = caseData as any;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-card border border-border saas-shadow-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-card rounded-t-2xl">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Resumo do cancelamento</p>
            <h3 className="text-base font-semibold text-foreground truncate">{c?.studentName ?? '—'}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {!c ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Cancelamento não encontrado.</div>
        ) : (
          <div className="p-5 space-y-4">
            <section>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Dados gerais</p>
              <Row label="Assessor" value={c.ac ?? '—'} />
              <Row label="Treinamento" value={c.treinamento ?? '—'} />
              <Row label="Etapa atual" value={c.stage ?? '—'} />
              <Row label="Status operacional" value={c.operationalStatus ?? '—'} />
              <Row label="Incluído no GC" value={fmtDate(c.createdAt)} />
              <Row label="Solicitação do aluno" value={fmtDate(c.dataEvento)} />
            </section>

            <section>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Motivo</p>
              <Row label="Motivo" value={c.motivoCancelamento ?? '—'} />
              {c.descricaoCancelamento && (
                <p className="mt-2 text-xs text-foreground bg-muted/50 rounded-lg p-2.5 whitespace-pre-wrap">{c.descricaoCancelamento}</p>
              )}
            </section>

            <section>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Financeiro</p>
              <Row label="Valor do contrato" value={formatCurrency(Number(c.value ?? 0))} />
              <Row label="Total pago até o momento" value={formatCurrency(Number(c.totalPagoAteMomento ?? 0))} />
              <Row
                label="Multa de cancelamento"
                value={`${formatCurrency(Number(c.multaValue ?? c.cancellationFineValue ?? 0))}${c.multaPercent ? ` (${c.multaPercent}%)` : ''}`}
              />
              {typeof c.quantidadeInscricoes === 'number' && (
                <Row label="Inscrições" value={`${c.inscricoesRevertidas ?? 0} revertida(s) de ${c.quantidadeInscricoes}`} />
              )}
            </section>

            {c.refundPlan && (
              <section>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Estorno gerado</p>
                <Row label="Valor total do estorno" value={formatCurrency(Number(c.refundPlan.totalValue ?? 0))} strong />
                <Row label="Parcelas" value={c.refundPlan.installments?.length ?? 0} />
                <Row label="Chave PIX" value={`${c.refundPlan.pixKeyType ?? '—'} · ${c.refundPlan.pixKey ?? '—'}`} />
                <div className="mt-2 space-y-1">
                  {(c.refundPlan.installments ?? []).map((p: any, i: number) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between text-xs rounded-lg px-2.5 py-1.5 border ${p.lancadoParaPagamento ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}
                    >
                      <span className="text-muted-foreground">
                        Parcela {i + 1}/{c.refundPlan.installments.length} · {fmtDate(p.date)}
                      </span>
                      <span className="font-semibold text-foreground">{formatCurrency(Number(p.value ?? 0))}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
