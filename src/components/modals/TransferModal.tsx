import { useMemo, useState } from 'react';
import { AC, Student } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { createAC, updateCancellationCaseDb, updateStudentDb } from '@/lib/supabaseMutations';
import { X } from 'lucide-react';

interface Props {
  ac: AC;
  onClose: () => void;
}

export default function TransferModal({ ac, onClose }: Props) {
  const {
    acs,
    students,
    cancellationCases,
    appUsers,
    updateStudent,
    updateCancellationCase,
    deleteAC,
  } = useAppStore();
  const availableACs = acs.filter((g) => g.id !== ac.id && g.active);
  const acStudents = students.filter((s) => s.ac === ac.name);
  const unlinkedAcUsers = appUsers.filter(
    (user) =>
      (user.role === 'ac' || user.role === 'acn2') &&
      !acs.some((candidate) => candidate.name.trim().toLowerCase() === user.name.trim().toLowerCase()),
  );

  // Distribution: selected ACs to receive
  const [selectedACs, setSelectedACs] = useState<string[]>([]);
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
    try {
      const selectedExistingACs = availableACs.filter((g) => selectedACs.includes(g.id));
      const selectedUsers = unlinkedAcUsers.filter((user) => selectedACs.includes(`user:${user.id}`));
      const createdACs = await Promise.all(
        selectedUsers.map(async (user) => {
          const row = await createAC({ name: user.name, active: true, photo: user.photo });
          return { id: row.id, name: row.name, active: row.active, photo: row.photo ?? undefined };
        }),
      );
      const targetACs = [...selectedExistingACs, ...createdACs];
      if (targetACs.length === 0) return;

      useAppStore.setState((state) => ({
        acs: [
          ...state.acs,
          ...createdACs.filter((created) => !state.acs.some((item) => item.id === created.id)),
        ],
      }));

      const targetByStudentId = new Map<string, string>();
      const persistenceJobs: Promise<unknown>[] = [];

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
          const history = [
            ...student.history,
            {
              date: new Date().toISOString(),
              type: 'Sistema' as const,
              text: `Carteira transferida de ${ac.name} para ${targetAC.name}.`,
            },
          ];
          updateStudent(student.id, {
            ac: targetAC.name,
            history,
          });
          // Aguarda a gravação real antes de remover o AC de origem.
          persistenceJobs.push(updateStudentDb(student.id, { ac: targetAC.name, history }));
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
        .forEach((c, idx) => {
          const linkedStudent = students.find(
            (student) =>
              student.id === c.studentId ||
              student.cancellationCaseId === c.id ||
              (student.ac === ac.name && student.name === c.studentName),
          );
          const targetName =
            (linkedStudent ? targetByStudentId.get(linkedStudent.id) : undefined) ??
            targetACs[idx % targetACs.length]?.name;
          if (!targetName) return;
          updateCancellationCase(c.id, { ac: targetName });
          persistenceJobs.push(updateCancellationCaseDb(c.id, { ac: targetName }));
        });

      await Promise.all(persistenceJobs);
      deleteAC(ac.id);
      onClose();
    } catch (error) {
      console.error('Falha ao transferir carteira:', error);
      window.alert('Não foi possível concluir a transferência. Tente novamente.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm fade-in">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">Transferir Carteira</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-muted transition-colors"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
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
            {availableACs.map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={selectedACs.includes(g.id)}
                  onChange={() => toggleAC(g.id)}
                  className="rounded"
                />
                <span className="text-sm text-foreground">{g.name}</span>
              </label>
            ))}
            {unlinkedAcUsers.map((user) => (
              <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={selectedACs.includes(`user:${user.id}`)}
                  onChange={() => toggleAC(`user:${user.id}`)}
                  className="rounded"
                />
                <span className="text-sm text-foreground">
                  {user.name} <span className="text-[10px] text-muted-foreground">(criar como assessora)</span>
                </span>
              </label>
            ))}
            {availableACs.length === 0 && unlinkedAcUsers.length === 0 && (
              <p className="text-xs text-destructive">Cadastre a Bianca como usuária AC antes de transferir.</p>
            )}
            {selectedACs.length === 0 && (availableACs.length > 0 || unlinkedAcUsers.length > 0) && (
              <p className="text-[11px] text-amber-700">Selecione pelo menos um destino para continuar.</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-border p-4 sm:p-6">
          <button type="button" onClick={onClose} className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={selectedACs.length === 0 || running}
            className="px-4 py-2 rounded-lg text-sm font-medium iam-gradient text-primary-foreground shadow-md disabled:opacity-40"
          >
            {running ? 'Transferindo...' : 'Transferir e Excluir AC'}
          </button>
        </div>
      </div>
    </div>
  );
}
