import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildForecastWorkbook, forecastFileName, type ForecastExportRow } from './exportForecastSpreadsheet';

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
    whatsapp: '(11) 98601-0000',
    email: 'rian7707@exemplo.com',
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
    bucket: 'a_vencer',
    studentId: '4',
    studentName: 'Bruno Recem Chegado',
    ac: 'Elaine Val',
    product: 'Confronto',
    displayStatus: 'Aluno Novo',
    installmentNumber: 1,
    dueDate: '2026-10-10',
    value: 100,
    paidValue: 0,
  },
  {
    bucket: 'a_vencer',
    studentId: '5',
    studentName: 'Carlos Sem Card',
    ac: 'Elaine Val',
    product: 'Confronto',
    displayStatus: 'Renda Extra',
    installmentNumber: 1,
    dueDate: '2026-10-11',
    value: 200,
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
  {
    bucket: 'pago',
    studentId: '6',
    studentName: 'Zilda Sem Data De Baixa',
    ac: 'Elaine Val',
    product: 'Confronto',
    displayStatus: 'Em Dia',
    installmentNumber: 3,
    dueDate: '2026-08-20',
    value: 150,
    paidValue: 150,
  },
];

function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;
  return XLSX.read(buf, { cellNF: true, cellStyles: true });
}

