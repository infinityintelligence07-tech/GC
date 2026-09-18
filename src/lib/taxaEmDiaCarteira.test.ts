import { describe, expect, it } from 'vitest';
import type { Installment, Student } from '@/types';
import { taxaEmDiaPorAssessor } from '@/lib/taxaEmDiaCarteira';

const parcela = (dueDate: string, value: number): Installment => ({
  number: 1,
  dueDate,
  value,
  paid: false,
});

const aluno = (over: Partial<Student>): Student =>
  ({
    id: over.id ?? 's',
    name: over.name ?? 'Aluno',
    ac: 'Elaine',
    product: 'Confronto',
    status: 'Em Dia',
    statusMode: 'Manual',
    installments: [],
    history: [],
    ...over,
  }) as Student;

const range = {
  start: new Date('2026-09-01T00:00:00'),
  end: new Date('2026-09-30T23:59:59'),
};
const today = new Date('2026-09-18T00:00:00');
const hidden = { ids: new Set<string>(), names: new Set<string>() };

describe('taxaEmDiaPorAssessor', () => {
  it('usa valor do mês: Em Dia + a vencer de Vencido, sem Alunos Novos', () => {
    const students = [
      aluno({ id: 'emdia', status: 'Em Dia', installments: [parcela('2026-09-20', 1000)] }),
      aluno({
        id: 'v1',
        name: 'Vencido',
        status: 'Vencido 1',
        installments: [parcela('2026-09-10', 400), parcela('2026-09-25', 600)],
      }),
      aluno({ id: 'novo', name: 'Novo', status: 'Aluno Novo', installments: [parcela('2026-09-15', 200)] }),
      aluno({ id: 'fora', name: 'Outubro', status: 'Em Dia', installments: [parcela('2026-10-10', 9000)] }),
    ];

    const taxa = taxaEmDiaPorAssessor({
      students,
      hidden,
      cancellationCases: [],
      range,
      today,
    }).get('Elaine');

    // carteira do mês = 1000 + 400 + 600 + 200; novos saem da base
    // Em Dia = 1000 + 600 (parcela de Vencido 1 ainda não vencida)
    expect(taxa?.carteira).toBe(2200);
    expect(taxa?.baseTaxa).toBe(2000);
    expect(taxa?.emDiaValue).toBe(1600);
    expect(taxa?.pct).toBe(80);
  });
});
