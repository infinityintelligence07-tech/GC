import type { ConciliacaoItem, ConciliacaoTipo, Installment, Student } from '@/types';

/**
 * Regra do card "Pago" (Dashboard e Carteira do AC), vigente desde 08/09/2026:
 * só entra parcela cuja BAIXA foi registrada dentro do GC por alguém e
 * conciliada. Parcela que já veio paga da planilha/IAM/Kamino (sem ninguém
 * ter dado baixa no GC) e entrada de venda (downPayment) ficam de fora.
 *
 * Ajustes de 14/09/2026 (pedido do financeiro):
 *  - o card soma o valor RECEBIDO (`paidValue`: parcela + juros − desconto), e
 *    não o valor de face da parcela — ver `valorRecebidoParcela`;
 *  - a entrada paga numa RENEGOCIAÇÃO entra no Pago (é baixa feita no GC, na
 *    data em que a Conciliação aprovou) — entrada de venda continua fora;
 *  - quitação de contrato entra pelo valor efetivamente pago (o desconto já é
 *    abatido em `paidValue` por `aplicarBaixaQuitacao`).
 *
 * Uma baixa "do GC" é reconhecida por qualquer um destes rastros:
 *  - `paidMarkedAt` na parcela — só o fluxo de baixa do GC grava esse campo
 *    (o pull do IAM preserva; importações não escrevem);
 *  - item da Conciliação com status `conciliado` do tipo `pagamento_parcela`
 *    ou `baixa_kamino` apontando para a parcela (número);
 *  - item `quitacao` conciliado para o aluno — as parcelas que estavam em
 *    aberto recebem paidDate = dia da conciliação, então casamos por data.
 *
 * Boleto antecipado (`antecipada: true`, baixa do banco/fundo, não pagamento
 * do aluno) NUNCA entra no Pago, mesmo com rastro de baixa — conta só no card
 * "Boletos Antecipados" (regra do financeiro, 09/09/2026).
 */
export const TIPOS_BAIXA_GC: ReadonlySet<ConciliacaoTipo> = new Set<ConciliacaoTipo>([
  'pagamento_parcela',
  'baixa_kamino',
  'quitacao',
]);

/** Entrada paga numa renegociação aprovada na Conciliação (baixa feita no GC). */
export interface EntradaRenegociacaoGc {
  /** Valor da entrada (o que o aluno pagou ao renegociar). */
  valor: number;
  /** Momento em que a Conciliação aprovou (data da baixa no GC), ISO. */
  data: string;
  /** Id do item de Conciliação (para detalhamento/exportação). */
  itemId: string;
}

export interface BaixasGcIndex {
  /** studentId → números de parcela com baixa conciliada no GC. */
  parcelas: Map<string, Set<number>>;
  /** studentId → dias (YYYY-MM-DD) em que uma quitação foi conciliada. */
  quitacoes: Map<string, string[]>;
  /** studentId → entradas de renegociação conciliadas. */
  entradasRenegociacao: Map<string, EntradaRenegociacaoGc[]>;
}

