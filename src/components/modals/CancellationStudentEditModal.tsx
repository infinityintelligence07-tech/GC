import { useState } from 'react';
import { Student, CancellationCase, MotivoCancelamento, MOTIVOS_CANCELAMENTO } from '@/types';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { useConfirm } from '@/hooks/useConfirm';
import { X, AlertTriangle, Calendar, Tag, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { getTagStyle, TAG_COLOR_MAP } from '@/lib/tagColors';
import { resolveStudentFinance } from '@/lib/studentFinance';

interface Props {
  student: Student;
  caseRef: CancellationCase;
  onClose: () => void;
}

/**
 * Modal de visualização do aluno acionado a partir da aba Cancelamentos.
 * REGRA: dados pessoais (nome, whatsapp, AC, CPF, treinamento, status) ficam
 * em modo somente leitura — eles devem ser editados apenas na aba Alunos.
 *
 * Permite editar:
 *  - Motivo de cancelamento e descrição
 *  - Etiquetas (tags exclusivas do setor de cancelamento)
 */
export default function CancellationStudentEditModal({ student, caseRef, onClose }: Props) {
  const {
    updateCancellationCase,
    studentTags,
    addStudentTag,
    updateStudentTag,
    deleteStudentTag,
  } = useAppStore();
  const confirm = useConfirm();

  const [motivo, setMotivo] = useState<MotivoCancelamento | ''>(caseRef.motivoCancelamento ?? '');
  const [descricao, setDescricao] = useState(caseRef.descricaoCancelamento ?? '');
  const [caseTags, setCaseTags] = useState<string[]>(caseRef.tags ?? []);

  // ── Criar nova etiqueta (cancellation scope) ──
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('purple');

  // ── Editar etiqueta existente ──
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<string>('purple');

  const cancellationTags = studentTags.filter((t) => t.scope === 'cancellation');

  const toggleTag = (tagId: string) => {
    setCaseTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const handleCreateTag = () => {
    const name = newName.trim();
    if (!name) return;
    addStudentTag({ name, color: newColor, scope: 'cancellation' });
    setNewName('');
    setNewColor('purple');
    setShowCreate(false);
  };

  // ── Calculo de valores ──
  const finance = resolveStudentFinance(student);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  student.installments.forEach((i) => {
    if (i.paid) return;
    if (new Date(i.dueDate) < today) vencido += i.value;
    else aVencer += i.value;
  });
  const pendente = vencido + aVencer;

  // ── Treinamento alerta ──
  const treinamentoData = student.data_treinamento_origem ?? student.enrollmentDate;
  const diasAteTreinamento = treinamentoData
    ? Math.floor((new Date(treinamentoData).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const treinamentoAlerta = diasAteTreinamento !== null && diasAteTreinamento >= 0 && diasAteTreinamento < 30;

  const handleSave = () => {
    updateCancellationCase(caseRef.id, {
      motivoCancelamento: motivo || undefined,
      descricaoCancelamento: descricao || undefined,
      tags: caseTags,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-foreground">Visualizar Aluno (Cancelamento)</h2>
            <p className="text-[11px] text-muted-foreground">
              Dados pessoais somente leitura. Edite-os na aba Alunos.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Treinamento alerta */}
        {treinamentoAlerta && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-rose-50 border border-rose-300 rounded-lg">
            <AlertTriangle size={14} className="text-rose-600 shrink-0" />
            <p className="text-[11px] text-rose-700">
              <strong>ALERTA:</strong> Treinamento em {diasAteTreinamento} dia{diasAteTreinamento !== 1 ? 's' : ''} ({new Date(treinamentoData).toLocaleDateString('pt-BR')})
            </p>
          </div>
        )}
        {!treinamentoAlerta && treinamentoData && (
          <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-blue-50 border border-blue-200 rounded-lg">
            <Calendar size={13} className="text-blue-600 shrink-0" />
            <p className="text-[11px] text-blue-700">
              Treinamento de origem: <strong>{new Date(treinamentoData).toLocaleDateString('pt-BR')}</strong>
              {diasAteTreinamento !== null && diasAteTreinamento >= 0 && ` (em ${diasAteTreinamento} dias)`}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {/* Dados do aluno — SOMENTE LEITURA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Nome</label>
              <input className="input-field w-full text-xs" value={student.name} disabled />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">WhatsApp</label>
              <input className="input-field w-full text-xs" value={student.whatsapp} disabled />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">CPF</label>
              <input className="input-field w-full text-xs" value={student.cpf} disabled />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">AC</label>
              <input className="input-field w-full text-xs" value={student.ac} disabled />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Treinamento</label>
              <input className="input-field w-full text-xs" value={student.product} disabled />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Status</label>
              <input className="input-field w-full text-xs" value={student.status} disabled />
            </div>
          </div>

          {/* Valores */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-muted/40 rounded-lg border border-border/50">
            <div>
              <p className="text-[9px] text-muted-foreground uppercase">Valor Contrato</p>
              <p className="text-xs font-bold text-foreground">{formatCurrency(finance.saleValue)}</p>
            </div>
            <div>
              <p className="text-[9px] text-muted-foreground uppercase">Valor Pendente</p>
              <p className="text-xs font-bold text-foreground">{formatCurrency(pendente)}</p>
              <p className="text-[8px] text-muted-foreground">vencido + a vencer</p>
            </div>
            <div>
              <p className="text-[9px] text-rose-700 uppercase font-semibold">Vencido</p>
              <p className="text-sm font-extrabold text-rose-600">{formatCurrency(vencido)}</p>
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Motivo do cancelamento</label>
            <select className="input-field w-full text-xs" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoCancelamento)}>
              <option value="">— Selecione —</option>
              {MOTIVOS_CANCELAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase mb-1">Descrição (campo aberto)</label>
            <textarea className="input-field w-full text-xs resize-none" rows={3}
              placeholder="Detalhes do motivo do cancelamento..."
              value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>

          {/* Etiquetas */}
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1.5">
                <Tag size={11} className="text-primary" />
                Etiquetas
              </label>
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
              >
                <Plus size={11} />
                Criar Etiqueta
              </button>
            </div>

            {showCreate && (
              <div className="mb-3 p-3 rounded-lg border border-border bg-muted/30 space-y-2">
                <input
                  type="text"
                  placeholder="Nome da etiqueta"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input-field w-full text-xs"
                  autoFocus
                />
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(TAG_COLOR_MAP).map(([key, hex]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewColor(key)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === key ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                      style={{ backgroundColor: hex, borderColor: hex }}
                      title={key}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreateTag}
                    disabled={!newName.trim()}
                    className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold iam-gradient text-primary-foreground disabled:opacity-50"
                  >
                    Criar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCreate(false); setNewName(''); }}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-muted text-muted-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {cancellationTags.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic py-2">
                Nenhuma etiqueta criada. Use "Criar Etiqueta" para adicionar.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {cancellationTags.map((tag) => {
                  const selected = caseTags.includes(tag.id);
                  const isEditing = editingTagId === tag.id;

                  if (isEditing) {
                    return (
                      <div key={tag.id} className="flex items-center gap-1.5 p-1.5 rounded-md border border-border bg-muted/40">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="input-field text-[10px] px-1.5 py-0.5 w-28"
                          autoFocus
                        />
                        <div className="flex gap-0.5">
                          {Object.entries(TAG_COLOR_MAP).map(([key, hex]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setEditColor(key)}
                              className={`w-4 h-4 rounded-full border transition-all ${editColor === key ? 'ring-1 ring-offset-1 ring-primary' : ''}`}
                              style={{ backgroundColor: hex, borderColor: hex }}
                              title={key}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const name = editName.trim();
                            if (!name) return;
                            updateStudentTag(tag.id, { name, color: editColor });
                            setEditingTagId(null);
                          }}
                          className="text-emerald-600 hover:text-emerald-700"
                          title="Salvar"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTagId(null)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Cancelar"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={tag.id}
                      className={`group flex items-center gap-1 rounded-md border transition-all ${selected ? 'ring-2 ring-offset-1 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                      style={getTagStyle(tag.color)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className="text-[10px] font-medium px-2 py-1"
                      >
                        {tag.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTagId(tag.id);
                          setEditName(tag.name);
                          setEditColor(tag.color);
                        }}
                        className="px-1 py-1 hover:bg-black/10 rounded transition-colors"
                        title="Editar"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Excluir etiqueta',
                            description: `Excluir a etiqueta "${tag.name}"?`,
                            variant: 'destructive',
                            confirmText: 'Excluir',
                          });
                          if (ok) {
                            deleteStudentTag(tag.id);
                            setCaseTags((prev) => prev.filter((id) => id !== tag.id));
                          }
                        }}
                        className="px-1 py-1 mr-1 hover:bg-black/10 rounded transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium iam-gradient text-primary-foreground shadow-md hover:shadow-lg transition-all">
            Salvar
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