describe('exportForecastSpreadsheet', () => {
  it('gera planilha com um aluno por linha e parcelas em colunas de mês', () => {
    const wb = roundTrip(
      buildForecastWorkbook(rows, { dateBasis: 'vencimento', periodLabel: 'Setembro 2026' }),
    );
    expect(wb.SheetNames).toEqual(['A Vencer Vencido', 'Pago']);

    const ws = wb.Sheets['A Vencer Vencido'];
    const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] as string[];
    expect(header.slice(0, 10)).toEqual([
      '', 'Aluno', 'WhatsApp', 'Email', 'Produto', 'Assessor', 'Valor Venda',
      'Nº Parcelas', 'Vencimentos', 'Situação',
    ]);
    expect(header).toContain('Abril/26');
    expect(header).toContain('Setembro/26');
    expect(header).toContain('Outubro/26');

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
    // Um aluno com 2 parcelas vira UMA linha (não duas).
    const adrian = json.filter((r) => r.Aluno === 'Adrian de Souza Ferreira Nascimento');
    expect(adrian).toHaveLength(1);
    expect(adrian[0]['Nº Parcelas']).toBe('11 | 12');
    expect(adrian[0].Vencimentos).toBe('15/09/2026 | 15/10/2026');
    expect(adrian[0]['Setembro/26']).toBe(891.76);
    expect(adrian[0]['Outubro/26']).toBe(891.76);
    expect(adrian[0].Situação).toBe('Em Dia');

    const acir = json.find((r) => r.Aluno === 'Acir Amalfi')!;
    expect(acir['Nº Parcelas']).toBe('2');
    expect(acir.Vencimentos).toBe('20/04/2026');
    expect(acir['Abril/26']).toBe(625);
    expect(acir.Situação).toBe('À Negativar');

    const bruno = json.find((r) => r.Aluno === 'Bruno Recem Chegado')!;
    expect(bruno.Situação).toBe('Alunos Novos');

    const carlos = json.find((r) => r.Aluno === 'Carlos Sem Card')!;
    expect(carlos.Situação).toBe('A Vencer / Vencido');

    expect(ws['!autofilter']!.ref).toMatch(/^B1:/);

    const pago = wb.Sheets['Pago'];
    const headerPago = XLSX.utils.sheet_to_json<string[]>(pago, { header: 1 })[0] as string[];
    expect(headerPago.slice(0, 10)).toEqual([
      '', 'Aluno', 'WhatsApp', 'Email', 'Produto', 'Assessor', 'Valor Venda',
      'Nº Parcelas', 'Vencimentos', 'Datas Pagamento',
    ]);
    const pagoJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(pago);
    const adriana = pagoJson.find((r) => r.Aluno === 'Adriana Gomes')!;
    expect(adriana.Vencimentos).toBe('15/09/2026');
    expect(adriana['Datas Pagamento']).toBe('02/10/2026');
    // Competência pelo caixa: pago em outubro.
    expect(adriana['Outubro/26']).toBe(302.33);

    const zilda = pagoJson.find((r) => r.Aluno === 'Zilda Sem Data De Baixa')!;
    expect(zilda['Datas Pagamento']).toBe('');
    expect(zilda['Agosto/26']).toBe(150);
  });

  it('inclui alunos em negativação na mesma aba dos demais', () => {
    const comNegativacao: ForecastExportRow[] = [
      ...rows,
      {
        bucket: 'negativacao',
        studentId: '7',
        studentName: 'Sivanildo Soares',
        ac: 'Bianca Martins',
        product: 'LIBERTY',
        displayStatus: 'À Negativar',
        installmentNumber: 5,
        dueDate: '2026-09-15',
        value: 9181.81,
        paidValue: 0,
      },
    ];
    const wb = roundTrip(
      buildForecastWorkbook(comNegativacao, { dateBasis: 'vencimento', periodLabel: 'Todos' }),
    );
    expect(wb.SheetNames).toEqual(['A Vencer Vencido', 'Pago']);
    const aVencer = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['A Vencer Vencido']);
    const linha = aVencer.find((r) => r.Aluno === 'Sivanildo Soares');
    expect(linha).toMatchObject({
      Aluno: 'Sivanildo Soares',
      'Nº Parcelas': '5',
      Vencimentos: '15/09/2026',
      Situação: 'À Negativar',
      'Setembro/26': 9181.81,
    });
  });

  it('nomeia o arquivo com base, período e data', () => {
    expect(
      forecastFileName({ dateBasis: 'vencimento', periodLabel: 'Setembro 2026', filePrefix: 'bianca' }),
    ).toMatch(/^bianca-vencimento-setembro-2026-\d{4}-\d{2}-\d{2}\.xlsx$/);
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
      {
        bucket: 'pago',
        studentId: 'pago-1',
        studentName: 'Aluno Quitado',
        ac: 'Luana',
        product: 'Confronto',
        displayStatus: 'Em Dia',
        installmentNumber: 1,
        dueDate: '2026-08-15',
        value: 500,
        paidValue: 500,
        paidDate: '2026-08-15',
      },
    ];
    const students = [
      {
        id: '1',
        name: 'Adrian',
        status: 'Em Dia',
        statusCancelamento: undefined,
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
        id: '4',
        name: 'Bruno',
        status: 'Aluno Novo',
        installments: [{ number: 1, dueDate: '2026-10-10', value: 100, paid: false }],
      },
      {
        id: '5',
        name: 'Carlos',
        status: 'Em Dia',
        installments: [{ number: 1, dueDate: '2026-10-11', value: 200, paid: false }],
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
        id: '6',
        name: 'Zilda',
        status: 'Em Dia',
        installments: [
          { number: 3, dueDate: '2026-08-20', value: 150, paid: true },
          { number: 4, dueDate: '2026-09-20', value: 150, paid: false },
        ],
      },
      {
        id: 'cancelado-1',
        name: 'Aluno Cancelado',
        status: 'Cancelado',
        statusCancelamento: 'cancelado',
        installments: [{ number: 1, dueDate: '2026-09-15', value: 500, paid: false }],
      },
      {
        id: 'pago-1',
        name: 'Aluno Quitado',
        status: 'Pago',
        installments: [{ number: 1, dueDate: '2026-08-15', value: 500, paid: true, paidDate: '2026-08-15' }],
      },
    ] as import('@/types').Student[];

    const wb = roundTrip(
      buildForecastWorkbook(comExtras, {
        dateBasis: 'vencimento',
        periodLabel: 'Todos',
        students,
      }),
    );
    const aVencer = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['A Vencer Vencido']);
    const pago = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Pago']);
    expect(aVencer.some((r) => r.Aluno === 'Aluno Cancelado')).toBe(false);
    expect(pago.some((r) => r.Aluno === 'Aluno Quitado')).toBe(false);
    expect(aVencer.some((r) => r.Aluno === 'Acir Amalfi')).toBe(true);
  });
});
