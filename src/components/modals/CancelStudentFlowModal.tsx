import { useMemo, useState } from 'react';
import { Student, MOTIVOS_CANCELAMENTO } from '@/types';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { XCircle, RotateCcw, PencilLine } from 'lucide-react';
import CancelDivergenceEditModal from './CancelDivergenceEditModal';

interface Props {
  student: Student;
  onClose: () => void;
  /** Called after cancelStudentToFlow completes, e.g. to open the financial modal. */
  onAfterConfirm?: (student: Student) => void;
}

/**
 * Shared cancellation questionnaire opened from the Alunos tab X action
 * (both StudentsPage and ACPortfolioPage). Mirrors the "Cancelar Aluno"
 * form: motivo, total pago (Kamino), qtd inscrições, data 1ª solicitação
 * no chat, 7 dias CDC, > 30D antecedência, preview de multa.
 */
export default function CancelStudentFlowModal({ student: studentProp, onClose, onAfterConfirm }: Props) {
  const { cancelStudentToFlow, rules, students } = useAppStore();
  // Sempre lê o aluno atualizado (pode ter sido editado pelo modal de ajuste).
  const student = students.find((s) => s.id === studentProp.id) ?? studentProp;

  const [selectedMotivo, setSelectedMotivo] = useState<typeof MOTIVOS_CANCELAMENTO[number] | ''>('');
  const [cancelDescricao, setCancelDescricao] = useState('');
  const [cancelDentro7Dias, setCancelDentro7Dias] = useState<boolean | null>(null);
  const [cancelCom30Dias, setCancelCom30Dias] = useState<boolean | null>(null);
  const [cancelDataEvento] = useState('');
  const [cancelTotalPago, setCancelTotalPago] = useState('');
  const [cancelQtdInscricoes, setCancelQtdInscricoes] = useState('');
  const [cancelDataSolicitacao, setCancelDataSolicitacao] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  );
  const [showDivergenciaModal, setShowDivergenciaModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [ajusteTag, setAjusteTag] = useState<string | null>(null);


  const contractValue = student.saleValue ?? 0;
  const fluxoPago = useMemo(
    () =>
      (student.downPayment ?? 0) +
      (student.installments ?? [])
        .filter((i) => i.paid)
        .reduce((acc, i) => acc + (typeof i.paidValue === 'number' ? i.paidValue : i.value), 0),
    [student]
  );
  const totalPagoNumLive = cancelTotalPago
    ? parseFloat(cancelTotalPago.replace(/\./g, '').replace(',', '.'))
    : NaN;
  const hasDivergencia =
    Number.isFinite(totalPagoNumLive) && Math.abs(totalPagoNumLive - fluxoPago) > 0.01;

  const multaPercent =
    cancelDentro7Dias === true
      ? 0
      : cancelCom30Dias === true
        ? rules.multaCancelamentoComAntecedencia
        : cancelCom30Dias === false
          ? rules.multaCancelamentoSemAntecedencia
          : null;
  const multaValue = multaPercent != null ? (contractValue * multaPercent) / 100 : null;

  const canConfirm =
    !!selectedMotivo &&
    cancelDentro7Dias !== null &&
    cancelCom30Dias !== null &&
    !!cancelQtdInscricoes &&
    parseInt(cancelQtdInscricoes, 10) > 0 &&
    !!cancelDataSolicitacao &&
    (!hasDivergencia || !!ajusteTag) &&
    Number.isFinite(totalPagoNumLive);

  const handleConfirm = () => {
    if (!canConfirm) return;
    const totalPagoNum = cancelTotalPago
      ? parseFloat(cancelTotalPago.replace(/\./g, '').replace(',', '.'))
      : undefined;
    const qtdInscricoesNum = cancelQtdInscricoes ? parseInt(cancelQtdInscricoes, 10) : undefined;
    const today = new Date().toISOString().slice(0, 10);
    let createdAtOverride: string | undefined;
    if (cancelDataSolicitacao && cancelDataSolicitacao !== today) {
      const now = new Date();
      const [y, m, d] = cancelDataSolicitacao.split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds());
      if (!isNaN(dt.getTime())) createdAtOverride = dt.toISOString();
    }
    cancelStudentToFlow(student.id, selectedMotivo as string, {
      dentro7Dias: cancelDentro7Dias!,
      com30DiasAntecedencia: cancelCom30Dias!,
      dataEvento: cancelDataEvento || undefined,
      multaPercent: multaPercent ?? undefined,
      multaValue: multaValue ?? undefined,
      totalPagoAteMomento: Number.isFinite(totalPagoNum as number) ? totalPagoNum : undefined,
      quantidadeInscricoes:
        Number.isFinite(qtdInscricoesNum as number) && (qtdInscricoesNum ?? 0) > 0
          ? qtdInscricoesNum
          : undefined,
      descricaoCancelamento: cancelDescricao || (selectedMotivo as string),
      ...(ajusteTag ? { tags: [ajusteTag] } : {}),
      ...(createdAtOverride ? { createdAt: createdAtOverride } : {}),
    });
    onClose();
    onAfterConfirm?.(student);
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in p-4">
      <div className="bg-card rounded-2xl w-full max-w-lg p-6 shadow-2xl border border-border space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <XCircle size={20} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Cancelar Aluno</h3>
            <p className="text-xs text-muted-foreground">Responda as perguntas para abrir o caso.</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          O aluno <strong>permanece na carteira</strong> com tag "Cancelamento solicitado". Um caso espelho será aberto em <strong>Cancelamentos → Entrada</strong>.
        </p>

        {/* 1 — Motivo */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            1. Qual o motivo de cancelamento? <span className="text-destructive">*</span>
          </label>
          <select
            className="input-field w-full text-xs"
            value={selectedMotivo}
            onChange={(e) => setSelectedMotivo(e.target.value as typeof MOTIVOS_CANCELAMENTO[number])}
          >
            <option value="">Selecione o motivo...</option>
            {MOTIVOS_CANCELAMENTO.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <textarea
            className="input-field w-full text-xs mt-2 resize-none"
            rows={2}
            placeholder="Descrição do motivo (opcional)"
            value={cancelDescricao}
            onChange={(e) => setCancelDescricao(e.target.value)}
          />
        </div>

        {/* Total pago Kamino */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Total pago até o momento (Kamino) <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            className={`input-field w-full text-xs ${hasDivergencia && !ajusteTag ? 'border-rose-400 focus:border-rose-500' : ''}`}
            placeholder="R$ 0,00"
            value={cancelTotalPago}
            onChange={(e) => setCancelTotalPago(e.target.value.replace(/[^\d,\.]/g, ''))}
            onBlur={() => {
              if (hasDivergencia && !ajusteTag) setShowDivergenciaModal(true);
            }}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Deve corresponder à soma <strong>Entrada + Total Pago</strong> do fluxo de pagamento.
            {' '}Fluxo atual: <strong>{formatCurrency(fluxoPago)}</strong>.
          </p>
          {hasDivergencia && !ajusteTag && (
            <p className="text-[10px] text-rose-600 mt-1 font-semibold">
              ⚠ Divergência de {formatCurrency(Math.abs(totalPagoNumLive - fluxoPago))} — atualize o fluxo de pagamento antes de prosseguir.
            </p>
          )}
          {hasDivergencia && ajusteTag && (
            <p className="text-[10px] text-amber-700 mt-1 font-semibold">
              ⚠ Divergência mantida — o caso seguirá com a tag <strong>"{ajusteTag}"</strong> para double-check da Conciliação.
            </p>
          )}
        </div>

        {/* Qtd inscrições */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Quantidade de inscrições do contrato <span className="text-destructive">*</span>
          </label>
          <input
            type="number"
            min={1}
            step={1}
            className="input-field w-full text-xs"
            placeholder="Ex.: 1, 2, 3..."
            value={cancelQtdInscricoes}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setCancelQtdInscricoes(e.target.value.replace(/[^\d]/g, ''))}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Número de <strong>inscrições</strong> que compõem este contrato.
          </p>
        </div>

        {/* Data solicitação no chat */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Data em que o aluno solicitou o cancelamento pela primeira vez no chat <span className="text-destructive">*</span>
          </label>
          <input
            type="date"
            className="input-field w-full text-xs"
            max={new Date().toISOString().slice(0, 10)}
            value={cancelDataSolicitacao}
            onChange={(e) => setCancelDataSolicitacao(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Se diferente de hoje, esta será a data considerada em <strong>"Solicitado"</strong> no card de cancelamentos.
          </p>
        </div>

        {/* 2 — 7 dias */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            2. O cancelamento está dentro dos 7 dias de contrato? <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCancelDentro7Dias(true)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                cancelDentro7Dias === true
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              Sim
            </button>
            <button
              type="button"
              onClick={() => setCancelDentro7Dias(false)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                cancelDentro7Dias === false
                  ? 'bg-rose-500 text-white border-rose-500'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              Não
            </button>
          </div>
          {cancelDentro7Dias === true && (
            <p className="text-[10px] text-emerald-700 mt-1">
              Direito de arrependimento (CDC art. 49) — <strong>sem multa</strong>.
            </p>
          )}
        </div>

        {/* 3 — 30 dias */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            3. Pediu o cancelamento com mais de 30 dias de antecedência da data do evento? <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCancelCom30Dias(true)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                cancelCom30Dias === true
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              Sim, mais de 30D
            </button>
            <button
              type="button"
              onClick={() => setCancelCom30Dias(false)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                cancelCom30Dias === false
                  ? 'bg-rose-500 text-white border-rose-500'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              Não, menos de 30D
            </button>
          </div>
        </div>

        {/* Preview multa */}
        {multaValue != null && contractValue > 0 && (
          <div className={`rounded-lg border px-3 py-2.5 text-xs ${
            multaPercent === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Multa calculada</span>
              <span className="font-bold">{multaPercent}%</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span>Valor do contrato:</span>
              <span>{formatCurrency(contractValue)}</span>
            </div>
            <div className="flex items-center justify-between mt-0.5 pt-1 border-t border-current/20">
              <span className="font-semibold">Multa a cobrar:</span>
              <span className="font-bold text-base">{formatCurrency(multaValue)}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-700">
          <RotateCcw size={12} />
          <span>Pode ser <strong>revertido</strong> a qualquer momento pelo time de cancelamentos.</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
          >
            Voltar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Confirmar e Ajustar Parcelas
          </button>
        </div>
      </div>

      {showDivergenciaModal && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm flex items-center justify-center z-[60] fade-in p-4"
          onClick={() => setShowDivergenciaModal(false)}
        >
          <div
            className="bg-card rounded-2xl w-full max-w-md p-5 shadow-2xl border border-rose-200 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                <XCircle size={20} className="text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Divergência de valores</h3>
                <p className="text-[11px] text-muted-foreground">O total informado não bate com o fluxo de pagamento.</p>
              </div>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800 space-y-1">
              <div className="flex justify-between"><span>Kamino (informado):</span><strong>{formatCurrency(totalPagoNumLive || 0)}</strong></div>
              <div className="flex justify-between"><span>Entrada + Pago (fluxo):</span><strong>{formatCurrency(fluxoPago)}</strong></div>
              <div className="flex justify-between pt-1 border-t border-rose-200"><span>Diferença:</span><strong>{formatCurrency(Math.abs((totalPagoNumLive || 0) - fluxoPago))}</strong></div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Ajuste o fluxo de pagamento para bater com o Kamino. Você pode editar
              os campos financeiros do contrato agora — a alteração será enviada
              para <strong>double-check da Conciliação</strong>.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDivergenciaModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  setShowDivergenciaModal(false);
                  setShowEditModal(true);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all inline-flex items-center gap-1.5"
              >
                <PencilLine size={12} /> Ajustar dados do contrato
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <CancelDivergenceEditModal
          student={student}
          onClose={() => setShowEditModal(false)}
          onSaved={({ ajusteTag: tag }) => {
            setAjusteTag(tag);
            // sincroniza o input "total pago" com o novo fluxo — sem divergência
            const novoFluxo =
              (useAppStore.getState().students.find((s) => s.id === student.id)?.downPayment ?? 0) +
              (useAppStore.getState().students.find((s) => s.id === student.id)?.installments ?? [])
                .filter((i) => i.paid)
                .reduce((acc, i) => acc + (typeof i.paidValue === 'number' ? i.paidValue : i.value), 0);
            setCancelTotalPago(
              novoFluxo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            );
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}
