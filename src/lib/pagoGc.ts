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
 * Ajustes de 15/09/2026 (alinhamento à planilha de liquidação):
 *  - o período do card usa a data de RECEBIMENTO (`paidDate`), não a data em
 *    que a baixa foi registrada no GC — ver `dataBaixaParaPeriodo`;
 *  - quitados (status Pago / contrato liquidado) CONTINUAM no card Pago: o
 *    aluno some da lista de cobrança, mas o recebimento do assessor fica.
 *
 * Uma baixa "do GC" é reconhecida por qualquer um destes rastros:
 *  - `paidMarkedAt` na parcela — só o fluxo de baixa do GC grava esse campo
 *    (o pull do IAM preserva; importações não escrevem);
 *  - item da Conciliação com status `conciliado` do tipo `pagamento_parcela`
 *    ou `baixa_kamino` apontando para a parcela (número);
 *  - item `quitacao` conciliado para o aluno — as parcelas baixadas na
 *    quitação casam pela data de RECEBIMENTO (`paidDate`), aceitando até
 *    60 dias antes da aprovação (PIX antes da Conciliação) e 1 dia depois.
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
      // Preferir a data em que o assessor RECEBEU a entrada (PIX/boleto),
      // alinhada à planilha; sem ela, cai na data da aprovação na Conciliação.
      const recebimento = String(depois?.entradaPaidDate ?? depois?.entradaDataRecebimento ?? '').slice(0, 10);
      const data = /^\d{4}-\d{2}-\d{2}$/.test(recebimento)
        ? `${recebimento}T12:00:00.000Z`
        : String(it.conciliadoAt ?? it.createdAt ?? '');
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
 * Entradas de renegociação do aluno que caem no período do card. Preferência:
 * data de recebimento (`depois.entradaPaidDate`), senão data da aprovação na
 * Conciliação. `range` nulo → todas.
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
 * Data que posiciona uma baixa no período do card "Pago": o dia em que o
 * assessor RECEBEU o pagamento (`paidDate`), alinhado à planilha de liquidação
 * diária (coluna Recebimento / VALOR PAGO). Quitados continuam contando — o
 * card soma o que entrou no caixa, não só quem ainda está na carteira ativa.
 * Sem `paidDate`, cai na data em que a baixa foi registrada no GC.
 */
export function dataBaixaParaPeriodo(inst: Pick<Installment, 'paidDate' | 'paidMarkedAt'>): Date | null {
  if (inst.paidDate) {
    const d = new Date(inst.paidDate + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (inst.paidMarkedAt) {
    const d = new Date(inst.paidMarkedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

const DIA_MS = 86_400_000;

/** Dias de `from` até `to` (positivo = `to` depois de `from`). */
const signedDiffDias = (from: string, to: string): number => {
  const ta = new Date(from.slice(0, 10) + 'T00:00:00Z').getTime();
  const tb = new Date(to.slice(0, 10) + 'T00:00:00Z').getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return (tb - ta) / DIA_MS;
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
    // paidDate é a data de RECEBIMENTO (PIX/boleto), que pode ser dias antes
    // da aprovação na Conciliação — ex.: Eduardo Soares, PIX 08/09, aprovação
    // 12/09. Aceita até 60 dias antes e 1 dia depois (fuso).
    if (
      quits.some((dia) => {
        const delta = signedDiffDias(dia, inst.paidDate as string);
        return delta >= -60 && delta <= 1;
      })
    ) {
      return true;
    }
  }
  return false;
}
