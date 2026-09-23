import { describe, expect, it } from 'vitest';
import {
  INSTITUTO_RAZAO,
  ZAPSIGN_ANCHOR_ALUNO,
  ZAPSIGN_ANCHOR_IAM,
  pickZapSignSignerUrls,
  withZapSignAssinaturas,
} from '@/lib/zapsignTermo';

describe('withZapSignAssinaturas', () => {
  it('anexa bloco com âncora do aluno (única assinatura)', () => {
    const out = withZapSignAssinaturas('# TERMO\n\nCorpo do termo.', 'Maria Silva', '123.456.789-00');
    expect(out).toContain(ZAPSIGN_ANCHOR_ALUNO);
    expect(out).not.toContain(ZAPSIGN_ANCHOR_IAM);
    expect(out).toContain('<table');
    expect(out).toContain('Maria Silva');
    expect(out).toContain(INSTITUTO_RAZAO);
    expect(out).not.toMatch(/_{20,}/);
  });

  it('remove bloco final de underscores do modelo antes de anexar', () => {
    const modelo = [
      '# TERMO',
      '',
      'Texto.',
      '',
      '\u00A0____________________________',
      'Maria Silva',
      '123.456.789-00',
      '',
      '\u00A0____________________________',
      INSTITUTO_RAZAO,
      'CNPJ 03.727.532/0001-13',
    ].join('\n');
    const out = withZapSignAssinaturas(modelo, 'Maria Silva', '123.456.789-00');
    expect(out.indexOf(ZAPSIGN_ANCHOR_ALUNO)).toBeGreaterThan(out.indexOf('Texto.'));
    expect(out.match(/_{12,}/g) ?? []).toHaveLength(0);
  });
});

describe('pickZapSignSignerUrls', () => {
  it('extrai o link do aluno (IAM opcional / legado)', () => {
    const urls = pickZapSignSignerUrls({
      url_assinatura: 'https://aluno',
      url_assinatura_iam: 'https://iam',
      signers: [
        { nome: 'Maria', email: 'a@a.com', status: 'pending', tipo: 'sign', papel: 'aluno', sign_url: 'https://aluno' },
        {
          nome: INSTITUTO_RAZAO,
          email: 'b@b.com',
          status: 'pending',
          tipo: 'sign',
          papel: 'instituto',
          sign_url: 'https://iam',
        },
      ],
    });
    expect(urls).toEqual({ aluno: 'https://aluno', iam: 'https://iam' });
  });
});
