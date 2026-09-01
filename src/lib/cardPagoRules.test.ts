import { describe, expect, it } from 'vitest';
import type { Installment, Student } from '@/types';
import { isIamConciliadoQuitadoAvista } from '@/lib/iamPendenteConciliacao';
import { filterCarteiraActiveStudents, isStudentFullyPaid } from '@/lib/acPortfolioVisibility';
import { resolveStudentDisplayStatus } from '@/lib/studentDisplayStatus';

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
