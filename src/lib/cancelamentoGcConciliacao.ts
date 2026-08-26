import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { createConciliacaoItemDb } from '@/lib/supabaseMutations';

const CANCEL_FUNIL_ATIVO = new Set([
  'solicitado',
  'em_tratamento',
  'juridico',
  'aguardando_conciliacao',
  'pagamento_multa_pendente',
]);

function openBalance(student: Student): number {
  const inst = student.installments ?? [];
  return inst
    .filter((i) => !i.paid)
    .reduce((sum, i) => sum + Number(i.value ?? 0), 0);
}

function findCase(student: Student, cases: CancellationCase[]): CancellationCase | undefined {
  if (student.cancellationCaseId) {
    const byId = cases.find((c) => c.id === student.cancellationCaseId);
    if (byId) return byId;
  }
  return cases.find((c) => c.studentId === student.id);
}

function hasOpenCancelItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      (i.tipo === 'cancelamento' || i.tipo === 'reversao') &&
      i.studentId === studentId &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
}

function wasConciliado(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      (i.tipo === 'cancelamento' || i.tipo === 'reversao') &&
      i.studentId === studentId &&
      i.status === 'conciliado',
  );
}

/** Aluno espelho GC em cancelamento (fora Kamino) — entra na fila Cancelamentos → GC. */
export function isCancelamentoEspelhoGc(student: Student, cases: CancellationCase[]): boolean {
  const sc = student.statusCancelamento;
  if (sc === 'cancelado' || sc === 'revertido' || student.status === 'Cancelado') return false;
  if (!sc || !CANCEL_FUNIL_ATIVO.has(sc)) {
    if (student.status !== 'Solicitação Cancelamento') return false;
  }
  const caso = findCase(student, cases);
  if (caso?.acao === 'Revertido' || caso?.acao === 'Cancelado') return false;
  return openBalance(student) > 0.0049;
}

/** Item espelho — aguarda finalização no funil antes de conciliar no GC. */
export function isCancelamentoEspelhoItem(item: ConciliacaoItem): boolean {
  return item.tipo === 'cancelamento' && item.depois?.espelho_gc === true;
}

/** Cria itens na fila Conciliação > Cancelamentos → GC para espelhos sem item aberto. */
export async function ensureCancelamentoEspelhoConciliacaoItems(
  students: Student[],
  cases: CancellationCase[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const created: ConciliacaoItem[] = [];
  for (const s of students) {
    if (!isCancelamentoEspelhoGc(s, cases)) continue;
    if (!s.id || hasOpenCancelItem(s.id, items)) continue;
    if (wasConciliado(s.id, items)) continue;
    const caso = findCase(s, cases);
    const aberto = openBalance(s);
    try {
      const row = await createConciliacaoItemDb({
        tipo: 'cancelamento',
        studentId: s.id,
        studentName: s.name,
        ac: s.ac ?? caso?.ac,
        resumo: `Espelho GC — cancelamento em andamento (${s.statusCancelamento?.replace(/_/g, ' ') ?? 'funil'}) — ${formatBrl(aberto)} em aberto (fora Kamino)`,
        antes: {
          statusCancelamento: s.statusCancelamento ?? null,
          openBalance: aberto,
        },
        depois: {
          espelho_gc: true,
          statusCancelamento: s.statusCancelamento ?? 'solicitado',
          openBalance: aberto,
          product: s.product,
        },
        autorNome: 'Sistema GC',
        status: 'pendente',
        relatedCaseId: caso?.id,
      });
      created.push(row);
    } catch (e) {
      console.error('[cancelamento_espelho] falha ao criar item', s.id, e);
    }
  }
  return created.length > 0 ? [...items, ...created] : items;
}

function formatBrl(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
