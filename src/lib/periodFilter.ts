// Shared utilities for period filtering and analysis modes
// Used by DashboardPage, ACPortfolioPage, and CancelamentosPage
import { getTodayBrasilia } from '@/lib/brasiliaDate';

export type DatePreset = 'ontem' | 'hoje' | 'amanha' | '2d' | '3d' | '7d' | '30d' | 'este-mes' | 'mes-passado' | 'trimestre-atual' | 'trimestre-passado' | 'este-ano' | 'custom';
export type AnalysisMode = 'performance' | 'historico';

export const PRESET_LABELS: Record<DatePreset, string> = {
  ontem: 'Ontem',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  '2d': '2 Dias',
  '3d': '3 Dias',
  '7d': '5 Dias',
  '30d': 'Últ. 30 dias',
  'este-mes': 'Este mês',
  'mes-passado': 'Mês passado',
  'trimestre-atual': 'Trimestre atual',
  'trimestre-passado': 'Trimestre passado',
  'este-ano': 'Este ano',
  custom: 'Personalizado',
};

export const MODE_LABELS: Record<AnalysisMode, string> = {
  performance: 'Performance',
  historico: 'Histórico',
};

export function getPresetRange(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
): { start: Date; end: Date } {
  const now = getTodayBrasilia();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'ontem': {
      const start = new Date(now);
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'hoje': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end: endOfDay };
    }
    case 'amanha': {
      const start = new Date(now);
      start.setDate(now.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(now.getDate() + 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case '2d': {
      const start = new Date(now);
      start.setDate(now.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(now.getDate() + 2);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case '3d': {
      const start = new Date(now);
      start.setDate(now.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(now.getDate() + 3);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case '7d': {
      const start = new Date(now);
      start.setDate(now.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(now.getDate() + 5);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case '30d': {
      const start = new Date(now);
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      return { start, end: endOfDay };
    }
    case 'este-mes': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: endOfDay };
    }
    case 'mes-passado': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return { start, end };
    }
    case 'trimestre-atual': {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), q * 3, 1);
      const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case 'trimestre-passado': {
      const q = Math.floor(now.getMonth() / 3) - 1;
      const year = q < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const qq = (q + 4) % 4;
      const start = new Date(year, qq * 3, 1);
      const end = new Date(year, qq * 3 + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case 'este-ano': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { start, end: endOfDay };
    }
    case 'custom': {
      const start = customStart ? new Date(customStart + 'T00:00:00') : new Date(0);
      const end = customEnd ? new Date(customEnd + 'T23:59:59') : endOfDay;
      return { start, end };
    }
  }
}

export function formatPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) return `${fmt(start)} — ${fmt(end)}`;
  return `${start.toLocaleDateString('pt-BR')} — ${end.toLocaleDateString('pt-BR')}`;
}

export function getCurrentMonthDates(): { firstDay: string; lastDay: string } {
  const now = getTodayBrasilia();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    firstDay: firstDay.toISOString().split('T')[0],
    lastDay: lastDay.toISOString().split('T')[0],
  };
}
