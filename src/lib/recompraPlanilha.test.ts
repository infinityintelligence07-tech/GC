import { describe, expect, it } from 'vitest';
import type { AC, Student } from '@/types';
import {
  matchAlunosRecompra,
  normalizeDataPlanilha,
  normalizeValorPlanilha,
  parsePlanilhaRecompra,
  planejarImportRecompra,
  RECOMPRA_PRODUTO_PADRAO,
  resolveAcPlanilha,
} from '@/lib/recompraPlanilha';

// Matriz no formato que o SheetJS devolve para "PLANILHA GC.xlsx" (header: 1,
// raw: true): título na linha 1, cabeçalho na 3, datas como serial do Excel e
// rodapé TOTAL.
const MATRIZ: unknown[][] = [
  ['RECOMPRA', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['DATA DO DÉBITO', 'DOCUMENTO', 'BANCO', 'VALOR DEBITADO', 'VENCIMENTO', 'VALOR ORIGINAL', 'JUROS', 'ALUNO', 'ASSESSOR', ''],
  [46252, '26', 'SICOOB', 2828.48, 46249, 2770, 58.48000000000002, 'YGOR SOUSA DE CAMARGO', 'ELAINE', ''],
  [46252, '4259', 'SICOOB', 893.38, 46249, 875, 18.38, 'JOAO VITOR DOS SANTOS DA', 'BIANCA', ''],
  [46255, '4415', 'SICOOB', 2467.44, 46254, 2416.66, 50.78, 'BARBARA MIDORI SASAKI', 'ELAINE', ''],
  [46260, '60', 'SICOOB', 2042.02, 46259, 2000, 42.02, 'FLAVIA LIMA RIBEIRO', 'BIANCA', 'LIBERTY'],
  [46252, '4577', 'SICOOB', 915.83, 46249, 897, 18.83, 'RENAN SCHWINDEN', 'BIANCA', ''],
  [46266, '4559', 'SICOOB', 1118.84, 46264, 1095.83, 23.01, 'ALESSANDRO CORDEIRO DE', 'LUANA', ''],
  ['TOTAL DEBITADO', '', '', 87480.84, 'TOTAL JUROS', '', 1801.96, '', '', ''],
];

function aluno(p: Partial<Student> & { name: string }): Student {
  return {
    id: p.id ?? p.name.toLowerCase().replace(/\s+/g, '-'),
    whatsapp: '',
    cpf: '',
    address: '',
    numero: '',
    cidade: '',
    estado: '',
    cep: '',
    status: 'Em Dia',
    statusMode: 'Automático',
    ac: 'Elaine Valadares',
    product: 'Confronto',
    enrollmentDate: '2026-01-10',
    dueDay: 15,
    saleValue: 1000,
    downPayment: 0,
    totalInstallments: 1,
    paidInstallments: 0,
    installmentValue: 1000,
    installments: [{ number: 1, dueDate: '2026-10-15', value: 1000, paid: false }],
    history: [],
    ...p,
  };
}

const ACS: AC[] = [
  { id: 'a1', name: 'Elaine Valadares', active: true },
  { id: 'a2', name: 'Bianca Souza', active: true },
  { id: 'a3', name: 'Luana Costa', active: true },
];

describe('normalizadores da planilha de recompra', () => {
  it('converte serial do Excel, texto BR e ISO para YYYY-MM-DD', () => {
    expect(normalizeDataPlanilha(46252)).toBe('2026-08-18');
    expect(normalizeDataPlanilha(46249)).toBe('2026-08-15');
    expect(normalizeDataPlanilha('18/08/2026')).toBe('2026-08-18');
    expect(normalizeDataPlanilha('5/9/26')).toBe('2026-09-05');
    expect(normalizeDataPlanilha('2026-08-18T00:00:00')).toBe('2026-08-18');
    expect(normalizeDataPlanilha('')).toBeNull();
  });

  it('lê valores numéricos, "R$ 2.828,48" e "R$ 2,828.48"', () => {
    expect(normalizeValorPlanilha(2828.48)).toBe(2828.48);
    expect(normalizeValorPlanilha('R$ 2.828,48')).toBe(2828.48);
    expect(normalizeValorPlanilha(' R$ 2,828.48 ')).toBe(2828.48);
    expect(normalizeValorPlanilha(18.38000000000004)).toBe(18.38);
    expect(normalizeValorPlanilha('')).toBeNull();
  });
});

describe('parsePlanilhaRecompra', () => {
  it('acha o cabeçalho na linha 3, ignora título e TOTAL, e mapeia as colunas', () => {
    const rows = parsePlanilhaRecompra(MATRIZ);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      rowIndex: 4,
      aluno: 'YGOR SOUSA DE CAMARGO',
      assessor: 'ELAINE',
      banco: 'SICOOB',
      documento: '26',
      dataDebito: '2026-08-18',
      vencimento: '2026-08-15',
      valorDebitado: 2828.48,
      valorOriginal: 2770,
      juros: 58.48,
      extra: '',
    });
    expect(rows[3].extra).toBe('LIBERTY');
  });

  it('falha com mensagem clara quando não há cabeçalho reconhecível', () => {
    expect(() => parsePlanilhaRecompra([['a', 'b'], [1, 2]])).toThrow(/Cabeçalho não encontrado/);
  });
});

