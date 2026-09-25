// ─── Entrada da venda × entrada de renegociação ──────────────────────────────
// A ficha tem um único campo de entrada (`downPayment`): a aprovação de uma
// renegociação SOMA a entrada dela a esse campo. Para exibir separado, as
// entradas de renegociação vêm dos itens `renegociacao` conciliados (valor +
// data de recebimento) e o restante do campo é a entrada da venda.

import type { ConciliacaoItem } from '@/types';

export interface EntradaRenegociacao {
  valor: number;
  /** Data do recebimento (YYYY-MM-DD); sem ela, a da aprovação na Conciliação. */
  data: string;
}

export interface EntradasSeparadas {
  venda: number;
  renegociacoes: EntradaRenegociacao[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Entradas de renegociação conciliadas do aluno, da mais antiga à mais recente. */
export function entradasRenegociacaoDoAluno(
  items: Pick<ConciliacaoItem, 'studentId' | 'tipo' | 'status' | 'depois' | 'conciliadoAt' | 'createdAt'>[],
  studentId: string,
): EntradaRenegociacao[] {
  const out: EntradaRenegociacao[] = [];
  for (const it of items) {
    if (it.studentId !== studentId || it.tipo !== 'renegociacao' || it.status !== 'conciliado') continue;
    const depois = it.depois as Record<string, unknown> | undefined;
    const valor = Number(depois?.entrada);
    if (!(valor > 0.0049)) continue;
    const recebimento = String(depois?.entradaPaidDate ?? depois?.entradaDataRecebimento ?? '').slice(0, 10);
    const data = isIsoDate(recebimento) ? recebimento : String(it.conciliadoAt ?? it.createdAt ?? '').slice(0, 10);
    if (!isIsoDate(data)) continue;
    out.push({ valor: round2(valor), data });
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Separa o campo de entrada. As renegociações abatem do campo a partir da mais
 * recente e nunca passam do total (fichas em que o campo foi editado depois
 * ficam com a parte de renegociação limitada ao que está no campo).
 */
export function separarEntradas(downPayment: number, renegociacoes: EntradaRenegociacao[]): EntradasSeparadas {
  let restante = round2(Math.max(0, Number(downPayment) || 0));
  const alocadas: EntradaRenegociacao[] = [];
  for (const r of [...renegociacoes].sort((a, b) => b.data.localeCompare(a.data))) {
    if (restante <= 0.0049) break;
    const valor = round2(Math.min(r.valor, restante));
    alocadas.push({ valor, data: r.data });
    restante = round2(restante - valor);
  }
  return { venda: restante, renegociacoes: alocadas.reverse() };
}
