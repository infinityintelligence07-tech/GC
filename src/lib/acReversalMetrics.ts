// Métricas de reversão por assessor — fonte única usada na aba Comissões
// e espelhada no Dashboard.

export function roundReversalPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Regra: centésimos até 0,05 → arredonda para 0; a partir de 0,06 → arredonda para 0,1
  const scaled = Math.round(value * 100);
  const whole = Math.floor(scaled / 10) * 10;
  const remainder = scaled - whole;
  return remainder <= 5 ? whole / 100 : (whole + 10) / 100;
}

export type AcMetric = {
  acName: string;
  acPhoto?: string;
  inscricoesTotal: number;
  financeiroTotal: number;
  inscricoesRevertidas: number;
  inscricoesCanceladas: number;
  financeiroRevertido: number;
  financeiroCancelado: number;
  casos: number;
  comissaoValor: number;
  comissaoPossivelValor: number;
  comissaoPercent: number;
  reversalPercent: number;
  meta1: number;
  meta2: number;
  meta3: number;
};

interface ComputeArgs {
  cancellationCases: any[];
  commissions: any[];
  acs: any[];
  rules: any;
  acNameFilter?: string | null;
  dateStart?: string;
  dateEnd?: string;
}

export function computeAcReversalMetrics({
  cancellationCases,
  commissions,
  acs,
  rules,
  acNameFilter = null,
  dateStart = '',
  dateEnd = '',
}: ComputeArgs): AcMetric[] {
  const inRange = (iso?: string) => {
    if (!iso) return true;
    if (!dateStart && !dateEnd) return true;
    const d = new Date(iso); d.setHours(0, 0, 0, 0);
    if (dateStart) {
      const s = new Date(dateStart + 'T00:00:00');
      if (d.getTime() < s.getTime()) return false;
    }
    if (dateEnd) {
      const e = new Date(dateEnd + 'T23:59:59');
      if (d.getTime() > e.getTime()) return false;
    }
    return true;
  };

  const map = new Map<string, AcMetric>();
  // caso → { acName, inscrições revertidas } para consolidar o numerador
  const caseInfo = new Map<string, { acName: string; revertidas: number }>();

  for (const c of cancellationCases) {
    if (!inRange(c.createdAt)) continue;
    const acName = c.ac || '—';
    if (acNameFilter && acName !== acNameFilter) continue;
    const qtd = Math.max(1, c.quantidadeInscricoes ?? 1);
    const valor = c.value ?? 0;
    const perInsc = valor / qtd;
    const isFinalCancel = c.funnelStage === 'Finalizado' && c.operationalStatus === 'Cancelado';
    const revertidasCase = Math.min(qtd, c.inscricoesRevertidas ?? 0);
    const canceladas = isFinalCancel ? Math.max(0, qtd - revertidasCase) : 0;
    const acRef = acs.find((a) => a.name === acName);
    const cur = map.get(acName) ?? {
      acName, acPhoto: acRef?.photo, inscricoesTotal: 0, financeiroTotal: 0,
      inscricoesRevertidas: 0, inscricoesCanceladas: 0,
      financeiroRevertido: 0, financeiroCancelado: 0, casos: 0,
      comissaoValor: 0, comissaoPossivelValor: 0, comissaoPercent: 0, reversalPercent: 0,
      meta1: acRef?.meta1 ?? rules.metaReversao1 ?? rules.meta1,
      meta2: acRef?.meta2 ?? rules.metaReversao2 ?? rules.meta2,
      meta3: acRef?.meta3 ?? rules.metaReversao3 ?? rules.meta3,
    };
    cur.inscricoesTotal += qtd;
    cur.financeiroTotal += valor;
    cur.inscricoesCanceladas += canceladas;
    cur.financeiroCancelado += perInsc * canceladas;
    cur.casos += 1;
    map.set(acName, cur);
    caseInfo.set(c.id, { acName, revertidas: Math.max(1, Math.min(qtd, c.inscricoesRevertidas ?? 0) || qtd) });
  }

  // Comissões contam mesmo aguardando conciliação; só as canceladas/reprovadas ficam fora.
  const casosComComissao = new Set<string>();
  for (const com of commissions) {
    if (com.status === 'cancelada') continue;
    if (!inRange(com.createdAt)) continue;
    const acName = com.acName || '—';
    if (acNameFilter && acName !== acNameFilter) continue;
    const cur = map.get(acName);
    if (!cur) continue;
    if (com.pendingApproval) {
      cur.comissaoPossivelValor += com.value;
    } else {
      cur.comissaoValor += com.value;
    }
    cur.financeiroRevertido += com.revertedValue || 0;
    const baseCaseId = String(com.cancellationCaseId ?? '').split('#')[0];
    if (baseCaseId) casosComComissao.add(baseCaseId);
  }

  // Numerador de reversões = inscrições efetivamente revertidas nos casos
  // que geraram comissão (ex.: 1 caso com 2 inscrições conta 2).
  for (const caseId of casosComComissao) {
    const info = caseInfo.get(caseId);
    if (!info) continue;
    const cur = map.get(info.acName);
    if (!cur) continue;
    cur.inscricoesRevertidas += info.revertidas;
  }

  for (const cur of map.values()) {
    cur.inscricoesRevertidas = Math.min(cur.inscricoesRevertidas, cur.inscricoesTotal);
    cur.comissaoPercent = cur.financeiroRevertido > 0 ? (cur.comissaoValor / cur.financeiroRevertido) * 100 : 0;
    cur.reversalPercent = cur.inscricoesTotal > 0 ? roundReversalPercent((cur.inscricoesRevertidas / cur.inscricoesTotal) * 100) : 0;
  }


  return Array.from(map.values()).sort(
    (a, b) => b.financeiroRevertido - a.financeiroRevertido || b.inscricoesRevertidas - a.inscricoesRevertidas,
  );
}
