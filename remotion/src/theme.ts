import { loadFont as loadDisplay } from '@remotion/google-fonts/Sora';
import { loadFont as loadBody } from '@remotion/google-fonts/Manrope';

const d = loadDisplay('normal', { weights: ['600', '700'], subsets: ['latin'] });
const b = loadBody('normal', { weights: ['400', '600', '700'], subsets: ['latin'] });

export const display = { fontFamily: d.fontFamily } as const;
export const body = { fontFamily: b.fontFamily } as const;

export const COLORS = {
  bg: '#080D18',
  text: '#F4F7FF',
  muted: '#9FB0CC',
  accent: '#3B82F6',
  warn: '#F59E0B',
  ok: '#10B981',
  line: '#1E2A44',
};
