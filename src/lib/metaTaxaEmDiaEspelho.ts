import type { AC } from '@/types';

/**
 * Meta / partida da Taxa em Dia na Dashboard geral = espelho das carteiras.
 *
 * Percentuais não se somam: pondera pela base da taxa (R$) de cada AC
 * (Carteira − Alunos Novos). Assim a dash acompanha a soma das carteiras,
 * independente de quantos assessores existam.
 *
 * Com filtro de um AC, devolve só os valores daquela carteira.
 */
export function metaTaxaEmDiaEspelhoDasCarteiras(opts: {
  acs: AC[];
  /** Peso (R$) por nome do AC — base da taxa da carteira. */
  pesoPorAc: Map<string, number>;
  metaPadrao: number;
  mesAtual: string;
  acFilter?: string | null;
}): {
  meta: number;
  base: number | undefined;
  baseMes: string | undefined;
  nCarteiras: number;
  titulo: string;
} {
  const ativos = opts.acs.filter((a) => a.active);
  const fonte = opts.acFilter
    ? ativos.filter((a) => a.name === opts.acFilter)
    : ativos;

  let sumMetaW = 0;
  let sumBaseW = 0;
  let sumW = 0;
  let sumWBase = 0;

  for (const ac of fonte) {
    const w = opts.pesoPorAc.get(ac.name) ?? 0;
    if (w <= 0.005) continue;
    const meta = ac.metaTaxaEmDia ?? opts.metaPadrao;
    sumMetaW += meta * w;
    sumW += w;
    if (
      ac.metaTaxaEmDiaBase != null &&
      Number.isFinite(ac.metaTaxaEmDiaBase) &&
      ac.metaTaxaEmDiaBaseMes === opts.mesAtual
    ) {
      sumBaseW += ac.metaTaxaEmDiaBase * w;
      sumWBase += w;
    }
  }

  const nCarteiras = fonte.length;
  const titulo = opts.acFilter
    ? opts.acFilter
    : nCarteiras <= 0
      ? 'Dashboard geral'
      : `Espelho de ${nCarteiras} carteira${nCarteiras === 1 ? '' : 's'}`;

  return {
    meta: sumW > 0 ? Math.round((sumMetaW / sumW) * 10) / 10 : opts.metaPadrao,
    base: sumWBase > 0 ? Math.round((sumBaseW / sumWBase) * 10) / 10 : undefined,
    baseMes: sumWBase > 0 ? opts.mesAtual : undefined,
    nCarteiras,
    titulo,
  };
}
