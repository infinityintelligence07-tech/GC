import { describe, expect, it } from 'vitest';
import {
  classifyIamTreinamentoOrigem,
  iamEventoProdutoLabel,
  resolveIamFilaStatus,
} from '@/lib/iamPendenteConciliacao';

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
