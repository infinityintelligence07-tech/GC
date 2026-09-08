import { describe, expect, it } from 'vitest';
import type { ConciliacaoItem, Installment } from '@/types';
import { buildBaixasGcIndex, isBaixaRegistradaNoGc } from '@/lib/pagoGc';

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
