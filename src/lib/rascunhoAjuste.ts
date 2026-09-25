// ─── Rascunho de ajuste de parcelas/contrato ─────────────────────────────────
// Regra de 25/09/2026: ajuste de parcelas/contrato enviado à Conciliação é
// RASCUNHO — a ficha continua com os valores antigos e o `depois._after` só é
// aplicado quando o setor clicar em "Conciliar". Itens assim são gravados com
// `_appliedUpfront: false`. (Itens antigos, com `_appliedUpfront: true` ou sem
// a flag, já tinham sido aplicados no envio.)
//
// Ao conciliar, a ficha pode ter mudado desde o envio (baixa de parcela, outro
// ajuste…). Este módulo decide, sem efeitos, como efetivar sem perder nada.

import type { ConciliacaoItem, Installment, Student } from '@/types';

type Rec = Record<string, unknown>;

/** Campos financeiros que o ajuste aplica e que o snapshot guarda. */
export const CAMPOS_AJUSTE = ['installments', 'saleValue', 'downPayment', 'totalInstallments'] as const;

const round2 = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '';
};

function assinaturaParcela(i: Installment): string {
  return [
    round2(i.value),
    i.dueDate ?? '',
    i.paid ? '1' : '0',
    i.paid ? i.paidDate ?? '' : '',
    i.paidValue != null ? round2(i.paidValue) : '',
    [...(i.tags ?? [])].sort().join(','),
  ].join('|');
}

/**
 * Assinatura das parcelas ignorando número/observação (a efetivação renumera
 * por vencimento) e a marca de antecipado (preservada na efetivação).
 */
function assinaturaParcelas(installments: unknown): string {
  if (!Array.isArray(installments)) return '';
  return (installments as Installment[]).map(assinaturaParcela).sort().join('#');
}

function assinaturaCampo(campo: string, valor: unknown): string {
  return campo === 'installments' ? assinaturaParcelas(valor) : round2(valor);
}

/** true se `estado` bate com `ficha` em todos os `campos`. */
export function fichaBate(ficha: Rec, estado: Rec, campos: readonly string[]): boolean {
  return campos.every((c) => assinaturaCampo(c, ficha[c]) === assinaturaCampo(c, estado[c]));
}

/** Campos do ajuste presentes no `_after` e no snapshot do item. */
export function camposDoAjuste(after: Rec, snapshot: Rec): string[] {
  return CAMPOS_AJUSTE.filter(
    (c) => Object.prototype.hasOwnProperty.call(after, c) && Object.prototype.hasOwnProperty.call(snapshot, c),
  );
}

/** Rascunho enviado sob a regra nova: ainda não está na ficha. */
export function isRascunhoNaoAplicado(item: Pick<ConciliacaoItem, 'depois'>): boolean {
  const depois = (item.depois ?? {}) as Rec;
  const after = depois._after;
  return !!after && typeof after === 'object' && depois._appliedUpfront === false;
}

export type PlanoEfetivacao =
  | { acao: 'aplicar'; after: Rec; baixasPreservadas: number[] }
  | { acao: 'ja_aplicado' }
  | { acao: 'bloqueado'; motivo: string };

const CAMPOS_BAIXA: (keyof Installment)[] = ['paid', 'paidDate', 'paidValue', 'paidMarkedAt', 'antecipada'];

/**
 * Decide como efetivar o rascunho na ficha atual:
 *  - ficha igual ao snapshot do envio → aplica o `_after`;
 *  - ficha já igual ao `_after` (outro item do mesmo envio já efetivou) → nada;
 *  - ficha só ganhou BAIXAS de parcelas que o ajuste não mexeu → aplica o
 *    `_after` levando essas baixas junto;
 *  - qualquer outra mudança → bloqueia (reprovar e reenviar o ajuste).
 */
export function planejarEfetivacaoRascunho(
  item: Pick<ConciliacaoItem, 'antes' | 'depois'>,
  student: Partial<Student>,
): PlanoEfetivacao {
  const after = ((item.depois ?? {}) as Rec)._after as Rec | undefined;
  const snapshot = ((item.antes ?? {}) as Rec)._snapshot as Rec | undefined;
  if (!after || typeof after !== 'object') return { acao: 'bloqueado', motivo: 'rascunho sem dados' };
  if (!snapshot || typeof snapshot !== 'object') return { acao: 'aplicar', after, baixasPreservadas: [] };

  const campos = camposDoAjuste(after, snapshot);
  const ficha = student as Rec;
  if (fichaBate(ficha, snapshot, campos)) return { acao: 'aplicar', after, baixasPreservadas: [] };
  if (fichaBate(ficha, after, campos)) return { acao: 'ja_aplicado' };

  const mudouForaDasParcelas = campos.some((c) => c !== 'installments' && !fichaBate(ficha, snapshot, [c]));
  if (mudouForaDasParcelas) {
    return { acao: 'bloqueado', motivo: 'o valor do contrato/entrada/quantidade de parcelas mudou depois do envio' };
  }

  // Só parcelas mudaram: aceita apenas baixas novas em parcelas que o ajuste não alterou.
  const snapInst = (Array.isArray(snapshot.installments) ? snapshot.installments : []) as Installment[];
  const fichaInst = (Array.isArray(student.installments) ? student.installments : []) as Installment[];
  const afterInst = (Array.isArray(after.installments) ? after.installments : snapInst) as Installment[];
  const snapByNum = new Map(snapInst.map((i) => [i.number, i]));
  const afterByNum = new Map(afterInst.map((i) => [i.number, i]));
  if (snapInst.length !== fichaInst.length) {
    return { acao: 'bloqueado', motivo: 'parcelas foram incluídas ou excluídas depois do envio' };
  }

  const baixas = new Map<number, Installment>();
  for (const atual of fichaInst) {
    const antes = snapByNum.get(atual.number);
    if (!antes) return { acao: 'bloqueado', motivo: 'parcelas foram renumeradas depois do envio' };
    if (assinaturaParcela(antes) === assinaturaParcela(atual)) continue;
    const soBaixa =
      !antes.paid &&
      atual.paid &&
      round2(antes.value) === round2(atual.value) &&
      antes.dueDate === atual.dueDate;
    const proposta = afterByNum.get(atual.number);
    const ajusteNaoMexeu =
      !!proposta &&
      !proposta.paid &&
      round2(proposta.value) === round2(antes.value) &&
      proposta.dueDate === antes.dueDate;
    if (!soBaixa || !ajusteNaoMexeu) {
      return { acao: 'bloqueado', motivo: `a parcela ${atual.number} mudou depois do envio e também está no ajuste` };
    }
    baixas.set(atual.number, atual);
  }

  const installments = afterInst.map((i) => {
    const baixa = baixas.get(i.number);
    if (!baixa) return i;
    const merged: Rec = { ...i };
    for (const k of CAMPOS_BAIXA) {
      if (baixa[k] !== undefined) merged[k] = baixa[k];
    }
    return merged as unknown as Installment;
  });
  return {
    acao: 'aplicar',
    after: {
      ...after,
      installments,
      ...(baixas.size > 0 || Object.prototype.hasOwnProperty.call(after, 'paidInstallments')
        ? { paidInstallments: installments.filter((i) => i.paid).length }
        : {}),
    },
    baixasPreservadas: [...baixas.keys()].sort((a, b) => a - b),
  };
}
