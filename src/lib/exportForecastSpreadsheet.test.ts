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
    // Vence em setembro, mas o dinheiro só entrou em outubro.
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
  it('gera planilha com moeda, larguras e filtro', () => {
    const wb = roundTrip(
      buildForecastWorkbook(rows, { dateBasis: 'vencimento', periodLabel: 'Setembro 2026' }),
    );
    expect(wb.SheetNames).toEqual(['A Vencer Vencido', 'Pago']);

    const ws = wb.Sheets['A Vencer Vencido'];
    const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
    // Coluna A fica livre para anotações; sem parcela paga nesta aba, data de
    // pagamento e valor recebido saem fora.
    expect(header).toEqual([
      '', 'Aluno', 'WhatsApp', 'Email', 'Produto', 'Assessor', 'Valor Venda',
      'Parcela', 'Vencimento', 'Mês/Ano', 'Valor Parcela', 'Situação',
    ]);
    expect(ws['A2']?.v).toBeUndefined();

    // Ordenado por nome: Acir vem antes de Adrian.
    expect(ws['B2'].v).toBe('Acir Amalfi');
    // Valor Parcela (coluna K) continua numérico, com formato de dinheiro.
    expect(ws['K2'].t).toBe('n');
    expect(ws['K2'].v).toBe(625);
    expect(ws['K2'].z).toBe('R$ #,##0.00');
    expect(ws['K3'].z).toBe('R$ #,##0.00');
    // Valor Venda vazio não vira texto: a célula simplesmente não existe.
    expect(ws['G2']).toBeUndefined();
    // Valor Venda preenchido também sai formatado.
    expect(ws['G3'].t).toBe('n');
    expect(ws['G3'].z).toBe('R$ #,##0.00');
    // Vencimento legível, com a competência ao lado.
    expect(ws['I2'].v).toBe('20/04/2026');
    expect(ws['J2'].v).toBe('Abril/26');
    expect(ws['J3'].v).toBe('Setembro/26');
    expect(ws['J4'].v).toBe('Outubro/26');

    // Situação desmembrada pelo card do aluno, com o mesmo nome da tela.
    expect(ws['L2'].v).toBe('À Negativar');
    expect(ws['L3'].v).toBe('Em Dia');
    expect(ws['L4'].v).toBe('Alunos Novos');
    // Status fora dos cards cai no rótulo genérico em vez de sumir.
    expect(ws['L5'].v).toBe('A Vencer / Vencido');

    // Filtro começa em B: a coluna de anotações não entra.
    expect(ws['!autofilter']!.ref).toMatch(/^B1:/);
    const cols = ws['!cols']!;
    expect(cols).toHaveLength(12);
    // Coluna de anotações nasce larga o bastante para escrever.
    expect(cols[0].wch).toBe(18);
    // Coluna do nome acompanha o aluno mais longo.
    expect(cols[1].wch).toBeGreaterThan(30);
    // Coluna de vencimento cabe dd/mm/aaaa inteiro.
    expect(cols[8].wch).toBeGreaterThanOrEqual(12);

    const pago = wb.Sheets['Pago'];
    // A aba Pago mantém as colunas de pagamento e dispensa a Situação, que
    // repetiria "Pago" em todas as linhas.
    const headerPago = XLSX.utils.sheet_to_json<string[]>(pago, { header: 1 })[0];
    expect(headerPago).toEqual([
      '', 'Aluno', 'WhatsApp', 'Email', 'Produto', 'Assessor', 'Valor Venda',
      'Parcela', 'Vencimento', 'Mês/Ano', 'Data Pagamento', 'Valor Parcela', 'Valor Recebido',
    ]);
    expect(pago['A2']?.v).toBeUndefined();
    // Aqui a competência segue o caixa: vence em setembro, pago em outubro.
    expect(pago['I2'].v).toBe('15/09/2026');
    expect(pago['J2'].v).toBe('Outubro/26');
    expect(pago['K2'].v).toBe('02/10/2026');
    // Sem data de baixa, cai no vencimento em vez de ficar em branco.
    expect(pago['K3'].v).toBe('');
    expect(pago['J3'].v).toBe('Agosto/26');
    // Valor Recebido preenchido só na aba Pago.
    expect(pago['M2'].t).toBe('n');
    expect(pago['M2'].z).toBe('R$ #,##0.00');
  });

  it('monta o nome do arquivo com base, período e data', () => {
    const nome = forecastFileName({ dateBasis: 'pagamento', periodLabel: 'Setembro 2026' });
    expect(nome).toMatch(/^projecao-carteira-pagamento-setembro-2026-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
