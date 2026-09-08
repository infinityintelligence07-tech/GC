import type { ConciliacaoItem, ConciliacaoTipo, Installment, Student } from '@/types';

/**
 * Regra do card "Pago" (Dashboard e Carteira do AC), vigente desde 08/09/2026:
 * só entra parcela cuja BAIXA foi registrada dentro do GC por alguém e
 * conciliada. Parcela que já veio paga da planilha/IAM/Kamino (sem ninguém
 * ter dado baixa no GC) e entrada de venda (downPayment) ficam de fora.
 *
 * Uma baixa "do GC" é reconhecida por qualquer um destes rastros:
 *  - `paidMarkedAt` na parcela — só o fluxo de baixa do GC grava esse campo
 *    (o pull do IAM preserva; importações não escrevem);
 *  - item da Conciliação com status `conciliado` do tipo `pagamento_parcela`
 *    ou `baixa_kamino` apontando para a parcela (número);
 *  - item `quitacao` conciliado para o aluno — as parcelas que estavam em
 *    aberto recebem paidDate = dia da conciliação, então casamos por data.
 */
export const TIPOS_BAIXA_GC: ReadonlySet<ConciliacaoTipo> = new Set<ConciliacaoTipo>([
  'pagamento_parcela',
  'baixa_kamino',
  'quitacao',
]);

export interface BaixasGcIndex {
  /** studentId → números de parcela com baixa conciliada no GC. */
  parcelas: Map<string, Set<number>>;
  /** studentId → dias (YYYY-MM-DD) em que uma quitação foi conciliada. */
  quitacoes: Map<string, string[]>;
}

const numeroParcela = (depois: Record<string, unknown> | undefined): number | null => {
  const n = Number(depois?.parcela ?? depois?.numero);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Indexa uma vez os itens conciliados para consulta O(1) por parcela. */
export function buildBaixasGcIndex(items: ConciliacaoItem[]): BaixasGcIndex {
  const parcelas = new Map<string, Set<number>>();
  const quitacoes = new Map<string, string[]>();
  for (const it of items) {
    if (it.status !== 'conciliado' || !it.studentId || !TIPOS_BAIXA_GC.has(it.tipo)) continue;
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
  return { parcelas, quitacoes };
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
 */
export function isBaixaRegistradaNoGc(
  student: Pick<Student, 'id'>,
  inst: Installment,
  index: BaixasGcIndex,
): boolean {
  if (!inst.paid) return false;
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
