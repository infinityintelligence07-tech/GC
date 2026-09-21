import { describe, expect, it } from 'vitest';
import type { Installment, Student, StudentTag } from '@/types';
import { computeTagKpis } from '@/lib/tagKpis';
import { calculateStudentAutoStatus } from '@/store/useAppStore';

const hoje = new Date();
const iso = (d: Date) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
};
const dias = (n: number) => {
  const d = new Date(hoje);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const parcela = (over: Partial<Installment> & Pick<Installment, 'dueDate'>): Installment => ({
  number: 1,
  value: 100,
  paid: false,
  ...over,
});

const aluno = (installments: Installment[]): Student =>
  ({
    id: 'a',
    name: 'Aluno',
    ac: 'Luana',
    product: 'Confronto',
    status: 'Em Dia',
    statusMode: 'Automático',
    installments,
    history: [],
    tags: ['fundo'],
  }) as Student;

const tags: StudentTag[] = [{ id: 'fundo', name: 'Fundo', color: '#000' }];

describe('card Boletos Antecipados', () => {
  it('não soma parcela vencida nem parcela paga pelo aluno', () => {
    const s = aluno([
      parcela({ number: 1, dueDate: dias(10), value: 50, tags: ['fundo'] }),
      parcela({ number: 2, dueDate: dias(-40), value: 80, tags: ['fundo'] }),
      parcela({ number: 3, dueDate: dias(5), value: 30, paid: true, paidDate: dias(-1), tags: ['fundo'] }),
    ]);
    const [kpi] = computeTagKpis([s], tags);
    expect(kpi.value).toBe(50);
    expect(kpi.count).toBe(1);
    expect(kpi.overdueValue).toBe(0);
  });

  it('antecipada vencida sai do card e cai na faixa de atraso', () => {
    const s = aluno([
      parcela({
        number: 1,
        dueDate: dias(-20),
        value: 200,
        paid: true,
        paidDate: dias(-30),
        antecipada: true,
      }),
    ]);
    const [kpi] = computeTagKpis([s], tags);
    expect(kpi.value).toBe(0);
    expect(kpi.count).toBe(0);
    expect(calculateStudentAutoStatus(s)).toBe('Vencido 1');
  });

  it('antecipada ainda a vencer permanece no card e não vira vencido', () => {
    const s = aluno([
      parcela({
        number: 1,
        dueDate: dias(15),
        value: 70,
        paid: true,
        paidDate: dias(-2),
        antecipada: true,
      }),
    ]);
    const [kpi] = computeTagKpis([s], tags);
    expect(kpi.value).toBe(70);
    expect(calculateStudentAutoStatus(s)).toBe('Pago');
  });
});
