import { useState } from 'react';
import { Student } from '@/types';
import { formatCurrency, useAppStore } from '@/store/useAppStore';
import { getTagStyle } from '@/lib/tagColors';
import { X, Tag } from 'lucide-react';

interface Props {
  student: Student;
  onClose: () => void;
}

export default function FlowModal({ student, onClose }: Props) {
  const { studentTags, toggleInstallmentTag } = useAppStore();
  const [tagPopoverFor, setTagPopoverFor] = useState<number | null>(null);

  const totalContract = student.saleValue;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totalOverdue = student.installments
    .filter((i) => !i.paid && new Date(i.dueDate) < today)
    .reduce((acc, i) => acc + i.value, 0);

  const totalAVencer = student.installments
    .filter((i) => !i.paid && new Date(i.dueDate) >= today)
    .reduce((acc, i) => acc + i.value, 0);

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in" onClick={() => setTagPopoverFor(null)}>
      <div className="bg-card rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Fluxo de Pagamento — {student.name}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-muted/50 rounded-xl">
              <p className="text-xs text-muted-foreground">Valor Total do Contrato</p>
              <p className="text-xl font-bold iam-text-gradient mt-1">{formatCurrency(totalContract)}</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-xl">
              <p className="text-xs text-amber-700">Total à Vencer</p>
              <p className="text-xl font-bold text-amber-600 mt-1">{formatCurrency(totalAVencer)}</p>
            </div>
            <div className="p-4 bg-destructive/5 rounded-xl">
              <p className="text-xs text-destructive">Total em Atraso (Vencido)</p>
              <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(totalOverdue)}</p>
            </div>
          </div>



          {/* Horizontal flow timeline */}
          <div className="overflow-x-auto no-scrollbar">
            <div className="flex gap-2 min-w-max py-2">
              {/* Card de Entrada (se houver) — não é parcela, apenas exibição */}
              {(student.downPayment ?? 0) > 0 && (
                <div className="relative flex flex-col items-center p-3 rounded-xl border min-w-[110px] border-emerald-300 bg-emerald-50">
                  <span className="text-[10px] font-bold text-emerald-700">ENTRADA</span>
                  <span className="text-xs font-bold mt-1 text-emerald-700">
                    {formatCurrency(student.downPayment ?? 0)}
                  </span>
                  {student.enrollmentDate && (
                    <span className="text-[9px] text-emerald-700 mt-1 font-semibold">
                      Pago: {new Date(student.enrollmentDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                  )}
                  <div className="flex gap-1 mt-1 flex-wrap justify-center">
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                      ✓ Pago
                    </span>
                  </div>
                </div>
              )}
              {(() => {
                const dateCount = new Map<string, number>();
                (student.installments || []).forEach((i) => {
                  dateCount.set(i.dueDate, (dateCount.get(i.dueDate) || 0) + 1);
                });
                return [...student.installments]
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.number - b.number)
                .map((inst) => {
                const parcelaTagsResolved = (inst.tags || [])
                  .map((tid) => studentTags.find((t) => t.id === tid))
                  .filter((t): t is NonNullable<typeof t> => !!t);
                const isRecompraOuFundo = parcelaTagsResolved.some((t) => /recompra|fundo/i.test(t.name));
                const isDuplicada = isRecompraOuFundo && (dateCount.get(inst.dueDate) || 0) > 1;
                // Recompra/Fundo é sempre tratada como pendente (nunca vencida visualmente)
                const isOverdue = !inst.paid && !isRecompraOuFundo && new Date(inst.dueDate) < today;
                return (
                  <div
                    key={inst.number}
                    className={`relative flex flex-col items-center p-3 rounded-xl border min-w-[110px] ${
                      inst.paid
                        ? 'border-emerald-300 bg-emerald-50'
                        : isOverdue
                          ? 'border-red-300 bg-red-50'
                          : 'border-border bg-muted/30'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-muted-foreground">P{inst.number}</span>
                    {(() => {
                      const hasDiff = inst.paid && typeof inst.paidValue === 'number' && Math.abs((inst.paidValue ?? inst.value) - inst.value) > 0.01;
                      const isJuros = hasDiff && (inst.paidValue as number) > inst.value;
                      if (hasDiff) {
                        return (
                          <div className="flex flex-col items-center mt-1 gap-0.5">
                            <span className="text-[10px] font-medium text-muted-foreground line-through">
                              {formatCurrency(inst.value)}
                            </span>
                            <span className={`text-xs font-bold ${isJuros ? 'text-amber-700' : 'text-emerald-700'}`}>
                              {formatCurrency(inst.paidValue as number)}
                            </span>
                            <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ${isJuros ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {isJuros ? `+ ${formatCurrency((inst.paidValue as number) - inst.value)} juros` : `− ${formatCurrency(inst.value - (inst.paidValue as number))} desc.`}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <span className={`text-xs font-bold mt-1 ${
                          inst.paid ? 'text-emerald-600' : isOverdue ? 'text-red-600' : 'text-foreground'
                        }`}>
                          {formatCurrency(inst.value)}
                        </span>
                      );
                    })()}
                    <span className="text-[9px] text-muted-foreground mt-1">
                      Venc: {new Date(inst.dueDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                    {inst.paid && inst.paidDate && (
                      <span className="text-[9px] text-emerald-700 mt-0.5 font-semibold">
                        Pago: {new Date(inst.paidDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                    )}
                    <div className="flex gap-1 mt-1 flex-wrap justify-center">
                      <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded ${
                        inst.paid ? 'bg-emerald-100 text-emerald-700' : isOverdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {inst.paid ? '✓ Pago' : isOverdue ? 'Vencido' : 'Pendente'}
                      </span>
                      {inst.tipoParcela === 'antecipada' && (
                        <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">
                          Antecipada
                        </span>
                      )}
                      {isDuplicada && (
                        <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-200">
                          Duplicada
                        </span>
                      )}
                      {parcelaTagsResolved.some((t) => /recompra/i.test(t.name)) && (
                        <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                          Recompra
                        </span>
                      )}
                      {parcelaTagsResolved.some((t) => /fundo/i.test(t.name)) && (
                        <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-200">
                          Fundo
                        </span>
                      )}
                    </div>

                    {/* Tags da parcela */}
                    {parcelaTagsResolved.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap justify-center">
                        {parcelaTagsResolved.map((tag) => (
                          <span
                            key={tag.id}
                            className="text-[8px] font-semibold px-1 py-0.5 rounded border"
                            style={getTagStyle(tag.color)}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Botão para abrir popover de tags */}
                    {studentTags.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setTagPopoverFor(tagPopoverFor === inst.number ? null : inst.number); }}
                        className="mt-1.5 text-[9px] text-muted-foreground hover:text-primary flex items-center gap-0.5 transition-colors"
                        title="Tags desta parcela"
                      >
                        <Tag size={9} /> Tags
                      </button>
                    )}

                    {tagPopoverFor === inst.number && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-card border border-border rounded-xl shadow-lg p-2 min-w-[160px] space-y-1" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
                          Tags da Parcela {inst.number}
                        </p>
                        {studentTags.map((tag) => {
                          const active = (inst.tags || []).includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => toggleInstallmentTag(student.id, inst.number, tag.id)}
                              className={`w-full text-left text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${active ? 'ring-2 ring-primary/40' : 'opacity-60 hover:opacity-100'}`}
                              style={getTagStyle(tag.color)}
                            >
                              {active ? '✓ ' : ''}{tag.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
