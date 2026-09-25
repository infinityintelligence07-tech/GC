import { describe, expect, it } from 'vitest';
import type { Installment } from '@/types';
import { decidirDesfazerAjuste } from '@/lib/desfazerAjusteReprovado';

const p = (number: number, value: number, dueDate: string, paid = false, extra: Partial<Installment> = {}): Installment => ({
  number,
  value,
  dueDate,
  paid,
  ...(paid ? { paidDate: dueDate } : {}),
  ...extra,
});

// Caso Javier (24/09): 10× R$ 1.350 → +2 parcelas de entrada, contrato 13.500 → 18.500.
const antes = [p(1, 1350, '2026-05-19', true), p(2, 1350, '2026-06-20', true), p(3, 1350, '2026-07-20')];
const proposto = [...antes, p(4, 3000, '2026-04-19'), p(5, 2000, '2026-04-20')];
// Como ficou na ficha após a aplicação: renumerado por vencimento, com observação.
const aplicado = [
  p(1, 3000, '2026-04-19', false, { observacao: 'Antes era Parcela 4 — agora é Parcela 1.', numeroOriginal: 4 }),
  p(2, 2000, '2026-04-20', false, { observacao: 'Antes era Parcela 5 — agora é Parcela 2.', numeroOriginal: 5 }),
  p(3, 1350, '2026-05-19', true, { numeroOriginal: 1 }),
  p(4, 1350, '2026-06-20', true, { numeroOriginal: 2 }),
  p(5, 1350, '2026-07-20', false, { numeroOriginal: 3 }),
];

const item = {
  antes: {
    totalParcelas: 3,
    _snapshot: { installments: antes, saleValue: 13500, downPayment: 0, totalInstallments: 3, paidInstallments: 2, installmentValue: 1350 },
  },
  depois: {
    totalParcelas: 5,
    _after: { installments: proposto, saleValue: 18500, totalInstallments: 5 },
    _appliedUpfront: true,
  },
};

describe('decidirDesfazerAjuste', () => {
  it('desfaz quando a ficha ainda está como o ajuste deixou (ignora renumeração)', () => {
    const r = decidirDesfazerAjuste(item, { installments: aplicado, saleValue: 18500, downPayment: 0, totalInstallments: 5 });
    expect(r.resultado).toBe('desfeito');
    expect(r.updates?.saleValue).toBe(13500);
    expect(r.updates?.installments).toEqual(antes);
    expect(r.updates?.totalInstallments).toBe(3);
    expect(r.updates?.paidInstallments).toBe(2);
    expect(r.updates?.installmentValue).toBe(1350);
    // downPayment não fazia parte do ajuste → não é tocado.
    expect(r.updates).not.toHaveProperty('downPayment');
  });

  it('não sobrescreve quando a ficha mudou depois do envio (ex.: baixa posterior)', () => {
    const comBaixa = aplicado.map((i) => (i.number === 1 ? { ...i, paid: true, paidDate: '2026-04-20' } : i));
    const r = decidirDesfazerAjuste(item, { installments: comBaixa, saleValue: 18500, totalInstallments: 5 });
    expect(r.resultado).toBe('ficha_mudou');
    expect(r.updates).toBeUndefined();
  });

  it('segundo item do mesmo envio encontra a ficha já restaurada', () => {
    const r = decidirDesfazerAjuste(item, { installments: antes, saleValue: 13500, totalInstallments: 3 });
    expect(r.resultado).toBe('ja_desfeito');
  });

  it('ignora itens que não foram aplicados na hora ou sem snapshot', () => {
    const semFlag = { ...item, depois: { ...item.depois, _appliedUpfront: undefined } };
    const semSnap = { ...item, antes: { totalParcelas: 3 } };
    expect(decidirDesfazerAjuste(semFlag, { installments: aplicado }).resultado).toBe('nao_se_aplica');
    expect(decidirDesfazerAjuste(semSnap, { installments: aplicado }).resultado).toBe('nao_se_aplica');
  });

  it('ajuste só de valor do contrato restaura só o valor', () => {
    const soValor = {
      antes: { _snapshot: { installments: antes, saleValue: 13500 } },
      depois: { _after: { saleValue: 18500 }, _appliedUpfront: true },
    };
    const outrasParcelas = [...antes, p(4, 999, '2027-01-01')];
    const r = decidirDesfazerAjuste(soValor, { installments: outrasParcelas, saleValue: 18500 });
    expect(r.resultado).toBe('desfeito');
    expect(r.updates).toEqual({ saleValue: 13500 });
  });
});
