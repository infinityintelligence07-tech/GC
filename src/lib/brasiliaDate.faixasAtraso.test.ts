import { describe, it, expect } from 'vitest';
import {
  addMonthsClamped,
  mesesDeAtraso,
  faixaAtrasoPorMes,
  dataEntradaNegativacao,
  diasEmNegativacao,
  isNegativacaoEstagnada,
} from './brasiliaDate';

const d = (iso: string) => new Date(iso + 'T00:00:00');

describe('faixas de atraso por mês (Vencido 1 → Vencido 2 → À Negativar)', () => {
  it('soma meses mantendo o dia e travando no fim do mês', () => {
    expect(addMonthsClamped(d('2026-01-31'), 1)).toEqual(d('2026-02-28'));
    expect(addMonthsClamped(d('2026-05-15'), 2)).toEqual(d('2026-07-15'));
    expect(addMonthsClamped(d('2026-12-10'), 2)).toEqual(d('2027-02-10'));
  });

  it('parcela de 15/05 (sexta): 1º mês Vencido 1, 2º mês Vencido 2, 3º mês À Negativar', () => {
    const due = '2026-05-15';
    expect(mesesDeAtraso(due, d('2026-05-15'))).toBe(0);
    expect(faixaAtrasoPorMes(due, d('2026-05-16'))).toBe('Vencido 1');
    expect(faixaAtrasoPorMes(due, d('2026-06-14'))).toBe('Vencido 1');
    // Completou 1 mês → 2º mês de atraso.
    expect(faixaAtrasoPorMes(due, d('2026-06-15'))).toBe('Vencido 2');
    expect(faixaAtrasoPorMes(due, d('2026-07-14'))).toBe('Vencido 2');
    // Completou 2 meses → entra no 3º mês → À Negativar.
    expect(faixaAtrasoPorMes(due, d('2026-07-15'))).toBe('À Negativar');
    expect(faixaAtrasoPorMes(due, d('2026-12-01'))).toBe('À Negativar');
    expect(dataEntradaNegativacao(due)).toEqual(d('2026-07-15'));
  });

  it('vencimento no fim de semana rola para segunda antes de contar os meses', () => {
    // 16/05/2026 é sábado → vencimento efetivo 18/05 (segunda).
    expect(faixaAtrasoPorMes('2026-05-16', d('2026-06-17'))).toBe('Vencido 1');
    expect(faixaAtrasoPorMes('2026-05-16', d('2026-06-18'))).toBe('Vencido 2');
    expect(dataEntradaNegativacao('2026-05-16')).toEqual(d('2026-07-18'));
  });

  it('+5d: acende 5 dias depois de entrar em À Negativar', () => {
    const inst = [
      { paid: true, dueDate: '2026-04-15' },
      { paid: false, dueDate: '2026-05-15' },
      { paid: false, dueDate: '2026-06-15' },
    ];
    expect(diasEmNegativacao(inst, d('2026-07-14'))).toBeNull();
    expect(diasEmNegativacao(inst, d('2026-07-15'))).toBe(0);
    expect(isNegativacaoEstagnada(inst, d('2026-07-19'))).toBe(false);
    expect(isNegativacaoEstagnada(inst, d('2026-07-20'))).toBe(true);
  });
});
