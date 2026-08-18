// ─── Comissões — Store (persistência no backend) ────────────────────────────
// Gera automaticamente uma comissão quando o assessor reverte um aluno na
// coluna "Em Tratativas". A % aplicada varia por método de pagamento
// (boleto / pix / cartão) e é configurável pelo próprio admin nesta aba.
//
// Persistência: tabela `commissions` no backend (compartilhada entre usuários).
// Visibilidade controlada por RLS: admin vê tudo; assessor vê só as dele.

import { create } from 'zustand';
import { reportDbError } from '@/lib/dbError';

export type CommissionPaymentType = 'boleto' | 'pix' | 'cartao';
export type CommissionStatus = 'pendente' | 'paga' | 'cancelada';

export interface Commission {
  id: string;
  cancellationCaseId: string;
  studentId?: string;
  studentName: string;
  acId?: string;
  acName?: string;
  paymentType: CommissionPaymentType;
  revertedValue: number;
  percent: number;      // %, ex.: 0.5, 1
  value: number;        // R$
  status: CommissionStatus;
  createdAt: string;
  paidAt?: string;
  observacao?: string;
  product?: string;
  // Comissão só é computada após aprovação da conciliação da reversão.
  // Enquanto true, NÃO aparece na aba Comissões / KPIs / rankings.
  pendingApproval?: boolean;
}


export interface CommissionRates {
  boleto: number;
  pix: number;
  cartao: number;
}

const DEFAULT_RATES: CommissionRates = { boleto: 0.5, pix: 1, cartao: 1 };

interface State {
  commissions: Commission[];
  rates: CommissionRates;
  loaded: boolean;
  setCommissions: (list: Commission[]) => void;
  loadAll: () => Promise<void>;
  setRates: (r: Partial<CommissionRates>) => void;
  register: (input: Omit<Commission, 'id' | 'percent' | 'value' | 'status' | 'createdAt'> & { percent?: number; pendingApproval?: boolean }) => Commission | null;
  updatePaymentType: (id: string, paymentType: CommissionPaymentType) => void;
  markPaga: (id: string, paidAt?: string) => void;
  markPendente: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  // Aprova comissões pendentes de um caso (id exato ou prefixo `${id}#`).
  approvePendingByCaseId: (caseId: string) => void;
  // Remove comissões pendentes de aprovação de um caso (usado em reprovação).
  removePendingByCaseId: (caseId: string) => void;
  // Marca as comissões do caso como reprovadas na conciliação (mantém na lista, riscadas).
  rejectByCaseId: (caseId: string, motivo: string) => void;

}


export const computeCommissionValue = (reverted: number, percent: number): number =>
  Math.max(0, Math.round(reverted * percent) / 100);

