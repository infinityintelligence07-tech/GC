import { X, Eye, Download, FileText } from 'lucide-react';
import type { CancellationCase } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { openCancellationPdf, downloadCancellationPdf } from '@/lib/openCancellationPdf';
import CaseNotesPanel from '@/components/cancellation/CaseNotesPanel';

interface Props {
  caseRef: CancellationCase;
  onClose: () => void;
}

function fmtBRL(v?: number | null): string {
  if (v === undefined || v === null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('pt-BR');
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium text-foreground text-right break-words max-w-[60%]">{value ?? '—'}</span>
    </div>
  );
}

export default function ExternalCancellationViewModal({ caseRef, onClose }: Props) {
  const liveCase =
    useAppStore((s) => s.cancellationCases.find((c) => c.id === caseRef.id)) ?? caseRef;
  const c = liveCase;
  const multaPct = Number(c.multaPercent ?? 0);
  const multaVal = Number(c.multaValue ?? c.cancellationFineValue ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg saas-shadow-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 p-5 pb-3 sticky top-0 bg-card border-b border-border rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground truncate">{c.studentName}</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Cancelamento importado manualmente · somente leitura
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 pt-3 space-y-5">
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Dados do aluno</h3>
            <Row label="Nome" value={c.studentName} />
            <Row label="Treinamento" value={c.treinamento || '—'} />
            <Row label="WhatsApp" value={c.studentWhatsapp || '—'} />
            <Row label="Assessor (AC)" value={c.ac || '—'} />
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Contrato</h3>
            <Row label="Quantidade de inscrições" value={c.quantidadeInscricoes ?? '—'} />
            <Row label="Inscrições revertidas" value={c.inscricoesRevertidas ?? 0} />
            <Row label="Valor do contrato" value={fmtBRL(c.value)} />
            <Row label="Total pago (Kamino)" value={fmtBRL(c.totalPagoAteMomento)} />
            <Row label="Forma de pagamento" value={c.pagamentoTipo || '—'} />
            <Row
              label="Encargos"
              value={multaPct > 0 || multaVal > 0 ? `Multa ${multaPct}% • ${fmtBRL(multaVal)}` : 'Multa 0% • R$ 0,00'}
            />
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Solicitação</h3>
            <Row label="Motivo do cancelamento" value={c.motivoCancelamento || '—'} />
            <Row label="Dentro de 7 dias (CDC)" value={c.dentro7Dias === undefined ? '—' : c.dentro7Dias ? 'Sim' : 'Não'} />
            <Row
              label="Com 30 dias de antecedência"
              value={c.com30DiasAntecedencia === undefined ? '—' : c.com30DiasAntecedencia ? 'Sim, mais de 30D' : 'Não, menos de 30D'}
            />
            <Row label="Data da solicitação" value={fmtDate(c.dataEvento || c.createdAt)} />
            <Row label="Etapa atual" value={c.stage} />
            <Row label="Ação" value={c.acao || '—'} />
            <Row label="Responsável" value={c.responsavel || '—'} />
          </section>

          {(c.descricaoCancelamento || c.notes) && (
            <section>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Observações</h3>
              {c.descricaoCancelamento && (
                <p className="text-[11px] text-foreground whitespace-pre-wrap mb-2">{c.descricaoCancelamento}</p>
              )}
              {c.notes && (
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded-xl p-3">{c.notes}</p>
              )}
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
              Observações da finalização
            </h3>
            <CaseNotesPanel caseRef={c} />
          </section>

          {c.contractPdfUrl && (
            <section>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Contrato (PDF)</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openCancellationPdf(c.contractPdfUrl!, 'contrato.pdf')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 transition-all"
                >
                  <Eye size={12} /> Visualizar contrato
                </button>
                <button
                  onClick={() => downloadCancellationPdf(c.contractPdfUrl!, 'contrato.pdf')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold text-muted-foreground bg-muted hover:text-foreground transition-all"
                  title="Baixar contrato"
                >
                  <Download size={12} />
                </button>
              </div>
            </section>
          )}

          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <FileText size={11} /> As informações deste card são somente leitura.
          </p>
        </div>

        <div className="p-5 pt-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
