import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { isCancelamentoEspelhoItem } from '@/lib/cancelamentoGcConciliacao';
import { isConciliacaoReversaoItem } from '@/lib/conciliacaoTipo';
import { getStudentTotalPaid, resolveStudentFinance } from '@/lib/studentFinance';

/**
 * Card Pago para contrato CANCELADO: entra só o que a empresa ficou de fato —
 *   retido = pago pelo aluno (entrada + parcelas + complemento de multa)
 *            − estorno devolvido ao aluno
 *            − abatimento levado para outro contrato (já conta lá).
 * Na prática é a multa quitada; quando a multa foi negativada, é o que o
 * aluno já tinha pago (nada é devolvido); no cancelamento em 7 dias (CDC) é 0.
 * As parcelas em aberto do contrato cancelado nunca entram no A Vencer.
 *
 * Data: o retido entra no Pago na data em que o dinheiro foi RECEBIDO
 * (entrada na matrícula, parcela na data da baixa, complemento de multa na
 * data do pagamento) — ver `recebimentosRetidos`. A data de conclusão do
 * cancelamento fica em `data` só como referência/fallback.
 */
export interface CancelamentoRetido {
  valor: number;
  /** Data (YYYY-MM-DD) em que o cancelamento foi concluído (referência/fallback). */
  data: string;
  pago: number;
  estorno: number;
  abatimento: number;
  multa: number;
  fonte: 'conciliacao' | 'caso';
  caseId: string;
}

