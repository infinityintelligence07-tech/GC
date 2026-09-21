import type { Installment, Student } from '@/types';
import { isPendenciaEventoInstallment } from '@/lib/studentDisplayStatus';
import { isParcelaAntecipada } from '@/lib/parcelaAntecipada';

/** Meta padrão (R$) da fita "Pago · mês vigente" quando ainda não há meta salva. */
export const EM_DIA_NOVOS_META_PADRAO = 144500;

/** Item de pendência que explica acréscimo na meta do mês. */
export interface MetaPendenciaItem {
  studentId: string;
  studentName: string;
  product: string;
  value: number;
  dueDate?: string;
  /** Data em que a pendência foi paga (YYYY-MM-DD). */
  paidDate?: string;
  tipo: string;
}

/** Soma em centavos (evita erro de ponto flutuante; mantém centavos exatos). */
function somaCentavos(valores: number[]): number {
  return valores.reduce((acc, v) => acc + Math.round((Number(v) || 0) * 100), 0);
}

function dataPagamentoIso(inst: Installment): string | undefined {
  if (inst.paidDate && /^\d{4}-\d{2}-\d{2}/.test(inst.paidDate)) return inst.paidDate.slice(0, 10);
  if (inst.paidMarkedAt && /^\d{4}-\d{2}-\d{2}/.test(inst.paidMarkedAt)) return inst.paidMarkedAt.slice(0, 10);
  return undefined;
}

function tipoPendenciaPaga(): string {
  return 'Pendência de evento paga';
}

/**
 * Pendências de evento já pagas. Pendência de entrada não entra.
 * Pendência ainda em aberto não entra. `pagoDe`/`pagoAte` recortam pela data
 * do pagamento (mês vigente da fita). Antecipação de boleto não conta.
 */
export function listMetaPendenciaItems(
  students: Student[],
  pagoDe?: string,
  pagoAte?: string,
): MetaPendenciaItem[] {
  const items: MetaPendenciaItem[] = [];
  for (const s of students) {
    for (const inst of s.installments ?? []) {
      if (!inst.paid || isParcelaAntecipada(inst) || !isPendenciaEventoInstallment(inst, s.product)) continue;
      const paidDate = dataPagamentoIso(inst);
      if (!paidDate) continue;
      if (pagoDe && paidDate < pagoDe) continue;
      if (pagoAte && paidDate > pagoAte) continue;
      items.push({
        studentId: s.id,
        studentName: s.name,
        product: s.product,
        value: Number(inst.value) || 0,
        dueDate: inst.dueDate,
        paidDate,
        tipo: tipoPendenciaPaga(),
      });
    }
  }
  return items.sort((a, b) => b.value - a.value || a.studentName.localeCompare(b.studentName, 'pt-BR'));
}

/** Soma exata das pendências (centavos), sem arredondar para reais inteiros. */
export function sumMetaPendenciaItems(items: MetaPendenciaItem[]): number {
  return somaCentavos(items.map((i) => i.value)) / 100;
}

/**
 * Meta base gravada no AC. Valores antigos com bump redondo (+10.000 sobre o
 * padrão) voltam ao padrão — o acréscimo passa a ser a soma exata das pendências.
 */
export function resolveMetaBase(stored?: number | null): number {
  if (stored == null || !Number.isFinite(Number(stored))) return EM_DIA_NOVOS_META_PADRAO;
  const n = Number(stored);
  if (Math.abs(n - (EM_DIA_NOVOS_META_PADRAO + 10000)) < 0.51) return EM_DIA_NOVOS_META_PADRAO;
  return n;
}

/** Meta efetiva = base + soma exata das pendências de entrada já pagas no período. */
export function metaEfetivaComPendencias(base: number, items: MetaPendenciaItem[]): number {
  const cents = Math.round((Number(base) || 0) * 100) + somaCentavos(items.map((i) => i.value));
  return cents / 100;
}

export function formatMetaPendenciaDue(iso?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
