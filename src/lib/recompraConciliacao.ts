// ─── Recompras → Conciliação ─────────────────────────────────────────────────
// Fichas de Recompra (Fundo) são contratos à parte na carteira do AC.
// Cada ficha sem treinamento vinculado entra no card "Recompras" da
// Conciliação, onde o revisor seleciona o treinamento de origem.

import type { ConciliacaoItem, Student } from '@/types';
import { conciliarItemDb, createConciliacaoItemDb } from '@/lib/supabaseMutations';

/**
 * Janela em que um item recém-conciliado ainda "segura" a fila. Cobre a corrida
 * entre a gravação do vínculo no aluno e o reload disparado pelo realtime do
 * item conciliado (que pode ler o aluno antes do vínculo ter sido gravado).
 */
const GRACE_MS = 10 * 60 * 1000;

/** Ficha de Recompra (Fundo) — contrato à parte na carteira do AC. */
export function isRecompraFicha(student: Student): boolean {
  return /recompra/i.test(student.product ?? '');
}

/** Recompra ainda sem treinamento vinculado — precisa passar pela Conciliação. */
export function needsRecompraVinculo(student: Student): boolean {
  return isRecompraFicha(student) && !student.recompraTreinamento;
}

function isOpen(i: ConciliacaoItem): boolean {
  return i.status === 'pendente' || i.status === 'aprovado';
}

function isRecompraItemOf(i: ConciliacaoItem, studentId: string): boolean {
  return i.tipo === 'recompra_vinculo' && i.studentId === studentId;
}

function hasOpenRecompraItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some((i) => isRecompraItemOf(i, studentId) && isOpen(i));
}

/** Item conciliado há pouco: o vínculo provavelmente está a caminho do banco. */
function hasRecentlyConciliadoRecompraItem(studentId: string, items: ConciliacaoItem[], now: number): boolean {
  return items.some((i) => {
    if (!isRecompraItemOf(i, studentId) || i.status !== 'conciliado' || !i.conciliadoAt) return false;
    const t = new Date(i.conciliadoAt).getTime();
    return Number.isFinite(t) && now - t < GRACE_MS;
  });
}

/**
 * Mantém a fila Conciliação > Recompras coerente com a carteira:
 * - cria item para ficha sem vínculo e sem item aberto;
 * - resolve item aberto cuja ficha já tem vínculo (fantasma deixado pela corrida).
 */
export async function ensureRecompraVinculoConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const now = Date.now();
  const created: ConciliacaoItem[] = [];
  const resolvidos = new Map<string, string>(); // itemId → nota

  for (const s of students) {
    if (!isRecompraFicha(s)) continue;

    if (s.recompraTreinamento) {
      for (const i of items) {
        if (!isRecompraItemOf(i, s.id) || !isOpen(i)) continue;
        const nota = `Vínculo já registrado na ficha: "${s.recompraTreinamento}".`;
        try {
          await conciliarItemDb(i.id, { conciliadoPorNome: 'Sistema', conciliadoNota: nota });
          resolvidos.set(i.id, nota);
        } catch (e) {
          console.error('[recompra_vinculo] falha ao resolver item fantasma', i.id, e);
        }
      }
      continue;
    }

    if (hasOpenRecompraItem(s.id, items)) continue;
    if (hasRecentlyConciliadoRecompraItem(s.id, items, now)) continue;

    const abertas = s.installments.filter((i) => !i.paid);
    const valorAberto = abertas.reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    try {
      const row = await createConciliacaoItemDb({
        tipo: 'recompra_vinculo',
        studentId: s.id,
        studentName: s.name,
        ac: s.ac,
        resumo:
          `Recompra com ${s.installments.length} parcela${s.installments.length !== 1 ? 's' : ''}` +
          ` (${abertas.length} em aberto — ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorAberto)}).` +
          ' Selecione o treinamento de origem.',
        antes: { recompra_treinamento: null },
        depois: {},
        autorNome: 'Sistema',
        status: 'pendente',
      });
      created.push(row);
    } catch (e) {
      console.error('[recompra_vinculo] falha ao criar item de conciliação', s.id, e);
    }
  }

  if (created.length === 0 && resolvidos.size === 0) return items;

  const conciliadoAt = new Date(now).toISOString();
  const base =
    resolvidos.size === 0
      ? items
      : items.map((i) =>
          resolvidos.has(i.id)
            ? { ...i, status: 'conciliado' as const, conciliadoAt, conciliadoPorNome: 'Sistema', conciliadoNota: resolvidos.get(i.id) }
            : i,
        );
  return created.length > 0 ? [...base, ...created] : base;
}
