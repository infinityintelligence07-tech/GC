import { describe, expect, it } from 'vitest';
import { entradasRenegociacaoDoAluno, separarEntradas } from '@/lib/entradaSeparada';

const reneg = (entrada: number, entradaPaidDate?: string, status = 'conciliado', studentId = 's1') => ({
  studentId,
  tipo: 'renegociacao' as const,
  status: status as 'conciliado',
  depois: { entrada, ...(entradaPaidDate ? { entradaPaidDate } : {}) },
  conciliadoAt: '2026-09-24T21:02:16.151Z',
  createdAt: '2026-09-24T20:50:26.890Z',
});

describe('entradasRenegociacaoDoAluno', () => {
  it('lê valor e data de recebimento só das renegociações conciliadas do aluno', () => {
    const items = [
      reneg(1350, '2026-09-23'),
      reneg(1350, undefined, 'reprovado'),
      reneg(900, '2026-08-27', 'conciliado', 'outro'),
      reneg(500), // sem data de recebimento → data da aprovação
    ];
    expect(entradasRenegociacaoDoAluno(items, 's1')).toEqual([
      { valor: 1350, data: '2026-09-23' },
      { valor: 500, data: '2026-09-24' },
    ]);
  });
});

describe('separarEntradas', () => {
  it('Javier: R$ 6.350 = venda R$ 5.000 + renegociação R$ 1.350', () => {
    expect(separarEntradas(6350, [{ valor: 1350, data: '2026-09-23' }])).toEqual({
      venda: 5000,
      renegociacoes: [{ valor: 1350, data: '2026-09-23' }],
    });
  });

  it('entrada só de renegociação → nada de venda', () => {
    expect(separarEntradas(665, [{ valor: 665, data: '2026-08-28' }])).toEqual({
      venda: 0,
      renegociacoes: [{ valor: 665, data: '2026-08-28' }],
    });
  });

  it('sem renegociação → tudo é entrada da venda', () => {
    expect(separarEntradas(2000, [])).toEqual({ venda: 2000, renegociacoes: [] });
  });

  it('campo menor que a soma das renegociações → limita a partir da mais recente', () => {
    // Cláudio: renegociações de R$ 1.900 e R$ 1.700, campo com R$ 1.700.
    expect(
      separarEntradas(1700, [
        { valor: 1900, data: '2026-08-21' },
        { valor: 1700, data: '2026-08-22' },
      ]),
    ).toEqual({ venda: 0, renegociacoes: [{ valor: 1700, data: '2026-08-22' }] });
  });
});
