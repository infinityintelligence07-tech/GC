import { describe, expect, it } from 'vitest';
import {
  missingTemplateVars,
  normalizeTemplateKey,
  renderTemplate,
  templateTextToZapSignMarkdown,
} from '@/lib/templateRender';

describe('renderTemplate', () => {
  it('preenche placeholders ignorando acento, caixa e underscore', () => {
    const out = renderTemplate('A: {{TOTAL APÓS RENEGOCIAÇÃO}} B: {{ total_apos_renegociacao }} C: {{Nome Completo}}', {
      'TOTAL APOS RENEGOCIACAO': 'R$ 10,00',
      'NOME COMPLETO': 'Maria',
    });
    expect(out).toBe('A: R$ 10,00 B: R$ 10,00 C: Maria');
  });

  it('placeholder sem valor vira travessão', () => {
    expect(renderTemplate('X: {{DESCONHECIDO}} Y: {{VAZIO}}', { VAZIO: '' })).toBe('X: — Y: —');
    expect(missingTemplateVars('{{A}} {{B}} {{á}}', { A: 1 })).toEqual(['B']);
  });

  it('normaliza chave', () => {
    expect(normalizeTemplateKey(' e-mail ')).toBe('E MAIL');
    expect(normalizeTemplateKey('Quantidade de Inscrições')).toBe('QUANTIDADE DE INSCRICOES');
  });
});

describe('templateTextToZapSignMarkdown', () => {
  it('título, rótulos em negrito, linha de assinatura preservada e pipe neutralizado', () => {
    const md = templateTextToZapSignMarkdown(
      [
        'TERMO DE TESTE',
        '',
        'NOME COMPLETO: Maria | Silva',
        'Texto corrido do termo.',
        '____________________________',
        'Maria',
        'Nota: com dois pontos no meio',
      ].join('\n'),
    );
    const linhas = md.split('\n\n');
    expect(linhas[0]).toBe('# TERMO DE TESTE');
    expect(linhas[1]).toBe('**NOME COMPLETO:** Maria / Silva');
    expect(linhas[2]).toBe('Texto corrido do termo.');
    // Linha de assinatura não vira régua horizontal (---): prefixo NBSP.
    expect(linhas[3]).toBe('\u00A0____________________________');
    expect(linhas[4]).toBe('Maria');
    // Rótulo que não está em caixa alta não vira negrito.
    expect(linhas[5]).toBe('Nota: com dois pontos no meio');
  });
});