/** Parte do valor retido, na data em que aquele dinheiro entrou. */
export interface RecebimentoRetido {
  /** Data (YYYY-MM-DD) do recebimento — filtro de período do card Pago. */
  data: string;
  valor: number;
  origem: 'entrada' | 'parcela' | 'multa' | 'outro';
  /** Número da parcela na ficha (0 para entrada / recebimento fora da ficha). */
  installmentNumber: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const toIsoDate = (v?: string | null): string => (v ? String(v).slice(0, 10) : '');

function findCase(student: Student, cases: CancellationCase[]): CancellationCase | undefined {
  const byId = student.cancellationCaseId
    ? cases.find((c) => c.id === student.cancellationCaseId)
    : undefined;
  if (byId) return byId;
  return cases
    .filter((c) => c.studentId === student.id && c.stage === 'Cancelado')
    .sort((a, b) => String(b.movedToCurrentStageAt ?? '').localeCompare(String(a.movedToCurrentStageAt ?? '')))[0];
}

function findItem(caseId: string, items: ConciliacaoItem[]): ConciliacaoItem | undefined {
  return items
    .filter(
      (it) =>
        it.tipo === 'cancelamento' &&
        it.status === 'conciliado' &&
        it.relatedCaseId === caseId &&
        !isCancelamentoEspelhoItem(it) &&
        !isConciliacaoReversaoItem(it),
    )
    .sort((a, b) => String(b.conciliadoAt ?? '').localeCompare(String(a.conciliadoAt ?? '')))[0];
}

/**
 * Estorno devolvido ao aluno. O item de conciliação grava `estornoAluno`;
 * quando não grava (caso importado / fluxo antigo), cai no plano de estorno
 * do caso e, em cancelamento dentro dos 7 dias do CDC sem multa, tudo o que
 * foi pago é devolvido (ex.: Jordana Naves — estorno integral em 3 parcelas).
 */
function resolveEstorno(depois: Record<string, unknown>, caso: CancellationCase, pago: number, multa: number): number {
  if (depois.estornoAluno != null) return num(depois.estornoAluno);
  const plano = num(caso.refundPlan?.totalValue);
  if (plano > 0.0049) return Math.min(pago, plano);
  const dentro7Dias = depois.dentro7DiasCDC === true || caso.dentro7Dias === true;
  if (dentro7Dias && multa <= 0.0049) return pago;
  return 0;
}

export function valorRetidoCancelamento(
  student: Student,
  cases: CancellationCase[],
  items: ConciliacaoItem[],
): CancelamentoRetido | null {
  if (student.statusCancelamento !== 'cancelado') return null;
  const caso = findCase(student, cases);
  if (!caso) return null;

  const item = findItem(caso.id, items);
  if (item) {
    const d = (item.depois ?? {}) as Record<string, unknown>;
    // Caso importado (PIX/cartão à vista) não grava totalPago no item — o
    // valor pago fica no próprio caso.
    const pago = num(d.totalPagoEfetivo ?? d.totalPago ?? caso.totalPagoAteMomento);
    const multa = num(d.multaCancelamento);
    const estorno = resolveEstorno(d, caso, pago, multa);
    const abatimento = num(d.abatimentoValor);
    const valor = round2(Math.max(0, pago - estorno - abatimento));
    return {
      valor,
      data: toIsoDate(item.conciliadoAt) || toIsoDate(caso.movedToCurrentStageAt),
      pago,
      estorno,
      abatimento,
      multa,
      fonte: 'conciliacao',
      caseId: caso.id,
    };
  }

  // Sem item de conciliação (cancelamento antigo / importado). A parcela de
  // multa na ficha é só o DINHEIRO recebido pela multa (complemento ou multa
  // negativada paga); a multa coberta pela entrada/parcelas já pagas não gera
  // parcela. Então: retido = tudo que o aluno pagou, limitado à multa do caso
  // (o excedente teria virado estorno).
  const multaPaga = (student.installments ?? [])
    .filter((i) => i.paid && (i.tags ?? []).includes('multa-cancelamento'))
    .reduce((acc, i) => acc + num(i.paidValue ?? i.value), 0);
  const multaCaso = num(caso.cancellationFineValue);
  const pagoTotal = getStudentTotalPaid(student);
  const valor = multaCaso > 0.0049 ? Math.min(pagoTotal, multaCaso) : multaPaga;
  return {
    valor: round2(valor),
    data: toIsoDate(caso.movedToCurrentStageAt),
    pago: round2(multaCaso > 0.0049 ? pagoTotal : multaPaga),
    estorno: 0,
    abatimento: 0,
    multa: multaCaso > 0.0049 ? multaCaso : multaPaga,
    fonte: 'caso',
    caseId: caso.id,
  };
}

/**
 * Distribui o valor retido pelos recebimentos reais do aluno, em ordem
 * cronológica (a empresa fica com o que entrou primeiro; o que foi devolvido
 * é o que entrou por último). Recebimentos:
 *   - entrada paga → data da matrícula (ou baixa da P1 quando a entrada está
 *     embutida na 1ª parcela);
 *   - parcelas pagas (inclusive complemento de multa) → data da baixa;
 *   - pago informado no caso sem registro na ficha (PIX/cartão fora do fluxo
 *     de boletos) → data da matrícula; sem matrícula, data da conclusão.
 */
export function recebimentosRetidos(student: Student, retido: CancelamentoRetido): RecebimentoRetido[] {
  if (retido.valor <= 0.0049) return [];

  const finance = resolveStudentFinance(student);
  const embedded = finance.embeddedEntradaInstallment;
  const matricula = toIsoDate(student.enrollmentDate);
  const recebimentos: RecebimentoRetido[] = [];

  if (finance.paidEntrada && finance.downPayment > 0.0049) {
    const dataEntrada = embedded ? toIsoDate(embedded.paidDate) || matricula : matricula;
    recebimentos.push({
      data: dataEntrada || retido.data,
      valor: round2(finance.downPayment),
      origem: 'entrada',
      installmentNumber: 0,
    });
  }

  (student.installments ?? [])
    .filter((i) => i.paid && !(embedded && i.number === embedded.number))
    .forEach((i) => {
      const valor = round2(num(i.paidValue ?? i.value));
      if (valor <= 0.0049) return;
      recebimentos.push({
        data: toIsoDate(i.paidDate) || toIsoDate(i.dueDate) || retido.data,
        valor,
        origem: (i.tags ?? []).includes('multa-cancelamento') ? 'multa' : 'parcela',
        installmentNumber: i.number,
      });
    });

  const registrado = round2(recebimentos.reduce((acc, r) => acc + r.valor, 0));
  const foraDaFicha = round2(retido.pago - registrado);
  if (foraDaFicha > 0.0049) {
    recebimentos.push({ data: matricula || retido.data, valor: foraDaFicha, origem: 'outro', installmentNumber: 0 });
  }
  if (recebimentos.length === 0) {
    return [{ data: retido.data, valor: retido.valor, origem: 'outro', installmentNumber: 0 }];
  }

  recebimentos.sort((a, b) => a.data.localeCompare(b.data) || a.installmentNumber - b.installmentNumber);

  const alocados: RecebimentoRetido[] = [];
  let restante = retido.valor;
  for (const r of recebimentos) {
    if (restante <= 0.0049) break;
    const parte = round2(Math.min(r.valor, restante));
    alocados.push({ ...r, valor: parte });
    restante = round2(restante - parte);
  }
  // Retido maior que os recebimentos conhecidos (inconsistência): o excedente
  // fica na data do último recebimento para não sumir do card.
  if (restante > 0.0049 && alocados.length > 0) {
    const ultimo = alocados[alocados.length - 1];
    ultimo.valor = round2(ultimo.valor + restante);
  }
  return alocados;
}

/** O recebimento entra no período do card? Em "Todos" sempre; com intervalo, pela data. */
export function retidoNoPeriodo(
  retido: Pick<CancelamentoRetido, 'data'> | Pick<RecebimentoRetido, 'data'>,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!range) return true;
  if (!retido.data) return false;
  const dt = new Date(retido.data + 'T00:00:00');
  return !(dt < range.start || dt > range.end);
}
