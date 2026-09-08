import { useMemo, useState } from 'react';
import { X, CalendarCheck, CheckCircle2, Pencil, ThumbsUp } from 'lucide-react';
import type { Student, Installment } from '@/types';
import { formatCurrency } from '@/store/useAppStore';

/** Alteração de data aprovada no modal antes de conciliar o contrato IAM. */
export interface IamDataPagamentoAjuste {
  /** Nova data do contrato / pagamento da entrada (YYYY-MM-DD). */
  enrollmentDate?: string;
  /** Novas datas de pagamento por número de parcela paga. */
  paidDates: Record<number, string>;
  /** Descrição legível de cada mudança (para o histórico do aluno). */
  descricoes: string[];
}

interface Props {
  student: Student;
  onClose: () => void;
  /** `ajuste` é null quando nada foi alterado — só confirma e concilia. */
  onConciliar: (ajuste: IamDataPagamentoAjuste | null) => Promise<void> | void;
}

const isoDay = (s?: string) => (s ?? '').slice(0, 10);
const fmt = (s?: string) => {
  const m = isoDay(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s || '—';
};

/**
 * Antes de conciliar um contrato IAM CONTROL → GC, mostra a data do pagamento
 * (data do contrato / entrada e a data de cada parcela já paga) para conferência.
 *
 * - Data certa: "Confirmar e conciliar" em um clique.
 * - Data errada: edita → "Aprovar nova data" (campos travam, mostra o resumo) →
 *   "Conciliar". A alteração é gravada na ficha e no histórico junto com a
 *   conciliação.
 */
export default function IamConciliarDataPagamentoModal({ student, onClose, onConciliar }: Props) {
  const entradaOriginal = isoDay(student.enrollmentDate);
  const parcelasPagas = useMemo<Installment[]>(
    () => (student.installments ?? []).filter((i) => i.paid).sort((a, b) => a.number - b.number),
    [student.installments],
  );
  const temEntrada = Number(student.downPayment ?? 0) > 0.009;

  const [entrada, setEntrada] = useState(entradaOriginal);
  const [paidDates, setPaidDates] = useState<Record<number, string>>(() =>
    Object.fromEntries(parcelasPagas.map((i) => [i.number, isoDay(i.paidDate) || entradaOriginal])),
  );
  const [aprovado, setAprovado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const ajuste = useMemo<IamDataPagamentoAjuste | null>(() => {
    const descricoes: string[] = [];
    const novasPaid: Record<number, string> = {};
    let novaEntrada: string | undefined;
    if (entrada && entrada !== entradaOriginal) {
      novaEntrada = entrada;
      descricoes.push(
        `${temEntrada ? 'Data do pagamento da entrada / contrato' : 'Data do contrato'}: ${fmt(entradaOriginal)} → ${fmt(entrada)}`,
      );
    }
    for (const i of parcelasPagas) {
      const atual = isoDay(i.paidDate) || entradaOriginal;
      const nova = paidDates[i.number];
      if (nova && nova !== atual) {
        novasPaid[i.number] = nova;
        descricoes.push(`Parcela ${i.number} (${formatCurrency(i.value)}) paga em: ${fmt(atual)} → ${fmt(nova)}`);
      }
    }
    if (descricoes.length === 0) return null;
    return { enrollmentDate: novaEntrada, paidDates: novasPaid, descricoes };
  }, [entrada, entradaOriginal, paidDates, parcelasPagas, temEntrada]);

  const alterado = ajuste !== null;
  const datasInvalidas = !entrada || parcelasPagas.some((i) => !paidDates[i.number]);
  const camposTravados = aprovado || salvando;

  const handlePrimario = async () => {
    if (datasInvalidas || salvando) return;
    if (alterado && !aprovado) {
      setAprovado(true);
      return;
    }
    setSalvando(true);
    try {
      await onConciliar(ajuste);
    } finally {
      setSalvando(false);
    }
  };

  const labelPrimario = salvando
    ? 'Conciliando...'
    : !alterado
      ? 'Confirmar e conciliar'
      : aprovado
        ? 'Conciliar'
        : 'Aprovar nova data';

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm tabular-nums disabled:opacity-70 disabled:bg-muted/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => !salvando && onClose()}>
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto saas-shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarCheck size={16} className="text-emerald-600" />
            <div>
              <h2 className="text-sm font-bold text-foreground">Data do pagamento</h2>
              <p className="text-[11px] text-muted-foreground">{student.name}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={salvando} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border text-[11px]">
          <div>
            <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Contrato</p>
            <p className="font-semibold tabular-nums">{formatCurrency(Number(student.saleValue ?? 0))}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Entrada</p>
            <p className="font-semibold tabular-nums">{formatCurrency(Number(student.downPayment ?? 0))}</p>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Parcelas pagas</p>
            <p className="font-semibold tabular-nums">
              {parcelasPagas.length}/{student.installments?.length ?? 0}
            </p>
          </div>
        </div>

        <label className="block text-[11px] font-semibold text-foreground mb-1">
          {temEntrada ? 'Data do pagamento da entrada / contrato' : 'Data do contrato'}
        </label>
        <input
          type="date"
          value={entrada}
          disabled={camposTravados}
          onChange={(e) => setEntrada(e.target.value)}
          className={`${inputCls} mb-3`}
          autoFocus
        />

        {parcelasPagas.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-foreground mb-1">Parcelas já pagas</p>
            <div className="space-y-1.5">
              {parcelasPagas.map((i) => (
                <div key={i.number} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-[132px] shrink-0">
                    Parcela {i.number} — <span className="tabular-nums text-foreground">{formatCurrency(i.value)}</span>
                  </span>
                  <input
                    type="date"
                    value={paidDates[i.number] ?? ''}
                    disabled={camposTravados}
                    onChange={(e) => setPaidDates((prev) => ({ ...prev, [i.number]: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {!alterado && (
          <p className="mb-4 text-[11px] text-muted-foreground">
            Se a data estiver correta, é só confirmar. Se precisar corrigir, edite acima, aprove a nova data e depois concilie.
          </p>
        )}

        {alterado && !aprovado && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            <p className="font-semibold mb-1">Alteração pendente de aprovação</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {ajuste.descricoes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {alterado && aprovado && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold inline-flex items-center gap-1">
                <CheckCircle2 size={12} /> Nova data aprovada
              </p>
              {!salvando && (
                <button
                  type="button"
                  onClick={() => setAprovado(false)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 hover:underline"
                >
                  <Pencil size={10} /> Editar
                </button>
              )}
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {ajuste.descricoes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-emerald-700/90">Ao conciliar, a data é gravada na ficha e no histórico do aluno.</p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={salvando}
            className="flex-1 py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:bg-muted transition-all disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handlePrimario}
            disabled={datasInvalidas || salvando}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 inline-flex items-center justify-center gap-1.5 ${
              alterado && !aprovado ? 'bg-sky-600 hover:bg-sky-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {alterado && !aprovado ? <ThumbsUp size={13} /> : <CheckCircle2 size={13} />}
            {labelPrimario}
          </button>
        </div>
      </div>
    </div>
  );
}
