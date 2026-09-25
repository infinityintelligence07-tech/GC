import { describe, it, expect } from 'vitest';
import {
  isLibertyGcCompany,
  metaLibertyDeAVencer,
  resolveLibertyMetaPct,
  LIBERTY_META_PCT_A_VENCER,
} from './metaPendenciaAjustes';

describe('meta Liberty = % do A Vencer/Vencido', () => {
  it('identifica empresa Liberty por slug ou nome', () => {
    expect(isLibertyGcCompany({ slug: 'liberty' })).toBe(true);
    expect(isLibertyGcCompany({ slug: 'Liberty' })).toBe(true);
    expect(isLibertyGcCompany({ name: 'Liberty - GC' })).toBe(true);
    expect(isLibertyGcCompany({ slug: 'iam', name: 'IAM - GC' })).toBe(false);
  });

  it('padrão 95% e percentual editável', () => {
    expect(LIBERTY_META_PCT_A_VENCER).toBe(95);
    expect(resolveLibertyMetaPct(undefined)).toBe(95);
    expect(resolveLibertyMetaPct(90)).toBe(90);
    expect(metaLibertyDeAVencer(100_000)).toBe(95_000);
    expect(metaLibertyDeAVencer(100_000, 90)).toBe(90_000);
    expect(metaLibertyDeAVencer(144_500, 95)).toBe(137_275);
    expect(metaLibertyDeAVencer(0)).toBe(0);
  });
});
