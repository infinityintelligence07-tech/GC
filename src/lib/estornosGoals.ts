// Metas de estornos por ano/mês/semana.
// Regra: se a meta mensal é definida, distribui igualmente entre as semanas do mês.
// Se metas semanais individuais são definidas, o total mensal = soma delas.
// Semanas seguem a mesma segmentação usada em EstornosPage (semanas Mon-Sun clipadas ao mês).

export type MonthGoal = { monthly?: number; weekly?: Record<number, number> };
export type GoalsData = Record<number, Record<number, MonthGoal>>; // [year][monthIdx0-11]

const KEY = 'estornos:goals-v2';
const LEGACY_KEY = 'estornos:weeklyGoal';
const EVT = 'estornos-goals-changed';

export function loadGoals(): GoalsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as GoalsData;
  } catch { /* noop */ }
  return {};
}

export function saveGoals(g: GoalsData): void {
  localStorage.setItem(KEY, JSON.stringify(g));
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* noop */ }
}

export function subscribeGoals(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVT, h);
  window.addEventListener('storage', h);
  return () => {
    window.removeEventListener(EVT, h);
    window.removeEventListener('storage', h);
  };
}

/** Devolve segmentos de semana (Mon-Sun clipados) que compõem o mês. */
export function getWeekSegments(year: number, month: number): { start: Date; end: Date }[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const segs: { start: Date; end: Date }[] = [];
  let cursor = new Date(first);
  while (cursor <= last) {
    const dow = cursor.getDay(); // 0=Dom, 6=Sáb
    const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + daysUntilSunday);
    const end = weekEnd > last ? new Date(last) : weekEnd;
    segs.push({ start: new Date(cursor), end: new Date(end) });
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() + 1);
  }
  return segs;
}

export function getMonthWeekCount(year: number, month: number): number {
  return getWeekSegments(year, month).length;
}

/** Normaliza a meta do mês em { monthly, weekly[] } segundo as regras de proporção. */
export function getMonthMeta(year: number, month: number): { monthly: number; weekly: number[] } {
  const g = loadGoals()[year]?.[month];
  const weeks = getMonthWeekCount(year, month);
  const weekly: number[] = Array(weeks).fill(0);
  if (!g) return { monthly: 0, weekly };
  if (g.weekly && Object.keys(g.weekly).length > 0) {
    for (let i = 0; i < weeks; i++) weekly[i] = Number(g.weekly[i + 1] ?? 0);
    const monthly = weekly.reduce((s, v) => s + v, 0);
    return { monthly, weekly };
  }
  const monthly = Number(g.monthly ?? 0);
  const per = weeks > 0 ? monthly / weeks : 0;
  for (let i = 0; i < weeks; i++) weekly[i] = per;
  return { monthly, weekly };
}

export function setMonthlyMeta(year: number, month: number, value: number): void {
  const data = loadGoals();
  if (!data[year]) data[year] = {};
  data[year][month] = { monthly: value > 0 ? value : undefined };
  saveGoals(data);
}

export function setWeeklyMeta(year: number, month: number, weekIdx1: number, value: number): void {
  const data = loadGoals();
  if (!data[year]) data[year] = {};
  const cur = data[year][month] ?? {};
  // Se ainda não há semanas específicas mas há um monthly, materializa a distribuição
  // antes de sobrescrever a semana clicada, preservando a proporção anterior.
  let weekly: Record<number, number> = { ...(cur.weekly ?? {}) };
  if (Object.keys(weekly).length === 0 && cur.monthly && cur.monthly > 0) {
    const weeks = getMonthWeekCount(year, month);
    const per = weeks > 0 ? cur.monthly / weeks : 0;
    for (let i = 1; i <= weeks; i++) weekly[i] = per;
  }
  if (value > 0) weekly[weekIdx1] = value;
  else delete weekly[weekIdx1];
  data[year][month] = {
    ...cur,
    weekly: Object.keys(weekly).length > 0 ? weekly : undefined,
    monthly: undefined, // após personalização, monthly = soma (deriva de weekly)
  };
  saveGoals(data);
}

export function clearMonthMeta(year: number, month: number): void {
  const data = loadGoals();
  if (data[year]) {
    delete data[year][month];
    if (Object.keys(data[year]).length === 0) delete data[year];
  }
  saveGoals(data);
}

/** Devolve a meta semanal para uma data específica (a semana que contém a data). */
export function getWeekMetaForDate(iso: string): number {
  if (!iso) return 0;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m) return 0;
  const target = new Date(y, m - 1, d);
  const segs = getWeekSegments(y, m - 1);
  const weekIdx = segs.findIndex((s) => target >= s.start && target <= s.end);
  if (weekIdx < 0) return 0;
  return getMonthMeta(y, m - 1).weekly[weekIdx] ?? 0;
}

/** Soma as metas das semanas cujo início (segunda-feira do segmento) cai dentro do range. */
export function getMetaForRange(fromISO: string, toISO: string): number {
  if (!fromISO || !toISO) return 0;
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  const from = new Date(y1, m1 - 1, d1);
  const to = new Date(y2, m2 - 1, d2);
  let total = 0;
  // Itera pelos meses envolvidos
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const endCursor = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= endCursor) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const segs = getWeekSegments(y, m);
    const meta = getMonthMeta(y, m).weekly;
    segs.forEach((s, i) => {
      // Considera a semana se qualquer parte dela cair dentro do range
      if (s.end >= from && s.start <= to) total += meta[i] ?? 0;
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return total;
}

/** Migração one-shot do valor único legacy para meta mensal do mês atual, sem sobrescrever se já configurado. */
export function migrateLegacyIfNeeded(): void {
  try {
    const legacy = Number(localStorage.getItem(LEGACY_KEY) ?? 0);
    if (!Number.isFinite(legacy) || legacy <= 0) return;
    const data = loadGoals();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (!data[y]?.[m]) {
      const weeks = getMonthWeekCount(y, m);
      setMonthlyMeta(y, m, legacy * weeks);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* noop */ }
}

export const GOAL_YEARS = [2026, 2027, 2028];
export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
