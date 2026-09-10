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
 * Filtro por data de cadastro NO SISTEMA (students.created_at, dia em Brasília).
 * `start`/`end` em YYYY-MM-DD; só uma ponta preenchida = a partir de / até;
 * as duas vazias = sem filtro. Ficha sem created_at só passa sem filtro.
 */
export function createdAtInRange(createdAt: string | undefined, start: string, end: string): boolean {
  if (!start && !end) return true;
  const d = createdAt ? toDateStringBrasilia(createdAt) : '';
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/** Converte um instante ISO (ex.: created_at) para a data civil em Brasília, YYYY-MM-DD. */
export function toDateStringBrasilia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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

// ─── Faixas de atraso por MÊS (Vencido 1 → Vencido 2 → À Negativar) ─────────
//
// O atraso é contado em meses de calendário a partir do vencimento efetivo da
// parcela vencida mais antiga: o 1º mês de atraso é "Vencido 1", o 2º mês é
// "Vencido 2" e, a partir do 3º mês (dois meses completos), "À Negativar".
// Ex.: parcela de 15/05 → Vencido 1 de 16/05 a 15/06, Vencido 2 de 16/06 a
// 15/07 e À Negativar a partir de 15/07 (o 3º mês em que a parcela venceria).
// O mesmo cálculo é espelhado na Edge Function `snapshot-daily`.

/** Meses completos de atraso a partir dos quais a ficha vira "Vencido 2". */
export const MESES_ATRASO_VENCIDO_2 = 1;
/** Meses completos de atraso a partir dos quais a ficha vira "À Negativar" (3º mês). */
export const MESES_ATRASO_NEGATIVAR = 2;
/** Dias em À Negativar a partir dos quais o card acende o alerta "+5d". */
export const DIAS_NEGATIVACAO_ESTAGNADA = 5;

export type FaixaAtraso = 'Vencido 1' | 'Vencido 2' | 'À Negativar';

/** Soma meses de calendário mantendo o dia (31/01 + 1 mês = 28/02). */
export function addMonthsClamped(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), lastDay));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Meses completos de atraso entre o vencimento efetivo e a data de referência.
 * 0 = ainda no 1º mês de atraso (ou não vencida).
 */
export function mesesDeAtraso(dueDateStr: string, ref: Date): number {
  const due = effectiveDueDate(dueDateStr);
  const refDay = startOfDay(ref);
  if (due.getTime() >= refDay.getTime()) return 0;
  let meses = 0;
  while (addMonthsClamped(due, meses + 1).getTime() <= refDay.getTime()) meses += 1;
  return meses;
}

/** Faixa de status de uma parcela vencida na data de referência. */
export function faixaAtrasoPorMes(dueDateStr: string, ref: Date): FaixaAtraso {
  const meses = mesesDeAtraso(dueDateStr, ref);
  if (meses < MESES_ATRASO_VENCIDO_2) return 'Vencido 1';
  if (meses < MESES_ATRASO_NEGATIVAR) return 'Vencido 2';
  return 'À Negativar';
}

/** Dia em que uma parcela vencida (e não paga) leva a ficha para "À Negativar". */
export function dataEntradaNegativacao(dueDateStr: string): Date {
  return addMonthsClamped(effectiveDueDate(dueDateStr), MESES_ATRASO_NEGATIVAR);
}

/**
 * Há quantos dias a ficha está em "À Negativar" pela parcela em aberto mais
 * antiga (0 no dia em que entrou). null quando nenhuma parcela chegou lá.
 */
export function diasEmNegativacao(
  installments: { paid: boolean; dueDate: string }[],
  ref: Date = getTodayBrasilia(),
): number | null {
  const refDay = startOfDay(ref).getTime();
  let max: number | null = null;
  for (const inst of installments) {
    if (inst.paid) continue;
    const entrada = dataEntradaNegativacao(inst.dueDate).getTime();
    if (entrada > refDay) continue;
    const dias = Math.floor((refDay - entrada) / (1000 * 60 * 60 * 24));
    if (max === null || dias > max) max = dias;
  }
  return max;
}

/** Alerta "+5d" do card À Negativar: ficha parada em negativação há 5 dias ou mais. */
export function isNegativacaoEstagnada(
  installments: { paid: boolean; dueDate: string }[],
  ref: Date = getTodayBrasilia(),
): boolean {
  const dias = diasEmNegativacao(installments, ref);
  return dias !== null && dias >= DIAS_NEGATIVACAO_ESTAGNADA;
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
