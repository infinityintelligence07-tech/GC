// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de data/horário no fuso de Brasília (America/Sao_Paulo – UTC-3)
//
// O sistema deve operar SEMPRE no horário de Brasília, independentemente do
// fuso do navegador do usuário.  As funções abaixo garantem isso.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'America/Sao_Paulo';

/** Retorna a data/hora atual formatada em Brasília como string YYYY-MM-DD */
export function getTodayStringBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Retorna um Date cujo dia/mês/ano corresponde ao "hoje" em Brasília,
 * com horas zeradas (00:00:00.000).
 */
export function getTodayBrasilia(): Date {
  const str = getTodayStringBrasilia(); // "2026-04-17"
  return new Date(str + 'T00:00:00');
}

/** Data de Brasília formatada como DD/MM/AAAA (pt-BR) */
export function getFormattedDateBrasilia(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date());
}

/** Horário de Brasília formatado como HH:MM (pt-BR) */
export function getFormattedTimeBrasilia(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

/** Data + horário completos de Brasília: "17/04/2026 14:32" */
export function getFormattedDateTimeBrasilia(): string {
  return `${getFormattedDateBrasilia()} ${getFormattedTimeBrasilia()}`;
}

// ─── Dias úteis ──────────────────────────────────────────────────────────────
// Sábado e domingo NÃO são considerados úteis. Quando uma parcela vence em
// fim de semana, o vencimento "efetivo" rola para a próxima segunda-feira.
// Isso significa que:
//   - na sexta/sábado/domingo essa parcela ainda é "Em Dia"
//   - na segunda, se não paga, ela é "vencida hoje" (incluindo fds)
//
// `effectiveDueDate(dateStr)` devolve a data efetiva (rolada para 2ª se cair
// em sáb/dom). Use sempre esta função ao comparar vencimento com a data atual.

export function isWeekend(d: Date): boolean {
  const dow = d.getDay(); // 0=Dom 6=Sáb
  return dow === 0 || dow === 6;
}

/** Recebe "YYYY-MM-DD" e devolve Date normalizado (00:00) já rolado p/ próximo dia útil se cair no fds. */
export function effectiveDueDate(dueDateStr: string): Date {
  const d = new Date(dueDateStr + 'T00:00:00');
  while (isWeekend(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Verifica se uma parcela está VENCIDA hoje (em Brasília).
 * Regras:
 *  - O dia do vencimento NÃO é vencido (é "Em Dia").
 *  - Vencimentos em sábado/domingo rolam para a 2ª-feira seguinte.
 *  - Portanto, na 2ª-feira, parcelas com vencimento original em sáb/dom
 *    contam como "vencendo hoje" (não vencidas) até o final daquela 2ª.
 */
export function isOverdueToday(dueDateStr: string, ref?: Date): boolean {
  const today = ref ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()) : getTodayBrasilia();
  const eff = effectiveDueDate(dueDateStr);
  return eff.getTime() < today.getTime();
}

/** Retorna true se a parcela vence HOJE (já considerando rolagem de fds). */
export function isDueToday(dueDateStr: string, ref?: Date): boolean {
  const today = ref ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()) : getTodayBrasilia();
  const eff = effectiveDueDate(dueDateStr);
  return eff.getTime() === today.getTime();
}

/** ISO YYYY-MM-DD a partir de Date local (sem UTC). */
export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Data exibida na UI: usa vencimento efetivo quando cai no fim de semana. */
export function dueDateForDisplay(dueDateStr: string): {
  displayIso: string;
  originalIso: string;
  rolledFromWeekend: boolean;
} {
  if (!dueDateStr) return { displayIso: '', originalIso: '', rolledFromWeekend: false };
  const eff = effectiveDueDate(dueDateStr);
  const displayIso = toIsoDateLocal(eff);
  const originalIso = dueDateStr.slice(0, 10);
  return {
    displayIso,
    originalIso,
    rolledFromWeekend: displayIso !== originalIso,
  };
}

/**
 * Calcula há quantos dias a parcela mais antiga vencida está em atraso.
 * Considera rolagem de fim de semana (vencimento efetivo).
 * Retorna null se não houver parcela vencida; caso contrário retorna o número de dias.
 */
export function calcularDiasVencido(installments: { paid: boolean; dueDate: string }[]): number | null {
  const today = getTodayBrasilia();
  let oldestOverdueDays: number | null = null;

  for (const inst of installments) {
    if (inst.paid) continue;
    const due = effectiveDueDate(inst.dueDate);
    if (due.getTime() < today.getTime()) {
      const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (oldestOverdueDays === null || diffDays > oldestOverdueDays) {
        oldestOverdueDays = diffDays;
      }
    }
  }

  return oldestOverdueDays;
}
