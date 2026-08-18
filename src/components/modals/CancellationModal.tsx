import { useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { CancellationCase, CancellationStage, CancellationOperationalStatus, MotivoCancelamento, MOTIVOS_CANCELAMENTO } from '@/types';
import { X } from 'lucide-react';
import CurrencyInput from '@/components/ui/CurrencyInput';

interface Props {
  existing?: CancellationCase | null;
  onClose: () => void;
}

const INITIAL_STAGE: CancellationStage = 'Aguardando Contato';
const INITIAL_OP_STATUS: CancellationOperationalStatus = 'Sem contato';

const OP_STATUS_OPTIONS: CancellationOperationalStatus[] = [
  'Sem contato', 'Em contato', 'Negociando', 'Aguardando', 'Jurídico', 'Recuperado', 'Cancelado',
];

export default function CancellationModal({ existing, onClose }: Props) {
  const { acs, students, products, addCancellationCase, updateCancellationCase } = useAppStore();

  const [studentName, setStudentName] = useState(existing?.studentName ?? '');
  const [ac, setAc] = useState(existing?.ac ?? '');
  const [stage, setStage] = useState<CancellationStage>(existing?.stage ?? INITIAL_STAGE);
  const [opStatus, setOpStatus] = useState<CancellationOperationalStatus>(existing?.operationalStatus ?? INITIAL_OP_STATUS);
  const [value, setValue] = useState<string>(existing?.value ? String(existing.value) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [motivoCancelamento, setMotivoCancelamento] = useState<MotivoCancelamento | ''>(existing?.motivoCancelamento ?? '');
  const [descricaoCancelamento, setDescricaoCancelamento] = useState(existing?.descricaoCancelamento ?? '');
  const [linkedStudentId, setLinkedStudentId] = useState(existing?.studentId ?? '');
  const [treinamento, setTreinamento] = useState(existing?.treinamento ?? '');
  const [quantidadeInscricoes, setQuantidadeInscricoes] = useState<string>(
    existing?.quantidadeInscricoes != null ? String(existing.quantidadeInscricoes) : ''
  );


  const activeACs = acs.filter((g) => g.active);

  const handleLinkedStudent = (id: string) => {
    setLinkedStudentId(id);
    const s = students.find((st) => st.id === id);
    if (s) {
      setStudentName(s.name);
      setAc(s.ac);
      if (!value) setValue(String(s.saleValue));
    }
  };

  const handleSave = () => {
    if (!studentName.trim()) return;
    const now = new Date().toISOString();
    const numValue = value ? parseFloat(value.replace(',', '.')) : undefined;
    const numInscricoes = quantidadeInscricoes ? parseInt(quantidadeInscricoes, 10) : undefined;

    if (existing) {
      updateCancellationCase(existing.id, {
        studentName, ac, stage, operationalStatus: opStatus,
        value: numValue, notes, studentId: linkedStudentId || undefined,
        motivoCancelamento: motivoCancelamento || undefined,
        descricaoCancelamento: descricaoCancelamento || undefined,
        treinamento: treinamento.trim() || undefined,
        quantidadeInscricoes: Number.isFinite(numInscricoes as number) ? numInscricoes : undefined,
      });
    } else {
      addCancellationCase({
        id: '',
        studentName: studentName.trim(),
        studentId: linkedStudentId || undefined,
        ac,
        stage,
        operationalStatus: opStatus,
        value: numValue,
        createdAt: now,
        movedToCurrentStageAt: now,
        notes,
        motivoCancelamento: motivoCancelamento || undefined,
        descricaoCancelamento: descricaoCancelamento || undefined,
        treinamento: treinamento.trim() || undefined,
        quantidadeInscricoes: Number.isFinite(numInscricoes as number) ? numInscricoes : undefined,
        history: [{ date: now, from: INITIAL_STAGE, to: stage, operationalStatus: opStatus }],
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md saas-shadow-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-foreground">
            {existing ? 'Editar Caso' : 'Novo Caso de Cancelamento'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Vincular a aluno existente */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
              Vincular a aluno cadastrado (opcional)
            </label>
            <select className="input-field w-full" value={linkedStudentId} onChange={(e) => handleLinkedStudent(e.target.value)}>
              <option value="">— Selecione um aluno —</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Nome */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
              Nome do aluno <span className="text-destructive">*</span>
            </label>
            <input className="input-field w-full" placeholder="Nome completo"
              value={studentName} onChange={(e) => setStudentName(e.target.value)} />
          </div>

          {/* AC */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">AC Responsável</label>
            <select className="input-field w-full" value={ac} onChange={(e) => setAc(e.target.value)}>
              <option value="">— Selecione —</option>
              {activeACs.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
            </select>
          </div>

          {/* Status Operacional */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Status</label>
            <select className="input-field w-full" value={opStatus} onChange={(e) => setOpStatus(e.target.value as CancellationOperationalStatus)}>
              {OP_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Etapa inicial */}
          {!existing && (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Etapa (coluna)</label>
              <select className="input-field w-full" value={stage} onChange={(e) => setStage(e.target.value as CancellationStage)}>
                <optgroup label="Jurídico">
                  <option>Aguardando Contato</option>
                  <option>Em Contato</option>
                  <option>Orientações (Jurídico)</option>
                  <option>Confeccionar Termo</option>
                  <option>Assinar Termo</option>
                </optgroup>
                <optgroup label="Financeiro / Boleto">
                  <option>Ajustes em Geral / Boleto</option>
                  <option>Cancelamento de Boleto</option>
                </optgroup>
                <optgroup label="Desfecho">
                  <option>Recuperado</option>
                  <option>Início do Estorno</option>
                  <option>Estorno em Andamento</option>
                  <option>Cancelado</option>
                </optgroup>
                <optgroup label="Pós-Cancelamento">
                  <option>Saldo a Receber - Sem Resposta</option>
                  <option>PROCON ou Judicial</option>
                  <option>Iniciar Negativação</option>
                  <option>Negativação Efetivada</option>
                  <option>Pagando Parcelado (Negativado)</option>
                  <option>Negativação Retirada</option>
                </optgroup>
              </select>
            </div>
          )}

          {/* Valor */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Valor do contrato</label>
            <CurrencyInput
              value={value === '' ? 0 : Number(value)}
              onChange={(v) => setValue(v ? String(v) : '')}
            />
          </div>

          {/* Quantidade de inscrições */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Quantidade de inscrições</label>
            <input
              type="number"
              min={0}
              className="input-field w-full"
              placeholder="Ex.: 2"
              value={quantidadeInscricoes}
              onChange={(e) => setQuantidadeInscricoes(e.target.value)}
            />
          </div>

          {/* Treinamento */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Treinamento</label>
            <input
              className="input-field w-full"
              list="cancellation-treinamentos"
              placeholder="Ex.: Missão Governar"
              value={treinamento}
              onChange={(e) => setTreinamento(e.target.value)}
            />
            <datalist id="cancellation-treinamentos">
              {products.map((p) => <option key={p.id} value={p.name} />)}
            </datalist>
          </div>



          {/* Motivo de Cancelamento */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Motivo do cancelamento</label>
            <select className="input-field w-full" value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value as MotivoCancelamento)}>
              <option value="">— Selecione um motivo —</option>
              {MOTIVOS_CANCELAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Descrição do Cancelamento */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Descrição do motivo</label>
            <textarea className="input-field w-full resize-none" rows={2}
              placeholder="Detalhes sobre o motivo do cancelamento..." value={descricaoCancelamento} onChange={(e) => setDescricaoCancelamento(e.target.value)} />
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">Observações</label>
            <textarea className="input-field w-full resize-none" rows={3}
              placeholder="Anotações sobre o caso..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={handleSave} disabled={!studentName.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all disabled:opacity-50">
            {existing ? 'Salvar' : 'Criar Caso'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
