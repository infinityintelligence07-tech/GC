import type { Installment, Student } from '@/types';
import { getDisplayInstallmentValue } from '@/lib/utils';
import { isEntradaPendenciaInstallment } from '@/lib/studentDisplayStatus';

export interface ResolveStudentFinanceOptions {
  /** Total informado pelo Kamino no caso de cancelamento (quando existir). */
  kaminoPaid?: number;
}

export interface ResolvedStudentFinance {
  downPayment: number;
  saleValue: number;
  /** A 1ª parcela do fluxo embute a entrada (down_payment = 0 no banco). */
  embeddedEntradaInstallment: Installment | null;
  inferredDownPayment: boolean;
  /** Entrada já quitada (ex.: débito IAM), distinta de parcela com tag entrada-pendente. */
  paidEntrada: boolean;
  correctedSaleValue: boolean;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumInstallmentValues(installments: Installment[]): number {
  return roundMoney(
    installments.reduce((acc, i) => acc + (Number(i.value) || 0), 0),
  );
}

/**
 * Detecta se a 1ª parcela do fluxo representa a entrada (padrão IAM quando
 * down_payment ainda não foi separado no registro do aluno).
 */
export function getEmbeddedEntradaInstallment(
  student: Pick<Student, 'downPayment' | 'saleValue' | 'installments' | 'installmentValue'>,
): Installment | null {
  const storedDown = Number(student.downPayment) || 0;
  if (storedDown > 0.0049) return null;

  const installments = student.installments ?? [];
  if (installments.length === 0) return null;

  const sorted = [...installments].sort(
    (a, b) => a.number - b.number,
  );
  const first = sorted[0];
  if (!first || first.number !== 1) return null;
  if (isEntradaPendenciaInstallment(first)) return null;

  const firstVal = Number(first.value) || 0;
  if (firstVal <= 0.0049) return null;

  const rest = sorted.slice(1);
  const { value: typical } = getDisplayInstallmentValue({
    installments: rest.length > 0 ? rest : installments,
    installmentValue: student.installmentValue,
  });
  if (typical <= 0.0049) return null;

  const sale = Number(student.saleValue) || 0;
  const sumInst = sumInstallmentValues(installments);

  // Contrato ≈ soma das parcelas e a 1ª difere do valor típico das demais.
  if (sale > 0 && Math.abs(sale - sumInst) > 0.05) return null;
  if (Math.abs(firstVal - typical) <= 0.05) return null;

  return first;
}

/**
 * Normaliza entrada e valor de contrato para exibição/edição quando o registro
 * só soma parcelas ou embute a entrada na P1.
 */
export function resolveStudentFinance(
  student: Pick<
    Student,
    'downPayment' | 'saleValue' | 'installments' | 'totalInstallments' | 'installmentValue'
  >,
  options?: ResolveStudentFinanceOptions,
): ResolvedStudentFinance {
  const storedDown = Math.max(0, Number(student.downPayment) || 0);
  const storedSale = Math.max(0, Number(student.saleValue) || 0);
  const installments = student.installments ?? [];
  const sumInst = sumInstallmentValues(installments);

  let downPayment = storedDown;
  let paidEntrada = storedDown > 0.0049;
  let inferredDownPayment = false;
  let embeddedEntradaInstallment: Installment | null = null;

  if (downPayment <= 0.0049) {
    embeddedEntradaInstallment = getEmbeddedEntradaInstallment(student);
    if (embeddedEntradaInstallment) {
      downPayment = roundMoney(Number(embeddedEntradaInstallment.value) || 0);
      inferredDownPayment = true;
      paidEntrada = !!embeddedEntradaInstallment.paid;
    }
  }

  // Entrada parcial já paga (ex.: IAM — débito R$197 + crédito R$2364 pendente).
  if (downPayment <= 0.0049 && storedSale > 0.0049 && sumInst > 0.0049) {
    const gap = roundMoney(storedSale - sumInst);
    if (gap > 0.0049 && gap < storedSale - 0.01) {
      downPayment = gap;
      inferredDownPayment = true;
      paidEntrada = true;
    }
  }

  const kaminoPaid = Math.max(0, Number(options?.kaminoPaid) || 0);
  if (downPayment <= 0.0049 && kaminoPaid > 0.0049) {
    const paidInsts = installments.filter((i) => i.paid);
    const paidParcelas = roundMoney(
      paidInsts.reduce(
        (acc, i) =>
          acc + (Number((i as { paidValue?: number }).paidValue) || Number(i.value) || 0),
        0,
      ),
    );
    const firstPaid = paidInsts.find((i) => i.number === 1);
    const onlyFirstPaidAsEntrada =
      firstPaid != null &&
      paidInsts.length === 1 &&
      Math.abs(Number(firstPaid.value) - kaminoPaid) <= 0.05;

    if (onlyFirstPaidAsEntrada) {
      downPayment = roundMoney(Number(firstPaid.value) || 0);
      embeddedEntradaInstallment = firstPaid;
      inferredDownPayment = true;
      paidEntrada = true;
    } else if (paidParcelas <= 0.0049 && kaminoPaid <= storedSale + 0.05) {
      // Kamino informou pagamento mas nenhuma parcela marcada como paga → trata como entrada.
      downPayment = kaminoPaid;
      inferredDownPayment = true;
      paidEntrada = true;
    }
  }

  let saleValue = storedSale;
  let correctedSaleValue = false;

  if (downPayment > 0.0049) {
    const embedded = embeddedEntradaInstallment != null;
    // Entrada separada: contrato deve incluir entrada + parcelas (não só parcelas).
    if (!embedded && Math.abs(storedSale - sumInst) <= 0.05 && sumInst > 0.0049) {
      saleValue = roundMoney(storedSale + downPayment);
      correctedSaleValue = true;
    }
    // Entrada embutida na P1: saleValue já reflete a soma total das parcelas.
  }

  return {
    downPayment,
    saleValue,
    embeddedEntradaInstallment,
    inferredDownPayment,
    paidEntrada,
    correctedSaleValue,
  };
}

/** Parcelas do fluxo excluindo a 1ª quando ela representa entrada embutida. */
export function getParcelInstallments(
  student: Pick<Student, 'downPayment' | 'saleValue' | 'installments' | 'installmentValue'>,
  options?: ResolveStudentFinanceOptions,
): Installment[] {
  const finance = resolveStudentFinance(student, options);
  const embedded = finance.embeddedEntradaInstallment;
  const installments = student.installments ?? [];
  if (!embedded) return installments;
  return installments.filter((i) => i.number !== embedded.number);
}

/** Total já pago: entrada (efetiva) + parcelas quitadas, sem duplicar P1-entrada. */
export function getStudentTotalPaid(
  student: Pick<
    Student,
    'downPayment' | 'saleValue' | 'installments' | 'installmentValue'
  >,
  options?: ResolveStudentFinanceOptions,
): number {
  const finance = resolveStudentFinance(student, options);
  const embedded = finance.embeddedEntradaInstallment;
  const entradaPaga = finance.paidEntrada && finance.downPayment > 0.0049;

  const parcelasPagas = (student.installments ?? [])
    .filter((i) => {
      if (!i.paid) return false;
      if (embedded && i.number === embedded.number) return false;
      return true;
    })
    .reduce(
      (acc, i) =>
        acc + (Number((i as { paidValue?: number }).paidValue) || Number(i.value) || 0),
      0,
    );

  return roundMoney((entradaPaga ? finance.downPayment : 0) + parcelasPagas);
}

/** Busca o caso de cancelamento mais recente do aluno (para Kamino / sync). */
export function getLatestCancellationCaseForStudent(
  studentId: string,
  studentName: string,
  cases: Array<{ studentId?: string; studentName?: string; createdAt?: string; totalPagoAteMomento?: number }>,
) {
  return [...cases]
    .filter((c) => c.studentId === studentId || c.studentName === studentName)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
}
