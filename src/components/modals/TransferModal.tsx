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
            {unlinkedAcUsers.map((user) => (
              <label key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
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