describe('matchAlunosRecompra', () => {
  const carteira: Student[] = [
    aluno({ name: 'Ygor Sousa de Camargo', ac: 'Elaine Valadares' }),
    aluno({ name: 'João Vitor dos Santos da Silva', ac: 'Bianca Souza' }),
    // Homônimos em ACs diferentes: o assessor da planilha desempata.
    aluno({ id: 'renan-bianca', name: 'Renan Schwinden', ac: 'Bianca Souza' }),
    aluno({ id: 'renan-luana', name: 'Renan Schwinden Junior', ac: 'Luana Costa' }),
    // Mesmo aluno com dois contratos: conta como UMA pessoa.
    aluno({ id: 'barbara-1', name: 'Barbara Midori Sasaki', product: 'Confronto', installments: [{ number: 1, dueDate: '2026-10-15', value: 1000, paid: true }] }),
    aluno({ id: 'barbara-2', name: 'Barbara Midori Sasaki', product: 'Liberty' }),
    // Ficha de recompra existente não é candidata a "pessoa".
    aluno({ id: 'alessandro-rec', name: 'Alessandro Cordeiro de Souza', product: RECOMPRA_PRODUTO_PADRAO, ac: 'Luana Costa' }),
  ];
  const matches = matchAlunosRecompra(parsePlanilhaRecompra(MATRIZ), carteira);
  const por = (nome: string) => matches.find((m) => m.row.aluno === nome)!;

  it('casa nome exato ignorando acento/caixa', () => {
    expect(por('YGOR SOUSA DE CAMARGO')).toMatchObject({ status: 'ok', studentId: 'ygor-sousa-de-camargo' });
  });

  it('casa nome truncado da planilha com o nome completo do GC', () => {
    expect(por('JOAO VITOR DOS SANTOS DA')).toMatchObject({ status: 'ok', studentId: 'joão-vitor-dos-santos-da-silva' });
  });

  it('desempata homônimos pelo assessor e prefere o contrato com saldo', () => {
    expect(por('RENAN SCHWINDEN')).toMatchObject({ status: 'ok', studentId: 'renan-bianca' });
    const barbara = por('BARBARA MIDORI SASAKI');
    expect(barbara.status).toBe('ok');
    expect(barbara.studentId).toBe('barbara-2');
  });

  it('marca como não encontrado quem só tem ficha de recompra ou não existe', () => {
    expect(por('ALESSANDRO CORDEIRO DE').status).toBe('nao_encontrado');
    expect(por('FLAVIA LIMA RIBEIRO').status).toBe('nao_encontrado');
  });

  it('invalida linha sem vencimento ou valor', () => {
    const [m] = matchAlunosRecompra(
      parsePlanilhaRecompra([
        ['DATA DO DÉBITO', 'DOCUMENTO', 'BANCO', 'VALOR DEBITADO', 'VENCIMENTO', 'VALOR ORIGINAL', 'JUROS', 'ALUNO', 'ASSESSOR'],
        [46252, '1', 'SICOOB', 100, '', 90, 10, 'FULANO DE TAL', 'ELAINE'],
      ]),
      carteira,
    );
    expect(m.status).toBe('invalido');
  });
});

