import type { CancellationCase, Student } from '@/types';
import {
  isStudentHiddenFromAcPortfolio,
  matchesCancelamentoFilter,
} from '@/lib/acPortfolioVisibility';
import {
  countsInAcPortfolioTotals,
  isIamConciliadoQuitadoAvista,
  isIamForaDaCarteiraAteConciliar,
  isInstallmentExcludedFromAcPortfolio,
} from '@/lib/iamPendenteConciliacao';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import { resolveStudentStatusComVinculo } from '@/lib/recompraVinculo';
import { comStatusFinanceiroParaCards } from '@/lib/renegociacaoStatus';
import { getTodayBrasilia } from '@/lib/brasiliaDate';

export interface TaxaEmDiaCarteira {
  /** Percentual com 1 casa, igual ao card da carteira (`toFixed(1)`). */
  pct: number;
  pctExact: number;
  baseTaxa: number;
  emDiaValue: number;
  carteira: number;
}

/**
 * Taxa Em Dia da carteira do assessor, por valor (R$), no período de vencimento.
 *
 * Mesma regra de `ACPortfolioPage` / Dashboard:
 *   base          = carteira do período − Alunos Novos
 *   inadimplente  = base − Em Dia
 *   Taxa Em Dia   = 100% − inadimplente / base
 *
 * Em Dia inclui o saldo em aberto de quem está Em Dia e as parcelas ainda não
 * vencidas de Vencido 1/2 que caem no período. À Negativar, Negativado e
 * pedido de cancelamento ficam na base e fora do Em Dia.
 */
export function taxaEmDiaPorAssessor(opts: {
  students: Student[];
  hidden: { ids: Set<string>; names: Set<string> };
  cancellationCases: CancellationCase[];
  range: { start: Date; end: Date };
  today?: Date;
}): Map<string, TaxaEmDiaCarteira> {
  const { students, hidden, cancellationCases, range } = opts;
  const today = opts.today ?? getTodayBrasilia();
  const todayMs = today.getTime();

  const carteira = new Map<string, { carteira: number; emDia: number; novos: number }>();

  const bump = (ac: string) => {
    let row = carteira.get(ac);
    if (!row) {
      row = { carteira: 0, emDia: 0, novos: 0 };
      carteira.set(ac, row);
    }
    return row;
  };

  const unpaidInRange = (s: Student, extra: (dueMs: number) => boolean = () => true) => {
    if (isIamConciliadoQuitadoAvista(s)) return 0;
    if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return 0;
    return (s.installments ?? []).reduce((acc, i) => {
      if (i.paid) return acc;
      if (isInstallmentExcludedFromAcPortfolio(s, i)) return acc;
      const dueMs = new Date(i.dueDate + 'T00:00:00').getTime();
      if (dueMs < range.start.getTime() || dueMs > range.end.getTime()) return acc;
      if (!extra(dueMs)) return acc;
      return acc + Number(i.value || 0);
    }, 0);
  };

  for (const raw of students) {
    if (!raw.ac) continue;
    if (isIamForaDaCarteiraAteConciliar(raw)) continue;
    if (isStudentHiddenFromAcPortfolio(raw, hidden, students)) continue;
    if (raw.statusCancelamento === 'cancelado' || raw.status === 'Cancelado') continue;
    if (!countsInAcPortfolioTotals(raw)) continue;
    if (isRendaExtraAtivo(raw) && raw.rendaExtraStatus && raw.rendaExtraStatus !== 'Conciliar Exclusão') continue;

    const withStatus = { ...raw, status: resolveStudentStatusComVinculo(raw, students) } as Student;
    const s = comStatusFinanceiroParaCards(withStatus, students);
    const aberto = unpaidInRange(s);
    if (aberto <= 0.005) continue;

    const row = bump(s.ac);
    row.carteira += aberto;

    if (s.status === 'Pago' || matchesCancelamentoFilter(s, cancellationCases)) continue;

    if (s.status === 'Aluno Novo') {
      row.novos += aberto;
    } else if (s.status === 'Em Dia') {
      row.emDia += aberto;
    } else if (s.status === 'Vencido 1' || s.status === 'Vencido 2') {
      const aVencer = unpaidInRange(s, (dueMs) => dueMs >= todayMs);
      row.emDia += aVencer;
    }
  }

  const out = new Map<string, TaxaEmDiaCarteira>();
  for (const [ac, row] of carteira) {
    if (row.carteira <= 0.005) continue;
    const baseTaxa = Math.max(0, row.carteira - row.novos);
    const inadimplente = Math.max(0, baseTaxa - row.emDia);
    const pctExact = baseTaxa > 0 ? 100 - (inadimplente / baseTaxa) * 100 : 0;
    out.set(ac, {
      pct: Number(pctExact.toFixed(1)),
      pctExact,
      baseTaxa,
      emDiaValue: row.emDia,
      carteira: row.carteira,
    });
  }
  return out;
}
