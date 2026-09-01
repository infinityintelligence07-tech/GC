import { useState, useRef, useEffect } from 'react';
import { ChevronDown, CheckCircle2 } from 'lucide-react';
import { Student, StudentStatus, canEditTab } from '@/types';
import { statusColors } from '@/lib/statusColors';
import { calculateAutoStatus, useAppStore } from '@/store/useAppStore';
import { toast } from 'sonner';
import FinancialModal from '@/components/modals/FinancialModal';
import { useConfirm } from '@/hooks/useConfirm';

interface StatusBadgeManualProps {
  student: Student;
  status: StudentStatus;
  /** Quando true, o badge fica estático (sem menu de alteração). */
  readOnly?: boolean;
}

/**
 * Badge de status com promoção MANUAL inline.
 * Regras:
 *  - "À Negativar" → permite promover para "Negativado"
 *  - "Negativado"  → Admin pode reverter para "À Negativar"
 *  - "Negativado" / "À Negativar" / "Vencido 1" / "Vencido 2"
 *    → usuários com edição em Alunos podem voltar para "Em Dia"
 *      (abre Gestão Financeira para registrar pagamentos)
 *  - Demais status → badge estático (não clicável)
 *
 * Observação: a transição "Negativado → Renda Extra" NÃO é manual.
 * Ela acontece automaticamente quando o aluno é conciliado em
 * "Conciliar Exclusão" na aba Renda Extra.
 */
export default function StatusBadgeManual({ student, status, readOnly = false }: StatusBadgeManualProps) {
  const [open, setOpen] = useState(false);
  const [showFinancial, setShowFinancial] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const updateStudent = useAppStore((s) => s.updateStudent);
  const markStudentNegativado = useAppStore((s) => s.markStudentNegativado);
  const currentUser = useAppStore((s) => s.currentUser);
  const confirm = useConfirm();
  const isAdmin = currentUser?.role === 'admin';
  const canEditAlunos = !readOnly && canEditTab(currentUser, 'alunos');
  const canConciliar = !readOnly && (canEditTab(currentUser, 'conciliacao') || currentUser?.role === 'admin' || currentUser?.role === 'conciliacao');

  // Opções de promoção disponíveis a partir do status atual
  const options: { key: string; label: React.ReactNode; variant?: 'default' | 'success'; action: () => void }[] = [];
  if (!readOnly && status === 'À Negativar') {
    options.push({
      key: 'negativado',
      label: 'Negativado',
      action: async () => {
        try {
          await markStudentNegativado(student.id);
          toast.success(`${student.name} marcado como Negativado.`);
        } catch {
          // O store reverte a mudança visual e mostra o erro real ao usuário.
        }
      },
    });
  }
  if (!readOnly && status === 'Negativado' && isAdmin) {
    options.push({
      key: 'a-negativar',
      label: 'À Negativar',
      action: () => {
        if (!window.confirm('Deseja reverter o status deste aluno de "Negativado" para "À Negativar"?')) return;
        updateStudent(student.id, {
          status: 'À Negativar',
          statusMode: 'Manual',
          history: [
            ...student.history,
            { date: new Date().toISOString(), type: 'Sistema', text: 'Admin reverteu o status de Negativado para À Negativar.' },
          ],
        });
        toast.success(`${student.name} revertido para À Negativar.`);
      },
    });
  }
  if (status === 'Negativado' && canEditAlunos) {
    options.push({
      key: 'inadimplencia-automatica',
      label: 'Voltar para inadimplência',
      action: () => {
        const restoredStatus = calculateAutoStatus(student.installments);
        if (!window.confirm(`Deseja tirar este aluno de "Negativado" e voltar para o status automático "${restoredStatus}"?`)) return;
        const now = new Date().toISOString();
        updateStudent(student.id, {
          status: restoredStatus,
          statusMode: 'Automático',
          history: [
            ...student.history,
            {
              date: now,
              type: 'Sistema' as const,
              text: `${currentUser?.name ?? 'Usuário'} reverteu "Negativado" para o status automático "${restoredStatus}".`,
            },
          ],
        });
        toast.success(`${student.name} voltou para ${restoredStatus}.`);
      },
    });
  }
  if (canEditAlunos && ['Negativado', 'À Negativar', 'Vencido 1', 'Vencido 2'].includes(status)) {
    options.push({
      key: 'voltar-em-dia',
      label: (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 size={10} />
          Voltar para Em Dia
        </span>
      ),
      variant: 'success',
      action: async () => {
        const paid = await confirm({
          title: 'Voltar para "Em Dia"',
          description: 'O aluno realizou o pagamento das parcelas em aberto?\n\nSe SIM, abriremos a Gestão Financeira para você apontar os valores e datas dos pagamentos. O status voltará automaticamente para "Em Dia" após o lançamento.',
          confirmText: 'Sim, registrar pagamentos',
          cancelText: 'Não, cancelar',
        });
        if (!paid) return;
        const now = new Date().toISOString();
        updateStudent(student.id, {
          statusMode: 'Automático',
          history: [
            ...student.history,
            {
              date: now,
              type: 'Sistema' as const,
              text: `${currentUser?.name ?? 'Usuário'} iniciou retorno para "Em Dia" — registrando pagamentos das parcelas em aberto.`,
            },
          ],
        });
        setShowFinancial(true);
      },
    });
  }

  const isClickable = options.length > 0;

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, [open]);

  if (!isClickable) {
    return (
      <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${statusColors[status]}`}>
        {status}
      </span>
    );
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${statusColors[status]} inline-flex items-center gap-1 hover:brightness-95 transition`}
        title="Clique para alterar manualmente o status"
      >
        {status}
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-2 py-1">Mudar para</p>
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                opt.action();
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 hover:bg-muted/60 transition"
            >
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1 ${
                  opt.variant === 'success'
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : statusColors[opt.key as StudentStatus] ?? 'bg-muted'
                }`}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {showFinancial && (
        <FinancialModal
          student={student}
          onClose={() => setShowFinancial(false)}
          immediateApply={canConciliar}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