describe('planejarImportRecompra', () => {
  const opts = { valorBase: 'debitado' as const, tagIds: ['tag-recompra'], fileName: 'PLANILHA GC.xlsx', autorNome: 'Tester', nowIso: '2026-09-14T12:00:00.000Z', acs: ACS };

  it('cria ficha nova por pessoa com os dados do contrato de origem e sem vínculo', () => {
    const carteira = [aluno({ name: 'Ygor Sousa de Camargo', whatsapp: '5599', cpf: '123', ac: 'Elaine Valadares' })];
    const rows = parsePlanilhaRecompra(MATRIZ).filter((r) => r.aluno === 'YGOR SOUSA DE CAMARGO');
    const plano = planejarImportRecompra(matchAlunosRecompra(rows, carteira), carteira, opts);
    expect(plano.anexos).toHaveLength(0);
    expect(plano.novas).toHaveLength(1);
    const f = plano.novas[0];
    expect(f).toMatchObject({
      id: '',
      name: 'Ygor Sousa de Camargo',
      whatsapp: '5599',
      cpf: '123',
      ac: 'Elaine Valadares',
      product: RECOMPRA_PRODUTO_PADRAO,
      enrollmentDate: '2026-08-18',
      dueDay: 15,
      saleValue: 2828.48,
      totalInstallments: 1,
      paidInstallments: 0,
      statusMode: 'Automático',
    });
    expect(f.recompraTreinamento).toBeUndefined();
    expect(f.installments[0]).toMatchObject({ number: 1, dueDate: '2026-08-15', value: 2828.48, paid: false, tags: ['tag-recompra'] });
    expect(f.installments[0].observacao).toContain('Doc. 26');
    expect(f.installments[0].observacao).toContain('debitado em 18/08/2026');
    expect(f.history[0].text).toContain('Tester');
    expect(plano.totalValor).toBe(2828.48);
  });

  it('usa o valor original quando pedido', () => {
    const carteira = [aluno({ name: 'Ygor Sousa de Camargo' })];
    const rows = parsePlanilhaRecompra(MATRIZ).filter((r) => r.aluno === 'YGOR SOUSA DE CAMARGO');
    const plano = planejarImportRecompra(matchAlunosRecompra(rows, carteira), carteira, { ...opts, valorBase: 'original' });
    expect(plano.novas[0].installments[0].value).toBe(2770);
  });

  it('anexa à ficha de recompra existente, renumera e pula duplicadas', () => {
    const recompra = aluno({
      id: 'rec-renan',
      name: 'Renan Schwinden',
      product: RECOMPRA_PRODUTO_PADRAO,
      ac: 'Bianca Souza',
      installments: [{ number: 1, dueDate: '2026-07-15', value: 500, paid: false, observacao: 'Recompra SICOOB · Doc. 4577' }],
      saleValue: 500,
      history: [{ date: '2026-08-01', type: 'Sistema', text: 'x' }],
    });
    const carteira = [aluno({ id: 'renan-bianca', name: 'Renan Schwinden', ac: 'Bianca Souza' }), recompra];
    const matriz = [
      MATRIZ[2],
      [46252, '4577', 'SICOOB', 915.83, 46249, 897, 18.83, 'RENAN SCHWINDEN', 'BIANCA'], // doc já existe → pulada
      [46255, '4900', 'SICOOB', 1200, 46254, 1170, 30, 'RENAN SCHWINDEN', 'BIANCA'],
    ];
    const plano = planejarImportRecompra(matchAlunosRecompra(parsePlanilhaRecompra(matriz), carteira), carteira, opts);
    expect(plano.novas).toHaveLength(0);
    expect(plano.ignoradas).toHaveLength(1);
    expect(plano.ignoradas[0].motivo).toMatch(/já existe/);
    expect(plano.anexos).toHaveLength(1);
    const a = plano.anexos[0];
    expect(a.studentId).toBe('rec-renan');
    expect(a.novasParcelas).toHaveLength(1);
    expect(a.novasParcelas[0]).toMatchObject({ number: 2, dueDate: '2026-08-20', value: 1200 });
    expect(a.patch.saleValue).toBe(1700);
    expect(a.patch.totalInstallments).toBe(2);
    expect(a.patch.history).toHaveLength(2);
  });

  it('cria ficha com nome da planilha e AC resolvido pelo primeiro nome quando não há aluno no GC', () => {
    const rows = parsePlanilhaRecompra(MATRIZ).filter((r) => r.aluno === 'FLAVIA LIMA RIBEIRO');
    const matches = matchAlunosRecompra(rows, []).map((m) => ({ ...m, criarComNomePlanilha: true }));
    const plano = planejarImportRecompra(matches, [], opts);
    expect(plano.novas[0]).toMatchObject({ name: 'FLAVIA LIMA RIBEIRO', ac: 'Bianca Souza' });
  });

  it('agrupa várias linhas do mesmo aluno numa ficha, ordenadas por vencimento', () => {
    const carteira = [aluno({ name: 'Julio Eduardo Costa' })];
    const matriz = [
      MATRIZ[2],
      [46255, '4580', 'SICOOB', 1063.54, 46254, 1041.67, 21.87, 'JULIO EDUARDO COSTA', 'BIANCA'],
      [46252, '4469', 'SICOOB', 915.84, 46249, 897, 18.84, 'JULIO EDUARDO COSTA', 'BIANCA'],
    ];
    const plano = planejarImportRecompra(matchAlunosRecompra(parsePlanilhaRecompra(matriz), carteira), carteira, opts);
    expect(plano.novas).toHaveLength(1);
    expect(plano.novas[0].installments.map((i) => [i.number, i.dueDate, i.value])).toEqual([
      [1, '2026-08-15', 915.84],
      [2, '2026-08-20', 1063.54],
    ]);
    expect(plano.novas[0].saleValue).toBe(1979.38);
  });

  it('linhas sem decisão vão para ignoradas', () => {
    const rows = parsePlanilhaRecompra(MATRIZ).filter((r) => r.aluno === 'FLAVIA LIMA RIBEIRO');
    const plano = planejarImportRecompra(matchAlunosRecompra(rows, []), [], opts);
    expect(plano.novas).toHaveLength(0);
    expect(plano.ignoradas[0].motivo).toMatch(/não encontrado/);
  });
});

describe('resolveAcPlanilha', () => {
  it('resolve pelo primeiro nome e ignora quando ambíguo', () => {
    expect(resolveAcPlanilha('ELAINE', ACS)?.name).toBe('Elaine Valadares');
    expect(resolveAcPlanilha('luana', ACS)?.name).toBe('Luana Costa');
    expect(resolveAcPlanilha('Bianca', [...ACS, { id: 'a4', name: 'Bianca Lima', active: true }])).toBeUndefined();
    expect(resolveAcPlanilha('', ACS)).toBeUndefined();
  });
});
