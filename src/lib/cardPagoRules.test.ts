import { describe, expect, it } from 'vitest';
import type { Installment, Student } from '@/types';
import { isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { filterCarteiraActiveStudents, isStudentFullyPaid } from '@/lib/acPortfolioVisibility';
import { resolveStudentDisplayStatus } from '@/lib/studentDisplayStatus';
import { entradaForaDasParcelas } from '@/lib/pagoFormaFilter';

const parcela = (n: number, value: number, paid: boolean): Installment => ({
  number: n,
  dueDate: `2026-0${n}-10`,
  value,
  paid,
  paidDate: paid ? `2026-0${n}-10` : undefined,
});

const aluno = (over: Partial<Student> = {}): Student =>
  ({
    id: `s${Math.random()}`,
    name: 'Aluno',
    ac: 'Elaine Valadares',
    product: 'Confronto',
    status: 'Em Dia',
    statusMode: 'Automático',
    installments: [],
    history: [],
    ...over,
  }) as Student;

describe('isIamConciliadoQuitadoAvista', () => {
  const iamBase = { iamControlAlunoId: 123, iamControlContratoStatus: 'CONCILIADO' };

  it('ignora aluno que não veio do IAM Control', () => {
    const s = aluno({ saleValue: 1000, downPayment: 1000, totalInstallments: 0 });
    expect(isIamConciliadoQuitadoAvista(s)).toBe(false);
  });

  it('ignora contrato IAM que ainda não está CONCILIADO', () => {
    const s = aluno({
      ...iamBase,
      iamControlContratoStatus: 'PENDENTE',
      saleValue: 1000,
      downPayment: 1000,
      totalInstallments: 0,
    });
    expect(isIamConciliadoQuitadoAvista(s)).toBe(false);
  });

  it('aceita à vista puro: sem parcelas e entrada cobrindo a venda', () => {
    const s = aluno({ ...iamBase, saleValue: 1000, downPayment: 1000, totalInstallments: 0 });
    expect(isIamConciliadoQuitadoAvista(s)).toBe(true);
  });

  it('aceita parcelado com todas as parcelas quitadas', () => {
    const s = aluno({
      ...iamBase,
      saleValue: 1000,
      downPayment: 0,
      totalInstallments: 2,
      paidInstallments: 2,
      installments: [parcela(1, 500, true), parcela(2, 500, true)],
    });
    expect(isIamConciliadoQuitadoAvista(s)).toBe(true);
  });

  it('recusa parcelado com parcela em aberto', () => {
    const s = aluno({
      ...iamBase,
      saleValue: 1000,
      downPayment: 0,
      totalInstallments: 2,
      paidInstallments: 1,
      installments: [parcela(1, 500, true), parcela(2, 500, false)],
    });
    expect(isIamConciliadoQuitadoAvista(s)).toBe(false);
  });
});

describe('filterCarteiraActiveStudents', () => {
  it('tira da carteira quem tem todas as parcelas pagas', () => {
    const quitado = aluno({ installments: [parcela(1, 500, true)] });
    const devendo = aluno({ installments: [parcela(1, 500, false)] });
    expect(filterCarteiraActiveStudents([quitado, devendo], '')).toEqual([devendo]);
  });

  it('tira da carteira quem está com status Pago', () => {
    const pago = aluno({ status: 'Pago', installments: [parcela(1, 500, false)] });
    expect(filterCarteiraActiveStudents([pago], '')).toEqual([]);
  });

  it('devolve só os quitados quando o filtro explícito é Pago', () => {
    const quitado = aluno({ installments: [parcela(1, 500, true)] });
    const devendo = aluno({ installments: [parcela(1, 500, false)] });
    expect(filterCarteiraActiveStudents([quitado, devendo], 'Pago')).toEqual([quitado]);
  });

  it('mantém na carteira o quitado que está em funil de cancelamento', () => {
    const emCancelamento = aluno({
      statusCancelamento: 'solicitado',
      installments: [parcela(1, 500, true)],
    });
    expect(filterCarteiraActiveStudents([emCancelamento], '')).toEqual([emCancelamento]);
  });
});

/**
 * Contrato IAM quitado à vista chega ao GC com `installments: []` — a venda
 * inteira vira down_payment. O card Pago soma esse valor pela entrada, então a
 * carteira e o status precisam enxergar o mesmo contrato como quitado.
 */
describe('quitado à vista sem parcelas', () => {
  const quitadoAvista = aluno({
    iamControlAlunoId: 123,
    iamControlContratoStatus: 'CONCILIADO',
    saleValue: 1000,
    downPayment: 1000,
    totalInstallments: 0,
    installments: [],
  });

  it('é reconhecido como quitado à vista pela regra do card Pago', () => {
    expect(isIamConciliadoQuitadoAvista(quitadoAvista)).toBe(true);
  });

  it('conta como quitado também para a regra de carteira', () => {
    expect(isStudentFullyPaid(quitadoAvista)).toBe(true);
  });

  it('sai da carteira ativa', () => {
    expect(filterCarteiraActiveStudents([quitadoAvista], '')).toEqual([]);
  });

  it('aparece na consulta por status Pago', () => {
    expect(filterCarteiraActiveStudents([quitadoAvista], 'Pago')).toEqual([quitadoAvista]);
  });

  it('é exibido como Pago mesmo sem parcelas', () => {
    expect(resolveStudentDisplayStatus(quitadoAvista)).toBe('Pago');
  });
});

/**
 * Entrada que não virou parcela precisa entrar no card Pago (Geral) para
 * qualquer origem — senão cadastro manual com entrada some da dashboard.
 */
describe('entradaForaDasParcelas', () => {
  it('cadastro manual: entrada + parcelas fecham o contrato → conta a entrada', () => {
    // Pedro Henrique — Confronto: R$ 23.939,96, entrada R$ 16.048,31, 5x R$ 1.578,33
    const s = aluno({
      saleValue: 23939.96,
      downPayment: 16048.31,
      installments: [1, 2, 3, 4, 5].map((n) => parcela(n, 1578.33, false)),
    });
    expect(entradaForaDasParcelas(s)).toBeCloseTo(16048.31, 2);
  });

  it('entrada embutida nas parcelas (parcelas já cobrem o contrato) → 0, sem duplicar', () => {
    const s = aluno({
      saleValue: 1000,
      downPayment: 200,
      installments: [parcela(1, 200, true), parcela(2, 400, false), parcela(3, 400, false)],
    });
    expect(entradaForaDasParcelas(s)).toBe(0);
  });

  it('parcelas com encargos acima do contrato → entrada considerada embutida', () => {
    const s = aluno({
      saleValue: 1000,
      downPayment: 200,
      installments: [parcela(1, 550, false), parcela(2, 550, false)],
    });
    expect(entradaForaDasParcelas(s)).toBe(0);
  });

  it('sem entrada → 0', () => {
    expect(entradaForaDasParcelas(aluno({ saleValue: 1000, downPayment: 0, installments: [parcela(1, 1000, false)] }))).toBe(0);
  });

  it('sem valor de contrato não dá para saber → 0 (conservador)', () => {
    expect(entradaForaDasParcelas(aluno({ saleValue: 0, downPayment: 300, installments: [] }))).toBe(0);
  });

  it('IAM quitado à vista conta sempre, mesmo sem parcelas', () => {
    const s = aluno({ saleValue: 1000, downPayment: 1000, installments: [] });
    expect(entradaForaDasParcelas(s, true)).toBe(1000);
    expect(entradaForaDasParcelas(s)).toBe(1000);
  });
});

/**
 * Contramedida: array de parcelas vazio sozinho NÃO pode significar quitado,
 * senão cadastro incompleto sai da carteira e some da cobrança.
 */
describe('contrato sem parcelas que não foi pago', () => {
  const semParcelas = aluno({ saleValue: 1000, downPayment: 0, installments: [] });

  it('não conta como quitado', () => {
    expect(isStudentFullyPaid(semParcelas)).toBe(false);
  });

  it('continua na carteira ativa', () => {
    expect(filterCarteiraActiveStudents([semParcelas], '')).toEqual([semParcelas]);
  });

  it('não é exibido como Pago', () => {
    expect(resolveStudentDisplayStatus(semParcelas)).not.toBe('Pago');
  });
});
