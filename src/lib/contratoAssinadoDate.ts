import type { Installment, Student } from '@/types';

function isoDay(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Data de assinatura do contrato para termos (YYYY-MM-DD).
 *
 * Usa a mais antiga entre:
 * - data de matrícula (`enrollmentDate`)
 * - vencimento da 1ª parcela (muitas vezes a entrada)
 * - pagamento da 1ª parcela (quando paga)
 *
 * Motivo: a matrícula às vezes fica gravada com a data de um pagamento
 * posterior (ex.: Elias — matrícula 13/10, entrada/assinatura 21/09).
 */
export function resolveContratoAssinadoIso(
  student: Pick<Student, 'enrollmentDate' | 'installments'>,
): string | null {
  const dates: string[] = [];
  const enr = isoDay(student.enrollmentDate);
  if (enr) dates.push(enr);

  const installments = student.installments ?? [];
  if (installments.length > 0) {
    const first = [...installments].sort(
      (a, b) => (Number(a.number) || 0) - (Number(b.number) || 0),
    )[0] as Installment | undefined;
    if (first) {
      const due = isoDay(first.dueDate);
      if (due) dates.push(due);
      if (first.paid) {
        const paid = isoDay(first.paidDate);
        if (paid) dates.push(paid);
      }
    }
  }

  if (dates.length === 0) return null;
  dates.sort();
  return dates[0] ?? null;
}

/** Formata a data de assinatura do contrato em DD/MM/AAAA (ou "—"). */
export function formatContratoAssinadoBR(
  student: Pick<Student, 'enrollmentDate' | 'installments'>,
): string {
  const iso = resolveContratoAssinadoIso(student);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
