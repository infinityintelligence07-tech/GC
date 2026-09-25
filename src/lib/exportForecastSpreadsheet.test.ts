import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildForecastWorkbook, forecastFileName, type ForecastExportRow } from './exportForecastSpreadsheet';
import type { Student } from '@/types';

const rows: ForecastExportRow[] = [
  {
    bucket: 'a_vencer',
    studentId: '1',
    studentName: 'Adrian de Souza Ferreira Nascimento',
    ac: 'Luana dos Santos',
    product: 'Missão GC',
    whatsapp: '(11) 98601-0000',
    email: 'rian7707@exemplo.com',
    displayStatus: 'Em Dia',
    saleValue: 15231.12,
    installmentNumber: 11,
    dueDate: '2026-09-15',
    value: 891.76,
    paidValue: 0,
  },
  {
    bucket: 'a_vencer',
    studentId: '1',
    studentName: 'Adrian de Souza Ferreira Nascimento',
    ac: 'Luana dos Santos',
    product: 'Missão GC',
    displayStatus: 'Em Dia',
    saleValue: 15231.12,
    installmentNumber: 12,
    dueDate: '2026-10-15',
    value: 891.76,
    paidValue: 0,
  },
  {
    bucket: 'a_vencer',
    studentId: '2',
    studentName: 'Acir Amalfi',
    ac: 'Elaine Val',
    product: 'Confronto',
    displayStatus: 'À Negativar',
    installmentNumber: 2,
    dueDate: '2026-04-20',
    value: 625,
    paidValue: 0,
  },
  {
    bucket: 'pago',
    studentId: '3',
    studentName: 'Adriana Gomes',
    ac: 'Elaine Val',
    product: 'Confronto',
    displayStatus: 'Em Dia',
    saleValue: 12053.57,
    installmentNumber: 11,
    dueDate: '2026-09-15',
    value: 302.33,
    paidValue: 302.33,
    paidDate: '2026-10-02',
  },
];

function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
  return XLSX.read(buf, { cellNF: true, cellStyles: true });
}

describe('exportForecastSpreadsheet', () => {
  it('gera uma linha por parcela, com Nº Parcela e Data Vencimento', () => {
    const wb = roundTrip(
      buildForecastWorkbook(rows, { dateBasis: 'vencimento', periodLabel: 'Setembro 2026' }),
    );
    expect(wb.SheetNames).toEqual(['A Vencer Vencido', 'Pago']);

    const ws = wb.Sheets['A Vencer Vencido'];
    const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
    expect(header).toEqual([
      '', 'Aluno', 'WhatsApp', 'Email', 'Produto', 'Assessor', 'Valor Venda',
      'Nº Parcela', 'Data Vencimento', 'Mês/Ano', 'Valor Parcela', 'Situação',
    ]);

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    const adrian = json.filter((r) => r.Aluno === 'Adrian de Souza Ferreira Nascimento');
    expect(adrian).toHaveLength(2);
    expect(adrian[0]['Nº Parcela']).toBe(11);
    expect(adrian[0]['Data Vencimento']).toBe('15/09/2026');
    expect(adrian[1]['Nº Parcela']).toBe(12);
    expect(adrian[1]['Data Vencimento']).toBe('15/10/2026');
    // Sem colunas de mês na lateral
    expect(header).not.toContain('Setembro/26');
  });

  it('exclui cancelados e quitados quando students é passado', () => {
    const comExtras: ForecastExportRow[] = [
      ...rows,
      {
        bucket: 'a_vencer',
        studentId: 'cancelado-1',
        studentName: 'Aluno Cancelado',
        ac: 'Luana',
        product: 'Confronto',
        displayStatus: 'Em Dia',
        installmentNumber: 1,
        dueDate: '2026-09-15',
        value: 500,
        paidValue: 0,
      },
    ];
    const students = [
      {
        id: '1',
        name: 'Adrian',
        status: 'Em Dia',
        installments: [
          { number: 11, dueDate: '2026-09-15', value: 891.76, paid: false },
          { number: 12, dueDate: '2026-10-15', value: 891.76, paid: false },
        ],
      },
      {
        id: '2',
        name: 'Acir',
        status: 'À Negativar',
        installments: [{ number: 2, dueDate: '2026-04-20', value: 625, paid: false }],
      },
      {
        id: '3',
        name: 'Adriana',
        status: 'Em Dia',
        installments: [
          { number: 11, dueDate: '2026-09-15', value: 302.33, paid: true, paidDate: '2026-10-02' },
          { number: 12, dueDate: '2026-10-15', value: 302.33, paid: false },
        ],
      },
      {
        id: 'cancelado-1',
        name: 'Aluno Cancelado',
        status: 'Cancelado',
        statusCancelamento: 'cancelado',
        installments: [{ number: 1, dueDate: '2026-09-15', value: 500, paid: false }],
      },
    ] as Student[];

    const wb = roundTrip(
      buildForecastWorkbook(comExtras, { dateBasis: 'vencimento', periodLabel: 'Todos', students }),
    );
    const aVencer = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['A Vencer Vencido']);
    expect(aVencer.some((r) => r.Aluno === 'Aluno Cancelado')).toBe(false);
    expect(aVencer.some((r) => r.Aluno === 'Acir Amalfi')).toBe(true);
  });

  it('nomeia o arquivo com base, período e data', () => {
    expect(
      forecastFileName({ dateBasis: 'vencimento', periodLabel: 'Setembro 2026', filePrefix: 'bianca' }),
    ).toMatch(/^bianca-vencimento-setembro-2026-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
