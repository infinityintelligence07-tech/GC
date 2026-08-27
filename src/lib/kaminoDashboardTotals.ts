import { supabase } from '@/integrations/supabase/client';

export type KaminoDashboardForecastTotals = {
  aVencer: number;
  pago: number;
  pagoReal: number;
  total: number;
  qtd: number;
  source: 'kamino_staging' | 'kamino_staging_gc_overlay';
};

function parseKaminoTotalsPayload(data: unknown): KaminoDashboardForecastTotals | null {
  if (!data) return null;
  let row: Record<string, unknown>;
  try {
    row = (typeof data === 'string' ? JSON.parse(data) : data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!row || typeof row !== 'object') return null;
  return {
    aVencer: Number(row.aVencer ?? 0),
    pago: Number(row.pago ?? 0),
    pagoReal: Number(row.pagoReal ?? 0),
    total: Number(row.total ?? 0),
    qtd: Number(row.qtd ?? 0),
    source: row.source === 'kamino_staging_gc_overlay'
      ? 'kamino_staging_gc_overlay'
      : 'kamino_staging',
  };
}

export async function fetchKaminoDashboardForecastTotals(
  ac?: string,
  product?: string,
): Promise<KaminoDashboardForecastTotals | null> {
  const args = {
    p_ac: ac?.trim() ? ac.trim() : null,
    p_product: product?.trim() ? product.trim() : null,
  };
  const { data, error } = await supabase.rpc('kamino_dashboard_forecast_totals', args);
  if (error) {
    console.warn('[kamino] kamino_dashboard_forecast_totals:', error.message);
    return null;
  }
  return parseKaminoTotalsPayload(data);
}
