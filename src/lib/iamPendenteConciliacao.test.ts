import { describe, expect, it } from 'vitest';
import type { Student } from '@/types';
import {
  classifyIamTreinamentoOrigem,
  iamEventoProdutoLabel,
  isIamForaDaCarteiraAteConciliar,
  isIamPendenteLinkOuPix,
  resolveIamFilaStatus,
} from '@/lib/iamPendenteConciliacao';

const iamStudent = (over: Partial<Student>): Student =>
  ({
    id: 'x',
    name: 'Aluno',
    status: 'Pendente',
    statusMode: 'Manual',
    installments: [{ number: 1, value: 1000, dueDate: '2026-10-10', paid: false }],
    saleValue: 5000,
    downPayment: 500,
    totalInstallments: 1,
    paidInstallments: 0,
    history: [],
    iamControlAlunoId: 123,
    ...over,
  }) as unknown as Student;

describe('carteira do AC — IAM antes da conciliação', () => {
  it('Pendente Link / PIX aparecem na carteira', () => {
    expect(isIamPendenteLinkOuPix(iamStudent({ iamControlContratoStatus: 'PENDENTE_LINK' }))).toBe(true);
    expect(isIamPendenteLinkOuPix(iamStudent({ iamControlContratoStatus: 'PENDENTE_PIX' }))).toBe(true);
    expect(isIamPendenteLinkOuPix(iamStudent({ iamControlContratoStatus: 'PENDENTE', iamControlPendenteTipo: 'PIX' }))).toBe(true);
    expect(isIamForaDaCarteiraAteConciliar(iamStudent({ iamControlContratoStatus: 'PENDENTE_PIX' }))).toBe(false);
  });

  it('demais status IAM ficam fora até conciliar no GC', () => {
    for (const st of ['NOVO', 'PARA_CONCILIAR', 'CONCILIADO', 'AJUSTES', 'PENDENTE', null]) {
      const s = iamStudent({ iamControlContratoStatus: st as string | null });
      expect(isIamPendenteLinkOuPix(s)).toBe(false);
      expect(isIamForaDaCarteiraAteConciliar(s)).toBe(true);
    }
  });

  it('conciliado no GC entra normalmente; não-IAM não é afetado', () => {
    expect(isIamForaDaCarteiraAteConciliar(iamStudent({ iamControlContratoStatus: 'NOVO', iamGcConciliadoAt: '2026-09-01T00:00:00Z' }))).toBe(false);
    expect(isIamForaDaCarteiraAteConciliar(iamStudent({ iamControlAlunoId: undefined, iamControlContratoStatus: 'NOVO' }))).toBe(false);
  });
});

describe('resolveIamFilaStatus', () => {
  it('agrupa PENDENTE* como pendente', () => {
    expect(resolveIamFilaStatus('PENDENTE')).toBe('pendente');
    expect(resolveIamFilaStatus('PENDENTE_PIX')).toBe('pendente');
    expect(resolveIamFilaStatus('PENDENTE_LINK')).toBe('pendente');
  });

  it('CONCILIADO é pago / conciliado', () => {
    expect(resolveIamFilaStatus('CONCILIADO')).toBe('pago');
  });

  it('PARA_CONCILIAR fica no filtro próprio', () => {
    expect(resolveIamFilaStatus('PARA_CONCILIAR')).toBe('para_conciliar');
  });
});

describe('classifyIamTreinamentoOrigem', () => {
  it('eventos: Missão Governar, Confronto, Trainer, PNL', () => {
    expect(classifyIamTreinamentoOrigem('Missão Governar')).toBe('eventos');
    expect(classifyIamTreinamentoOrigem('Confronto')).toBe('eventos');
    expect(classifyIamTreinamentoOrigem('Confronto 2')).toBe('eventos');
    expect(classifyIamTreinamentoOrigem('Trainer')).toBe('eventos');
    expect(classifyIamTreinamentoOrigem('Programação Neurolinguística')).toBe('eventos');
  });

  it('time de vendas: Leader Skills, PEA, Liberty', () => {
    expect(classifyIamTreinamentoOrigem('Leader Skills')).toBe('time_vendas');
    expect(classifyIamTreinamentoOrigem('Plano e Ação')).toBe('time_vendas');
    expect(classifyIamTreinamentoOrigem('Liberty Begin')).toBe('time_vendas');
    expect(classifyIamTreinamentoOrigem('Liberty')).toBe('time_vendas');
  });

  it('masterclass pelo nome', () => {
    expect(classifyIamTreinamentoOrigem('Masterclass Curitiba')).toBe('masterclass');
  });

  it('desconhecido cai em outros', () => {
    expect(classifyIamTreinamentoOrigem('Produto XYZ')).toBe('outros');
  });
});

describe('iamEventoProdutoLabel', () => {
  it('agrupa confronto numerado', () => {
    expect(iamEventoProdutoLabel('Confronto')).toBe('Confronto');
    expect(iamEventoProdutoLabel('Confronto 2')).toBe('Confronto 2');
    expect(iamEventoProdutoLabel('Missão Governar')).toBe('Missão Governar');
  });
});
