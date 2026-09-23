/**
 * Ao "manter as datas atuais" na renegociação, as novas parcelas herdam os
 * vencimentos em aberto. Datas na entrada ou anteriores são descartadas —
 * a 1ª parcela não pode ficar retroativa em relação ao recebimento da entrada.
 *
 * Ex.: entrada 22/09, vencimentos abertos [15/09, 15/10, …] → começa em 15/10.
 * Se todas as datas abertas forem ≤ entrada, gera a próxima ocorrência do
 * mesmo dia do mês imediatamente após a entrada.
 */
export function datasMantidasAposEntrada(
  datasOrdenadas: string[],
  entradaISO: string | null | undefined,
): string[] {
  const sorted = [...datasOrdenadas]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!entradaISO || !/^\d{4}-\d{2}-\d{2}$/.test(entradaISO)) return sorted;

  const after = sorted.filter((d) => d > entradaISO);
  if (after.length > 0) return after;
  if (sorted.length === 0) return [];

  const diaBase = Number(sorted[0].slice(8, 10)) || 1;
  const [ey, em] = entradaISO.split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const d = new Date(ey, em - 1 + i, diaBase);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (iso > entradaISO) return [iso];
  }
  return [];
}
