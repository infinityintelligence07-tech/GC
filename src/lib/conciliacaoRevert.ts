// ─── Revert de pendências reprovadas ─────────────────────────────────────────
// Aplica o snapshot `antes` de volta no aluno, por tipo de alteração.
// Retorna um label amigável descrevendo o que foi revertido (ou aviso de
// revert parcial — quando o snapshot não tem dados suficientes p/ reverter
// 100% e a equipe precisa ajustar manualmente).
//
// Filosofia: melhor reverter o máximo possível e avisar o autor que pontos
// devem ser ajustados na mão, do que falhar silenciosamente.

import { useAppStore } from '@/store/useAppStore';
import type { ConciliacaoItem, Student, Installment, HistoryEntry } from '@/types';

function num(v: unknown, fallback?: number): number | undefined {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

/**
 * Reverte um único item. Devolve a descrição curta do que aconteceu.
 * Se o aluno não existir mais, devolve 'sem aluno'.
 */
export function revertConciliacaoItem(item: ConciliacaoItem): string {
  const { studentId, tipo, antes, depois } = item;
  if (!studentId) return 'sem aluno vinculado';
  const store = useAppStore.getState();
  const student = store.students.find((s) => s.id === studentId);
  if (!student) return 'aluno não encontrado';

  // ─── RASCUNHO COM EFEITO IMEDIATO ────────────────────────────────────────
  // Double-check: o ajuste já vale no aluno desde o envio. Em reprovação
  // antiga este ramo dizia "nada aplicado" — agora, se `_appliedUpfront`,
  // restauramos via `_snapshot` (quando existir) em vez de descartar.
  const depoisRec = (depois as Record<string, unknown>) ?? {};
  const after = depoisRec._after;
  if (after && typeof after === 'object') {
    const appliedUpfront = depoisRec._appliedUpfront === true;
    if (!appliedUpfront) {
      const historyEntry: HistoryEntry = {
        date: new Date().toISOString(),
        type: 'Sistema',
        text: `Rascunho REPROVADO — ${item.resumo}. Nenhuma alteração havia sido aplicada.`,
      };
      store.updateStudent(student.id, { history: [...student.history, historyEntry] });
      return 'rascunho descartado (nada havia sido aplicado)';
    }
    // Applied upfront: cair no fluxo de snapshot / por-tipo abaixo.
  }


  const updates: Partial<Student> = {};
  let descricao = '';
  let parcial = false;

  // ─── Snapshot completo (preferido) ──────────────────────────────────────
  // Se o registro trouxe `_snapshot` (estado do aluno ANTES da alteração),
  // restauramos 100% — vence qualquer lógica por-tipo abaixo.
  const snap = (antes as Record<string, unknown>)._snapshot as
    | Partial<Student>
    | undefined;
  const hasSnapshot = snap && typeof snap === 'object';

  switch (tipo) {
    // ─── Valor de uma parcela específica ────────────────────────────────────
    case 'parcela_valor': {
      const parcelaNum = num(antes.parcela);
      const valorAntes = num(antes.valor);
      if (parcelaNum != null && valorAntes != null) {
        const installments: Installment[] = student.installments.map((i) =>
          i.number === parcelaNum ? { ...i, value: valorAntes } : i,
        );
        updates.installments = installments;
        descricao = `valor da parcela ${parcelaNum} restaurado`;
      } else {
        parcial = true;
      }
      break;
    }

    // ─── Vencimento de uma parcela específica ───────────────────────────────
    case 'parcela_vencimento': {
      const parcelaNum = num(antes.parcela);
      const vencAntes = str(antes.vencimento);
      if (parcelaNum != null && vencAntes) {
        const installments: Installment[] = student.installments.map((i) =>
          i.number === parcelaNum ? { ...i, dueDate: vencAntes } : i,
        );
        updates.installments = installments;
        descricao = `vencimento da parcela ${parcelaNum} restaurado`;
      } else {
        parcial = true;
      }
      break;
    }

    // ─── Quantidade de parcelas ─────────────────────────────────────────────
    // Caso simples: parcela duplicada (depois.novaParcela existe) → remove a
    // parcela criada. Casos complexos (renegociação completa) → aviso.
    case 'parcela_quantidade': {
      const novaParcela = num((item.depois as Record<string, unknown>).novaParcela);
      const parcelaExcluida = num(antes.parcelaExcluida);
      if (novaParcela != null) {
        const installments = student.installments.filter((i) => i.number !== novaParcela);
        // Renumera para manter sequência contínua
        const renum: Installment[] = installments
          .sort((a, b) => a.number - b.number)
          .map((i, idx) => ({ ...i, number: idx + 1 }));
        updates.installments = renum;
        updates.totalInstallments = renum.length;
        descricao = `parcela ${novaParcela} (criada na renegociação) removida`;
      } else if (parcelaExcluida != null) {
        // Não temos os dados originais (dueDate, paidDate) — recriamos com o
        // valor conhecido e devolvemos como 'parcial' p/ revisão manual.
        const valorRestaurado = num(antes.valor) ?? 0;
        const restored: Installment = {
          number: parcelaExcluida,
          dueDate: new Date().toISOString().slice(0, 10),
          value: valorRestaurado,
          paid: false,
        };
        const installments = [...student.installments, restored]
          .sort((a, b) => a.number - b.number)
          .map((i, idx) => ({ ...i, number: idx + 1 }));
        updates.installments = installments;
        updates.totalInstallments = installments.length;
        descricao = `parcela ${parcelaExcluida} recriada (revise vencimento)`;
        parcial = true;
      } else {
        // Renegociação completa: restaura valores top-level conhecidos.
        const totalAntes = num(antes.totalParcelas);
        const valorAntes = num(antes.valorParcela);
        const saleAntes = num(antes.saleValue);
        if (totalAntes != null) updates.totalInstallments = totalAntes;
        if (valorAntes != null) updates.installmentValue = valorAntes;
        if (saleAntes != null) updates.saleValue = saleAntes;
        descricao = 'cabeçalho da renegociação restaurado';
        parcial = true; // installments[] originais não estão no snapshot
      }
      break;
    }

    // ─── Pagamento manual de parcela ────────────────────────────────────────
    // Como a baixa só ocorre ao aprovar, reprovar é simplesmente não aplicar.
    case 'pagamento_parcela': {
      const parcelaNum = num(antes.parcela);
      descricao = parcelaNum != null
        ? `pagamento da parcela ${parcelaNum} cancelado (parcela permanece em aberto)`
        : 'pagamento manual cancelado';
      break;
    }

    // ─── Quitação total ──────────────────────────────────────────────────────
    case 'quitacao': {
      // Não dá pra reverter parcelas pagas individualmente (snapshot só tem
      // contagem). Sinaliza para o autor revisar manualmente.
      descricao = 'quitação marcada para revisão manual';
      parcial = true;
      break;
    }

    // ─── Cancelamento aguardando conciliação ────────────────────────────────
    case 'cancelamento': {
      const stageAntes = str(antes.stage);
      const statusAntes = str(antes.statusCancelamento);
      if (statusAntes) {
        updates.statusCancelamento = statusAntes as Student['statusCancelamento'];
      }
      // Devolve o card ao estado ANTES da finalização usando o snapshot do caso.
      const caseSnap = (antes as Record<string, unknown>)._caseSnapshot as
        | Record<string, unknown>
        | undefined;
      const caseId = item.relatedCaseId;
      if (caseSnap && caseId) {
        const now = new Date().toISOString();
        const cancCase = store.cancellationCases.find((c) => c.id === caseId);
        if (cancCase) {
          const restoredStage = (caseSnap.stage as string | undefined) ?? cancCase.stage;
          const restoredOp = (caseSnap.operationalStatus as string | undefined) ?? cancCase.operationalStatus;
          const restoredFunnel = (caseSnap.funnelStage as string | null | undefined) ?? undefined;
          const restoredAcao = (caseSnap.acao as string | null | undefined) ?? undefined;
          const entry = {
            date: now,
            from: cancCase.stage,
            to: restoredStage as never,
            operationalStatus: restoredOp as never,
            note: `Conciliação REPROVADA — cancelamento revertido para "${restoredFunnel ?? restoredStage}". Alterações da finalização desfeitas.`,
          } as (typeof cancCase.history)[number];
          store.updateCancellationCase(caseId, {
            stage: restoredStage as never,
            operationalStatus: restoredOp as never,
            funnelStage: (restoredFunnel ?? null) as never,
            acao: (restoredAcao ?? null) as never,
            cancellationFineValue: (caseSnap.cancellationFineValue as number | null) ?? null,
            cancellationReviewedInstallments: (caseSnap.cancellationReviewedInstallments as never) ?? null,
            movedToCurrentStageAt: (caseSnap.movedToCurrentStageAt as string) ?? now,
            history: [...cancCase.history, entry],
          });
          descricao = `cancelamento revertido para "${restoredFunnel ?? restoredStage}" (card devolvido à coluna de origem)`;
          break;
        }
      }
      descricao = stageAntes
        ? `cancelamento revertido para stage "${stageAntes}"`
        : 'status de cancelamento restaurado';
      parcial = true; // mexer no cancellation_case fica fora do escopo seguro
      break;
    }

    // ─── Reversão de cancelamento ───────────────────────────────────────────
    case 'reversao': {
      const statusAntes = str(antes.statusCancelamento);
      if (statusAntes) {
        updates.statusCancelamento = statusAntes as Student['statusCancelamento'];
      }
      descricao = 'reversão de cancelamento desfeita';
      parcial = true;
      break;
    }

    // ─── Renda Extra ────────────────────────────────────────────────────────
    case 'renda_extra_exclusao': {
      updates.isRendaExtra = false;
      updates.rendaExtraStatus = null;
      descricao = 'aluno removido de Renda Extra';
      break;
    }
    case 'renda_extra_acordo': {
      const reStatusAntes = str(antes.rendaExtraStatus) ?? null;
      updates.rendaExtraStatus = reStatusAntes as Student['rendaExtraStatus'];
      descricao = 'acordo de Renda Extra desfeito';
      parcial = true;
      break;
    }

    // ─── Renegociação em rascunho ───────────────────────────────────────────
    // Nada foi aplicado ao aluno — basta descartar a proposta.
    case 'renegociacao': {
      descricao = 'rascunho da renegociação descartado (nenhuma alteração havia sido aplicada)';
      break;
    }

    default: {
      descricao = 'sem reversão automática disponível';
      parcial = true;
    }
  }

  // ─── Override por snapshot ──────────────────────────────────────────────
  // Se temos o estado completo do aluno antes da alteração, restauramos
  // EXATAMENTE — sobrescreve qualquer reversão parcial deduzida acima.
  if (hasSnapshot && snap) {
    const allowedKeys: (keyof Student)[] = [
      'installments',
      'totalInstallments',
      'paidInstallments',
      'installmentValue',
      'saleValue',
      'downPayment',
      'statusCancelamento',
      'cancellationCaseId',
      'isRendaExtra',
      'rendaExtraStatus',
      'rendaExtraAcordoValue',
      'product',
      'productHistory',
    ];
    const snapRec = snap as Record<string, unknown>;
    for (const k of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(snapRec, k)) {
        (updates as Record<string, unknown>)[k as string] = snapRec[k as string];
      }
    }
    parcial = false;
    descricao = descricao
      ? `${descricao} + snapshot completo restaurado`
      : 'estado anterior restaurado (snapshot completo)';
  }

  // Sempre adiciona entry no histórico do aluno informando a reprovação
  const historyEntry: HistoryEntry = {
    date: new Date().toISOString(),
    type: 'Sistema',
    text: `Conciliação REPROVADA — ${item.resumo}. ${parcial ? 'Revert parcial: revise os dados.' : 'Estado anterior restaurado.'}`,
  };
  updates.history = [...student.history, historyEntry];

  store.updateStudent(student.id, updates);

  return parcial ? `${descricao} (parcial — revisar)` : descricao;
}