const numeroParcela = (depois: Record<string, unknown> | undefined): number | null => {
  const n = Number(depois?.parcela ?? depois?.numero);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Valor que efetivamente entrou no caixa por uma parcela paga: `paidValue`
 * quando registrado (já com juros somados / desconto abatido); senão o valor
 * de face. É este número que o card "Pago" soma.
 */
export function valorRecebidoParcela(inst: Pick<Installment, 'value' | 'paidValue'>): number {
  return typeof inst.paidValue === 'number' && Number.isFinite(inst.paidValue) ? inst.paidValue : Number(inst.value || 0);
}

/** Indexa uma vez os itens conciliados para consulta O(1) por parcela. */
export function buildBaixasGcIndex(items: ConciliacaoItem[]): BaixasGcIndex {
  const parcelas = new Map<string, Set<number>>();
  const quitacoes = new Map<string, string[]>();
  const entradasRenegociacao = new Map<string, EntradaRenegociacaoGc[]>();
  for (const it of items) {
    if (it.status !== 'conciliado' || !it.studentId) continue;
    if (it.tipo === 'renegociacao') {
      // Só a entrada de RENEGOCIAÇÃO entra no Pago (entrada de venda não).
      const depois = it.depois as Record<string, unknown> | undefined;
      const valor = Number(depois?.entrada);
      const data = String(it.conciliadoAt ?? it.createdAt ?? '');
      if (!Number.isFinite(valor) || valor <= 0.0049 || !data) continue;
      const lista = entradasRenegociacao.get(it.studentId) ?? [];
      lista.push({ valor, data, itemId: it.id });
      entradasRenegociacao.set(it.studentId, lista);
      continue;
    }
    if (!TIPOS_BAIXA_GC.has(it.tipo)) continue;
    if (it.tipo === 'quitacao') {
      const dia = String(it.conciliadoAt ?? it.createdAt ?? '').slice(0, 10);
      if (!dia) continue;
      const lista = quitacoes.get(it.studentId) ?? [];
      lista.push(dia);
      quitacoes.set(it.studentId, lista);
      continue;
    }
    const n = numeroParcela(it.depois as Record<string, unknown> | undefined);
    if (n == null) continue;
    const set = parcelas.get(it.studentId) ?? new Set<number>();
    set.add(n);
    parcelas.set(it.studentId, set);
  }
  return { parcelas, quitacoes, entradasRenegociacao };
}

/**
 * Entradas de renegociação do aluno que caem no período do card (pela data em
 * que a Conciliação aprovou). `range` nulo → todas.
 */
export function entradasRenegociacaoNoPeriodo(
  student: Pick<Student, 'id'>,
  index: BaixasGcIndex,
  range: { start: Date; end: Date } | null | undefined,
): EntradaRenegociacaoGc[] {
  const lista = index.entradasRenegociacao.get(student.id);
  if (!lista || lista.length === 0) return [];
  if (!range) return lista;
  return lista.filter((e) => {
    const d = new Date(e.data);
    return !Number.isNaN(d.getTime()) && d >= range.start && d <= range.end;
  });
}

/**
 * Data que posiciona uma baixa no período do card "Pago": o dia em que a baixa
 * foi REGISTRADA no GC (`paidMarkedAt`), não a data em que o aluno pagou.
 * Ex.: parcela paga em 30/05 e baixada/conciliada em 12/09 entra no Pago de
 * setembro — igual ao controle financeiro, que lança pela data do registro.
 * Sem `paidMarkedAt` (baixa antiga/importada) cai na data de pagamento.
 */
export function dataBaixaParaPeriodo(inst: Pick<Installment, 'paidDate' | 'paidMarkedAt'>): Date | null {
  if (inst.paidMarkedAt) {
    const d = new Date(inst.paidMarkedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (inst.paidDate) {
    const d = new Date(inst.paidDate + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

const DIA_MS = 86_400_000;

const diffDias = (a: string, b: string): number => {
  const ta = new Date(a.slice(0, 10) + 'T00:00:00Z').getTime();
  const tb = new Date(b.slice(0, 10) + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / DIA_MS;
};

/**
 * A parcela está paga E a baixa foi feita dentro do GC (conciliada)?
 * Parcela paga sem rastro (importada já paga) devolve false.
 * Boleto antecipado devolve false: fica só em "Boletos Antecipados".
 */
export function isBaixaRegistradaNoGc(
  student: Pick<Student, 'id'>,
  inst: Installment,
  index: BaixasGcIndex,
): boolean {
  if (!inst.paid) return false;
  if (inst.antecipada) return false;
  if (inst.paidMarkedAt) return true;

  const nums = index.parcelas.get(student.id);
  if (nums) {
    if (nums.has(inst.number)) return true;
    if (inst.numeroOriginal != null && nums.has(inst.numeroOriginal)) return true;
  }

  const quits = index.quitacoes.get(student.id);
  if (quits && inst.paidDate) {
    // A quitação grava paidDate = dia da conciliação (UTC); tolera 1 dia de fuso.
    if (quits.some((dia) => diffDias(dia, inst.paidDate as string) <= 1)) return true;
  }
  return false;
}
