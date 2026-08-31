import { useState, useRef, useEffect } from 'react';
import { Student, canEditTab } from '@/types';
import { calculateAutoStatus, formatCurrency, calcularScoreComportamento, calcularMediaDiasPagamento } from '@/store/useAppStore';
import { statusColors } from '@/lib/statusColors';
import { X, User, Phone, Mail, MapPin, FileText, CreditCard, Calendar, TrendingUp, Star, Tag, Hash, Info, Plus, Check, RotateCcw, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import FinancialModal from '@/components/modals/FinancialModal';
import { useConfirm } from '@/hooks/useConfirm';

import { getTagStyle } from '@/lib/tagColors';
import { getDisplayInstallmentValue } from '@/lib/utils';
import { getVisibleStudentTagRefs } from '@/lib/tagFilter';
import StudentDraftBanner from '@/components/ui/StudentDraftBanner';
import {
  getLatestCancellationCaseForStudent,
  getParcelInstallments,
  getStudentTotalPaid,
  resolveStudentFinance,
} from '@/lib/studentFinance';

interface Props {
  student: Student;
  onClose: () => void;
  /** Extra sections rendered below the default sections (e.g. cancellation reason). */
  extraSections?: React.ReactNode;
  /** Optional badge shown next to status in the header (e.g. funnel stage). */
  headerBadge?: React.ReactNode;
}

function Field({ icon: Icon, label, value }: { icon?: any; label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon size={11} />}
        {label}
      </div>
      <div className="text-sm text-foreground font-medium break-words">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 border border-border rounded-xl p-4">
      <h3 className="text-xs font-semibold text-foreground mb-3 uppercase tracking-wider">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}


function formatDateTimeBR(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDateOnlyBR(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export default function StudentViewModal({ student, onClose, extraSections, headerBadge }: Props) {
  const { studentTags, students, updateStudent, currentUser, cancellationCases } = useAppStore();
  const latestCancellationCase = getLatestCancellationCaseForStudent(
    student.id,
    student.name,
    cancellationCases,
  );
  // Data em que o card entrou no GC = 1º registro de histórico do caso
  // (createdAt pode ser retroagido para a data da solicitação no chat).
  const inclusaoGcDate = latestCancellationCase
    ? (latestCancellationCase.history ?? [])
        .map((h: any) => h?.date)
        .filter(Boolean)
        .sort()[0] ?? latestCancellationCase.createdAt
    : undefined;
  const qtdInscricoes = latestCancellationCase?.quantidadeInscricoes;
  const pagoAteMomentoKamino = latestCancellationCase?.totalPagoAteMomento;
  const confirm = useConfirm();
  const canManageTags = canEditTab(currentUser, 'alunos');
  const canEditAlunos = canEditTab(currentUser, 'alunos');
  const canConciliar = canEditTab(currentUser, 'conciliacao') || currentUser?.role === 'admin' || currentUser?.role === 'conciliacao';
  const isAdmin = currentUser?.role === 'admin';
  const currentStudent = students.find((s) => s.id === student.id) ?? student;
  const [showFinancial, setShowFinancial] = useState(false);
  const studentLevelTagIds = new Set((currentStudent.tags || []).filter(Boolean));
  const assignableTags = studentTags.filter((t) => (t.scope || 'student') === 'student');
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tagPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [tagPickerOpen]);
  const toggleStudentTag = (tagId: string) => {
    const current = new Set((currentStudent.tags || []).filter(Boolean));
    if (current.has(tagId)) current.delete(tagId);
    else current.add(tagId);
    updateStudent(currentStudent.id, { tags: Array.from(current) });
  };
  const handleRevertNegativado = () => {
    if (!window.confirm('Deseja reverter o status deste aluno de "Negativado" para "À Negativar"?')) return;
    const now = new Date().toISOString();
    updateStudent(currentStudent.id, {
      status: 'À Negativar',
      statusMode: 'Manual',
      history: [
        ...currentStudent.history,
        { date: now, type: 'Sistema' as const, text: 'Admin reverteu o status de Negativado para À Negativar.' },
      ],
    });
  };
  const handleRevertNegativadoToAutomatic = () => {
    const restoredStatus = calculateAutoStatus(currentStudent.installments);
    if (!window.confirm(`Deseja tirar este aluno de "Negativado" e voltar para o status automático "${restoredStatus}"?`)) return;
    const now = new Date().toISOString();
    updateStudent(currentStudent.id, {
      status: restoredStatus,
      statusMode: 'Automático',
      history: [
        ...currentStudent.history,
        {
          date: now,
          type: 'Sistema' as const,
          text: `${currentUser?.name ?? 'Usuário'} reverteu "Negativado" para o status automático "${restoredStatus}".`,
        },
      ],
    });
  };
  const handleVoltarEmDia = async () => {
    const paid = await confirm({
      title: 'Voltar para "Em Dia"',
      description: 'O aluno realizou o pagamento das parcelas em aberto?\n\nSe SIM, abriremos a Gestão Financeira para você apontar os valores e datas dos pagamentos. O status voltará automaticamente para "Em Dia" após o lançamento.',
      confirmText: 'Sim, registrar pagamentos',
      cancelText: 'Não, cancelar',
    });
    if (!paid) return;
    const now = new Date().toISOString();
    // Libera o auto-status: assim que as parcelas em atraso forem quitadas
    // no FinancialModal, o status retorna para "Em Dia" automaticamente.
    updateStudent(currentStudent.id, {
      statusMode: 'Automático',
      history: [
        ...currentStudent.history,
        {
          date: now,
          type: 'Sistema' as const,
          text: `${currentUser?.name ?? 'Usuário'} iniciou retorno para "Em Dia" — registrando pagamentos das parcelas em aberto.`,
        },
      ],
    });
    setShowFinancial(true);
  };
  const finance = resolveStudentFinance(currentStudent, {
    kaminoPaid: latestCancellationCase?.totalPagoAteMomento,
  });
  const parcelInstallments = getParcelInstallments(currentStudent, {
    kaminoPaid: latestCancellationCase?.totalPagoAteMomento,
  });
  const score = calcularScoreComportamento(currentStudent.installments);
  const paidCount = parcelInstallments.filter((i) => i.paid).length;
  const totalInstallmentsReal = parcelInstallments.length || currentStudent.totalInstallments;
  const totalPaidValue = getStudentTotalPaid(currentStudent, {
    kaminoPaid: latestCancellationCase?.totalPagoAteMomento,
  });
  const totalUnpaidValue = parcelInstallments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0);
  const mediaDias = calcularMediaDiasPagamento(currentStudent.installments);
  // ─── Valor de parcela exibido (deriva das parcelas reais p/ não divergir da Gestão Financeira) ───
  const { value: displayInstallmentValue, varied: hasVariedValues } = getDisplayInstallmentValue({
    installments: parcelInstallments,
    installmentValue: currentStudent.installmentValue,
  });

  // Resolve todas as tags visíveis (aluno + parcelas), com fallback por nome.
  // Filtra "Recompra" pura — mantém apenas variantes nomeadas como "Fundo - Receita (Recompra)".
  const tagRefs = getVisibleStudentTagRefs(currentStudent);
  const seenTagNames = new Set<string>();
  const tags = tagRefs
    .map((ref) => {
      const found = studentTags.find(
        (t) => t.id === ref || t.name.toLowerCase() === ref.toLowerCase()
      );
      if (found) return found;
      // Fallback: exibe a string crua como tag neutra
      return { id: ref, name: ref, color: 'gray' } as { id: string; name: string; color: string };
    })
    .filter((t) => {
      const name = t.name.trim();
      const key = name.toLowerCase();
      if (!name || key === 'recompra' || seenTagNames.has(key)) return false;
      seenTagNames.add(key);
      return true;
    });

  const fullAddress = [currentStudent.address, currentStudent.numero].filter(Boolean).join(', ');
  const cityState = [currentStudent.cidade, currentStudent.estado].filter(Boolean).join(' - ');

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4">
      <div className="bg-card rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full iam-gradient flex items-center justify-center text-primary-foreground font-bold">
              {student.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{student.name}</h2>
                {currentStudent.detalhes && (
                  <button
                    type="button"
                    title={currentStudent.detalhes}
                    aria-label="Ver detalhes/observações importadas"
                    className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    onClick={() => {
                      const el = document.getElementById('student-detalhes-section');
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el?.classList.add('ring-2', 'ring-primary');
                      setTimeout(() => el?.classList.remove('ring-2', 'ring-primary'), 1500);
                    }}
                  >
                    <Info size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${statusColors[student.status]}`}>
                  {student.status}
                </span>
                {isAdmin && currentStudent.status === 'Negativado' && (
                  <button
                    type="button"
                    onClick={handleRevertNegativado}
                    title="Reverter status para À Negativar"
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                  >
                    <RotateCcw size={10} />
                    Reverter para À Negativar
                  </button>
                )}
                {canEditAlunos && currentStudent.status === 'Negativado' && (
                  <button
                    type="button"
                    onClick={handleRevertNegativadoToAutomatic}
                    title="Voltar para o status automático de inadimplência"
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    <RotateCcw size={10} />
                    Voltar para inadimplência
                  </button>
                )}
                {canEditAlunos && ['Negativado', 'À Negativar', 'Vencido 1', 'Vencido 2'].includes(currentStudent.status) && (
                  <button
                    type="button"
                    onClick={handleVoltarEmDia}
                    title='Registrar pagamentos e voltar para "Em Dia"'
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    <CheckCircle2 size={10} />
                    Voltar para Em Dia
                  </button>
                )}
                <span className="text-[11px] text-muted-foreground">{student.product}</span>
                {student.ciclo && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-300" title="Ciclo do contrato (ex.: renovação anual)">
                    Ciclo {student.ciclo}
                  </span>
                )}
                {headerBadge}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <StudentDraftBanner studentId={student.id} />
          {/* Resumo rápido */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Parcelas</p>
              <p className="text-lg font-bold text-foreground">{paidCount}/{totalInstallmentsReal}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Valor Parcela</p>
              <p className="text-lg font-bold iam-text-gradient">
                {formatCurrency(displayInstallmentValue)}
                {hasVariedValues && <span className="ml-1 text-[9px] font-medium text-muted-foreground normal-case">(varia)</span>}
              </p>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">A Receber</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(totalUnpaidValue)}</p>
            </div>
            <div className="bg-card border border-border rounded-xl p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Score</p>
              <div className="flex items-center gap-0.5 mt-1">
                {score === 0 ? (
                  <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">Novo</span>
                ) : (
                  [1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={14} className={s <= score ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30'} />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Dados Pessoais */}
          <Section title="Dados Pessoais">
            <Field icon={User} label="Nome Completo" value={student.name} />
            <Field icon={Hash} label="CPF" value={student.cpf} />
            <Field icon={Phone} label="WhatsApp" value={student.whatsapp} />
            <Field icon={Mail} label="E-mail" value={student.email} />
          </Section>

          {/* Endereço */}
          <Section title="Endereço">
            <Field icon={MapPin} label="Endereço" value={fullAddress} />
            <Field label="Cidade / Estado" value={cityState} />
            <Field label="CEP" value={student.cep} />
          </Section>

          {/* Financeiro */}
          <Section title="Contrato Financeiro">
            <Field icon={CreditCard} label="Valor Contrato" value={formatCurrency(finance.saleValue)} />
            <Field label="Valor Entrada" value={formatCurrency(finance.downPayment)} />
            <Field label="Nº Parcelas" value={`${totalInstallmentsReal}x de ${formatCurrency(displayInstallmentValue)}${hasVariedValues ? ' (valores variados)' : ''}`} />
            <Field label="Parcelas Pagas" value={`${paidCount} de ${totalInstallmentsReal}`} />
            <Field label="Total Pago" value={formatCurrency(totalPaidValue)} />
            <Field label="Total a Receber" value={formatCurrency(totalUnpaidValue)} />
            {qtdInscricoes != null && (
              <Field label="Qtd. Inscrições" value={String(qtdInscricoes)} />
            )}
            {typeof pagoAteMomentoKamino === 'number' && (
              <Field label="Pago até o momento (Kamino)" value={formatCurrency(pagoAteMomentoKamino)} />
            )}
          </Section>


          {/* Datas e Treinamento */}
          <Section title="Treinamento e Datas">
            <Field icon={FileText} label="Treinamento" value={student.product} />
            <Field label="Assessor de Conta" value={student.ac} />
            <Field icon={Calendar} label="Data Inscrição" value={student.enrollmentDate ? new Date(student.enrollmentDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—'} />
            <Field label="Data Competência" value={student.data_treinamento_origem ? new Date(student.data_treinamento_origem + 'T00:00:00').toLocaleDateString('pt-BR') : '—'} />
            <Field label="Dia Vencimento" value={`Dia ${student.dueDay}`} />
            <Field icon={TrendingUp} label="Média de Pagamento" value={mediaDias === null ? '—' : `${mediaDias > 0 ? '+' : ''}${mediaDias} dias`} />
            {latestCancellationCase && (
              <>
                <Field icon={Calendar} label="Solicitação do Aluno (1ª vez)" value={formatDateOnlyBR(latestCancellationCase.createdAt)} />
                <Field icon={Calendar} label="Incluído no GC" value={formatDateTimeBR(inclusaoGcDate)} />
              </>
            )}
          </Section>

          {/* Tags */}
          {(tags.length > 0 || canManageTags) && (
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider">
                  <Tag size={12} /> Tags
                </div>
                {canManageTags && (
                  <div className="relative" ref={tagPickerRef}>
                    <button
                      type="button"
                      onClick={() => setTagPickerOpen((v) => !v)}
                      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-border bg-card hover:bg-muted transition-colors"
                    >
                      <Plus size={11} /> Atribuir tag
                    </button>
                    {tagPickerOpen && (
                      <div className="absolute right-0 mt-1 w-64 max-h-64 overflow-auto rounded-xl border border-border bg-popover shadow-lg z-20 p-2 space-y-0.5">
                        {assignableTags.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground p-2">Nenhuma tag cadastrada. Crie tags em Configurações.</p>
                        ) : (
                          assignableTags.map((t) => {
                            const checked = studentLevelTagIds.has(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => toggleStudentTag(t.id)}
                                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-muted text-left"
                              >
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border" style={getTagStyle(t.color)}>
                                  {t.name}
                                </span>
                                {checked && <Check size={13} className="text-primary shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {tags.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Nenhuma tag atribuída.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag: any) => {
                    const isManual = studentLevelTagIds.has(tag.id);
                    return (
                      <span
                        key={tag.id}
                        className="text-[10px] font-semibold px-2 py-1 rounded-lg border inline-flex items-center gap-1"
                        style={getTagStyle(tag.color)}
                      >
                        {tag.name}
                        {canManageTags && isManual && (
                          <button
                            type="button"
                            onClick={() => toggleStudentTag(tag.id)}
                            title="Remover tag do aluno"
                            className="hover:opacity-70"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Seções extras (ex.: motivo do cancelamento) */}
          {extraSections}

          {/* Detalhes / Observações */}
          {currentStudent.detalhes && (
            <div id="student-detalhes-section" className="bg-muted/30 border border-border rounded-xl p-4 transition-all">
              <h3 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <Info size={12} /> Observações (Detalhe)
              </h3>
              <p className="text-sm text-foreground whitespace-pre-wrap">{currentStudent.detalhes}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border flex justify-end sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all">
            Fechar
          </button>
        </div>
      </div>
      {showFinancial && (
        <FinancialModal
          student={currentStudent}
          onClose={() => setShowFinancial(false)}
          immediateApply={canConciliar}
        />
      )}
    </div>
  );
}
