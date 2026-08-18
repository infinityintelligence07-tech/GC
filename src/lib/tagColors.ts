import type { CSSProperties } from 'react';
// ── Tag color utilities ─────────────────────────────────────────────────────
// Maps tag color key names to CSS hex colors for inline styles.

export const TAG_COLOR_MAP: Record<string, string> = {
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  yellow: '#eab308',
  slate: '#64748b',
  cyan: '#06b6d4',
  indigo: '#6366f1',
};

export function getTagCSSColor(color: string): string {
  return TAG_COLOR_MAP[color] || '#64748b';
}

/** Returns inline style object for rendering a tag badge */
export function getTagStyle(color: string): CSSProperties {
  const hex = getTagCSSColor(color);
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 15%, white)`,
    color: hex,
    borderColor: `color-mix(in srgb, ${hex} 40%, white)`,
  };
}
