import { supabase } from '@/integrations/supabase/client';

export type KaminoDashboardForecastTotals = {
  aVencer: number;
  pago: number;
  pagoReal: number;
  total: number;
  qtd: number;
  source: 'kamino_staging';
};

export async function fetchKaminoDashboardForecastTotals(
  ac?: string,
  product?: string,
): Promise<KaminoDashboardForecastTotals | null> {
  const { data, error } = await supabase.rpc('kamino_dashboard_forecast_totals', {
    p_ac: ac?.trim() || null,
    p_product: product?.trim() || null,
  });
  if (error) {
    console.warn('[kamino] kamino_dashboard_forecast_totals:', error.message);
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return {
    aVencer: Number(row.aVencer ?? 0),
    pago: Number(row.pago ?? 0),
    pagoReal: Number(row.pagoReal ?? 0),
    total: Number(row.total ?? 0),
    qtd: Number(row.qtd ?? 0),
    source: 'kamino_staging',
  };
}
