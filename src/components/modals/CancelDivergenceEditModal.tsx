// ─── Ajuste financeiro pré-cancelamento (autonomia limitada ao AC) ──────────
// Este modal só é aberto pelo `CancelStudentFlowModal` quando o total pago
// informado pelo AC (Kamino) diverge do fluxo atual do aluno. Permite editar
// APENAS os campos financeiros exibidos no print (Modo Status, AC,
// Treinamento, Ciclo, Data de Inscrição, Data de Competência, Data de
// Vencimento, Valor Contrato, Valor Entrada, Nº de Parcelas, Qtd Parcelas
// Pagas). Em outras partes do sistema o AC NÃO tem essa autonomia.
//
// Após salvar:
//  1. Aplica as alterações no aluno (regenerando o fluxo de parcelas).
//  2. Registra um item na aba Conciliação (tipo `correcao_contrato`) com o
//     antes/depois para o setor de Conciliação fazer o double-check.
//  3. Dispara notificação para os usuários da Conciliação e Admins.
//  4. Retorna as tags/notas necessárias para marcar o card do cancelamento
//     com um destaque específico (ver `CancelStudentFlowModal`).
import { useMemo, useState } from 'react';
import { Student, StatusMode } from '@/types';
import {
  useAppStore,
  calculateInstallmentValue,
  generateInstallments,
  formatCurrency,
} from '@/store/useAppStore';
import { registrarConciliacao } from '@/store/useConciliacaoStore';
import { useNotificationsStore } from '@/store/useNotificationsStore';
import { PencilLine, ShieldAlert } from 'lucide-react';
import { useConfirm } from '@/hooks/useConfirm';
import { AJUSTE_TAG, FIELD_LABELS, type DivergenceField } from '@/lib/doubleCheckRejection';



interface Props {
  student: Student;
  onClose: () => void;
  onSaved: (info: { summary: string; ajusteTag: string }) => void;
  /**
   * Quando informado, SOMENTE estes campos ficam editáveis. Usado na correção
   * pós-reprovação da Conciliação (double-check): o AC só pode mexer no que
   * ele mesmo alterou e foi reprovado.
   */
  allowedFields?: DivergenceField[];
  /** Motivo da reprovação da Conciliação (exibido em destaque no topo). */
  rejectionMotivo?: string;
  rejectionBy?: string;
}


// Máscara de moeda BRL: usuário digita e o valor vai formatando (R$ 1.000,00)
function brlMask(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits === '') return '';
  const cents = Number(digits) / 100;
  return cents.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function brlParse(masked: string): number {
  const digits = String(masked ?? '').replace(/\D/g, '');
  if (digits === '') return NaN;
  return Number(digits) / 100;
}

