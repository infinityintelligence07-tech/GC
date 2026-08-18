import { Student, canConfirmarPagamento } from '@/types';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { X, Lock } from 'lucide-react';

interface Props {
  student: Student;
  onClose: () => void;
}

export default function RendaExtraModal({ student, onClose }: Props) {
  const { rules, updateStudent, currentUser } = useAppStore();
  const podeConfirmarPagto = canConfirmarPagamento(currentUser);

  const saldoOriginal = student.installments
    .filter((i) => !i.paid)
    .reduce((acc, i) => acc + i.value, 0);

  const valorQuitacao = saldoOriginal * (1 - rules.descontoRendaExtra / 100);

  const handleConfirm = () => {
    const updated = student.installments.map((i) =>
      !i.paid ? { ...i, paid: true, paidDate: new Date().toISOString().split('T')[0] } : i
    );
    updateStudent(student.id, {
      installments: updated,
      paidInstallments: updated.length,
      status: 'Em Dia',
      history: [
        ...student.history,
        {
          date: new Date().toISOString(),
          type: 'Sistema',
          text: `Liquidação Renda Extra: ${formatCurrency(valorQuitacao)} (desconto ${rules.descontoRendaExtra}%)`,
        },
      ],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Liquidação Renda Extra</h2>
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
            <span className="text-xs text-muted-foreground">Saldo Original:</span>
            <span className="text-sm font-semibold text-foreground">{formatCurrency(saldoOriginal)}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-primary/5 rounded-xl border border-primary/20">
            <span className="text-xs text-primary">Valor Quitação ({rules.descontoRendaExtra}% desc.):</span>
            <span className="text-lg font-bold iam-text-gradient">{formatCurrency(valorQuitacao)}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!podeConfirmarPagto}
            title={!podeConfirmarPagto ? 'Você não tem permissão para confirmar pagamentos' : undefined}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {!podeConfirmarPagto && <Lock size={13} />}
            Confirmar Acordo
          </button>
        </div>
      </div>
    </div>
  );
}
