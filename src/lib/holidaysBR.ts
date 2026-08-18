// ─────────────────────────────────────────────────────────────────────────────
// Feriados nacionais brasileiros (lista fixa)
//
// Inclui datas fixas + datas móveis (Páscoa, Carnaval, Sexta-Santa, Corpus
// Christi) calculadas algoritmicamente para cobrir 2024–2030.
//
// Usado para:
//  • Filtros "Hoje" (Dashboard / AC) — quando hoje é dia útil mas o(s)
//    dia(s) anterior(es) foram fim de semana ou feriado, o filtro inclui
//    aqueles vencimentos retroativos até o último dia útil anterior.
// ─────────────────────────────────────────────────────────────────────────────

import { getTodayBrasilia } from './brasiliaDate';

/** Calcula a data da Páscoa (Domingo de Páscoa) para um dado ano — algoritmo de Meeus/Jones/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=mar, 4=abr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Retorna Set de strings YYYY-MM-DD com todos os feriados nacionais para os anos informados. */
function buildHolidaySet(years: number[]): Set<string> {
  const set = new Set<string>();
  for (const y of years) {
    // Datas fixas nacionais
    set.add(`${y}-01-01`); // Confraternização Universal
    set.add(`${y}-04-21`); // Tiradentes
    set.add(`${y}-05-01`); // Dia do Trabalho
    set.add(`${y}-09-07`); // Independência
    set.add(`${y}-10-12`); // Nossa Senhora Aparecida
    set.add(`${y}-11-02`); // Finados
    set.add(`${y}-11-15`); // Proclamação da República
    set.add(`${y}-11-20`); // Consciência Negra (nacional desde 2024)
    set.add(`${y}-12-25`); // Natal

    // Datas móveis
    const easter = easterSunday(y);
    set.add(fmt(addDays(easter, -48))); // Segunda de Carnaval (não é feriado nacional, mas ponto facultativo amplamente observado)
    set.add(fmt(addDays(easter, -47))); // Terça de Carnaval
    set.add(fmt(addDays(easter, -2)));  // Sexta-feira Santa
    set.add(fmt(addDays(easter, 60)));  // Corpus Christi
  }
  return set;
}

const HOLIDAYS = buildHolidaySet([2024, 2025, 2026, 2027, 2028, 2029, 2030]);

/** True se a data (YYYY-MM-DD) é feriado nacional. */
export function isHoliday(dateStr: string): boolean {
  return HOLIDAYS.has(dateStr);
}

/** True se a data (Date) é sábado, domingo ou feriado. */
export function isNonBusinessDay(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  return isHoliday(fmt(d));
}

/**
 * Quando o filtro "Hoje" é aplicado e hoje é dia útil, recua a data inicial
 * até o dia seguinte ao último dia útil anterior. Assim, se hoje é segunda
 * e sexta foi feriado, retorna a sexta-feira (00:00) como início do range.
 *
 * Se hoje for um dia não útil (fds/feriado), retorna o próprio "hoje" 00:00.
 */
export function getEffectiveTodayStart(today?: Date): Date {
  const ref = today ?? getTodayBrasilia();
  // Se hoje não é dia útil, não há "retroatividade" (mantém comportamento padrão).
  if (isNonBusinessDay(ref)) return new Date(ref);

  // Retrocede 1 dia por vez enquanto o anterior for fds/feriado.
  let cursor = new Date(ref);
  cursor.setDate(cursor.getDate() - 1);
  while (isNonBusinessDay(cursor)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  // cursor agora está no último dia útil anterior — o início do range é o
  // dia SEGUINTE a ele (ou seja, o primeiro dia não-útil retroativo).
  cursor.setDate(cursor.getDate() + 1);
  cursor.setHours(0, 0, 0, 0);
  return cursor;
}
