import { describe, expect, it } from 'vitest';
import { formatContratoAssinadoBR, resolveContratoAssinadoIso } from '@/lib/contratoAssinadoDate';
import type { Student } from '@/types';

function stub(partial: Partial<Student> & Pick<Student, 'enrollmentDate' | 'installments'>): Pick<
  Student,
  'enrollmentDate' | 'installments'
> {
  return partial;
}

describe('resolveContratoAssinadoIso', () => {
  it('usa a entrada (1ª parcela) quando a matrícula ficou em pagamento posterior', () => {
    // Caso Elias: matrícula 13/10, entrada/assinatura 21/09
    const iso = resolveContratoAssinadoIso(
      stub({
        enrollmentDate: '2025-10-13',
        installments: [
          { number: 1, value: 1500, dueDate: '2025-09-21', paid: true, paidDate: '2025-09-21' },
          { number: 2, value: 500, dueDate: '2025-10-13', paid: true, paidDate: '2025-10-13' },
        ],
      }),
    );
    expect(iso).toBe('2025-09-21');
    expect(formatContratoAssinadoBR(
      stub({
        enrollmentDate: '2025-10-13',
        installments: [
          { number: 1, value: 1500, dueDate: '2025-09-21', paid: true, paidDate: '2025-09-21' },
        ],
      }),
    )).toBe('21/09/2025');
  });

  it('mantém a matrícula quando ela é a data mais antiga', () => {
    expect(
      resolveContratoAssinadoIso(
        stub({
          enrollmentDate: '2025-09-01',
          installments: [
            { number: 1, value: 1000, dueDate: '2025-10-21', paid: false },
          ],
        }),
      ),
    ).toBe('2025-09-01');
  });
});
