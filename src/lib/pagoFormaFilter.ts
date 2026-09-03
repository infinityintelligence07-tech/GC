import type { Student } from '@/types';

/**
 * Regra do card "Pago" (Dashboard e Carteira do AC): TUDO o que foi pago entra
 * no card, independente da forma (boleto, à vista, cartão, PIX/link, entrada
 * de cadastro manual/Kamino). Não existe mais filtro por forma de pagamento.
 */

/**
 * Entrada recebida que NÃO está representada nas parcelas — é o valor que o
 * card Pago precisa somar à parte, senão o dinheiro some da dashboard.
 *
 * Vale para cadastro manual, importação Kamino e IAM (down_payment do IAM já é
 * só o que foi recebido; entrada pendente vira parcela com tag). Quando a soma
 * das parcelas já cobre o contrato, a entrada está embutida nelas e somá-la
 * duplicaria — retorna 0. `quitadoAvista` (IAM à vista/cartão) conta sempre.
 */
export function entradaForaDasParcelas(
  student: Pick<Student, 'downPayment' | 'saleValue' | 'installments'>,
  quitadoAvista = false,
): number {
  const entrada = Number(student.downPayment ?? 0);
  if (!(entrada > 0)) return 0;
  if (quitadoAvista) return entrada;
  const sale = Number(student.saleValue ?? 0);
  if (!(sale > 0)) return 0;
  const instSum = (student.installments ?? []).reduce((a, i) => a + (Number(i.value) || 0), 0);
  return instSum < sale - 1 ? entrada : 0;
}

/**
 * Data em que a entrada foi recebida, para filtrar o card por período. A
 * entrada não tem data própria no GC: usa a matrícula (data da venda). Vazio
 * quando não há como saber.
 */
export function entradaPaidDate(student: Pick<Student, 'enrollmentDate'>): string {
  return (student.enrollmentDate || '').slice(0, 10);
}

/**
 * A entrada entra no período do card? Em "Todos" (sem intervalo) sempre.
 * Com intervalo, só se a data de recebimento (matrícula) estiver dentro dele;
 * sem data conhecida ela fica de fora, como uma parcela paga sem paidDate.
 */
export function entradaNoPeriodo(
  student: Pick<Student, 'enrollmentDate'>,
  range: { start: Date; end: Date } | null,
): boolean {
  if (!range) return true;
  const d = entradaPaidDate(student);
  if (!d) return false;
  const dt = new Date(d + 'T00:00:00');
  return !(dt < range.start || dt > range.end);
}