// Converte número inicial (ex: 1875) para dígitos em centavos e aplica máscara
function brlFromNumber(v: string): string {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CancelDivergenceEditModal({ student, onClose, onSaved, allowedFields, rejectionMotivo, rejectionBy }: Props) {
  const { acs, products, rules, updateStudent, appUsers, currentUser } = useAppStore();
  const notify = useNotificationsStore((s) => s.notify);
  const confirm = useConfirm();
  // Campos bloqueados na correção pós-reprovação
  const locked = (k: DivergenceField) => !!allowedFields && !allowedFields.includes(k);



  const firstDue = student.installments?.[0]?.dueDate || student.enrollmentDate;
  const [form, setForm] = useState({
    statusMode: student.statusMode as StatusMode,
    ac: student.ac,
    product: student.product,
    ciclo: student.ciclo || '',
    enrollmentDate: student.enrollmentDate,
    data_treinamento_origem: student.data_treinamento_origem || student.enrollmentDate,
    dueDate: firstDue,
    // Campos numéricos como string para permitir "0" explícito e detectar vazio
    saleValue: brlFromNumber(String(student.saleValue ?? '')),
    downPayment: brlFromNumber(String(student.downPayment ?? '')),
    totalInstallments: String(student.totalInstallments ?? ''),
    paidInstallments: String(student.paidInstallments ?? ''),
  });

  const num = (v: string) => {
    const t = v.trim();
    if (t === '') return NaN;
    if (/[R$.,\s]/.test(t)) return brlParse(t);
    return Number(t);
  };
  const saleValueNum = num(form.saleValue);
  const downPaymentNum = num(form.downPayment);
  const totalInstNum = num(form.totalInstallments);
  const paidInstNum = num(form.paidInstallments);

  const installmentValue = useMemo(
    () =>
      calculateInstallmentValue(
        Number.isFinite(saleValueNum) ? saleValueNum : 0,
        Number.isFinite(downPaymentNum) ? downPaymentNum : 0,
        Number.isFinite(totalInstNum) && totalInstNum > 0 ? totalInstNum : 1,
      ),
    [saleValueNum, downPaymentNum, totalInstNum],
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Todos os campos são obrigatórios (0 é válido) — exceto "Ciclo do contrato".
  const missing = {
    statusMode: !form.statusMode,
    ac: !form.ac,
    product: !form.product || form.product.trim().toLowerCase() === 'sem treinamento',
    enrollmentDate: !form.enrollmentDate,
    data_treinamento_origem: !form.data_treinamento_origem,
    dueDate: !form.dueDate,
    saleValue: !Number.isFinite(saleValueNum) || saleValueNum < 0,
    downPayment: !Number.isFinite(downPaymentNum) || downPaymentNum < 0,
    totalInstallments:
      !Number.isFinite(totalInstNum) ||
      totalInstNum <= 0 ||
      totalInstNum > rules.maxParcelasCadastro,
    paidInstallments:
      !Number.isFinite(paidInstNum) ||
      paidInstNum < 0 ||
      (Number.isFinite(totalInstNum) && paidInstNum > totalInstNum),
  };
  const canSave = !Object.values(missing).some(Boolean);
  const errCls = (bad: boolean) => (bad ? ' border-destructive focus:border-destructive' : '');

  const handleSave = async () => {
    if (!canSave) return;

    // 1) Confirmação obrigatória quando a entrada for zero
    if (downPaymentNum === 0) {
      const okEntrada = await confirm({
        title: 'Confirmar valor de entrada zerado',
        description:
          'O campo "Valor Entrada" está como R$ 0,00.\n\nConfirma que o aluno realmente NÃO deu nenhuma entrada neste contrato?',
        confirmText: 'Sim, sem entrada',
        cancelText: 'Não, revisar',
        highlightCancel: true,
      });
      if (!okEntrada) return;
    }

    // 2) Confirmação do valor total do contrato (sempre, qualquer valor)
    const okContrato = await confirm({
      title: 'Confirmar valor do contrato',
      description: `O "Valor Contrato" informado é ${formatCurrency(saleValueNum)}.\n\nEste valor condiz com o valor TOTAL do contrato do aluno?`,
      confirmText: 'Sim, confirmar',
      cancelText: 'Não, revisar',
      highlightCancel: true,
    });
    if (!okContrato) return;


    // Regenera fluxo de parcelas com base nos novos campos financeiros.
    const dueDateObj = new Date(form.dueDate + 'T00:00:00');
    const effectiveDueDay = isNaN(dueDateObj.getTime())
      ? student.dueDay
      : dueDateObj.getDate();
    const syntheticEnrollment = new Date(dueDateObj);
    syntheticEnrollment.setMonth(syntheticEnrollment.getMonth() - 1);
    const enrollmentForGen = isNaN(syntheticEnrollment.getTime())
      ? form.enrollmentDate
      : syntheticEnrollment.toISOString().split('T')[0];

    const paidQty = Math.max(0, paidInstNum || 0);
    const installments = generateInstallments(
      effectiveDueDay,
      totalInstNum,
      installmentValue,
      paidQty,
      enrollmentForGen,
    );

    // Snapshot antes/depois (para conciliação)
    const antes: Record<string, unknown> = {
      statusMode: student.statusMode,
      ac: student.ac,
      product: student.product,
      ciclo: student.ciclo || '',
      enrollmentDate: student.enrollmentDate,
      data_treinamento_origem: student.data_treinamento_origem,
      dueDay: student.dueDay,
      saleValue: student.saleValue,
      downPayment: student.downPayment,
      totalInstallments: student.totalInstallments,
      paidInstallments: student.paidInstallments,
      installmentValue: student.installmentValue,
    };
    const depois: Record<string, unknown> = {
      statusMode: form.statusMode,
      ac: form.ac,
      product: form.product,
      ciclo: form.ciclo,
      enrollmentDate: form.enrollmentDate,
      data_treinamento_origem: form.data_treinamento_origem,
      dueDay: effectiveDueDay,
      saleValue: saleValueNum,
      downPayment: downPaymentNum,
      totalInstallments: totalInstNum,
      paidInstallments: paidQty,
      installmentValue,
    };

    // Aplica no aluno
    updateStudent(student.id, {
      statusMode: form.statusMode,
      ac: form.ac,
      product: form.product,
      ciclo: form.ciclo || undefined,
      enrollmentDate: form.enrollmentDate,
      data_treinamento_origem: form.data_treinamento_origem,
      dueDay: effectiveDueDay,
      saleValue: saleValueNum,
      downPayment: downPaymentNum,
      totalInstallments: totalInstNum,
      paidInstallments: paidQty,
      installmentValue,
      installments,
      history: [
        ...(student.history ?? []),
        {
          date: new Date().toISOString(),
          type: 'Sistema',
          text: `Ajuste financeiro pré-cancelamento realizado pelo AC${
            currentUser?.name ? ` ${currentUser.name}` : ''
          } (aguardando double-check da Conciliação).`,
        },
      ],
    });

    // Diff textual para a Conciliação
    const changes: string[] = [];
    if (antes.saleValue !== depois.saleValue)
      changes.push(`Contrato: ${formatCurrency(antes.saleValue as number)} → ${formatCurrency(depois.saleValue as number)}`);
    if (antes.downPayment !== depois.downPayment)
      changes.push(`Entrada: ${formatCurrency(antes.downPayment as number)} → ${formatCurrency(depois.downPayment as number)}`);
    if (antes.totalInstallments !== depois.totalInstallments)
      changes.push(`Parcelas: ${antes.totalInstallments} → ${depois.totalInstallments}`);
    if (antes.paidInstallments !== depois.paidInstallments)
      changes.push(`Pagas: ${antes.paidInstallments} → ${depois.paidInstallments}`);
    if (antes.dueDay !== depois.dueDay)
      changes.push(`Dia venc.: ${antes.dueDay} → ${depois.dueDay}`);
    if (antes.ac !== depois.ac) changes.push(`AC: ${antes.ac} → ${depois.ac}`);
    if (antes.product !== depois.product)
      changes.push(`Treinamento: ${antes.product} → ${depois.product}`);
    if (antes.ciclo !== depois.ciclo)
      changes.push(`Ciclo: ${antes.ciclo || '—'} → ${depois.ciclo || '—'}`);
    if (antes.enrollmentDate !== depois.enrollmentDate)
      changes.push(`Data insc.: ${antes.enrollmentDate} → ${depois.enrollmentDate}`);
    if (antes.data_treinamento_origem !== depois.data_treinamento_origem)
      changes.push(`Data comp.: ${antes.data_treinamento_origem} → ${depois.data_treinamento_origem}`);
    if (antes.statusMode !== depois.statusMode)
      changes.push(`Modo: ${antes.statusMode} → ${depois.statusMode}`);

    const resumo =
      changes.length > 0
        ? `[${AJUSTE_TAG}] ${changes.join(' | ')}`
        : `[${AJUSTE_TAG}] Ajuste registrado sem diferenças detectáveis`;

    // Registra na Conciliação para double-check
    registrarConciliacao({
      tipo: 'correcao_contrato',
      studentId: student.id,
      studentName: student.name,
      ac: form.ac,
      resumo,
      antes,
      depois,
      autorObservacao:
        allowedFields
          ? 'Correção enviada pelo AC após reprovação da Conciliação (double-check). Somente os campos reprovados foram liberados para edição.'
          : 'Ajuste realizado pelo AC durante o fluxo de cancelamento (divergência de valores com o Kamino). Requer double-check.',
    });

    // Notifica Conciliação e Admins
    const alvos = appUsers.filter((u) => u.role === 'conciliacao' || u.role === 'admin');
    alvos.forEach((u) => {
      notify({
        userId: u.id,
        acId: u.acId,
        type: 'conciliacao_pre_aprovada',
        title: `Ajuste financeiro pré-cancelamento — ${student.name}`,
        body: `AC${currentUser?.name ? ` ${currentUser.name}` : ''} editou dados do contrato antes de enviar o aluno para cancelamento. Confira em Conciliação.`,
        meta: { studentId: student.id, tag: AJUSTE_TAG },
      }).catch(() => {});
    });

    onSaved({ summary: resumo, ajusteTag: AJUSTE_TAG });
  };

  return (
    <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[70] fade-in p-4">
      <div className="bg-card rounded-2xl w-full max-w-2xl p-6 shadow-2xl border border-border space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <PencilLine size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {allowedFields ? 'Corrigir dados reprovados na Conciliação' : 'Ajustar dados do contrato'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {allowedFields
                ? 'Somente os campos apontados na reprovação estão liberados para edição.'
                : (<>Autonomia liberada <strong>apenas neste fluxo</strong> de cancelamento. As alterações serão enviadas para <strong>double-check da Conciliação</strong>.</>)}
            </p>
          </div>
        </div>

        {allowedFields && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800 space-y-1">
            <p className="font-semibold uppercase tracking-wider text-[10px]">Conciliação reprovada — ajuste necessário</p>
            {rejectionMotivo && <p className="whitespace-pre-wrap">{rejectionMotivo}</p>}
            <p className="text-rose-700/80">
              {rejectionBy ? `Reprovado por ${rejectionBy}. ` : ''}
              Campos liberados: {allowedFields.map((f) => FIELD_LABELS[f]).join(', ') || '—'}.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800 flex gap-2 items-start">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-blue-600" />
          <span>
            Observe atentamente para preencher todos os campos. Confira campo a campo para ver se bate com os dados da kamino e dados do contrato do aluno.
          </span>
        </div>


        <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground pt-1">
          Financeiro
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Modo de Status *</label>
            <select
              className="input-field w-full text-xs"
              value={form.statusMode}
              onChange={(e) => set('statusMode', e.target.value as StatusMode)}
              disabled={locked('statusMode')}
            >
              <option value="Automático">Automático</option>
              <option value="Manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Assessor de Conta *</label>
            <select
              className={'input-field w-full text-xs' + errCls(missing.ac)}
              value={form.ac}
              onChange={(e) => set('ac', e.target.value)}
              disabled={locked('ac')}
            >
              {acs.map((a) => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Treinamento *</label>
            <select
              className={'input-field w-full text-xs' + errCls(missing.product)}
              value={form.product}
              onChange={(e) => set('product', e.target.value)}
              disabled={locked('product')}
            >
              {products.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
              Ciclo do contrato <span className="text-muted-foreground/70 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              className="input-field w-full text-xs"
              placeholder="Ex.: 2026"
              value={form.ciclo}
              onChange={(e) => set('ciclo', e.target.value)}
              disabled={locked('ciclo')}
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Data de Inscrição *</label>
            <input
              type="date"
              className={'input-field w-full text-xs' + errCls(missing.enrollmentDate)}
              value={form.enrollmentDate}
              onChange={(e) => set('enrollmentDate', e.target.value)}
              disabled={locked('enrollmentDate')}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Data de Competência *</label>
            <input
              type="date"
              className={'input-field w-full text-xs' + errCls(missing.data_treinamento_origem)}
              value={form.data_treinamento_origem}
              onChange={(e) => set('data_treinamento_origem', e.target.value)}
              disabled={locked('data_treinamento_origem')}
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Data Vencimento *</label>
            <input
              type="date"
              className={'input-field w-full text-xs' + errCls(missing.dueDate)}
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
              disabled={locked('dueDate')}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Valor Total do Contrato *</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="R$ 0,00"
              className={'input-field w-full text-xs' + errCls(missing.saleValue)}
              value={form.saleValue}
              onChange={(e) => set('saleValue', brlMask(e.target.value))}
              disabled={locked('saleValue')}
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Valor da Entrada do Contrato *</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="R$ 0,00"
              className={'input-field w-full text-xs' + errCls(missing.downPayment)}
              value={form.downPayment}
              onChange={(e) => set('downPayment', brlMask(e.target.value))}
              disabled={locked('downPayment')}
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Número de Parcelas *</label>
            <input
              type="number"
              min={1}
              max={rules.maxParcelasCadastro}
              className={'input-field w-full text-xs' + errCls(missing.totalInstallments)}
              value={form.totalInstallments}
              onChange={(e) => set('totalInstallments', e.target.value)}
              disabled={locked('totalInstallments')}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Máx: {rules.maxParcelasCadastro}</p>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Qtd Parcelas Pagas *</label>
            <input
              type="number"
              min={0}
              max={Number.isFinite(totalInstNum) ? totalInstNum : undefined}
              placeholder="0"
              className={'input-field w-full text-xs' + errCls(missing.paidInstallments)}
              value={form.paidInstallments}
              onChange={(e) => set('paidInstallments', e.target.value)}
              disabled={locked('paidInstallments')}
            />
          </div>


          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
              Valor da parcela <span className="text-muted-foreground/70 font-normal">(calculado)</span>
            </label>
            <div className="input-field w-full text-xs bg-muted/40 text-muted-foreground">
              {formatCurrency(installmentValue)}
            </div>
          </div>
        </div>

        {!canSave && (
          <p className="text-[11px] text-destructive">
            Preencha todos os campos obrigatórios (*). Valores podem ser 0, mas não podem ficar em branco. Apenas "Ciclo do contrato" é opcional.
          </p>
        )}



        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {allowedFields ? 'Salvar correção e reenviar para Conciliação' : 'Salvar e enviar para Conciliação'}
          </button>
        </div>
      </div>
    </div>
  );
}
