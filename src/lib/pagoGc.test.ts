import { describe, expect, it } from 'vitest';
import type { ConciliacaoItem, Installment } from '@/types';
import {
  buildBaixasGcIndex,
  dataBaixaParaPeriodo,
  entradasRenegociacaoNoPeriodo,
  isBaixaRegistradaNoGc,
  valorRecebidoParcela,
} from '@/lib/pagoGc';

const aluno = { id: 'aluno-1' };

const parcela = (over: Partial<Installment> = {}): Installment => ({
  number: 1,
  dueDate: '2026-09-10',
  value: 500,
  paid: true,
  paidDate: '2026-09-05',
  ...over,
});

const item = (over: Partial<ConciliacaoItem>): ConciliacaoItem =>
  ({
    id: `it-${Math.random()}`,
    tipo: 'pagamento_parcela',
    studentId: aluno.id,
    studentName: 'Aluno',
    resumo: '',
    antes: {},
    depois: {},
    status: 'conciliado',
    createdAt: '2026-09-05T12:00:00.000Z',
    conciliadoAt: '2026-09-05T12:00:00.000Z',
    ...over,
  }) as ConciliacaoItem;

describe('isBaixaRegistradaNoGc', () => {
  it('parcela em aberto nunca conta', () => {
    const idx = buildBaixasGcIndex([]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ paid: false, paidMarkedAt: '2026-09-05T12:00:00Z' }), idx)).toBe(false);
  });

  it('parcela que veio paga da planilha (sem rastro) fica de fora', () => {
    const idx = buildBaixasGcIndex([]);
    expect(isBaixaRegistradaNoGc(aluno, parcela(), idx)).toBe(false);
  });

  it('paidMarkedAt (fluxo de baixa do GC) basta', () => {
    const idx = buildBaixasGcIndex([]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ paidMarkedAt: '2026-09-05T12:00:00Z' }), idx)).toBe(true);
  });

  it('boleto antecipado nunca entra no Pago, mesmo com rastro de baixa', () => {
    const idx = buildBaixasGcIndex([item({ depois: { parcela: 1 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ antecipada: true, paidMarkedAt: '2026-09-05T12:00:00Z' }), idx)).toBe(false);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ antecipada: true }), idx)).toBe(false);
  });

  it('item pagamento_parcela conciliado casa pelo número da parcela', () => {
    const idx = buildBaixasGcIndex([item({ depois: { parcela: 2, valor: 500 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 2 }), idx)).toBe(true);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 3 }), idx)).toBe(false);
  });

  it('item pendente/reprovado não conta', () => {
    const idx = buildBaixasGcIndex([
      item({ status: 'pendente', depois: { parcela: 1 } }),
      item({ status: 'reprovado', depois: { parcela: 1 } }),
    ]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 1 }), idx)).toBe(false);
  });

  it('item de outro aluno não conta', () => {
    const idx = buildBaixasGcIndex([item({ studentId: 'outro', depois: { parcela: 1 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 1 }), idx)).toBe(false);
  });

  it('baixa_kamino conciliada usa o campo numero', () => {
    const idx = buildBaixasGcIndex([item({ tipo: 'baixa_kamino', depois: { numero: 4, paid: true } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 4 }), idx)).toBe(true);
  });

  it('parcela renumerada casa pelo numeroOriginal', () => {
    const idx = buildBaixasGcIndex([item({ depois: { parcela: 2 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 1, numeroOriginal: 2 }), idx)).toBe(true);
  });

  it('quitação conciliada cobre as parcelas baixadas no dia da conciliação (tolerância de 1 dia)', () => {
    const idx = buildBaixasGcIndex([item({ tipo: 'quitacao', conciliadoAt: '2026-09-05T23:30:00.000Z', depois: { valorPago: 900 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 3, paidDate: '2026-09-05' }), idx)).toBe(true);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 4, paidDate: '2026-09-06' }), idx)).toBe(true);
    // Parcela paga meses antes (importada) não é da quitação.
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 1, paidDate: '2026-03-10' }), idx)).toBe(false);
  });

  it('tipos que não são baixa (ex.: parcela_valor) não contam', () => {
    const idx = buildBaixasGcIndex([item({ tipo: 'parcela_valor', depois: { parcela: 1 } })]);
    expect(isBaixaRegistradaNoGc(aluno, parcela({ number: 1 }), idx)).toBe(false);
  });
});

