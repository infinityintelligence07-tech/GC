import { describe, expect, it } from 'vitest';
import type { Installment } from '@/types';
import { isRascunhoNaoAplicado, planejarEfetivacaoRascunho } from '@/lib/rascunhoAjuste';

const p = (number: number, value: number, dueDate: string, paid = false, extra: Partial<Installment> = {}): Installment => ({
  number,
  value,
  dueDate,
  paid,
  ...(paid ? { paidDate: dueDate } : {}),
  ...extra,
});

// Caso Alexia (24/09): 3 parcelas de R$ 847 → valor R$ 529,38 nas 2 últimas.
const antes = [p(1, 847, '2026-10-10', true), p(2, 847, '2026-11-10'), p(3, 847, '2026-12-10')];
const proposto = [p(1, 847, '2026-10-10', true), p(2, 529.38, '2026-11-10'), p(3, 529.38, '2026-12-10')];

const item = {
  antes: { _snapshot: { installments: antes, saleValue: 14205, totalInstallments: 3 } },
  depois: { _after: { installments: proposto, totalInstallments: 3, saleValue: 14205.12 }, _appliedUpfront: false },
};

describe('isRascunhoNaoAplicado', () => {
  it('só rascunhos novos (flag false) estão fora da ficha', () => {
    expect(isRascunhoNaoAplicado(item)).toBe(true);
    expect(isRascunhoNaoAplicado({ depois: { ...item.depois, _appliedUpfront: true } })).toBe(false);
    expect(isRascunhoNaoAplicado({ depois: { _after: {} } })).toBe(false); // antigos, sem flag
    expect(isRascunhoNaoAplicado({ depois: { parcela: 1 } })).toBe(false);
  });
});

describe('planejarEfetivacaoRascunho', () => {
  it('ficha igual ao envio → aplica o proposto', () => {
    const r = planejarEfetivacaoRascunho(item, { installments: antes, saleValue: 14205, totalInstallments: 3 });
    expect(r).toEqual({ acao: 'aplicar', after: item.depois._after, baixasPreservadas: [] });
  });

  it('outro item do mesmo envio já efetivou → não reaplica', () => {
    const renumerado = proposto.map((i) => ({ ...i, observacao: 'x' }));
    const r = planejarEfetivacaoRascunho(item, { installments: renumerado, saleValue: 14205.12, totalInstallments: 3 });
    expect(r.acao).toBe('ja_aplicado');
  });

  it('baixa feita depois do envio em parcela que o ajuste não mexeu → aplica levando a baixa', () => {
    const itemP2Intacta = {
      ...item,
      depois: {
        ...item.depois,
        _after: { ...item.depois._after, installments: [proposto[0], p(2, 847, '2026-11-10'), proposto[2]] },
      },
    };
    const baixa = { paid: true, paidDate: '2026-11-09', paidMarkedAt: '2026-11-09T12:00:00Z', paidValue: 850 };
    const ficha = [antes[0], { ...antes[1], ...baixa }, antes[2]];
    const r = planejarEfetivacaoRascunho(itemP2Intacta, { installments: ficha, saleValue: 14205, totalInstallments: 3 });
    expect(r.acao).toBe('aplicar');
    if (r.acao !== 'aplicar') return;
    expect(r.baixasPreservadas).toEqual([2]);
    const inst = r.after.installments as Installment[];
    expect(inst[1]).toMatchObject({ number: 2, value: 847, ...baixa });
    expect(inst[2].value).toBe(529.38);
    expect(r.after.paidInstallments).toBe(2);
  });

  it('baixa em parcela que o ajuste alterou → bloqueia', () => {
    const ficha = [antes[0], { ...antes[1], paid: true, paidDate: '2026-11-09' }, antes[2]];
    const r = planejarEfetivacaoRascunho(item, { installments: ficha, saleValue: 14205, totalInstallments: 3 });
    expect(r.acao).toBe('bloqueado');
  });

  it('contrato mudou depois do envio → bloqueia', () => {
    const r = planejarEfetivacaoRascunho(item, { installments: antes, saleValue: 15000, totalInstallments: 3 });
    expect(r).toMatchObject({ acao: 'bloqueado' });
  });

  it('parcela incluída depois do envio → bloqueia', () => {
    const r = planejarEfetivacaoRascunho(item, {
      installments: [...antes, p(4, 100, '2027-01-10')],
      saleValue: 14205,
      totalInstallments: 3,
    });
    expect(r.acao).toBe('bloqueado');
  });
});
