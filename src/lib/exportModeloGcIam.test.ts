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
    expect(assessorCurto('Elaine Val')).toBe('ELAINE');
  });

  it('detecta BOLETO com fluxo de parcelas e coloca entrada no PIX', () => {
    const s = baseStudent();
    expect(detectFormaPagto(s)).toBe('BOLETO');
    expect(detectEntradaDestino(s)).toBe('PIX');
    const { rows, monthCols } = buildModeloGcIamExport([s]);
    expect(rows).toHaveLength(1);
    expect(rows[0].formaPagto).toBe('BOLETO');
    expect(rows[0].assessor).toBe('BIANCA');
    expect(rows[0].pix).toBe(9500);
    expect(rows[0].cartao).toBeNull();
    expect(rows[0].vencimento).toContain('15');
    const jun = monthCols.find((c) => c.key === '2026-06');
    expect(jun?.label).toBe('JUNHO');
    expect(rows[0].months['2026-06']?.paid).toBe(true);
    expect(rows[0].months['2026-08']?.paid).toBe(false);
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

  it('PIX à vista preenche coluna PIX e não gera meses', () => {
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
    const { rows, monthCols } = buildModeloGcIamExport([s]);
    expect(rows[0].formaPagto).toBe('PIX');
    expect(rows[0].pix).toBe(48050);
    expect(rows[0].cartao).toBeNull();
    expect(monthCols).toHaveLength(0);
  });

  it('CARTAO à vista preenche coluna CARTAO', () => {
    const s = baseStudent({
      saleValue: 43930,
      downPayment: 43930,
      totalInstallments: 0,
      paidInstallments: 0,
      installmentValue: 0,
      installments: [],
      iamControlAlunoId: 100,
      iamControlContratoStatus: 'CONCILIADO',
      iamGcConciliadoAt: '2026-03-01T00:00:00Z',
      history: [{ date: '2026-03-01', type: 'Sistema', text: 'Pago no cartão' }],
    });
    expect(detectFormaPagto(s)).toBe('CARTAO');
    const { rows } = buildModeloGcIamExport([s]);
    expect(rows[0].cartao).toBe(43930);
    expect(rows[0].pix).toBeNull();
  });

  it('CSV contém cabeçalhos do modelo e BOM', () => {
    const data = buildModeloGcIamExport([baseStudent()]);
    const csv = modeloGcIamToCsv(data);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('FORMA DE PAGTO');
    expect(csv).toContain('ASSESSOR');
    expect(csv).toContain('JUNHO');
    expect(csv).toContain('BOLETO');
  });

  it('SpreadsheetML marca só parcela paga com verde', () => {
    const data = buildModeloGcIamExport([baseStudent()]);
    const xml = modeloGcIamToSpreadsheetMl(data);
    expect(xml).toContain(PAID_CELL_FILL);
    expect(xml).toContain('ss:StyleID="Paid"');
    expect(xml).toContain('FORMA DE PAGTO');
    // Totais / valores não pagos usam Money (branco), não Paid em tudo
    expect(xml).toContain('ss:StyleID="Money"');
  });
});
