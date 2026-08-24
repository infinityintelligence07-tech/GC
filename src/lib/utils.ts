import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Installment } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Crédito de abatimento entre contratos já aplicado na parcela. */
export function getInstallmentCreditApplied(i: Installment): number {
  return Math.max(0, Number(i.creditApplied) || 0);
}

/** Saldo em aberto da parcela (valor nominal − créditos de abatimento). */
export function getInstallmentOutstanding(i: Installment): number {
  if (i.paid) return 0;
  if (i.tipoParcela === "antecipada") return i.valorContabil ?? 0;
  const base = i.valorContabil ?? i.value ?? 0;
  return Math.max(0, Math.round((base - getInstallmentCreditApplied(i)) * 100) / 100);
}

/** Soma dos créditos de abatimento recebidos em parcelas ainda em aberto. */
export function getStudentCreditAppliedTotal(installments: Installment[] = []): number {
  return installments
    .filter((i) => !i.paid)
    .reduce((sum, i) => sum + getInstallmentCreditApplied(i), 0);
}

/**
 * Normaliza nomes próprios para exibição em Title Case (PT-BR).
 * Mantém preposições em minúsculas e siglas (LTDA, ME, EPP, S.A., S/A) em maiúsculas.
 */
export function toDisplayName(raw?: string | null): string {
  if (!raw) return "";
  const lower = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "von", "van", "la", "le"]);
  const upper = new Set(["LTDA", "ME", "EPP", "MEI", "EIRELI", "S.A.", "S/A", "SA"]);
  return raw
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((word, i) => {
      const up = word.toUpperCase();
      if (upper.has(up)) return up;
      if (i > 0 && lower.has(word)) return word;
      // Preserva hifens e apóstrofos
      return word
        .split(/([-'])/)
        .map((p) => (p === "-" || p === "'" ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)))
        .join("");
    })
    .join(" ");
}

/**
 * Valor de parcela "exibido" derivado das parcelas reais.
 * - Usa o valor mais comum entre todas as parcelas (moda) — espelha a Gestão Financeira.
 * - Prioriza parcelas em aberto; só cai nas pagas se não houver nenhuma em aberto.
 * - Marca `varied=true` quando há mais de um valor distinto na base considerada.
 * - Fallback final: `student.installmentValue` armazenado.
 */
export function getDisplayInstallmentValue(student: { installments?: Array<{ value: number; paid: boolean }>; installmentValue?: number }): { value: number; varied: boolean } {
  const all = student.installments ?? [];
  const unpaid = all.filter((i) => !i.paid);
  const base = unpaid.length > 0 ? unpaid : all;
  if (base.length === 0) return { value: student.installmentValue ?? 0, varied: false };
  const counts = new Map<number, number>();
  for (const i of base) {
    const v = Math.round((i.value ?? 0) * 100) / 100;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return { value: sorted[0][0], varied: counts.size > 1 };
}



/** Normaliza texto para busca: minúsculas, sem acentos e sem pontuação extra. */
export function normalizeSearch(raw?: string | null): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Preposições comuns que não contam como nome próprio. */
const NAME_PARTICLES = new Set([
  "de", "da", "do", "das", "dos", "e", "di", "du", "von", "van", "la", "le", "del", "al", "y", "i", "e", "ou",
]);

/**
 * Retorna uma versão curta do nome: primeiro e último nome próprio.
 * Preposições e partículas do meio são ignoradas.
 * Mantém o nome completo se ele já tiver apenas 2 palavras válidas.
 */
export function toShortName(raw?: string | null): string {
  if (!raw) return "";
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !NAME_PARTICLES.has(w.toLowerCase()));
  if (meaningful.length <= 2) return raw.trim();
  const first = meaningful[0];
  const last = meaningful[meaningful.length - 1];
  return `${first} ${last}`;
}

/** Classe de fonte recomendada para o nome curto de um card, evitando ellipsis. */
export function shortNameFontClass(raw?: string | null): string {
  if (!raw) return "text-[12px]";
  const short = toShortName(raw);
  const len = short.length;
  if (len > 22) return "text-[10px]";
  if (len > 16) return "text-[11px]";
  return "text-[12px]";
}
