// ─── Recompras → Conciliação ─────────────────────────────────────────────────
// Fichas de Recompra (Fundo) são contratos à parte na carteira do AC.
// Cada ficha sem treinamento vinculado entra no card "Recompras" da
// Conciliação, onde o revisor seleciona o treinamento de origem.

import type { ConciliacaoItem, Student } from '@/types';
import { createConciliacaoItemDb } from '@/lib/supabaseMutations';

/** Ficha de Recompra (Fundo) — contrato à parte na carteira do AC. */
export function isRecompraFicha(student: Student): boolean {
  return /recompra/i.test(student.product ?? '');
}

/** Recompra ainda sem treinamento vinculado — precisa passar pela Conciliação. */
export function needsRecompraVinculo(student: Student): boolean {
  return isRecompraFicha(student) && !student.recompraTreinamento;
}

function hasOpenRecompraItem(studentId: string, items: ConciliacaoItem[]): boolean {
  return items.some(
    (i) =>
      i.tipo === 'recompra_vinculo' &&
      i.studentId === studentId &&
      (i.status === 'pendente' || i.status === 'aprovado'),
  );
}

/** Cria itens na fila Conciliação > Recompras para fichas sem vínculo. */
export async function ensureRecompraVinculoConciliacaoItems(
  students: Student[],
  items: ConciliacaoItem[],
): Promise<ConciliacaoItem[]> {
  const created: ConciliacaoItem[] = [];
  for (const s of students) {
    if (!needsRecompraVinculo(s)) continue;
    if (hasOpenRecompraItem(s.id, items)) continue;
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
  return created.length > 0 ? [...items, ...created] : items;
}
