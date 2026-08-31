import { useMemo, useState } from 'react';
import { AC, Student } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { X } from 'lucide-react';

interface Props {
  ac: AC;
  onClose: () => void;
}

export default function TransferModal({ ac, onClose }: Props) {
  const { acs, students, cancellationCases, updateStudent, updateCancellationCase, deleteAC } = useAppStore();
  const availableACs = acs.filter((g) => g.id !== ac.id && g.active);
  const acStudents = students.filter((s) => s.ac === ac.name);

  // Distribution: selected ACs to receive
  const [selectedACs, setSelectedACs] = useState<string[]>(availableACs.map((g) => g.id));
  const [running, setRunning] = useState(false);

  const toggleAC = (id: string) => {
    setSelectedACs((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Agrupa por TODOS os status presentes (inclui Pago, Cancelado, Aluno Novo etc.)
  const statusesPresent = useMemo(() => {
    const map = new Map<string, number>();
    acStudents.forEach((s) => map.set(s.status, (map.get(s.status) ?? 0) + 1));
    return Array.from(map.entries());
  }, [acStudents]);

  const handleTransfer = async () => {
    if (selectedACs.length === 0 || running) return;
    setRunning(true);
    const targetACs = availableACs.filter((g) => selectedACs.includes(g.id));
    const targetByStudentId = new Map<string, string>();

    // Distribui proporcionalmente DENTRO de cada status, mas considerando TODOS os status
    const byStatus = new Map<string, Student[]>();
    acStudents.forEach((s) => {
      const arr = byStatus.get(s.status) ?? [];
      arr.push(s);
      byStatus.set(s.status, arr);
    });

    byStatus.forEach((group) => {
      group.forEach((student, idx) => {
        const targetAC = targetACs[idx % targetACs.length];
        targetByStudentId.set(student.id, targetAC.name);
        updateStudent(student.id, {
          ac: targetAC.name,
          history: [
            ...student.history,
            {
              date: new Date().toISOString(),
              type: 'Sistema' as const,
              text: `Carteira transferida de ${ac.name} para ${targetAC.name}.`,
            },
          ],
        });
      });
    });

    // Casos ativos acompanham o aluno. Comissões e casos finalizados permanecem
    // com o assessor original para preservar o histórico operacional/contábil.
    cancellationCases
      .filter((c) =>
        c.ac === ac.name &&
        c.funnelStage !== 'Finalizado' &&
        !['Cancelado', 'Recuperado', 'Negativação Efetivada', 'Negativação Retirada'].includes(c.stage),
      )
      .forEach((c) => {
        const targetName = c.studentId ? targetByStudentId.get(c.studentId) : undefined;
        if (targetName) updateCancellationCase(c.id, { ac: targetName });
      });

    // Pequeno atraso pra garantir que os updates entrem na fila antes do delete
    await new Promise((r) => setTimeout(r, 300));
    deleteAC(ac.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-md shadow-2xl border border-border">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Transferir Carteira</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground">
            O assessor <strong className="text-foreground">{ac.name}</strong> possui{' '}
            <strong className="text-foreground">{acStudents.length}</strong> aluno(s).
            Selecione os assessores que receberão a carteira (distribuição proporcional por status):
          </p>

          <div className="space-y-2">
            {statusesPresent.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum aluno vinculado.</p>
            ) : statusesPresent.map(([status, count]) => (
              <div key={status} className="flex justify-between text-xs p-2 bg-muted/50 rounded-lg">
                <span className="text-muted-foreground">{status}</span>
                <span className="font-semibold text-foreground">{count} aluno(s)</span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase">Destino</p>
            {availableACs.length === 0 ? (
              <p className="text-xs text-destructive">Nenhum assessor disponível para transferência.</p>
            ) : (
              availableACs.map((g) => (
                <label key={g.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedACs.includes(g.id)}
                    onChange={() => toggleAC(g.id)}
                    className="rounded"
                  />
                  <span className="text-sm text-foreground">{g.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="p-6 border-t border-border flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground">
            Cancelar
          </button>
          <button
            onClick={handleTransfer}
            disabled={selectedACs.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md disabled:opacity-40"
          >
            Transferir e Excluir AC
          </button>
        </div>
      </div>
    </div>
  );
}
