import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { isStudentInAcPortfolio } from '@/lib/acPortfolioVisibility';
import { AC, Student, StudentStatus } from '@/types';
import { X, ChevronRight, Check, AlertTriangle, Users } from 'lucide-react';

interface Props {
  ac: AC;
  onClose: () => void;
}

const STATUS_ORDER: StudentStatus[] = ['Em Dia', 'Vencido 1', 'Vencido 2', 'À Negativar', 'Negativado'];

const STATUS_COLORS: Record<string, string> = {
  'Em Dia': 'text-emerald-600 bg-emerald-500/10',
  'Vencido 1': 'text-amber-600 bg-amber-500/10',
  'Vencido 2': 'text-orange-600 bg-orange-500/10',
  'À Negativar': 'text-red-600 bg-red-500/10',
  'Negativado': 'text-rose-800 bg-rose-800/10',
};

// Distributes students of a status group round-robin among target ACs
function distributeRoundRobin(
  students: Student[],
  targetACNames: string[]
): Record<string, Student[]> {
  const result: Record<string, Student[]> = {};
  targetACNames.forEach((g) => { result[g] = []; });
  students.forEach((s, i) => {
    result[targetACNames[i % targetACNames.length]].push(s);
  });
  return result;
}

// Merge distributions across all status groups
function buildFullDistribution(
  allStudents: Student[],
  targetACNames: string[]
): Record<string, Student[]> {
  const final: Record<string, Student[]> = {};
  targetACNames.forEach((g) => { final[g] = []; });

  STATUS_ORDER.forEach((status) => {
    const group = allStudents.filter((s) => s.status === status);
    const dist = distributeRoundRobin(group, targetACNames);
    targetACNames.forEach((g) => { final[g] = [...final[g], ...dist[g]]; });
  });

  return final;
}

export default function DivisaoCarteiraModal({ ac, onClose }: Props) {
  const { acs, students, updateStudent } = useAppStore();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedACIds, setSelectedACIds] = useState<string[]>([]);

  // Students from the leaving AC (somente carteira ativa — sem quitados)
  const acStudents = students.filter((s) => s.ac === ac.name && isStudentInAcPortfolio(s));

  // Other active ACs (not the one being divided)
  const otherACs = acs.filter((g) => g.active && g.id !== ac.id);

  // Toggle AC selection
  const toggleAC = (id: string) => {
    setSelectedACIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedACNames = selectedACIds
    .map((id) => acs.find((g) => g.id === id)?.name)
    .filter(Boolean) as string[];

  // Preview distribution
  const distribution = useMemo(() => {
    if (selectedACNames.length === 0) return {};
    return buildFullDistribution(acStudents, selectedACNames);
  }, [acStudents, selectedACNames]);

  const statusCount = (status: StudentStatus) =>
    acStudents.filter((s) => s.status === status).length;

  const handleConfirm = () => {
    Object.entries(distribution).forEach(([acName, studs]) => {
      studs.forEach((s) => {
        updateStudent(s.id, { ac: acName });
      });
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg saas-shadow-md mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-foreground">Divisão de Carteira</h2>
            <p className="text-xs text-muted-foreground mt-0.5">AC: <span className="font-medium text-foreground">{ac.name}</span> · {acStudents.length} alunos</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border/50">
          {[
            { n: 1, label: 'Carteira' },
            { n: 2, label: 'Destinos' },
            { n: 3, label: 'Confirmar' },
          ].map(({ n, label }, i, arr) => (
            <div key={n} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                step >= n ? 'iam-gradient text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {step > n ? <Check size={10} /> : n}
              </div>
              <span className={`text-[11px] font-medium ${step >= n ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
              {i < arr.length - 1 && <ChevronRight size={12} className="text-muted-foreground/50" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1: Show portfolio breakdown */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Confira a composição atual da carteira de <strong className="text-foreground">{ac.name}</strong> antes de dividi-la.
              </p>
              <div className="space-y-2">
                {STATUS_ORDER.map((status) => {
                  const count = statusCount(status);
                  if (count === 0) return null;
                  return (
                    <div key={status} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${STATUS_COLORS[status]}`}>{status}</span>
                      <span className="text-sm font-bold text-foreground">{count} alunos</span>
                    </div>
                  );
                })}
                {acStudents.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum aluno nesta carteira.</p>
                )}
              </div>
              {acStudents.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex gap-2">
                  <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700">
                    A divisão é feita por status — cada grupo é distribuído igualmente entre os ACs selecionados, garantindo equilíbrio por tipo de inadimplência.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Select target ACs */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Selecione os ACs que vão receber a carteira. A divisão será feita igualmente entre os selecionados.
              </p>
              {otherACs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum outro AC ativo disponível.</p>
              ) : (
                <div className="space-y-2">
                  {otherACs.map((g) => {
                    const checked = selectedACIds.includes(g.id);
                    const acStudentCount = students.filter((s) => s.ac === g.name).length;
                    return (
                      <button
                        key={g.id}
                        onClick={() => toggleAC(g.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                          checked
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-muted/20 hover:border-primary/40'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-all ${
                          checked ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                        }`}>
                          {checked && <Check size={11} className="text-primary-foreground" />}
                        </div>
                        {g.photo ? (
                          <img src={g.photo} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary">
                            {g.name.charAt(0)}
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{g.name}</p>
                          <p className="text-[10px] text-muted-foreground">{acStudentCount} alunos na carteira atual</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedACIds.length >= 2 && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex gap-2">
                  <Users size={13} className="text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-blue-700">
                    Divisão por <strong>{selectedACIds.length}</strong> ACs — cada status será dividido em {selectedACIds.length} partes iguais.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Preview & confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground mb-3">
                Confira como ficará a divisão antes de confirmar. Esta ação <strong className="text-foreground">não pode ser desfeita</strong>.
              </p>
              {selectedACNames.map((acName) => {
                const studs = distribution[acName] ?? [];
                return (
                  <div key={acName} className="bg-muted/30 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground">{acName}</p>
                      <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        +{studs.length} alunos
                      </span>
                    </div>
                    {STATUS_ORDER.map((status) => {
                      const group = studs.filter((s) => s.status === status);
                      if (group.length === 0) return null;
                      return (
                        <div key={status} className="flex items-center justify-between pl-2">
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_COLORS[status]}`}>{status}</span>
                          <span className="text-[11px] text-muted-foreground">{group.length} alunos</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border flex gap-2">
          {step > 1 && (
            <button
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              Voltar
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 2 && selectedACIds.length === 0}
              className="px-4 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-40"
            >
              Próximo
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              className="px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 shadow-md transition-all"
            >
              Confirmar Divisão
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