const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const useCommissionsStore = create<State>()((set, get) => ({
  commissions: [],
  rates: DEFAULT_RATES,
  loaded: false,

  setCommissions: (list) => set({ commissions: list, loaded: true }),

  loadAll: async () => {
    const { fetchCommissions, fetchCommissionRates } = await import('@/lib/commissionsDb');
    try {
      const [list, rates] = await Promise.all([fetchCommissions(), fetchCommissionRates()]);
      set({ commissions: list, loaded: true, rates: rates ?? get().rates });
    } catch (e) {
      console.error('Falha ao carregar comissões:', e);
    }
  },

  setRates: (r) => {
    const rates = { ...get().rates, ...r };
    set({ rates });
    import('@/lib/commissionsDb').then(({ saveCommissionRatesDb }) =>
      saveCommissionRatesDb(rates).catch(reportDbError('salvar percentuais de comissão')));
  },

  register: (input) => {
    if (!input.revertedValue || input.revertedValue <= 0) return null;
    // Evita duplicar comissão para o mesmo caso
    const dup = get().commissions.find((c) => c.cancellationCaseId === input.cancellationCaseId && c.status !== 'cancelada');
    if (dup) return dup;
    const rates = get().rates;
    const percent = input.percent ?? rates[input.paymentType] ?? 0;
    const value = computeCommissionValue(input.revertedValue, percent);
    const commission: Commission = {
      id: newId(),
      cancellationCaseId: input.cancellationCaseId,
      studentId: input.studentId,
      studentName: input.studentName,
      acId: input.acId,
      acName: input.acName,
      paymentType: input.paymentType,
      revertedValue: input.revertedValue,
      percent,
      value,
      status: 'pendente',
      createdAt: new Date().toISOString(),
      observacao: input.observacao,
      product: input.product,
      pendingApproval: input.pendingApproval ?? false,
    };
    set({ commissions: [commission, ...get().commissions] });
    import('@/lib/commissionsDb').then(({ insertCommissionDb }) =>
      insertCommissionDb(commission).catch(reportDbError('registrar comissão')));

    // Garante o vínculo com o AC: se veio só o nome, resolve o id pela lista de ACs
    // e corrige o registro (evita comissões "órfãs" que somem ao filtrar por assessor).
    if (!commission.acId && commission.acName) {
      import('@/store/useAppStore').then(({ useAppStore }) => {
        const acId = useAppStore.getState().acs.find((a) => a.name === commission.acName)?.id;
        if (!acId) return;
        set({ commissions: get().commissions.map((c) => c.id === commission.id ? { ...c, acId } : c) });
        import('@/lib/commissionsDb').then(({ setCommissionAcDb }) =>
          setCommissionAcDb(commission.id, acId).catch(reportDbError('vincular assessor à comissão')));
      });
    }
    return commission;
  },


  updatePaymentType: (id, paymentType) => {
    const percent = get().rates[paymentType];
    let patch: Partial<Commission> | null = null;
    set({
      commissions: get().commissions.map((c) => {
        if (c.id !== id) return c;
        const p = percent ?? c.percent;
        patch = { paymentType, percent: p, value: computeCommissionValue(c.revertedValue, p) };
        return { ...c, ...patch };
      }),
    });
    if (patch) persist(id, patch);
  },

  markPaga: (id, paidAt) => {
    const patch: Partial<Commission> = { status: 'paga', paidAt: paidAt ?? new Date().toISOString() };
    set({ commissions: get().commissions.map((c) => c.id === id ? { ...c, ...patch } : c) });
    persist(id, patch);
  },

  markPendente: (id) => {
    set({ commissions: get().commissions.map((c) => c.id === id ? { ...c, status: 'pendente', paidAt: undefined } : c) });
    persist(id, { status: 'pendente', paidAt: undefined });
  },

  cancel: (id) => {
    set({ commissions: get().commissions.map((c) => c.id === id ? { ...c, status: 'cancelada' } : c) });
    persist(id, { status: 'cancelada' });
  },

  remove: (id) => {
    set({ commissions: get().commissions.filter((c) => c.id !== id) });
    import('@/lib/commissionsDb').then(({ deleteCommissionDb }) =>
      deleteCommissionDb(id).catch(reportDbError('excluir comissão')));
  },

  approvePendingByCaseId: (caseId) => {
    const alvos = get().commissions.filter((c) => matchCase(c, caseId) && c.pendingApproval);
    if (!alvos.length) return;
    set({
      commissions: get().commissions.map((c) =>
        matchCase(c, caseId) && c.pendingApproval ? { ...c, pendingApproval: false } : c),
    });
    alvos.forEach((c) => persist(c.id, { pendingApproval: false }));
  },

  removePendingByCaseId: (caseId) => {
    const alvos = get().commissions.filter((c) => matchCase(c, caseId) && c.pendingApproval);
    if (!alvos.length) return;
    set({ commissions: get().commissions.filter((c) => !(matchCase(c, caseId) && c.pendingApproval)) });
    import('@/lib/commissionsDb').then(({ deleteCommissionDb }) => {
      alvos.forEach((c) => deleteCommissionDb(c.id).catch(reportDbError('excluir comissão')));
    });
  },

  rejectByCaseId: (caseId, motivo) => {
    const alvos = get().commissions.filter((c) => matchCase(c, caseId) && c.status !== 'cancelada');
    if (!alvos.length) return;
    const observacao = `${REJECTED_PREFIX}${motivo}`;
    set({
      commissions: get().commissions.map((c) =>
        matchCase(c, caseId) && c.status !== 'cancelada'
          ? { ...c, status: 'cancelada' as CommissionStatus, pendingApproval: false, observacao }
          : c),
    });
    alvos.forEach((c) => persist(c.id, { status: 'cancelada', pendingApproval: false, observacao }));
  },
}));

export const REJECTED_PREFIX = 'Conciliação reprovada: ';

export function isCommissionRejected(c: Commission): boolean {
  return c.status === 'cancelada' && !!c.observacao?.startsWith(REJECTED_PREFIX);
}

export function commissionRejectionReason(c: Commission): string {
  return c.observacao?.slice(REJECTED_PREFIX.length) ?? '';
}


function matchCase(c: Commission, caseId: string): boolean {
  return c.cancellationCaseId === caseId || c.cancellationCaseId.startsWith(`${caseId}#`);
}

function persist(id: string, patch: Partial<Commission>): void {
  import('@/lib/commissionsDb').then(({ updateCommissionDb }) =>
    updateCommissionDb(id, patch).catch(reportDbError('atualizar comissão')));
}

// Helper: mapeia o campo `pagamentoTipo` do CancellationCase para o tipo interno.
export function mapPagamentoTipoToPaymentType(t?: string | null): CommissionPaymentType {
  const s = (t ?? '').toLowerCase();
  if (s.includes('pix')) return 'pix';
  if (s.includes('cart')) return 'cartao';
  return 'boleto';
}
