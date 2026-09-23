import { describe, expect, it } from 'vitest';
import { datasMantidasAposEntrada } from '@/lib/renegParcelasDatas';

describe('datasMantidasAposEntrada', () => {
  it('sem entrada devolve as datas ordenadas', () => {
    expect(datasMantidasAposEntrada(['2026-10-15', '2026-09-15'], undefined)).toEqual([
      '2026-09-15',
      '2026-10-15',
    ]);
  });

  it('descarta vencimentos na entrada ou anteriores (caso Ivanildo)', () => {
    expect(
      datasMantidasAposEntrada(
        ['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15'],
        '2026-09-22',
      ),
    ).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
  });

  it('se todas as datas abertas forem ≤ entrada, gera a próxima ocorrência do dia', () => {
    expect(datasMantidasAposEntrada(['2026-09-15'], '2026-09-22')).toEqual(['2026-10-15']);
    expect(datasMantidasAposEntrada(['2026-09-22'], '2026-09-22')).toEqual(['2026-10-22']);
  });
});
