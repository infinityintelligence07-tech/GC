// ─── Reprovação desfaz ajuste aplicado na hora ───────────────────────────────
// Ajustes de parcela/contrato (`depois._after` + `_appliedUpfront`) valem na
// ficha desde o envio. Regra de 25/09/2026: ao REPROVAR na Conciliação, a ficha
// volta ao estado de antes do envio (`antes._snapshot`) — mas só quando ninguém
// mexeu nela depois (a ficha ainda está exatamente como o ajuste deixou). Se
// mudou (baixa, outro ajuste…), nada é sobrescrito: fica para correção manual.

import { useAppStore } from '@/store/useAppStore';
import type { ConciliacaoItem, Installment, Student } from '@/types';

export type ResultadoDesfazer =
  | 'desfeito'      // ficha voltou ao estado de antes do envio
  | 'ja_desfeito'   // ficha já estava no estado de antes (ex.: 2º item do mesmo envio)
  | 'ficha_mudou'   // ficha mudou depois do envio — não sobrescreve
  | 'nao_se_aplica'; // item não foi aplicado na hora / sem snapshot

/** Campos que o ajuste aplica e que o snapshot sabe restaurar. */
const CAMPOS_RESTAURAVEIS = ['installments', 'saleValue', 'downPayment', 'totalInstallments'] as const;
/** Derivados das parcelas: voltam junto quando as parcelas voltam. */
const CAMPOS_DERIVADOS_PARCELAS = ['totalInstallments', 'paidInstallments', 'installmentValue'] as const;

type Rec = Record<string, unknown>;

const round2 = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : '';
};

/**
 * Assinatura das parcelas ignorando número/observação (a aplicação renumera
 * por vencimento) e a marca de antecipado (preservada na aplicação).
 */
function assinaturaParcelas(installments: unknown): string {
  if (!Array.isArray(installments)) return '';
  return (installments as Installment[])
    .map((i) =>
      [
        round2(i.value),
        i.dueDate ?? '',
        i.paid ? '1' : '0',
        i.paid ? i.paidDate ?? '' : '',
        i.paidValue != null ? round2(i.paidValue) : '',
        [...(i.tags ?? [])].sort().join(','),
      ].join('|'),
    )
    .sort()
    .join('#');
}

function assinaturaCampo(campo: string, valor: unknown): string {
  return campo === 'installments' ? assinaturaParcelas(valor) : round2(valor);
}

/** true se `estado` bate com `ficha` em todos os `campos`. */
function bate(ficha: Rec, estado: Rec, campos: string[]): boolean {
  return campos.every((c) => assinaturaCampo(c, ficha[c]) === assinaturaCampo(c, estado[c]));
}

/**
 * Decide (sem efeitos) se a reprovação do item pode desfazer o ajuste na ficha
 * e, se puder, quais campos restaurar.
 */
export function decidirDesfazerAjuste(
  item: Pick<ConciliacaoItem, 'antes' | 'depois'>,
  student: Partial<Student>,
): { resultado: ResultadoDesfazer; updates?: Partial<Student> } {
  const depois = (item.depois ?? {}) as Rec;
  const after = depois._after as Rec | undefined;
  const snapshot = ((item.antes ?? {}) as Rec)._snapshot as Rec | undefined;
  if (depois._appliedUpfront !== true || !after || typeof after !== 'object' || !snapshot || typeof snapshot !== 'object') {
    return { resultado: 'nao_se_aplica' };
  }

  // Só os campos que o ajuste de fato aplicou e que o snapshot tem.
  const campos = CAMPOS_RESTAURAVEIS.filter(
    (c) => Object.prototype.hasOwnProperty.call(after, c) && Object.prototype.hasOwnProperty.call(snapshot, c),
  ) as string[];
  if (campos.length === 0) return { resultado: 'nao_se_aplica' };

  const ficha = student as Rec;
  if (bate(ficha, snapshot, campos)) return { resultado: 'ja_desfeito' };
  if (!bate(ficha, after, campos)) return { resultado: 'ficha_mudou' };

  const updates: Rec = {};
  const restaurar = new Set<string>(campos);
  if (restaurar.has('installments')) CAMPOS_DERIVADOS_PARCELAS.forEach((c) => restaurar.add(c));
  for (const c of restaurar) {
    if (Object.prototype.hasOwnProperty.call(snapshot, c)) {
      updates[c] = c === 'installments' ? JSON.parse(JSON.stringify(snapshot[c] ?? [])) : snapshot[c];
    }
  }
  return { resultado: 'desfeito', updates: updates as Partial<Student> };
}

/**
 * Desfaz na ficha os ajustes reprovados (mais recente primeiro, para que
 * envios encadeados voltem na ordem certa) e registra no histórico do aluno.
 */
export function desfazerAjustesReprovados(
  items: ConciliacaoItem[],
): Record<ResultadoDesfazer, ConciliacaoItem[]> {
  const out: Record<ResultadoDesfazer, ConciliacaoItem[]> = {
    desfeito: [],
    ja_desfeito: [],
    ficha_mudou: [],
    nao_se_aplica: [],
  };
  const ordenados = [...items].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  );
  for (const item of ordenados) {
    const store = useAppStore.getState();
    const student = item.studentId ? store.students.find((s) => s.id === item.studentId) : undefined;
    if (!student) {
      out.nao_se_aplica.push(item);
      continue;
    }
    const { resultado, updates } = decidirDesfazerAjuste(item, student);
    out[resultado].push(item);
    if (resultado === 'desfeito' || resultado === 'ficha_mudou') {
      const text =
        resultado === 'desfeito'
          ? `Conciliação reprovada — ajuste desfeito: a ficha voltou ao estado de antes do envio (${item.resumo}).`
          : `Conciliação reprovada — ajuste NÃO desfeito automaticamente: a ficha mudou depois do envio. Corrigir manualmente (${item.resumo}).`;
      store.updateStudent(student.id, {
        ...(updates ?? {}),
        history: [...(student.history ?? []), { date: new Date().toISOString(), type: 'Sistema', text }],
      });
    }
  }
  return out;
}
