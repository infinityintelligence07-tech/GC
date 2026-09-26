import { describe, it, expect } from 'vitest';
import type { Student } from '@/types';
import {
  assessorCurto,
  buildModeloGcIamExport,
  detectFormaPagto,
  detectEntradaDestino,
  modeloGcIamToCsv,
  modeloGcIamToSpreadsheetMl,
  PAID_CELL_FILL,
} from './exportModeloGcIam';

function baseStudent(over: Partial<Student> = {}): Student {
  return {
    id: '1',
    name: 'Alessa Padua',
    whatsapp: '11996572211',
    email: 'alessa@example.com',
    cpf: '00000000000',
    address: '',
    numero: '',
    cidade: '',
    estado: '',
    cep: '',
    status: 'Em Dia',
    statusMode: 'auto',
    ac: 'Bianca Confronto',
    product: 'Confronto',
    enrollmentDate: '2026-03-10',
    dueDay: 15,
    saleValue: 99000,
    downPayment: 9500,
    totalInstallments: 10,
    paidInstallments: 2,
    installmentValue: 1800,
    installments: [
      { number: 1, dueDate: '2026-06-15', value: 1800, paid: true, paidDate: '2026-06-15' },
      { number: 2, dueDate: '2026-07-15', value: 1800, paid: true, paidDate: '2026-07-15' },
      { number: 3, dueDate: '2026-08-15', value: 1800, paid: false },
      { number: 4, dueDate: '2026-09-15', value: 1800, paid: false },
    ],
    history: [],
    ...over,
  };
}

describe('exportModeloGcIam', () => {
  it('assessorCurto usa só o primeiro nome em maiúsculas', () => {
    expect(assessorCurto('Bianca Confronto')).toBe('BIANCA');
  });

  it('gera uma linha por parcela (vertical), com nº e data de vencimento', () => {
    const s = baseStudent();
    expect(detectFormaPagto(s)).toBe('BOLETO');
    const { rows } = buildModeloGcIamExport([s]);
    expect(rows).toHaveLength(4);
    expect(rows[0].formaPagto).toBe('BOLETO');
    expect(rows[0].assessor).toBe('BIANCA');
    expect(rows[0].pix).toBe(9500);
    expect(rows[0].numeroParcela).toBe(1);
    expect(rows[0].dataVencimento).toBe('15/06/2026');
    expect(rows[0].valorParcela).toBe(1800);
    expect(rows[0].paid).toBe(true);
    // Entrada só na 1ª linha
    expect(rows[1].pix).toBeNull();
    expect(rows[2].paid).toBe(false);
    expect(rows[2].dataVencimento).toBe('15/08/2026');
  });

  it('entrada de boleto vai para CARTAO quando o histórico indica cartão', () => {
    const s = baseStudent({
      history: [{ date: '2026-03-10', type: 'Sistema', text: 'Entrada paga no cartão de crédito' }],
    });
    expect(detectEntradaDestino(s)).toBe('CARTAO');
    const { rows } = buildModeloGcIamExport([s]);
    expect(rows[0].cartao).toBe(9500);
    expect(rows[0].pix).toBeNull();
  });

  it('PIX à vista quitado não entra na planilha (tudo pago)', () => {
    const s = baseStudent({
      saleValue: 48050,
      downPayment: 48050,
      totalInstallments: 0,
      paidInstallments: 0,
      installmentValue: 0,
      installments: [],
      iamControlAlunoId: 99,
      iamControlContratoStatus: 'CONCILIADO',
      iamGcConciliadoAt: '2026-03-01T00:00:00Z',
      history: [{ date: '2026-03-01', type: 'Sistema', text: 'Pagamento via PIX' }],
    });
    expect(detectFormaPagto(s)).toBe('PIX');
    const { rows } = buildModeloGcIamExport([s]);
    expect(rows).toHaveLength(0);
  });

  it('CSV e XLS usam Nº PARCELA e DATA VENCIMENTO, sem meses na lateral', () => {
    const data = buildModeloGcIamExport([baseStudent()]);
    const csv = modeloGcIamToCsv(data);
    expect(csv).toContain('Nº PARCELA');
    expect(csv).toContain('DATA VENCIMENTO');
    expect(csv).toContain('VALOR PARCELA');
    expect(csv).not.toContain(',JUNHO,');
    expect(csv).not.toContain(',ABRIL,');

    const xml = modeloGcIamToSpreadsheetMl(data);
    expect(xml).toContain(PAID_CELL_FILL);
    expect(xml).toContain('Nº PARCELA');
    expect(xml).toContain('DATA VENCIMENTO');
    expect(xml).not.toContain('>JUNHO<');
  });

  it('exclui contratos cancelados da planilha', () => {
    const ativo = baseStudent({ id: 'ativo', name: 'Aluno Ativo' });
    const cancelado = baseStudent({
      id: 'canc',
      name: 'Aluno Cancelado',
      status: 'Cancelado',
      statusCancelamento: 'cancelado',
    });
    const { rows } = buildModeloGcIamExport([ativo, cancelado]);
    expect(rows.every((r) => r.nomeAluno !== 'Aluno Cancelado')).toBe(true);
    expect(rows.some((r) => r.nomeAluno === 'Aluno Ativo')).toBe(true);
  });

  it('exclui alunos com tudo pago da planilha', () => {
    const ativo = baseStudent({ id: 'ativo', name: 'Aluno Ativo' });
    const quitado = baseStudent({
      id: 'pago',
      name: 'Aluno Quitado',
      status: 'Pago',
      installments: [
        { number: 1, dueDate: '2026-06-15', value: 1800, paid: true, paidDate: '2026-06-15' },
        { number: 2, dueDate: '2026-07-15', value: 1800, paid: true, paidDate: '2026-07-15' },
      ],
    });
    const { rows } = buildModeloGcIamExport([ativo, quitado]);
    expect(rows.every((r) => r.nomeAluno !== 'Aluno Quitado')).toBe(true);
    expect(rows.some((r) => r.nomeAluno === 'Aluno Ativo')).toBe(true);
  });
});
