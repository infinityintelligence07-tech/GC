// Guarda contra sobrescrita de dados do aluno por "retrato velho" (stale write).
//
// Problema observado (caso Ana Beatriz Oliveira Andrade): após um rollback de caso
// de cancelamento, o estado local ficou preso em um snapshot antigo. A gravação
// seguinte (mover card / mudar etapa) enviou o objeto inteiro do aluno e regravou
// os campos financeiros antigos por cima de um ajuste já feito, além de apagar
// entradas de histórico.
//
// Este módulo:
//  1) guarda a última versão conhecida (`updated_at`) de cada aluno vinda do banco;
//  2) permite detectar quando o banco está mais novo que o snapshot local;
//  3) mescla histórico em vez de substituir.

const versions = new Map<string, string>();

/** Registra a versão (updated_at) lida do banco para um aluno. */
export function noteStudentVersion(id?: string | null, updatedAt?: string | null) {
  if (!id || !updatedAt) return;
  versions.set(id, updatedAt);
}

export function getKnownStudentVersion(id: string): string | undefined {
  return versions.get(id);
}

/** true quando o banco tem versão mais nova do que a última lida pelo cliente. */
export function isStaleSnapshot(id: string, dbUpdatedAt?: string | null): boolean {
  if (!dbUpdatedAt) return false;
  const known = versions.get(id);
  if (!known) return false;
  return new Date(dbUpdatedAt).getTime() > new Date(known).getTime();
}

/** Campos financeiros/contratuais que nunca devem ser regravados a partir de snapshot velho. */
export const FINANCIAL_COLUMNS = [
  'sale_value',
  'down_payment',
  'installment_value',
  'total_installments',
  'paid_installments',
  'installments',
  'enrollment_date',
  'due_day',
] as const;

type HistoryEntry = { date?: string; type?: string; text?: string; [k: string]: unknown };

function entryKey(e: HistoryEntry): string {
  return `${e?.date ?? ''}|${e?.type ?? ''}|${e?.text ?? ''}`;
}

/**
 * Une o histórico do banco com o histórico enviado pelo cliente, sem perder entradas.
 * Deduplica por data+tipo+texto e ordena cronologicamente.
 */
export function mergeHistory(dbHistory: unknown, incoming: unknown): HistoryEntry[] {
  const a = Array.isArray(dbHistory) ? (dbHistory as HistoryEntry[]) : [];
  const b = Array.isArray(incoming) ? (incoming as HistoryEntry[]) : [];
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (const e of [...a, ...b]) {
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((x, y) => new Date(x.date ?? 0).getTime() - new Date(y.date ?? 0).getTime());
}
