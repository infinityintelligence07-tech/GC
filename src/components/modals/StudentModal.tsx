import { useState, useEffect, useRef } from 'react';
import { Student, StudentStatus, StatusMode, canEditTab } from '@/types';
import { useAppStore, calculateInstallmentValue, generateInstallments, formatCurrency } from '@/store/useAppStore';
import { buildStudentSnapshot, registrarConciliacao } from '@/store/useConciliacaoStore';
import { X, FileText, Tag, Plus, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import CurrencyInput from '@/components/ui/CurrencyInput';
import { getTagStyle } from '@/lib/tagColors';
import { isProductExcludedFromEsteira } from '@/lib/acEsteira';
import { findDuplicateStudent } from '@/lib/studentIdentity';
import {
  openIamControlContrato,
  openIamControlPaymentLink,
  isIamContratoPendenteLink,
  isIamContratoPendentePix,
} from '@/lib/iamControlContrato';
import {
  getLatestCancellationCaseForStudent,
  resolveStudentFinance,
} from '@/lib/studentFinance';

interface Props {
  student?: Student | null;
  onClose: () => void;
}

const statusOptions: StudentStatus[] = ['Em Dia', 'Vencido 1', 'Vencido 2', 'À Negativar', 'Negativado', 'Em Negociação', 'Excluído'];

const estados = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

// Masks
function maskWhatsApp(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

function maskCPFOrCNPJ(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    // CPF: 000.000.000-00
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  }
  // CNPJ: 00.000.000/0000-00
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function maskCEP(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}


export default function StudentModal({ student, onClose }: Props) {
  const { acs, products, addStudent, updateStudent, rules, studentTags, currentUser, students, cancellationCases } = useAppStore();
  const canManageTags = canEditTab(currentUser, 'alunos');
  const assignableTags = studentTags.filter((t) => (t.scope || 'student') === 'student');
  const canChooseMode = !!student && (currentUser?.role === 'admin' || currentUser?.role === 'conciliacao');
  const [approvalMode, setApprovalMode] = useState<'total' | 'send'>('total');
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const [studentTagIds, setStudentTagIds] = useState<string[]>([]);
  const [contratoBusy, setContratoBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  useEffect(() => {
    setStudentTagIds(student ? (student.tags || []).filter(Boolean) : []);
    // Depende apenas do id do aluno — evita reset a cada re-render do parent
    // (que stompa edições in-flight do formulário, ex.: status Manual).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);
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
  const toggleTag = (tagId: string) => {
    setStudentTagIds((prev) => prev.includes(tagId) ? prev.filter((x) => x !== tagId) : [...prev, tagId]);
  };

  const [form, setForm] = useState({
    name: '', whatsapp: '', email: '', cpf: '', address: '', numero: '', cidade: '', estado: '', cep: '',
    statusMode: 'Automático' as StatusMode,
    status: 'Em Dia' as StudentStatus,
    // Vazio = esteira automática no INSERT (banco atribui o próximo AC ativo)
    ac: '',
    product: products[0]?.name || '',
    enrollmentDate: new Date().toISOString().split('T')[0],
    data_treinamento_origem: new Date().toISOString().split('T')[0],
    dueDate: new Date().toISOString().split('T')[0],
    dueDay: 10,
    saleValue: 0, downPayment: 0, totalInstallments: 1, paidInstallments: 0,
    detalhes: '',
    ciclo: '',
  });


  useEffect(() => {
    if (student) {
      const latestCase = getLatestCancellationCaseForStudent(
        student.id,
        student.name,
        cancellationCases,
      );
      const finance = resolveStudentFinance(student, {
        kaminoPaid: latestCase?.totalPagoAteMomento,
      });
      const embedded = finance.embeddedEntradaInstallment;
      let totalInstallments = student.totalInstallments;
      let paidInstallments = student.paidInstallments;
      if (embedded) {
        totalInstallments = Math.max(
          1,
          (student.installments?.length ?? student.totalInstallments) - 1,
        );
        if (embedded.paid && paidInstallments > 0) {
          paidInstallments = Math.max(0, paidInstallments - 1);
        }
      }
      setForm({
        name: student.name, whatsapp: student.whatsapp, email: student.email || '', cpf: student.cpf,
        address: student.address, numero: student.numero || '', cidade: student.cidade || '', estado: student.estado || '',
        cep: student.cep,
        statusMode: student.statusMode, status: student.status,
        ac: student.ac, product: student.product,
        enrollmentDate: student.enrollmentDate,
        data_treinamento_origem: student.data_treinamento_origem || student.enrollmentDate,
        dueDate: student.installments?.[0]?.dueDate || student.enrollmentDate, dueDay: student.dueDay,
        saleValue: finance.saleValue, downPayment: finance.downPayment,
        totalInstallments, paidInstallments,
        detalhes: student.detalhes || '',
        ciclo: student.ciclo || '',
      });
    }
    // Reset apenas quando o aluno editado muda — não a cada re-render do parent
    // (caso contrário, sincronizações realtime/cálculos derivados reescrevem
    // continuamente o form e perdem a seleção manual de Status feita pelo usuário).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id]);

  const installmentValue = calculateInstallmentValue(form.saleValue, form.downPayment, form.totalInstallments);

  const handleVisualizarContrato = async () => {
    if (!student) return;
    if (!student.iamControlAlunoId) {
      toast.error('Aluno sem vínculo com o IAM Control — contrato indisponível.');
      return;
    }
    setContratoBusy(true);
    try {
      const res = await openIamControlContrato(student);
      if (res.pdf_base64) {
        toast.success(
          res.treinamento
            ? `Contrato aberto: ${res.treinamento}`
            : 'Contrato aberto.',
        );
      } else {
        const status = String(res.status_conciliacao ?? '').toUpperCase();
        const pendente = status === 'PENDENTE' || status.startsWith('PENDENTE_');
        if (pendente || res.aviso) {
          toast.info(
            res.aviso
              || (res.pendente_tipo === 'PIX'
                ? 'Contrato pendente de pagamento via PIX — PDF ainda não disponível.'
                : 'Contrato pendente no IAM Control — aguardando confirmação de pagamento.'),
          );
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível abrir o contrato.');
    } finally {
      setContratoBusy(false);
    }
  };

  const handleVerLinkPagamento = async () => {
    if (!student) return;
    setLinkBusy(true);
    try {
      const link = await openIamControlPaymentLink(student);
      toast.success('Link de pagamento aberto.');
      void link;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível abrir o link de pagamento.');
    } finally {
      setLinkBusy(false);
    }
  };

  const iamPendenteLink = student ? isIamContratoPendenteLink(student) : false;
  const iamPendentePix = student ? isIamContratoPendentePix(student) : false;
  const iamPendente = iamPendenteLink || iamPendentePix;

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (!form.product || !form.product.trim()) {
      toast.error('Selecione um treinamento para concluir o cadastro.');
      return;
    }
    if (form.totalInstallments > rules.maxParcelasCadastro) {
      alert(`Máximo de ${rules.maxParcelasCadastro} parcelas permitido.`);
      return;
    }

    const dup = findDuplicateStudent(
      students,
      {
        cpf: form.cpf,
        product: form.product,
        ciclo: form.ciclo,
        whatsapp: form.whatsapp,
        email: form.email,
        address: form.address,
        numero: form.numero,
        cidade: form.cidade,
        estado: form.estado,
        cep: form.cep,
      },
      student?.id,
    );
    if (dup) {
      toast.error('Cadastro duplicado', {
        description: `${dup.detail}. Mesmo CPF em outro treinamento é permitido; no mesmo treinamento deve existir só uma ficha.`,
      });
      return;
    }

    const now = new Date().toISOString();

    // Deriva dueDay do dueDate escolhido pelo usuário e ajusta o "enrollment" sintético
    // para que a primeira parcela caia exatamente em form.dueDate (o sistema de geração
    // produz a primeira parcela um mês após o enrollment usado).
    const dueDateObj = new Date(form.dueDate + 'T00:00:00');
    const effectiveDueDay = isNaN(dueDateObj.getTime()) ? form.dueDay : dueDateObj.getDate();
    const syntheticEnrollment = new Date(dueDateObj);
    syntheticEnrollment.setMonth(syntheticEnrollment.getMonth() - 1);
    const enrollmentForGen = isNaN(syntheticEnrollment.getTime())
      ? form.enrollmentDate
      : syntheticEnrollment.toISOString().split('T')[0];

    // CRÍTICO: Só regenera o fluxo de parcelas quando algum campo que afeta o
    // cronograma realmente mudou. Caso contrário, preserva as parcelas existentes
    // (com datas de vencimento reais vindas da importação Kamino, pagamentos,
    // tags por parcela, etc.). Regenerar à toa destruía datas como 15/05, 15/06...
    // substituindo-as por datas calculadas a partir de dueDay.
    const scheduleChanged = !student
      || form.totalInstallments !== student.totalInstallments
      || form.paidInstallments !== student.paidInstallments
      || form.saleValue !== student.saleValue
      || form.downPayment !== student.downPayment
      || effectiveDueDay !== student.dueDay;

    const paidQty = Math.max(0, Number(form.paidInstallments) || 0);
    const generated = scheduleChanged
      ? generateInstallments(effectiveDueDay, form.totalInstallments, installmentValue, paidQty, enrollmentForGen)
      : (student?.installments ?? []);
    // Garantia: se nada foi marcado como pago, força paid=false em todas (evita bug
    // de primeira parcela vir marcada como paga em cadastro manual sem preenchimento).
    const installments = paidQty === 0
      ? generated.map((i) => ({ ...i, paid: false, paidDate: undefined }))
      : generated;
    // Garante que o dueDay salvo no aluno coincide com o dueDate escolhido
    form.dueDay = effectiveDueDay;

    if (student) {
      const immediateChanges: string[] = [];
      const financialChanges: string[] = [];
      if (form.name !== student.name) immediateChanges.push(`Nome: ${student.name} → ${form.name}`);
      if (form.whatsapp !== student.whatsapp) immediateChanges.push(`WhatsApp: ${student.whatsapp} → ${form.whatsapp}`);
      if (form.cpf !== student.cpf) immediateChanges.push(`CPF alterado`);
      if ((form.email || '') !== (student.email || '')) immediateChanges.push(`E-mail alterado`);
      if ((form.cep || '') !== (student.cep || '')) immediateChanges.push(`CEP alterado`);
      if ((form.address || '') !== (student.address || '')) immediateChanges.push(`Endereço alterado`);
      if ((form.numero || '') !== (student.numero || '')) immediateChanges.push(`Número alterado`);
      if ((form.cidade || '') !== (student.cidade || '')) immediateChanges.push(`Cidade alterada`);
      if ((form.estado || '') !== (student.estado || '')) immediateChanges.push(`Estado alterado`);
      if ((form.detalhes || '') !== (student.detalhes || '')) immediateChanges.push(`Detalhes alterados`);
      if ((form.ciclo || '') !== (student.ciclo || '')) immediateChanges.push(`Ciclo alterado`);
      if (form.data_treinamento_origem !== (student.data_treinamento_origem || student.enrollmentDate)) immediateChanges.push(`Data de treinamento alterada`);
      if (form.enrollmentDate !== student.enrollmentDate) immediateChanges.push(`Data de inscrição alterada`);
      if (form.ac !== student.ac) immediateChanges.push(`AC: ${student.ac} → ${form.ac}`);
      if (form.product !== student.product) immediateChanges.push(`Produto: ${student.product} → ${form.product}`);
      if (form.statusMode !== student.statusMode) immediateChanges.push(`Modo Status: ${student.statusMode} → ${form.statusMode}`);
      if (form.status !== student.status) immediateChanges.push(`Status: ${student.status} → ${form.status}`);
      if (form.saleValue !== student.saleValue) financialChanges.push(`Valor Venda: ${formatCurrency(student.saleValue)} → ${formatCurrency(form.saleValue)}`);
      if (form.downPayment !== student.downPayment) financialChanges.push(`Entrada: ${formatCurrency(student.downPayment)} → ${formatCurrency(form.downPayment)}`);
      if (form.totalInstallments !== student.totalInstallments) financialChanges.push(`Parcelas: ${student.totalInstallments} → ${form.totalInstallments}`);
      if (form.paidInstallments !== student.paidInstallments) financialChanges.push(`Parcelas Pagas: ${student.paidInstallments} → ${form.paidInstallments}`);
      if (effectiveDueDay !== student.dueDay) financialChanges.push(`Dia de vencimento: ${student.dueDay} → ${effectiveDueDay}`);

      // Preserva tags importadas (não-aluno) que não estão em assignableTags;
      // o picker só mexe em tags de escopo 'student'.
      const importedTagIds = (student.tags || []).filter((id) => !assignableTags.some((t) => t.id === id));
      const mergedTags = Array.from(new Set([...importedTagIds, ...studentTagIds]));
      const prevTags = [...(student.tags || [])].sort().join(',');
      const nextTags = [...mergedTags].sort().join(',');
      if (prevTags !== nextTags) immediateChanges.push(`Tags atualizadas`);

      const applyImmediate = canChooseMode && approvalMode === 'total';
      const historyText = immediateChanges.length > 0
        ? `Ficha editada: ${immediateChanges.join('; ')}.`
        : financialChanges.length > 0
          ? (applyImmediate
              ? 'Ficha financeira aprovada com Conciliação Total.'
              : 'Ficha financeira enviada para Conciliação como rascunho.')
          : 'Ficha aberta e salva sem alterações.';

      updateStudent(student.id, {
        name: form.name,
        whatsapp: form.whatsapp,
        email: form.email,
        cpf: form.cpf,
        address: form.address,
        numero: form.numero,
        cidade: form.cidade,
        estado: form.estado,
        cep: form.cep,
        // status/statusMode NÃO são enviados aqui: eles já são persistidos
        // imediatamente pelos próprios selects (linhas ~446 e ~476). Reenviar
        // aqui causava reversão silenciosa (ex.: Negativado → À Negativar)
        // quando o form ficava defasado em relação ao estado real do aluno.
        ac: form.ac,
        product: form.product,
        enrollmentDate: form.enrollmentDate,
        data_treinamento_origem: form.data_treinamento_origem,
        detalhes: form.detalhes,
        ciclo: form.ciclo || undefined,
        tags: mergedTags,
        history: [
          ...student.history,
          { date: now, type: 'Sistema' as const, text: historyText },
        ],
      });
      if (financialChanges.length > 0) {
        registrarConciliacao({
          tipo: effectiveDueDay !== student.dueDay
            ? 'parcela_vencimento'
            : form.totalInstallments !== student.totalInstallments || form.paidInstallments !== student.paidInstallments
              ? 'parcela_quantidade'
              : 'parcela_valor',
          studentSnapshot: buildStudentSnapshot(student),
          draftAfter: {
            dueDay: effectiveDueDay,
            saleValue: form.saleValue,
            downPayment: form.downPayment,
            totalInstallments: form.totalInstallments,
            paidInstallments: form.paidInstallments,
            installmentValue,
            installments,
          },
          studentId: student.id,
          studentName: student.name,
          ac: student.ac,
          resumo: `Ficha financeira — ${financialChanges.join('; ')}`,
          antes: {
            dueDay: student.dueDay,
            saleValue: student.saleValue,
            downPayment: student.downPayment,
            totalInstallments: student.totalInstallments,
            paidInstallments: student.paidInstallments,
            installmentValue: student.installmentValue,
          },
          depois: {
            dueDay: effectiveDueDay,
            saleValue: form.saleValue,
            downPayment: form.downPayment,
            totalInstallments: form.totalInstallments,
            paidInstallments: form.paidInstallments,
            installmentValue,
          },
          executaImediatamente: applyImmediate,
        });
      }
    } else {
      addStudent({
        ...form,
        id: '',
        installmentValue,
        installments,
        tags: studentTagIds,
        history: [
          {
            date: now,
            type: 'Sistema' as const,
            text: `Aluno cadastrado. Produto: ${form.product}, AC: ${form.ac}, Valor: ${formatCurrency(form.saleValue)}, Entrada: ${formatCurrency(form.downPayment)}, ${form.totalInstallments}x de ${formatCurrency(installmentValue)}.`,
          },
        ],
      } as Student);
    }
    onClose();
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Ficha do Aluno</h2>
            {student && (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  student.iamControlAlunoId
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'bg-muted text-muted-foreground border border-border'
                }`}
                title="Origem do cadastro (somente leitura)"
              >
                {student.iamControlAlunoId
                  ? `Sincronizado com IAM Control #${student.iamControlAlunoId}`
                  : 'Cadastro local'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Identificação */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dados Pessoais</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Nome Completo</label>
                <input className="input-field w-full" placeholder="Nome Completo" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">WhatsApp</label>
                <input className="input-field w-full" placeholder="(00) 00000-0000" value={form.whatsapp} onChange={(e) => set('whatsapp', maskWhatsApp(e.target.value))} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">CPF / CNPJ</label>
                <input className="input-field w-full" placeholder="CPF ou CNPJ" value={form.cpf} onChange={(e) => set('cpf', maskCPFOrCNPJ(e.target.value))} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">CEP</label>
                <input className="input-field w-full" placeholder="00000-000" value={form.cep} onChange={(e) => set('cep', maskCEP(e.target.value))} />
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">E-mail</label>
                <input className="input-field w-full" type="email" placeholder="email@exemplo.com" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div className="md:col-span-1">
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Endereço</label>
                <input className="input-field w-full" placeholder="Rua, Av..." value={form.address} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Número</label>
                <input className="input-field w-full" placeholder="Nº" value={form.numero} onChange={(e) => set('numero', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Cidade</label>
                <input className="input-field w-full" placeholder="Cidade" value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Estado</label>
                <select className="input-field w-full" value={form.estado} onChange={(e) => set('estado', e.target.value)}>
                  <option value="">Selecione</option>
                  {estados.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Detalhes</label>
              <textarea className="input-field w-full min-h-[60px] resize-y" placeholder="Observações gerais..." value={form.detalhes} onChange={(e) => set('detalhes', e.target.value)} />
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Tag size={12} /> Tags
              </h3>
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
                          const checked = studentTagIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTag(t.id)}
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
            {studentTagIds.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nenhuma tag atribuída manualmente.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {studentTagIds.map((id) => {
                  const t = studentTags.find((x) => x.id === id);
                  if (!t) return null;
                  return (
                    <span
                      key={id}
                      className="text-[10px] font-semibold px-2 py-1 rounded-lg border inline-flex items-center gap-1"
                      style={getTagStyle(t.color)}
                    >
                      {t.name}
                      {canManageTags && (
                        <button
                          type="button"
                          onClick={() => toggleTag(id)}
                          title="Remover tag"
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
            {!canManageTags && (
              <p className="text-[10px] text-muted-foreground mt-2">Apenas usuários com permissão total em Alunos podem atribuir tags.</p>
            )}
          </div>



          {/* Financeiro */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Financeiro</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Modo de Status</label>
                <select
                  className="input-field w-full"
                  value={form.statusMode}
                  disabled={student?.status === 'Negativado'}
                  title={student?.status === 'Negativado' ? 'Aluno em Negativado — reverta pelo badge para "À Negativar" ou "Em Dia" antes de trocar o modo.' : undefined}
                  onChange={(e) => {
                    const newMode = e.target.value as StatusMode;
                    // Bloqueio: não permitir sair de Manual quando aluno está Negativado.
                    // Negativado só sai por ação explícita no badge (reverter/quitar).
                    if (student?.status === 'Negativado' && newMode === 'Automático') {
                      toast.error('Aluno em "Negativado" só pode mudar de modo após reverter o status pelo badge.');
                      return;
                    }
                    set('statusMode', newMode);
                    if (student) {
                      // Persiste IMEDIATAMENTE o modo (e o status quando Manual),
                      // sem comparação com student.statusMode — evita que uma
                      // sincronização realtime que chegou antes do clique faça
                      // a comparação ficar "igual" e silenciosamente perder a edição.
                      updateStudent(student.id, {
                        statusMode: newMode,
                        status: newMode === 'Manual' ? form.status : student.status,
                      });
                      toast.success(`Modo de status alterado para ${newMode}.`);
                    }
                  }}
                >
                  <option value="Automático">Automático</option>
                  <option value="Manual">Manual</option>
                </select>
              </div>
              {form.statusMode === 'Manual' && (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Status</label>
                  <select
                    className="input-field w-full"
                    value={form.status}
                    onChange={(e) => {
                      const newStatus = e.target.value as StudentStatus;
                      set('status', newStatus);
                      if (student) {
                        // Sempre persiste a seleção manual — sem guard de
                        // igualdade, que poderia barrar a gravação se o estado
                        // local já tiver sido atualizado por outra via.
                        updateStudent(student.id, {
                          status: newStatus,
                          statusMode: 'Manual',
                          history: [
                            ...(student.history || []),
                            {
                              date: new Date().toISOString(),
                              type: 'Sistema' as const,
                              text: `Status alterado manualmente para "${newStatus}".`,
                            },
                          ],
                        });
                        toast.success(`Status atualizado para "${newStatus}".`);
                      }
                    }}
                  >
                    {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Assessor de Conta</label>
                <select className="input-field w-full" value={form.ac} onChange={(e) => set('ac', e.target.value)}>
                  {!student && (
                    <option value="">
                      {isProductExcludedFromEsteira(form.product)
                        ? '— Sem assessor (fora da esteira) —'
                        : '— Automático (esteira) —'}
                    </option>
                  )}
                  {acs.filter((g) => g.active).map((g) => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>
                {!student && !form.ac && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {isProductExcludedFromEsteira(form.product)
                      ? 'IPR e Imersão de Negócios não entram na esteira — escolha o assessor manualmente se quiser.'
                      : 'Sem assessor escolhido, o próximo da esteira recebe o aluno automaticamente.'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  Treinamento <span className="text-destructive">*</span>
                </label>
                <select className="input-field w-full" value={form.product} onChange={(e) => set('product', e.target.value)}>
                  <option value="">— Selecione um treinamento —</option>
                  {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block" title="Ex.: 2026, 2027. Mesmo CPF + mesmo treinamento + ciclos diferentes = fichas separadas (renovação).">
                  Ciclo do contrato <span className="text-muted-foreground/60 font-normal">(opcional)</span>
                </label>
                <input
                  className="input-field w-full"
                  placeholder="Ex.: 2026"
                  value={form.ciclo}
                  onChange={(e) => set('ciclo', e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Data de Inscrição</label>
                <input className="input-field w-full" type="date" value={form.enrollmentDate} onChange={(e) => set('enrollmentDate', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Data de Competência</label>
                <input className="input-field w-full" type="date" value={form.data_treinamento_origem} onChange={(e) => set('data_treinamento_origem', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Data Vencimento</label>
                <input className="input-field w-full" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Valor Contrato</label>
                <CurrencyInput value={form.saleValue} onChange={(v) => set('saleValue', v)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Valor Entrada</label>
                <CurrencyInput value={form.downPayment} onChange={(v) => set('downPayment', v)} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Número de Parcelas</label>
                <input className="input-field w-full" type="number" placeholder="Qtd" min="1" max={rules.maxParcelasCadastro} value={form.totalInstallments || ''} onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > rules.maxParcelasCadastro) return;
                  set('totalInstallments', v);
                }} />
                <p className="text-[9px] text-muted-foreground mt-0.5">Máx: {rules.maxParcelasCadastro}</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Qtd Parcelas Pagas</label>
                <input className="input-field w-full" type="number" placeholder="Qtd" min="0" value={form.paidInstallments ?? ''} onChange={(e) => set('paidInstallments', Number(e.target.value))} />
              </div>
            </div>
            <div className="mt-3 p-3 bg-muted rounded-xl flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Valor Parcela</span>
              <span className="text-sm font-bold iam-text-gradient">
                {formatCurrency(installmentValue)}
              </span>
            </div>
          </div>
        </div>

        {canChooseMode && (
          <div className="px-6 pt-4 pb-2">
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-[11px] font-semibold text-foreground/80 mb-2">
                Modo de aprovação (aplica a alterações financeiras: valor, entrada, parcelas, vencimento)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalMode('total')}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors text-xs ${
                    approvalMode === 'total'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm'
                      : 'bg-card border-border text-foreground/70 hover:bg-muted'
                  }`}
                  title="Aplica as alterações imediatamente e já registra como conciliadas (auditoria)."
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Check size={12} /> Aprovar com Conciliação Total
                  </div>
                  <div className="text-[10px] font-normal text-foreground/60 mt-0.5">
                    Efetiva na hora, sem pendência.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalMode('send')}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors text-xs ${
                    approvalMode === 'send'
                      ? 'bg-amber-50 border-amber-300 text-amber-800 shadow-sm'
                      : 'bg-card border-border text-foreground/70 hover:bg-muted'
                  }`}
                  title="Registra a alteração como pendência na aba Conciliação, para revisão."
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <FileText size={12} /> Aprovar e enviar para Conciliação
                  </div>
                  <div className="text-[10px] font-normal text-foreground/60 mt-0.5">
                    Vai para a fila de conciliação.
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {student && student.iamControlAlunoId && iamPendente && (
          <div className="px-6 pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-50/50 px-4 py-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                  Pendente {iamPendenteLink ? '(link)' : '(pix)'}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Aguardando confirmação do pagamento via {iamPendenteLink ? 'link' : 'PIX'} no IAM Control.
                </p>
              </div>
              {iamPendenteLink && (
                <button
                  type="button"
                  onClick={() => void handleVerLinkPagamento()}
                  disabled={linkBusy}
                  className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  <ExternalLink size={14} />
                  {linkBusy ? 'Abrindo link...' : 'Ver link de pagamento'}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="p-6 border-t border-border flex gap-3 justify-end flex-wrap">
          {student && (
            <button
              type="button"
              onClick={() => void handleVisualizarContrato()}
              disabled={contratoBusy || !student.iamControlAlunoId}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                student.iamControlAlunoId
                  ? 'Abre o contrato deste aluno no IAM Control (conciliado ou pendente).'
                  : 'Disponível apenas para alunos sincronizados com o IAM Control.'
              }
            >
              <FileText size={14} />
              {contratoBusy ? 'Abrindo contrato...' : 'Visualizar Contrato'}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
