/**
 * Nome canônico do produto no GC — espelha `public.gc_canonical_product` no
 * banco (migração 20260908180000). A Kamino classifica como "Pmr"/"Pnl" e o IAM
 * Control manda o nome por extenso ("Programação Mental para Riqueza e
 * Relacionamento", "Programação Neurolinguística"); no GC é um produto só.
 */
export function canonicalProduct(produto: string | null | undefined): string {
  const original = String(produto ?? '').trim();
  const p = original
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (p === 'pmr' || p.startsWith('programacao mental')) return 'PMR';
  if (p === 'pnl' || p.startsWith('programacao neurolinguistica') || p.startsWith('programacao neuro-linguistica')) return 'PNL';
  return original;
}
