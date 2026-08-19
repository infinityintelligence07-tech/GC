// ─── Double-check do ajuste financeiro pré-cancelamento ─────────────────────
// Quando o AC edita os dados do contrato durante o fluxo de cancelamento
// (divergência de valores com o Kamino), é gerado um item de Conciliação do
// tipo `correcao_contrato` marcado com a AJUSTE_TAG.
//
// Se a Conciliação REPROVAR esse item, o card volta para "Em Tratativas" e o
// AC recebe permissão para editar SOMENTE os campos que ele mesmo alterou
// naquele ajuste — nada além disso.

import type { ConciliacaoItem } from '@/types';

export const AJUSTE_TAG = 'Ajuste financeiro AC (pré-cancelamento)';

export type DivergenceField =
  | 'statusMode'
  | 'ac'
  | 'product'
  | 'ciclo'
  | 'enrollmentDate'
  | 'data_treinamento_origem'
  | 'dueDate'
  | 'saleValue'
  | 'downPayment'
  | 'totalInstallments'
  | 'paidInstallments';

export const FIELD_LABELS: Record<DivergenceField, string> = {
  statusMode: 'Modo de Status',
  ac: 'Assessor de Conta',
  product: 'Treinamento',
  ciclo: 'Ciclo do contrato',
  enrollmentDate: 'Data de Inscrição',
  data_treinamento_origem: 'Data de Competência',
  dueDate: 'Data de Vencimento',
  saleValue: 'Valor Total do Contrato',
  downPayment: 'Valor da Entrada do Contrato',
  totalInstallments: 'Número de Parcelas',
  paidInstallments: 'Qtd Parcelas Pagas',
};

/** Item de Conciliação originado do double-check pré-cancelamento. */
export function isDoubleCheckItem(item: ConciliacaoItem): boolean {
  return item.tipo === 'correcao_contrato' && (item.resumo ?? '').includes(AJUSTE_TAG);
}

/** Campos efetivamente alterados pelo AC no ajuste (antes → depois). */
export function changedFieldsFromItem(item: ConciliacaoItem): DivergenceField[] {
  const antes = (item.antes ?? {}) as Record<string, unknown>;
  const depois = (item.depois ?? {}) as Record<string, unknown>;
  const out: DivergenceField[] = [];
  const check = (key: string, field: DivergenceField) => {
    if (String(antes[key] ?? '') !== String(depois[key] ?? '')) out.push(field);
  };
  check('statusMode', 'statusMode');
  check('ac', 'ac');
  check('product', 'product');
  check('ciclo', 'ciclo');
  check('enrollmentDate', 'enrollmentDate');
  check('data_treinamento_origem', 'data_treinamento_origem');
  check('dueDay', 'dueDate');
  check('saleValue', 'saleValue');
  check('downPayment', 'downPayment');
  check('totalInstallments', 'totalInstallments');
  check('paidInstallments', 'paidInstallments');
  return out;
}

/**
 * Retorna a correção pendente (item de double-check reprovado sem reenvio
 * posterior) para um aluno — ou null quando não há nada a corrigir.
 */
export function pendingDoubleCheckCorrection(
  items: ConciliacaoItem[],
  studentId?: string,
): { item: ConciliacaoItem; fields: DivergenceField[] } | null {
  if (!studentId) return null;
  const mine = items.filter((i) => i.studentId === studentId && isDoubleCheckItem(i));
  if (mine.length === 0) return null;
  const byDate = [...mine].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );
  const latest = byDate[0];
  if (latest.status !== 'reprovado') return null;
  const fields = changedFieldsFromItem(latest);
  return { item: latest, fields: fields.length > 0 ? fields : (Object.keys(FIELD_LABELS) as DivergenceField[]) };
}