describe('dataBaixaParaPeriodo', () => {
  it('usa a data da baixa no GC (paidMarkedAt), não a data em que o aluno pagou', () => {
    // Fabricio: pagou 30/05, baixa registrada em 11/09 → entra no Pago de setembro.
    const d = dataBaixaParaPeriodo(parcela({ paidDate: '2026-05-30', paidMarkedAt: '2026-09-11T22:51:21.363Z' }));
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
  });

  it('sem paidMarkedAt cai na data de pagamento; sem nenhuma devolve null', () => {
    expect(dataBaixaParaPeriodo(parcela({ paidDate: '2026-03-09' }))?.getMonth()).toBe(2);
    expect(dataBaixaParaPeriodo(parcela({ paidDate: undefined }))).toBeNull();
  });
});

describe('valorRecebidoParcela (juros − desconto)', () => {
  it('com paidValue usa o recebido: juros somam, desconto abate', () => {
    expect(valorRecebidoParcela(parcela({ value: 500, paidValue: 537.5 }))).toBe(537.5);
    expect(valorRecebidoParcela(parcela({ value: 500, paidValue: 450 }))).toBe(450);
  });

  it('sem paidValue (pagamento exato) usa o valor de face', () => {
    expect(valorRecebidoParcela(parcela({ value: 500, paidValue: undefined }))).toBe(500);
  });

  it('quitação com desconto: paidValue zerado na última parcela conta zero, não o valor de face', () => {
    expect(valorRecebidoParcela(parcela({ value: 500, paidValue: 0 }))).toBe(0);
  });
});

describe('entradas de renegociação no Pago', () => {
  const reneg = (over: Partial<ConciliacaoItem> = {}) =>
    item({ tipo: 'renegociacao', depois: { entrada: 1200, novasParcelas: [] }, conciliadoAt: '2026-09-10T15:00:00.000Z', ...over });

  it('renegociação conciliada com entrada > 0 entra na data da aprovação', () => {
    const idx = buildBaixasGcIndex([reneg()]);
    const lista = entradasRenegociacaoNoPeriodo(aluno, idx, null);
    expect(lista).toHaveLength(1);
    expect(lista[0].valor).toBe(1200);
    expect(lista[0].data).toBe('2026-09-10T15:00:00.000Z');
  });

  it('respeita o período pela data da aprovação na Conciliação', () => {
    const idx = buildBaixasGcIndex([reneg()]);
    const set = { start: new Date('2026-09-01T00:00:00'), end: new Date('2026-09-30T23:59:59') };
    const ago = { start: new Date('2026-08-01T00:00:00'), end: new Date('2026-08-31T23:59:59') };
    expect(entradasRenegociacaoNoPeriodo(aluno, idx, set)).toHaveLength(1);
    expect(entradasRenegociacaoNoPeriodo(aluno, idx, ago)).toHaveLength(0);
  });

  it('renegociação sem entrada, pendente/reprovada ou de outro aluno fica de fora', () => {
    const idx = buildBaixasGcIndex([
      reneg({ depois: { entrada: 0 } }),
      reneg({ status: 'pendente' }),
      reneg({ status: 'reprovado' }),
      reneg({ studentId: 'outro' }),
    ]);
    expect(entradasRenegociacaoNoPeriodo(aluno, idx, null)).toHaveLength(0);
  });

  it('entrada de venda (downPayment) continua fora: só renegociação gera entrada no índice', () => {
    const idx = buildBaixasGcIndex([item({ tipo: 'parcela_valor', depois: { entrada: 3000, downPayment: 3000 } })]);
    expect(entradasRenegociacaoNoPeriodo(aluno, idx, null)).toHaveLength(0);
  });
});
