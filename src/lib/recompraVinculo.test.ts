import { describe, expect, it } from 'vitest';
import type { Installment, Student } from '@/types';
import {
  findRecompraOriginal,
  findRecomprasVinculadas,
  getRecompraVinculoGroup,
  resolveStudentDisplayStatusVinculado,
} from '@/lib/recompraVinculo';
import { calculateStudentAutoStatus } from '@/store/useAppStore';

const hoje = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const diasAtras = (n: number) => {
  const d = new Date(hoje);
  d.setDate(d.getDate() - n);
  return iso(d);
};
const diasFrente = (n: number) => diasAtras(-n);

const parcela = (n: number, dueDate: string, paid: boolean, tags?: string[]): Installment => ({
  number: n,
  dueDate,
  value: 100,
  paid,
  paidDate: paid ? dueDate : undefined,
  tags,
});

let seq = 0;
const ficha = (over: Partial<Student>): Student =>
  ({
    id: `s${++seq}`,
    name: 'Cláudio Márcio Neves da Trindade',
    ac: 'Luana dos Santos',
    product: 'Confronto',
    status: 'Em Dia',
    statusMode: 'Automático',
    installments: [],
    history: [],
    ...over,
  }) as Student;

describe('vínculo recompra ↔ contrato original', () => {
  const confronto = ficha({ product: 'Confronto', installments: [parcela(1, diasAtras(200), true), parcela(2, diasAtras(170), true)] });
  const missao = ficha({ product: 'Missão Governar', installments: [parcela(1, diasAtras(50), false)] });
  const recompraPaga = ficha({
    product: 'Fundo - Receita (Recompra)',
    recompraTreinamento: 'Confronto',
    installments: [parcela(1, diasAtras(120), true, ['recompra'])],
  });
  const recompraDevendo = ficha({
    product: 'Fundo - Receita (Recompra)',
    recompraTreinamento: 'Confronto',
    installments: [parcela(1, diasAtras(112), false, ['recompra']), parcela(2, diasAtras(82), false, ['recompra'])],
  });
  const recompraSemVinculo = ficha({ product: 'Fundo - Receita (Recompra)', installments: [parcela(1, diasAtras(10), false)] });
  const outroAluno = ficha({ name: 'Outra Pessoa', product: 'Confronto', installments: [parcela(1, diasFrente(10), false)] });
  const todos = [confronto, missao, recompraPaga, recompraDevendo, recompraSemVinculo, outroAluno];

  it('acha o contrato original pelo nome + treinamento vinculado', () => {
    expect(findRecompraOriginal(recompraDevendo, todos)?.id).toBe(confronto.id);
    expect(findRecompraOriginal(recompraSemVinculo, todos)).toBeUndefined();
  });

  it('acha as recompras vinculadas ao contrato original (e não as de outro treinamento)', () => {
    expect(findRecomprasVinculadas(confronto, todos).map((s) => s.id).sort()).toEqual([recompraPaga.id, recompraDevendo.id].sort());
    expect(findRecomprasVinculadas(missao, todos)).toEqual([]);
    expect(findRecomprasVinculadas(outroAluno, todos)).toEqual([]);
  });

  it('monta o grupo a partir de qualquer lado', () => {
    expect(getRecompraVinculoGroup(recompraPaga, todos)?.original.id).toBe(confronto.id);
    expect(getRecompraVinculoGroup(confronto, todos)?.recompras).toHaveLength(2);
    expect(getRecompraVinculoGroup(missao, todos)).toBeNull();
  });

  it('original quitado + recompra devendo → os dois aparecem devendo (À Negativar, 112d)', () => {
    const rOriginal = resolveStudentDisplayStatusVinculado(confronto, todos);
    expect(rOriginal.status).toBe('À Negativar');
    expect(rOriginal.puxadoDoVinculo).toBe(true);
    const rRecompra = resolveStudentDisplayStatusVinculado(recompraDevendo, todos);
    expect(rRecompra.status).toBe('À Negativar');
    // a recompra sozinha já lê as próprias parcelas como vencidas (ficha de
    // recompra), então o conjunto coincide com a leitura própria.
    expect(rRecompra.puxadoDoVinculo).toBe(false);
    expect(rRecompra.group?.original.id).toBe(confronto.id);
    // a recompra já paga também lê o conjunto
    expect(resolveStudentDisplayStatusVinculado(recompraPaga, todos).status).toBe('À Negativar');
  });

  it('vice-versa: original devendo puxa a recompra quitada para devendo', () => {
    const original = ficha({ product: 'Missão Governar', installments: [parcela(1, diasAtras(20), false)] });
    const recompra = ficha({ product: 'Fundo - Receita (Recompra)', recompraTreinamento: 'Missão Governar', installments: [parcela(1, diasAtras(60), true, ['recompra'])] });
    const r = resolveStudentDisplayStatusVinculado(recompra, [original, recompra]);
    expect(r.status).toBe('Vencido 1');
    expect(r.puxadoDoVinculo).toBe(true);
  });

  it('tudo pago nos dois lados → Pago', () => {
    const original = ficha({ installments: [parcela(1, diasAtras(20), true)] });
    const recompra = ficha({ product: 'Fundo - Receita (Recompra)', recompraTreinamento: 'Confronto', installments: [parcela(1, diasAtras(60), true, ['recompra'])] });
    expect(resolveStudentDisplayStatusVinculado(original, [original, recompra]).status).toBe('Pago');
    expect(resolveStudentDisplayStatusVinculado(recompra, [original, recompra]).status).toBe('Pago');
  });

  it('sem vínculo, a ficha continua com a leitura própria', () => {
    const r = resolveStudentDisplayStatusVinculado(missao, todos);
    expect(r.group).toBeNull();
    expect(r.puxadoDoVinculo).toBe(false);
  });

  it('ficha de recompra SEM vínculo e com parcela recompra vencida não fica "Aluno Novo"', () => {
    // Caso da tela: "Fundo - Receita (Recompra)" 0/3, vencida há 91 dias, lia "Aluno Novo 91d".
    const recompra = ficha({
      product: 'Fundo - Receita (Recompra)',
      installments: [parcela(1, diasAtras(91), false, ['recompra']), parcela(2, diasAtras(61), false, ['recompra']), parcela(3, diasAtras(31), false, ['recompra'])],
    });
    expect(calculateStudentAutoStatus(recompra)).toBe('À Negativar');
    const r = resolveStudentDisplayStatusVinculado(recompra, [recompra]);
    expect(r.group).toBeNull();
    expect(r.status).toBe('À Negativar');
  });

  it('ficha comum com parcela recompra vencida continua ignorando a tag (fluxo normal em dia)', () => {
    const comum = ficha({
      product: 'Confronto',
      installments: [parcela(1, diasAtras(91), false, ['recompra']), parcela(2, diasFrente(10), false)],
    });
    expect(calculateStudentAutoStatus(comum)).not.toMatch(/Vencido|Negativar/);
  });

  it('status Manual e cancelamento ativo não são sobrescritos pelo vínculo', () => {
    const manual = ficha({ statusMode: 'Manual', status: 'Em Dia', installments: [parcela(1, diasAtras(5), true)] });
    const recompra = ficha({ product: 'Fundo - Receita (Recompra)', recompraTreinamento: 'Confronto', installments: [parcela(1, diasAtras(100), false, ['recompra'])] });
    expect(resolveStudentDisplayStatusVinculado(manual, [manual, recompra]).status).toBe('Em Dia');

    const emCancelamento = ficha({ statusCancelamento: 'solicitado', status: 'Solicitação Cancelamento', installments: [parcela(1, diasAtras(5), true)] });
    const r = resolveStudentDisplayStatusVinculado(emCancelamento, [emCancelamento, recompra]);
    expect(r.status).toBe('Solicitação Cancelamento');
    expect(r.puxadoDoVinculo).toBe(false);
  });
});
