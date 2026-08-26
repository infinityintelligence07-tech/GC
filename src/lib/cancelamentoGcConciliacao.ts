import type { CancellationCase, ConciliacaoItem, Student } from '@/types';
import { conciliarItemDb, createConciliacaoItemDb } from '@/lib/supabaseMutations';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';

const CANCEL_FUNIL_ATIVO = new Set([
  'solicitado',
  'em_tratamento',
  'juridico',
  'aguardando_conciliacao',
  'pagamento_multa_pendente',
]);

const CANCEL_FUNIL_BLOQUEIA_ESPELHO = new Set([
  'solicitado',
  'em_tratamento',
  'juridico',
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

function hasOpenEspelhoItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.studentId === studentId &&
      isCancelamentoEspelhoItem(i) &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
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

/** Cancelamento formal (pós-finalização) aguardando conciliação GC. */
export function hasRealCancelamentoPendente(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.studentId === studentId &&
      i.tipo === 'cancelamento' &&
      !isCancelamentoEspelhoItem(i) &&
      (i.status === 'pendente' || i.status === 'aprovado'),
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

/** Item espelho — placeholder enquanto o cancelamento não foi formalizado. */
export function isCancelamentoEspelhoItem(item: ConciliacaoItem): boolean {
  return item.tipo === 'cancelamento' && item.depois?.espelho_gc === true;
}

/** Pendência real de cancelamento/reversão (pós-finalização) — exclui espelhos GC. */
export function isCancelamentoFinalPendingItem(item: ConciliacaoItem): boolean {
  if (item.status !== 'pendente' && item.status !== 'aprovado') return false;
  if (isCancelamentoEspelhoItem(item)) return false;
  return item.tipo === 'cancelamento' || item.tipo === 'reversao';
}

export function caseHasCancelamentoFinalPending(
  caseId: string,
  items: ConciliacaoItem[],
): boolean {
  return items.some(
    (it) => it.relatedCaseId === caseId && isCancelamentoFinalPendingItem(it),
  );
}

/**
 * Espelho GC ainda bloqueia Conciliar/Aprovar?
 * Só quando o aluno segue no funil de cancelamento SEM item formal na fila.
 */
export function groupBlocksEspelhoConciliacao(
  groupItems: ConciliacaoItem[],
  student: Student | undefined,
  allItems: ConciliacaoItem[],
): boolean {
  const espelhoItems = groupItems.filter(isCancelamentoEspelhoItem);
  if (espelhoItems.length === 0) return false;

  const studentId = groupItems[0]?.studentId;
  if (!studentId) return true;

  if (hasRealCancelamentoPendente(studentId, allItems)) return false;
  if (groupItems.some((i) => i.tipo === 'cancelamento' && !isCancelamentoEspelhoItem(i))) return false;

  if (student?.statusCancelamento === 'aguardando_conciliacao') return false;

  const sc = student?.statusCancelamento;
  if (!sc || sc === 'nenhum' || sc === 'revertido' || student?.status === 'Cancelado') {
    return false;
  }

  if (sc && CANCEL_FUNIL_BLOQUEIA_ESPELHO.has(sc)) return true;
  if (student?.status === 'Solicitação Cancelamento') return true;

  return false;
}

/** Arquiva espelhos abertos quando já existe cancelamento formal ou espelho obsoleto. */
export async function dismissStaleEspelhoItems(
  students: Student[],
  cases: CancellationCase[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  let next = [...items];
  for (const it of items) {
    if (!isCancelamentoEspelhoItem(it)) continue;
    if (it.status !== 'pendente' && it.status !== 'aprovado') continue;
    if (!it.studentId) continue;

    const st = students.find((s) => s.id === it.studentId);
    const substituido = hasRealCancelamentoPendente(it.studentId, items);
    const obsoleto = !st || !isCancelamentoEspelhoGc(st, cases);

    if (!substituido && !obsoleto) continue;

    const nota = substituido
      ? 'Espelho substituído pelo cancelamento formalizado na aba Cancelamentos.'
      : 'Espelho encerrado — aluno não está mais no funil de cancelamento ativo.';

    try {
      await conciliarItemDb(it.id, {
        conciliadoPorNome: 'Sistema GC',
        conciliadoNota: nota,
      });
      next = next.map((row) =>
        row.id === it.id
          ? {
              ...row,
              status: 'conciliado' as const,
              conciliadoAt: new Date().toISOString(),
              conciliadoPorNome: 'Sistema GC',
              conciliadoNota: nota,
            }
          : row,
      );
    } catch (e) {
      console.error('[cancelamento_espelho] falha ao arquivar espelho obsoleto', it.id, e);
    }
  }
  return next;
}

/** Fecha espelhos abertos após formalizar cancelamento (chamado no finalize). */
export async function dismissEspelhoItemsForStudent(studentId: string): Promise<void> {
  const items = useConciliacaoStore.getState().items;
  const espelhos = items.filter(
    (i) =>
      i.studentId === studentId &&
      isCancelamentoEspelhoItem(i) &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
  for (const it of espelhos) {
    useConciliacaoStore.getState().conciliar(it.id, 'Espelho substituído pelo cancelamento formalizado.', {
      silent: true,
    });
  }
}

/** Cria itens na fila Conciliação > Cancelamentos → GC para espelhos sem item aberto. */
export async function ensureCancelamentoEspelhoConciliacaoItems(
  students: Student[],
  cases: CancellationCase[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  let working = await dismissStaleEspelhoItems(students, cases, items);
  const created: ConciliacaoItem[] = [];

  for (const s of students) {
    if (!isCancelamentoEspelhoGc(s, cases)) continue;
    if (!s.id) continue;
    if (hasOpenEspelhoItem(s.id, working)) continue;
    if (hasRealCancelamentoPendente(s.id, working)) continue;
    if (hasOpenCancelItem(s.id, working)) continue;
    if (wasConciliado(s.id, working)) continue;

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

  return created.length > 0 ? [...working, ...created] : working;
}

function formatBrl(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}
