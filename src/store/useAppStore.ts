import { create } from 'zustand';
import { reportDbError } from '@/lib/dbError';
import { persist } from 'zustand/middleware';
import { Student, AC, Product, FinancialRules, TabKey, StudentStatus, Installment, HistoryEntry, CancellationCase, CancellationStage, CancellationOperationalStatus, RendaExtraStatus, AppUser, StatusCancelamento, StudentTag, AbatimentoInfo } from '@/types';
import { getTodayBrasilia, effectiveDueDate } from '@/lib/brasiliaDate';
import { getInstallmentOutstanding } from '@/lib/utils';
import { resolveStudentFinance, getLatestCancellationCaseForStudent } from '@/lib/studentFinance';
import {
  createAC, updateACDb, deleteACDb,
  createProduct, updateProductDb, deleteProductDb,
  createStudentTag, updateStudentTagDb, deleteStudentTagDb,
  updateRulesDb,
  createStudentDb, createStudentsBulkDb, updateStudentDb, markStudentNegativadoDb, deleteStudentDb,
  createCancellationCaseDb, updateCancellationCaseDb, deleteCancellationCaseDb,
  createAppUserDb, updateAppUserDb, deleteAppUserDb,
} from '@/lib/supabaseMutations';
import { logActivity, formatBRL } from '@/lib/activityLog';
import { resolveOriginalCancellationAc } from '@/lib/cancellationOriginalAc';
import type { KaminoDashboardForecastTotals } from '@/lib/kaminoDashboardTotals';


interface AppState {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;

  selectedACId: string | null;
  setSelectedACId: (id: string | null) => void;

  students: Student[];
  /** Totais autoritativos da Kamino (staging), carregados no sync. */
  kaminoPortfolioTotals: KaminoDashboardForecastTotals | null;
  setKaminoPortfolioTotals: (totals: KaminoDashboardForecastTotals | null) => void;
  addStudent: (student: Student) => void;
  addStudentsBulk: (students: Student[]) => Promise<{ inserted: number; failed: number }>;
  /** Atualiza otimista + grava no banco. A promise resolve quando a gravação confirmar (rejeita se falhar). */
  updateStudent: (id: string, data: Partial<Student>) => Promise<void>;
  markStudentNegativado: (id: string) => Promise<void>;
  deleteStudent: (id: string) => void;

  acs: AC[];
  addAC: (ac: AC) => void;
  updateAC: (id: string, data: Partial<AC>) => void;
  deleteAC: (id: string) => void;

  products: Product[];
  addProduct: (product: Product) => void;
  updateProduct: (id: string, data: Partial<Product>) => void;
  deleteProduct: (id: string) => void;

  rules: FinancialRules;
  setRules: (rules: Partial<FinancialRules>) => void;

  dashboardSubTab: 'gestao' | 'treinamento';
  setDashboardSubTab: (t: 'gestao' | 'treinamento') => void;

  cancellationCases: CancellationCase[];
  addCancellationCase: (c: CancellationCase) => void;
  updateCancellationCase: (id: string, data: Partial<CancellationCase>) => void;
  moveCancellationCase: (id: string, newStage: CancellationStage, note?: string) => void;
  updateCancellationOperationalStatus: (id: string, status: CancellationOperationalStatus) => void;
  deleteCancellationCase: (id: string) => void;

  // Auth
  appUsers: AppUser[];
  currentUser: AppUser | null;
  setCurrentUser: (user: AppUser | null) => void;
  addUser: (user: Omit<AppUser, 'id'>) => Promise<AppUser>;
  updateUser: (id: string, data: Partial<AppUser>) => void;
  deleteUser: (id: string) => void;

  // Cancel student → espelho
  cancelStudentToFlow: (
    studentId: string,
    motivo?: string,
    extras?: Partial<CancellationCase>,
    options?: { forceNew?: boolean },
  ) => void;
  revertCancellation: (caseId: string) => void;
  finalizeCancellation: (caseId: string, reviewedInstallments?: Installment[], fineValue?: number, fineDueDate?: string, fineAlreadyPaid?: boolean, skipConciliation?: boolean, abatimento?: AbatimentoInfo) => void;
  concluirConciliacaoCancelamento: (caseId: string) => void; // baixa real após conciliação
  /** Aluno pagou a multa de cancelamento negativada: ajusta a parcela de multa
   *  para o valor efetivamente pago, marca como paga e finaliza o cancelamento. */
  registrarPagamentoMultaCancelamento: (
    caseId: string,
    payload: { valorPago: number; dataPagamento: string },
  ) => void;
  markInstallmentAsAntecipada: (studentId: string, installmentNumber: number) => void;
  markInstallmentAsPropria: (studentId: string, installmentNumber: number) => void;

  // Renda Extra actions
  migrarParaRendaExtra: (studentId: string) => void;
  assumirRendaExtra: (studentId: string, acName: string) => void;
  liberarRendaExtra: (studentId: string) => void;
  fazerAcordoRendaExtra: (studentId: string, acName: string, valorAcordo: number, paymentDate?: string, paymentMethod?: 'pix' | 'link') => void;
  editarPagamentoRendaExtra: (studentId: string, paymentDate: string, paymentMethod: 'pix' | 'link') => void;
  setRendaExtraStatus: (studentId: string, status: RendaExtraStatus) => void;
  removerDeRendaExtra: (studentId: string) => void;
  verificarMigracoesAutomaticasRendaExtra: () => Promise<number>; // rotina diária 180d

  // Tags customizáveis
  studentTags: StudentTag[];
  addStudentTag: (tag: Omit<StudentTag, 'id'>) => void;
  updateStudentTag: (id: string, data: Partial<StudentTag>) => void;
  deleteStudentTag: (id: string) => void;
  toggleStudentTag: (studentId: string, tagId: string) => void;
  toggleInstallmentTag: (studentId: string, installmentNumber: number, tagId: string) => void;

  // Dev/Test helpers
  resetToSeed: () => void;
  clearAllData: () => void;
}

const generateId = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

function getInstallmentFinancialValue(i: Installment): number {
  if (i.tipoParcela === 'antecipada') return i.valorContabil ?? 0;
  if (!i.paid) return getInstallmentOutstanding(i);
  return i.valorContabil ?? i.value;
}

// ─── Fluxo de Valor Renda Extra ──────────────────────────────────────────────
function getStudentEffectiveValue(student: Student, cancellationCases: CancellationCase[]): number {
  const unpaidBalance = student.installments
    .filter((i) => !i.paid)
    .reduce((sum, i) => sum + getInstallmentFinancialValue(i), 0);

  if (student.isRendaExtra && student.rendaExtraStatus !== 'Acordo Feito') return 0;

  const activeCase = cancellationCases.find(c => c.studentId === student.id && c.isMirror && c.operationalStatus !== 'Cancelado');
  if (activeCase) return unpaidBalance;

  return unpaidBalance;
}

export function calculateBalanceWithRendaExtraFlow(
  students: Student[],
  cancellationCases: CancellationCase[]
): { carteiraPropria: number; emRendaExtra: number; emTratamento: number } {
  let carteiraPropria = 0;
  let emRendaExtra = 0;
  let emTratamento = 0;

  students.forEach(student => {
    // Saldo a receber considerando apenas parcelas não pagas.
    // Para alunos cancelados (statusCancelamento === 'cancelado'), só permanece
    // o que ainda é devido — a multa de cancelamento pendente.
    const isCancelled = student.statusCancelamento === 'cancelado';
    const unpaidBalance = student.installments
      .filter((i) => !i.paid)
      .filter((i) => !isCancelled || (i.tags ?? []).includes('multa-cancelamento'))
      .reduce((sum, i) => sum + getInstallmentFinancialValue(i), 0);

    if (student.isRendaExtra && student.rendaExtraStatus !== 'Acordo Feito') {
      emRendaExtra += unpaidBalance;
    } else {
      const activeCase = cancellationCases.find(c => c.studentId === student.id && c.isMirror && c.operationalStatus !== 'Cancelado');
      if (activeCase) {
        emTratamento += unpaidBalance;
      } else {
        carteiraPropria += unpaidBalance;
      }
    }
  });

  return { carteiraPropria, emRendaExtra, emTratamento };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedACId: null,
  setSelectedACId: (id) => set({ selectedACId: id }),

  // ── Students ─ persistidos no Supabase ──────────────────────────────────
  students: [],
  kaminoPortfolioTotals: null,
  setKaminoPortfolioTotals: (totals) => set({ kaminoPortfolioTotals: totals }),
  addStudent: (student) => {
    const s = {
      ...student,
      data_treinamento_origem: student.data_treinamento_origem ?? student.enrollmentDate,
    };
    createStudentDb(s)
      .then((created) => {
        set((state) => {
          if (state.students.some((st) => st.id === created.id)) return state;
          return { students: [...state.students, created] };
        });
        logActivity({
          action: 'student.create',
          entity: 'student',
          entityId: created.id,
          entityLabel: created.name,
          summary: `Cadastrou o aluno ${created.name} (${created.product}, ${formatBRL(created.saleValue)})`,
        });
      })
      .catch((e) => console.error('Falha ao criar aluno:', e));
  },

  addStudentsBulk: async (studentsToAdd) => {
    if (studentsToAdd.length === 0) return { inserted: 0, failed: 0 };
    const normalized = studentsToAdd.map((s) => ({
      ...s,
      data_treinamento_origem: s.data_treinamento_origem ?? s.enrollmentDate,
    }));
    // Estratégia otimizada: insere em lotes (chunks) para máxima velocidade.
    // Se um lote inteiro falhar, faz fallback row-by-row apenas naquele lote
    // — assim falhas individuais não derrubam o restante e não pagamos N round-trips no caso feliz.
    const CHUNK_SIZE = 100;
    let inserted = 0;
    let failed = 0;
    const created: Student[] = [];
    console.log('[addStudentsBulk] iniciando insert em lotes de', normalized.length, 'aluno(s) — chunk', CHUNK_SIZE);

    for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
      const chunk = normalized.slice(i, i + CHUNK_SIZE);
      try {
        const rows = await createStudentsBulkDb(chunk);
        created.push(...rows);
        inserted += rows.length;
        console.log(`[addStudentsBulk] lote ${i / CHUNK_SIZE + 1}: ${rows.length}/${chunk.length} OK`);
      } catch (bulkErr) {
        console.warn('[addStudentsBulk] lote falhou — caindo para inserção individual:', bulkErr);
        // Fallback: insere um por um SOMENTE neste lote para isolar a linha problemática
        for (const s of chunk) {
          try {
            const row = await createStudentDb(s);
            created.push(row);
            inserted++;
          } catch (e) {
            console.error('Falha ao criar aluno (bulk fallback):', s.name, e);
            failed++;
          }
        }
      }
    }

    if (created.length > 0) {
      set((state) => {
        const existingIds = new Set(state.students.map((st) => st.id));
        const fresh = created.filter((c) => !existingIds.has(c.id));
        return { students: [...state.students, ...fresh] };
      });
    }
    return { inserted, failed };
  },
  updateStudent: (id, data) => {
    const before = get().students.find((st) => st.id === id);
    set((state) => ({
      students: state.students.map((st) =>
        st.id === id
          ? { ...st, ...data, data_treinamento_origem: st.data_treinamento_origem ?? data.data_treinamento_origem ?? st.enrollmentDate }
          : st
      ),
    }));
    const after = before ? { ...before, ...data } : undefined;
    const financialKeys = ['saleValue', 'downPayment', 'totalInstallments', 'paidInstallments', 'installments', 'installmentValue'] as const;
    if (after && financialKeys.some((k) => k in data)) {
      const latestCase = getLatestCancellationCaseForStudent(
        after.id,
        after.name,
        get().cancellationCases,
      );
      const finance = resolveStudentFinance(after, {
        kaminoPaid: latestCase?.totalPagoAteMomento,
      });
      get()
        .cancellationCases.filter((c) => c.studentId === id && c.value !== finance.saleValue)
        .forEach((c) => {
          get().updateCancellationCase(c.id, { value: finance.saleValue });
        });
    }
    const dbPromise = updateStudentDb(id, data).catch((e) => {
      console.error('Falha ao atualizar aluno:', e);
      // Desfaz o otimismo para não mostrar dado que não foi gravado.
      if (before) {
        set((state) => ({
          students: state.students.map((st) => (st.id === id ? before : st)),
        }));
      }
      const msg = e instanceof Error ? e.message : 'Falha ao gravar alteração do aluno.';
      void import('sonner').then(({ toast }) => toast.error(msg));
      throw e;
    });
    if (before) {
      const changedKeys = Object.keys(data).filter((k) => (before as any)[k] !== (data as any)[k]);
      if (changedKeys.length > 0) {
        logActivity({
          action: 'student.update',
          entity: 'student',
          entityId: id,
          entityLabel: before.name,
          summary: `Editou o aluno ${before.name} (${changedKeys.join(', ')})`,
          meta: { changedKeys },
        });
      }
    }
    return dbPromise;
  },
  markStudentNegativado: async (id) => {
    const before = get().students.find((st) => st.id === id);
    if (!before) return;

    const actorName = get().currentUser?.name ?? 'Usuário';
    const now = new Date().toISOString();
    const optimistic: Student = {
      ...before,
      status: 'Negativado',
      statusMode: 'Manual',
      history: [
        ...(before.history ?? []),
        { date: now, type: 'Sistema' as const, text: `${actorName} alterou o status manualmente para "Negativado".` },
      ],
    };

    set((state) => ({
      students: state.students.map((st) => (st.id === id ? optimistic : st)),
    }));

    try {
      const saved = await markStudentNegativadoDb(id, actorName);
      set((state) => ({
        students: state.students.map((st) => (st.id === id ? saved : st)),
      }));
      logActivity({
        action: 'student.update',
        entity: 'student',
        entityId: id,
        entityLabel: before.name,
        summary: `Marcou o aluno ${before.name} como Negativado`,
        meta: { changedKeys: ['status', 'statusMode'] },
      });
    } catch (e) {
      set((state) => ({
        students: state.students.map((st) => (st.id === id ? before : st)),
      }));
      reportDbError('marcar aluno como Negativado')(e);
      throw e;
    }
  },
  deleteStudent: (id) => {
    const before = get().students.find((st) => st.id === id);
    // Cards de cancelamento vinculados: exclui somente se estiverem nas colunas
    // "Entrada" ou "Em Tratativas" (Em Execução). Nas colunas Distrato do
    // Contrato (Formalização), Pendente e Finalizado o card é preservado.
    const deletableStages: string[] = ['Entrada', 'Em Execução'];
    const linkedCases = get().cancellationCases.filter(
      (c) => c.studentId === id && deletableStages.includes(c.funnelStage ?? 'Entrada'),
    );
    if (linkedCases.length) {
      const ids = new Set(linkedCases.map((c) => c.id));
      set((s) => ({ cancellationCases: s.cancellationCases.filter((c) => !ids.has(c.id)) }));
      linkedCases.forEach((c) => {
        deleteCancellationCaseDb(c.id).catch(reportDbError('excluir caso de cancelamento'));
        logActivity({
          action: 'cancellation.delete',
          entity: 'cancellation',
          entityId: c.id,
          entityLabel: c.studentName,
          summary: `Excluiu caso de cancelamento (aluno excluído) — ${c.studentName}`,
        });
      });
    }
    set((state) => ({ students: state.students.filter((st) => st.id !== id) }));
    deleteStudentDb(id).catch((e) => {
      // Rollback otimista: se o banco recusou, devolve o aluno à lista e avisa
      // (antes ele "sumia e voltava" sozinho no próximo sync, sem explicação).
      if (before) set((state) => (state.students.some((st) => st.id === id) ? state : { students: [...state.students, before] }));
      reportDbError('excluir aluno')(e);
    });

    if (before) {
      logActivity({
        action: 'student.delete',
        entity: 'student',
        entityId: id,
        entityLabel: before.name,
        summary: `Excluiu o aluno ${before.name}`,
      });
    }
  },



  // ── ACs ─ persistidos no Supabase
  acs: [],
  addAC: (ac) => {
    createAC({ name: ac.name, active: ac.active, photo: ac.photo }).then((row) => {
      const created: AC = {
        id: row.id,
        name: row.name,
        active: row.active,
        photo: row.photo ?? undefined,
        createdAt: (row as { created_at?: string }).created_at,
      };
      set((s) => ({ acs: [...s.acs, created] }));
      logActivity({ action: 'ac.create', entity: 'ac', entityId: created.id, entityLabel: created.name, summary: `Criou o assessor de conta ${created.name}` });
    }).catch((e) =>
      console.error('Falha ao criar AC:', e)
    );
  },
  updateAC: (id, data) => {
    const prevAC = get().acs.find((a) => a.id === id);
    const oldName = prevAC?.name;
    const newName = data.name;
    set((s) => ({ acs: s.acs.map((a) => (a.id === id ? { ...a, ...data } : a)) }));
    updateACDb(id, data).catch((e) => console.error('Falha ao atualizar AC:', e));

    if (newName && oldName && newName !== oldName) {
      const affected = get().students.filter((s) => s.ac === oldName);
      set((s) => ({
        students: s.students.map((st) => (st.ac === oldName ? { ...st, ac: newName } : st)),
        cancellationCases: s.cancellationCases.map((c) => (c.ac === oldName ? { ...c, ac: newName } : c)),
      }));
      affected.forEach((st) => {
        updateStudentDb(st.id, { ac: newName }).catch((e) => console.error('Falha ao reatribuir aluno:', e));
      });
    }
    if (prevAC) {
      logActivity({ action: 'ac.update', entity: 'ac', entityId: id, entityLabel: newName ?? prevAC.name, summary: `Editou o AC ${prevAC.name}${newName && newName !== prevAC.name ? ` → ${newName}` : ''}` });
    }
  },
  deleteAC: (id) => {
    const prev = get().acs;
    const target = prev.find((a) => a.id === id);
    set({ acs: prev.filter((a) => a.id !== id) });
    deleteACDb(id).catch((e) => {
      console.error('Falha ao excluir AC:', e);
      set({ acs: prev });
    });
    if (target) logActivity({ action: 'ac.delete', entity: 'ac', entityId: id, entityLabel: target.name, summary: `Excluiu o AC ${target.name}` });
  },

  // ── Products ─ persistidos no Supabase
  products: [],
  addProduct: (product) => {
    createProduct({ name: product.name, value: product.value }).then((row: any) => {
      const created: Product = { id: row.id, name: row.name, value: row.value ?? undefined };
      set((s) => ({ products: [...s.products, created] }));
      logActivity({ action: 'product.create', entity: 'product', entityId: created.id, entityLabel: created.name, summary: `Criou o produto ${created.name}` });
    }).catch((e) =>
      console.error('Falha ao criar produto:', e)
    );
  },
  updateProduct: (id, data) => {
    const before = get().products.find((p) => p.id === id);
    set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, ...data } : p)) }));
    updateProductDb(id, data).catch((e) => console.error('Falha ao atualizar produto:', e));
    if (before) logActivity({ action: 'product.update', entity: 'product', entityId: id, entityLabel: data.name ?? before.name, summary: `Editou o produto ${before.name}` });
  },
  deleteProduct: (id) => {
    const prev = get().products;
    const target = prev.find((p) => p.id === id);
    set({ products: prev.filter((p) => p.id !== id) });
    deleteProductDb(id).catch((e) => {
      console.error('Falha ao excluir produto:', e);
      set({ products: prev });
    });
    if (target) logActivity({ action: 'product.delete', entity: 'product', entityId: id, entityLabel: target.name, summary: `Excluiu o produto ${target.name}` });
  },


  // ── Tags customizáveis ─ persistidas no Supabase
  studentTags: [],
  addStudentTag: (tag) => {
    createStudentTag({ name: tag.name, color: tag.color, scope: tag.scope ?? 'student' }).catch((e) =>
      console.error('Falha ao criar tag:', e)
    );
    logActivity({ action: 'tag.create', entity: 'tag', entityLabel: tag.name, summary: `Criou a tag "${tag.name}"` });
  },
  updateStudentTag: (id, data) => {
    const before = get().studentTags.find((t) => t.id === id);
    updateStudentTagDb(id, data).catch((e) => console.error('Falha ao atualizar tag:', e));
    if (before) logActivity({ action: 'tag.update', entity: 'tag', entityId: id, entityLabel: data.name ?? before.name, summary: `Editou a tag "${before.name}"` });
  },

  deleteStudentTag: (id) => {
    const target = get().studentTags.find((t) => t.id === id);
    set((state) => ({
      studentTags: state.studentTags.filter((t) => t.id !== id),
      students: state.students.map((st) =>
        (st.tags || []).includes(id)
          ? { ...st, tags: (st.tags || []).filter((tid) => tid !== id) }
          : st
      ),
    }));
    deleteStudentTagDb(id).catch((e) => console.error('Falha ao excluir tag:', e));
    const students = get().students;
    students.forEach((st) => {
      if ((st.tags || []).includes(id)) {
        const newTags = (st.tags || []).filter((tid) => tid !== id);
        updateStudentDb(st.id, { tags: newTags }).catch(reportDbError("salvar alteração"));
      }
    });
    if (target) logActivity({ action: 'tag.delete', entity: 'tag', entityId: id, entityLabel: target.name, summary: `Excluiu a tag "${target.name}"` });
  },

  toggleStudentTag: (studentId, tagId) => {
    const state = get();
    const student = state.students.find((st) => st.id === studentId);
    if (!student) return;
    const currentTags = student.tags || [];
    const newTags = currentTags.includes(tagId)
      ? currentTags.filter((t) => t !== tagId)
      : [...currentTags, tagId];
    set((s) => ({
      students: s.students.map((st) => st.id === studentId ? { ...st, tags: newTags } : st),
    }));
    updateStudentDb(studentId, { tags: newTags }).catch(reportDbError("salvar alteração"));
  },
  toggleInstallmentTag: (studentId, installmentNumber, tagId) => {
    const state = get();
    const student = state.students.find((st) => st.id === studentId);
    if (!student) return;
    const newInstallments = student.installments.map((inst) => {
      if (inst.number !== installmentNumber) return inst;
      const cur = inst.tags || [];
      const next = cur.includes(tagId) ? cur.filter((t) => t !== tagId) : [...cur, tagId];
      return { ...inst, tags: next.length > 0 ? next : undefined };
    });
    set((s) => ({
      students: s.students.map((st) => st.id === studentId ? { ...st, installments: newInstallments } : st),
    }));
    updateStudentDb(studentId, { installments: newInstallments }).catch(reportDbError("salvar alteração"));
  },

  // ── Regras financeiras ─ persistidas no Supabase
  rules: { multaPercent: 2, jurosPercent: 1, descontoRendaExtra: 30, maxParcelasRenegociacao: 24, maxParcelasCadastro: 24, meta1: 60, meta2: 80, meta3: 95, multaCancelamentoComAntecedencia: 30, multaCancelamentoSemAntecedencia: 40 },
  setRules: (rules) => {
    set((s) => ({ rules: { ...s.rules, ...rules } }));
    updateRulesDb(rules).catch((e) => console.error('Falha ao atualizar regras:', e));
    const keys = Object.keys(rules);
    if (keys.length > 0) logActivity({ action: 'rules.update', entity: 'rules', summary: `Atualizou regras financeiras (${keys.join(', ')})`, meta: rules as any });
  },


  dashboardSubTab: 'gestao',
  setDashboardSubTab: (t) => set({ dashboardSubTab: t }),

  // ── Auth ─ persistidos no Supabase ──────────────────────────────────────
  appUsers: [],
  currentUser: null,
  setCurrentUser: (user) => set((s) => {
    if (!user) return { currentUser: null };
    const updates: Partial<typeof s> = { currentUser: user };
    // Defaults de aba só na PRIMEIRA hidratação do usuário (login).
    // Re-hidratações causadas por TOKEN_REFRESHED (ao voltar para a aba do navegador)
    // NÃO devem resetar a aba/seleção atual — preserva produtividade.
    const isInitialLogin = !s.currentUser || s.currentUser.id !== user.id;
    if (isInitialLogin) {
      if ((user.role === 'ac' || user.role === 'acn2') && user.acId) {
        updates.selectedACId = user.acId;
        updates.activeTab = 'ac';
      }
      if (user.role === 'juridico') {
        updates.activeTab = 'cancelamentos';
      }
      if (user.role === 'admin') {
        updates.activeTab = 'dashboard';
      }
    }
    return updates;
  }),
  addUser: async (user) => {
    const created = await createAppUserDb(user);
    set((s) => ({
      appUsers: s.appUsers.some((u) => u.id === created.id)
        ? s.appUsers.map((u) => (u.id === created.id ? created : u))
        : [...s.appUsers, created],
    }));
    logActivity({ action: 'user.create', entity: 'user', entityId: created.id, entityLabel: created.name, summary: `Criou o usuário ${created.name} (${created.login})` });
    return created;
  },
  updateUser: (id, data) => {
    const before = get().appUsers.find((u) => u.id === id);
    set((s) => ({ appUsers: s.appUsers.map((u) => u.id === id ? { ...u, ...data } : u) }));
    updateAppUserDb(id, data).catch((e) => console.error('Falha ao atualizar usuário:', e));
    if (before) {
      const changedKeys = Object.keys(data).filter((k) => k !== 'password');
      logActivity({ action: 'user.update', entity: 'user', entityId: id, entityLabel: before.name, summary: `Editou o usuário ${before.name}${data.password ? ' (senha alterada)' : ''}`, meta: { changedKeys } });
    }
  },
  deleteUser: (id) => {
    const target = get().appUsers.find((u) => u.id === id);
    set((s) => ({ appUsers: s.appUsers.filter((u) => u.id !== id) }));
    deleteAppUserDb(id).catch((e) => console.error('Falha ao excluir usuário:', e));
    if (target) logActivity({ action: 'user.delete', entity: 'user', entityId: id, entityLabel: target.name, summary: `Excluiu o usuário ${target.name}` });
  },


  // ── Cancel student → espelho ────────────────────────────────────────────
  cancelStudentToFlow: (studentId, motivo, extras, options) => {
    const s = get();
    const student = s.students.find((st) => st.id === studentId);
    if (!student) return;
    if (
      !options?.forceNew &&
      student.statusCancelamento &&
      student.statusCancelamento !== 'nenhum' &&
      student.statusCancelamento !== 'revertido'
    ) {
      return;
    }
    const now = new Date().toISOString();
    const remaining = student.installments.filter((i) => !i.paid).reduce((sum, i) => sum + getInstallmentFinancialValue(i), 0);
    const paid = student.installments.filter((i) => i.paid).length;

    // ── Dedupe: se já existir caso(s) prévio(s) do aluno, reabrimos o mais recente
    //    ao invés de criar um novo card (evita duplicação após reverter/cancelar).
    //    forceNew: mantém o Finalizado/Revertido e abre um card novo na Entrada.
    const priorCases = s.cancellationCases
      .filter((c) => c.studentId === studentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const existing = options?.forceNew ? undefined : priorCases[0];
    const staleIds = options?.forceNew ? [] : priorCases.slice(1).map((c) => c.id);

    const historyEntry: HistoryEntry = {
      date: now, type: 'Sistema',
      text: options?.forceNew
        ? 'Novo cancelamento aberto a partir do caso revertido no Finalizado. O histórico anterior permanece.'
        : 'Cancelamento solicitado. Caso aberto em Cancelamentos. Aluno permanece na carteira.',
    };

    if (existing) {
      const wasRevertido = student.statusCancelamento === 'revertido';
      const originalAc = wasRevertido ? resolveOriginalCancellationAc(existing) : '';
      const restoreAc = Boolean(originalAc && student.ac !== originalAc);

      const reopenEntry = {
        date: now, from: existing.stage, to: 'Aguardando Contato' as CancellationStage,
        operationalStatus: 'Sem contato' as CancellationOperationalStatus,
        note: restoreAc
          ? `Cancelamento reaberto via aba Alunos. Assessor restaurado para ${originalAc}.`
          : 'Cancelamento reaberto via aba Alunos.',
      };
      const studentHistory: HistoryEntry[] = [...student.history, historyEntry];
      if (restoreAc) {
        studentHistory.push({
          date: now,
          type: 'Sistema',
          text: `Assessor restaurado para ${originalAc} (carteira original do contrato).`,
        });
      }
      const updatedCase: Partial<CancellationCase> = {
        stage: 'Aguardando Contato',
        operationalStatus: 'Sem contato',
        value: remaining,
        movedToCurrentStageAt: now,
        history: [...existing.history, reopenEntry],
        isMirror: true,
        funnelStage: 'Entrada',
        acao: 'Aguardando Contato',
        motivoCancelamento: (motivo as any) ?? existing.motivoCancelamento,
        descricaoCancelamento: motivo ?? existing.descricaoCancelamento,
        ...(originalAc ? { ac: originalAc } : {}),
        ...(extras ?? {}),
      };
      const updatedStudent = {
        status: 'Solicitação Cancelamento' as StudentStatus,
        statusMode: 'Manual' as const,
        statusCancelamento: 'solicitado' as StatusCancelamento,
        cancellationCaseId: existing.id,
        statusAntesCancelamento: student.status,
        ...(restoreAc ? { ac: originalAc } : {}),
        history: studentHistory,
      };
      set((state) => ({
        students: state.students.map((st) => st.id === studentId ? { ...st, ...updatedStudent } : st),
        cancellationCases: state.cancellationCases
          .filter((c) => !staleIds.includes(c.id))
          .map((c) => c.id === existing.id ? { ...c, ...updatedCase } : c),
      }));
      logActivity({
        action: 'cancellation.open',
        entity: 'cancellation',
        entityId: existing.id,
        entityLabel: student.name,
        summary: `Reabriu cancelamento de ${student.name}${motivo ? ` (motivo: ${motivo})` : ''}`,
      });
      (async () => {
        try {
          await Promise.all(staleIds.map((id) => deleteCancellationCaseDb(id).catch(() => {})));
          await updateCancellationCaseDb(existing.id, updatedCase);
          await updateStudentDb(studentId, updatedStudent);
        } catch (e) {
          reportDbError('reabrir cancelamento')(e);
        }
      })();
      return;
    }

    const caseId = generateId();
    const newCase: CancellationCase = {
      id: caseId,
      studentName: student.name,
      studentId: student.id,
      studentWhatsapp: student.whatsapp,
      ac: student.ac,
      stage: 'Aguardando Contato',
      operationalStatus: 'Sem contato',
      value: remaining,
      createdAt: now,
      movedToCurrentStageAt: now,
      notes: `Produto: ${student.product} | Parcelas pagas: ${paid}/${student.totalInstallments} | AC: ${student.ac} | Matrícula: ${new Date(student.enrollmentDate).toLocaleDateString('pt-BR')}`,
      history: [{
        date: now, from: 'Aguardando Contato', to: 'Aguardando Contato',
        operationalStatus: 'Sem contato',
        note: options?.forceNew
          ? 'Novo cancelamento aberto a partir do card Revertido no Finalizado. Caso anterior permanece no histórico.'
          : 'Cancelamento solicitado via aba Alunos. Aluno permanece na carteira.',
      }],
      isMirror: true,
      funnelStage: 'Entrada',
      acao: 'Aguardando Contato',
      motivoCancelamento: motivo as any,
      descricaoCancelamento: motivo,
      ...(extras ?? {}),
    };
    const updatedStudent = {
      status: 'Solicitação Cancelamento' as StudentStatus,
      statusMode: 'Manual' as const,
      statusCancelamento: 'solicitado' as StatusCancelamento,
      cancellationCaseId: caseId,
      statusAntesCancelamento: student.status,
      history: [...student.history, historyEntry],
    };

    set((state) => ({
      students: state.students.map((st) => st.id === studentId ? { ...st, ...updatedStudent } : st),
      cancellationCases: [...state.cancellationCases, newCase],
    }));
    logActivity({
      action: 'cancellation.open',
      entity: 'cancellation',
      entityId: caseId,
      entityLabel: student.name,
      summary: `Solicitou cancelamento de ${student.name}${motivo ? ` (motivo: ${motivo})` : ''}`,
    });

    (async () => {
      try {
        await createCancellationCaseDb(newCase);
        await updateStudentDb(studentId, updatedStudent);
      } catch (e) {
        reportDbError('salvar solicitação de cancelamento')(e);
      } finally {
        set((state) => ({
          students: state.students.map((st) =>
            st.id === studentId
              ? { ...st, status: 'Solicitação Cancelamento' as StudentStatus, statusMode: 'Manual' as const, statusCancelamento: 'solicitado' as StatusCancelamento, cancellationCaseId: caseId }
              : st
          ),
        }));
      }
    })();
  },

  revertCancellation: (caseId) => {
    const s = get();
    const cancCase = s.cancellationCases.find((c) => c.id === caseId);
    if (!cancCase) return;
    const now = new Date().toISOString();
    const author = s.currentUser;
    const entry = {
      date: now,
      from: cancCase.stage,
      to: 'Recuperado' as CancellationStage,
      operationalStatus: 'Recuperado' as CancellationOperationalStatus,
      note: 'Cancelamento revertido.',
      byName: author?.name,
      byUserId: author?.id,
    };
    const updatedCase = {
      stage: 'Recuperado' as CancellationStage,
      operationalStatus: 'Recuperado' as CancellationOperationalStatus,
      movedToCurrentStageAt: now,
      history: [...cancCase.history, entry],
      acao: 'Revertido' as const,
      funnelStage: 'Finalizado' as const,
    };
    const historyEntry: HistoryEntry = { date: now, type: 'Sistema', text: 'Cancelamento revertido. Aluno permanece na carteira e status financeiro normalizado.' };

    const originalAc = resolveOriginalCancellationAc(cancCase);
    const linkedStudentBefore =
      (cancCase.studentId ? s.students.find((st) => st.id === cancCase.studentId) : undefined)
      ?? s.students.find((st) => st.cancellationCaseId === caseId);
    const restoreAc = Boolean(originalAc && linkedStudentBefore && linkedStudentBefore.ac !== originalAc);
    const acHistoryEntry: HistoryEntry | null = restoreAc
      ? { date: now, type: 'Sistema', text: `Assessor restaurado para ${originalAc} (carteira original do contrato).` }
      : null;
    
    set((state) => ({
      cancellationCases: state.cancellationCases.map((c) => c.id === caseId ? { ...c, ...updatedCase } : c),
      students: state.students.map((st) => {
        if (st.cancellationCaseId !== caseId && st.id !== cancCase.studentId) return st;
        // Revert: volta o status para Automático (auto-calc reprocessa Em Dia/Vencido/etc.)
        const autoStatus = calculateStudentAutoStatus(st);
        return {
          ...st,
          status: autoStatus,
          statusMode: 'Automático' as const,
          statusCancelamento: 'revertido' as StatusCancelamento,
          ...(restoreAc ? { ac: originalAc } : {}),
          history: [...st.history, historyEntry, ...(acHistoryEntry ? [acHistoryEntry] : [])],
        };
      }),
    }));
    updateCancellationCaseDb(caseId, updatedCase).catch(reportDbError("salvar alteração"));
    logActivity({ action: 'cancellation.revert', entity: 'cancellation', entityId: caseId, entityLabel: cancCase.studentName, summary: `Reverteu o cancelamento de ${cancCase.studentName}` });

    // Sempre prioriza o contrato vinculado explicitamente ao caso (studentId).
    const linkedStudent =
      (cancCase.studentId ? s.students.find((st) => st.id === cancCase.studentId) : undefined)
      ?? s.students.find((st) => st.cancellationCaseId === caseId);
    if (linkedStudent) {
      const autoStatus = calculateStudentAutoStatus(linkedStudent);
      updateStudentDb(linkedStudent.id, {
        status: autoStatus,
        statusMode: 'Automático',
        statusCancelamento: 'revertido',
        ...(restoreAc ? { ac: originalAc } : {}),
        history: [...linkedStudent.history, historyEntry, ...(acHistoryEntry ? [acHistoryEntry] : [])],
      }).catch(reportDbError("salvar alteração"));
    }
    // Espelha a reversão para a aba de Conciliação (nova negociação no Kamino)
    import('@/store/useConciliacaoStore').then(({ registrarConciliacao, buildStudentSnapshot }) => {
      registrarConciliacao({
        tipo: 'reversao',
        studentId: cancCase.studentId,
        studentName: cancCase.studentName,
        ac: cancCase.ac,
        resumo: `Cancelamento REVERTIDO — ${cancCase.studentName} (nova negociação a refletir no Kamino)`,
        antes: { stage: cancCase.stage, statusCancelamento: 'em_tratamento' },
        depois: cancCase.externalImport
          ? { stage: 'Recuperado', statusCancelamento: 'revertido', valorCarteira: 0, impactoCarteira: 0, impactoCarteiraNota: 'Aluno não impacta na carteira — pagamento à vista' }
          // Valor na carteira sempre reflete o valor ATUAL do contrato do aluno
          // (o assessor pode ter reduzido o contrato na negociação da reversão).
          // Só cai no valor original do caso quando não há contrato vinculado.
          : { stage: 'Recuperado', statusCancelamento: 'revertido', valorCarteira: linkedStudent?.saleValue ?? cancCase.value ?? 0 },
        relatedCaseId: caseId,
        studentSnapshot: linkedStudent ? buildStudentSnapshot(linkedStudent) : undefined,
        // Reversões sempre precisam ser reconciliadas contra o Kamino — nunca
        // aplicar imediatamente, mesmo quando o autor é do setor Conciliação.
        // Isso garante que o card mostra "aguardando conciliação" após a
        // reversão (inclusive para casos importados sem aluno vinculado).
        executaImediatamente: false,
      });
    }).catch(reportDbError("salvar alteração"));
  },

  finalizeCancellation: (caseId, reviewedInstallments, fineValue, fineDueDate, fineAlreadyPaid, skipConciliation, abatimento) => {
    // Move o caso para a etapa "Conciliação Pendente" (não baixa carteira ainda).
    // A baixa real só acontece após `concluirConciliacaoCancelamento`.
    const s = get();
    const cancCase = s.cancellationCases.find((c) => c.id === caseId);
    if (!cancCase) return;
    // Prioriza o contrato explicitamente vinculado ao caso (`studentId`). Quando
    // o mesmo aluno tem mais de um contrato, buscar apenas por `cancellationCaseId`
    // podia pegar o contrato errado e calcular entrada/parcelas pagas de outro contrato.
    const linkedStudent =
      (cancCase.studentId ? s.students.find((st) => st.id === cancCase.studentId) : undefined)
      ?? s.students.find((st) => st.cancellationCaseId === caseId);
    const sourceInstallments = reviewedInstallments ?? linkedStudent?.installments ?? [];
    const finalFineValue = fineValue ?? 0;
    const now = new Date().toISOString();

    // Impacto na carteira (total e do AC):
    //   - Remove TODAS as parcelas pendentes (aluno não pagará mais).
    //   - Adiciona 1 parcela representando a multa de cancelamento (se > 0),
    //     que entra na carteira como valor a receber até a conciliação.
    // Como a carteira soma `installments` não pagas, isso resulta
    // automaticamente em: -soma(pendentes) + multa.
    const paidOnly = sourceInstallments.filter((i) => i.paid);
    const maxNumber = sourceInstallments.reduce((m, i) => Math.max(m, i.number), 0);
    const finalFineDueDate = fineDueDate || (() => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      return d.toISOString().split('T')[0];
    })();
    const fineInstallment: Installment | null = finalFineValue > 0 ? {
      number: maxNumber + 1,
      dueDate: finalFineDueDate,
      value: finalFineValue,
      paid: !!fineAlreadyPaid,
      paidDate: fineAlreadyPaid ? finalFineDueDate : undefined,
      tags: ['multa-cancelamento'],
    } : null;
    const finalInstallments: Installment[] = fineInstallment
      ? [...paidOnly, fineInstallment]
      : paidOnly;

    const entry = {
      date: now,
      from: cancCase.stage,
      to: 'Assinar Termo' as CancellationStage,
      operationalStatus: 'Aguardando' as CancellationOperationalStatus,
      note: `Cancelamento confirmado. Aguardando conciliação contábil. Multa de cancelamento: ${formatCurrency(finalFineValue)}.`,
      byName: get().currentUser?.name,
      byUserId: get().currentUser?.id,
    };
    const updatedCase = {
      stage: 'Assinar Termo' as CancellationStage,
      operationalStatus: 'Aguardando' as CancellationOperationalStatus,
      movedToCurrentStageAt: now,
      history: [...cancCase.history, entry],
      acao: 'Assinar Termo' as const,
      funnelStage: 'Formalização' as const,
      cancellationFineValue: finalFineValue,
      cancellationReviewedInstallments: finalInstallments,
    };
    const historyEntry: HistoryEntry = { date: now, type: 'Sistema', text: `Cancelamento confirmado. Multa de cancelamento: ${formatCurrency(finalFineValue)}. Aguardando conciliação contábil — carteira só será atualizada após a conciliação.` };

    // IMPORTANTE: NÃO mexemos nas `installments` do aluno aqui. A baixa real
    // (remoção das parcelas pendentes + adição da multa) só acontece quando
    // o setor de conciliação clica em "Conciliar" na aba Conciliação. Assim
    // a carteira do AC e total não sofrem alteração na formalização.
    // Os valores ficam guardados no próprio caso (`cancellationReviewedInstallments`)
    // para serem aplicados em `concluirConciliacaoCancelamento`.
    set((state) => ({
      cancellationCases: state.cancellationCases.map((c) => c.id === caseId ? { ...c, ...updatedCase } : c),
      students: state.students.map((st) => {
        if (st.cancellationCaseId !== caseId) return st;
        return {
          ...st,
          status: 'Solicitação Cancelamento' as StudentStatus,
          statusMode: 'Manual' as const,
          statusCancelamento: 'aguardando_conciliacao' as StatusCancelamento,
          history: [...st.history, historyEntry],
        };
      }),
    }));
    updateCancellationCaseDb(caseId, updatedCase).catch(reportDbError("salvar alteração"));
    if (linkedStudent) {
      updateStudentDb(linkedStudent.id, {
        status: 'Solicitação Cancelamento',
        statusMode: 'Manual',
        statusCancelamento: 'aguardando_conciliacao',
        history: [...linkedStudent.history, historyEntry],
      }).catch(reportDbError("salvar alteração"));
    }
    // Espelha o cancelamento finalizado (já com pagamento final/multas acordadas)
    // para a aba de Conciliação refletir a baixa no Kamino.
    // Resumimos parcelas em strings legíveis (antes = situação atual do aluno;
    // depois = 0 parcelas, apenas a multa de cancelamento permanece).
    const parcelasOrigem = linkedStudent?.installments ?? [];
    const pagasArr = parcelasOrigem.filter((i) => i.paid);
    const pendentesArr = parcelasOrigem.filter((i) => !i.paid);
    const totalPagasValor = pagasArr.reduce((s, i) => s + (i.value ?? 0), 0);
    const totalPendentesValor = pendentesArr.reduce((s, i) => s + (i.value ?? 0), 0);
    const entradaAluno = Number(linkedStudent?.downPayment) || 0;
    const totalInscricoesCase = Math.max(1, cancCase.quantidadeInscricoes ?? 1);
    const inscRevertidasCase = Math.min(Math.max(0, cancCase.inscricoesRevertidas ?? 0), totalInscricoesCase);
    const inscRestantesCase = Math.max(1, totalInscricoesCase - inscRevertidasCase);
    const proporcionalCancel = inscRevertidasCase > 0 && inscRestantesCase < totalInscricoesCase;
    const totalPagoBrutoAluno = linkedStudent
      ? Math.round((entradaAluno + totalPagasValor) * 100) / 100
      : Math.max(0, Number(cancCase.totalPagoAteMomento) || 0);
    const totalPagoAluno = proporcionalCancel
      ? Math.round(totalPagoBrutoAluno * inscRestantesCase / totalInscricoesCase * 100) / 100
      : totalPagoBrutoAluno;
    
    const fine = finalFineValue;
    // Multa complementar paga pelo aluno: quando o total já pago (entrada +
    // parcelas) é MENOR que a multa contratual e o Jurídico marcou como
    // "Multa Quitada" (fineAlreadyPaid=true), o aluno pagou a diferença.
    const multaComplementarPaga = fineAlreadyPaid && fine > 0
      ? Math.max(0, Math.round((fine - totalPagoAluno) * 100) / 100)
      : 0;
    // TOTAL PAGO efetivo = entrada + parcelas pagas + multa complementar paga.
    const totalPagoFinal = Math.round((totalPagoAluno + multaComplementarPaga) * 100) / 100;
    // Estorno ao aluno: quando o total já pago pelo aluno (entrada + parcelas)
    // é maior que a multa contratual, a multa é retida do valor pago e o
    // excedente é devolvido ao aluno. Abatimento em outro contrato reduz o
    // estorno líquido (o que não for abatido segue para PIX / aba Estornos).
    const estornoBruto = Math.max(0, Math.round((totalPagoAluno - fine) * 100) / 100);
    const abatimentoValor = abatimento?.valor ?? 0;
    const estornoAluno = Math.max(0, Math.round((estornoBruto - abatimentoValor) * 100) / 100);
    const hasEstorno = estornoAluno > 0.0049;
    // Detalhamento do estorno (plano de devolução preenchido pelo usuário):
    // ex.: "2 parcelas — 10/08/2026: R$ 1.000,00 • 10/09/2026: R$ 1.000,00".
    const refundPlan = (cancCase as { refundPlan?: { installments?: Array<{ date: string; value: number }> } }).refundPlan;
    const estornoParcelas = Array.isArray(refundPlan?.installments) ? refundPlan!.installments! : [];
    const estornoAlunoDetalhe = estornoParcelas.length
      ? `${estornoParcelas.length} ${estornoParcelas.length === 1 ? 'parcela' : 'parcelas'} — ` +
        estornoParcelas
          .map((p) => {
            const [y, m, d] = String(p.date ?? '').split('-');
            const dataFmt = y && m && d ? `${d}/${m}/${y}` : String(p.date ?? '');
            return `${dataFmt}: ${formatCurrency(Number(p.value) || 0)}`;
          })
          .join(' • ')
      : '';
    // Valor a NEGATIVAR: quando o Jurídico optou por "Negativar Multa"
    // (fineAlreadyPaid=false) e a multa contratual é MAIOR que o total já
    // pago pelo aluno, a diferença vira uma pendência a negativar.
    // Ex.: multa R$ 5.437,50 − pago R$ 5.214,28 = R$ 223,22 a negativar.
    const totalNegativar = !fineAlreadyPaid && fine > 0
      ? Math.max(0, Math.round((fine - totalPagoAluno) * 100) / 100)
      : 0;
    const hasNegativar = totalNegativar > 0.0049;
    // Impacto na carteira = Saldo em aberto do contrato (valor total − total
    // efetivamente pago pelo aluno, incluindo entrada, parcelas pagas e
    // eventual complemento de multa). Ex.: contrato R$12.500 − R$3.750 pagos
    // = saldo R$8.750 → impacto -R$8.750 (equivale ao que deixa de entrar).
    // EXCEÇÃO: importações externas (PIX/Cartão pago à vista) não têm
    // carteira a impactar — o contrato já foi quitado fora do sistema.
    const isExternal = cancCase.externalImport === true;
    const saleValueRef = Number(linkedStudent?.saleValue) || (totalPagoAluno + totalPendentesValor);
    // Quando há estorno ao aluno, o valor pago é devolvido — logo ele volta a
    // compor o impacto na carteira (ex.: 14.237,12 − 2.000,00 + 2.000,00 estorno
    // = -14.237,12).
    const saldoEmAberto = Math.max(
      0,
      Math.round((saleValueRef - totalPagoFinal + (hasEstorno ? estornoAluno : 0)) * 100) / 100,
    );
    // Impacto na carteira = NEGATIVO do saldo em aberto do contrato (valor
    // contratado − total efetivamente pago, já considerando o complemento de
    // multa e eventual estorno devolvido ao aluno).
    const impactoCarteira = isExternal ? 0 : -saldoEmAberto;

    const parcelasResumoAntes =
      `${pagasArr.length} pagas (${formatCurrency(totalPagasValor)}) • ${pendentesArr.length} pendentes (${formatCurrency(totalPendentesValor)})`;
    // Individualiza a composição da multa quitada (entrada + complemento).
    let parcelasResumoDepois: string;
    if (multaComplementarPaga > 0.0049) {
      parcelasResumoDepois =
        `Entrada ${formatCurrency(entradaAluno)} + Multa paga em 1 parcela ${formatCurrency(multaComplementarPaga)} = Multa contratual ${formatCurrency(fine)} (quitada)`;
    } else if (fine > 0 && fineAlreadyPaid) {
      parcelasResumoDepois = `Entrada + parcelas pagas ${formatCurrency(totalPagoAluno)} cobriram a multa contratual ${formatCurrency(fine)} (quitada)`;
    } else if (fine > 0 && hasNegativar) {
      parcelasResumoDepois = `Multa contratual ${formatCurrency(fine)} − Pago ${formatCurrency(totalPagoAluno)} = A negativar ${formatCurrency(totalNegativar)}`;
    } else if (fine > 0) {
      parcelasResumoDepois = `0 pendentes originais • 1 parcela de multa a negativar (${formatCurrency(fine)})`;
    } else {
      parcelasResumoDepois = `0 pendentes originais`;
    }
    if (!skipConciliation) {
      import('@/store/useConciliacaoStore').then(({ registrarConciliacao, buildStudentSnapshot }) => {
        registrarConciliacao({
          tipo: 'cancelamento',
          studentId: cancCase.studentId,
          studentName: cancCase.studentName,
          ac: cancCase.ac,
          resumo: (cancCase.dentro7Dias === true && fine === 0)
            ? `Cancelamento SEM MULTA — 7 dias CDC (Art. 49) — ${cancCase.studentName}. Aguardando conciliação da baixa das parcelas pendentes.`
            : hasEstorno
              ? `Cancelamento aguardando conciliação — ${cancCase.studentName}. Multa ${formatCurrency(fine)} retida do valor pago (${formatCurrency(totalPagoAluno)}) — estorno ao aluno ${formatCurrency(estornoAluno)}.`
              : abatimentoValor > 0.0049
                ? `Cancelamento aguardando conciliação — ${cancCase.studentName}. Saldo a devolver ${formatCurrency(estornoBruto)} abatido em outro contrato (${formatCurrency(abatimentoValor)}).`
                : multaComplementarPaga > 0.0049
                ? `Cancelamento aguardando conciliação — ${cancCase.studentName}. Multa ${formatCurrency(fine)} quitada (entrada ${formatCurrency(entradaAluno)} + complemento ${formatCurrency(multaComplementarPaga)}).`
                : `Cancelamento aguardando conciliação — ${cancCase.studentName} (multa ${formatCurrency(fine)}). A carteira só será atualizada após conciliar.`,
          antes: {
            stage: cancCase.stage,
            statusCancelamento: 'em_tratamento',
            parcelas: parcelasResumoAntes,
            multaCancelamento: 0,
            ...(fine > 0 ? { totalPago: totalPagoAluno } : {}),
            ...(hasEstorno ? { estornoAluno: 0 } : {}),
            // Snapshot do caso ANTES da finalização — usado ao reprovar
            // conciliação para devolver o card à coluna/estado de origem.
            _caseSnapshot: {
              stage: cancCase.stage,
              operationalStatus: cancCase.operationalStatus,
              funnelStage: cancCase.funnelStage ?? null,
              acao: cancCase.acao ?? null,
              cancellationFineValue: cancCase.cancellationFineValue ?? null,
              cancellationReviewedInstallments: cancCase.cancellationReviewedInstallments ?? null,
              movedToCurrentStageAt: cancCase.movedToCurrentStageAt,
            },
          },
          depois: {
            stage: 'Assinar Termo',
            statusCancelamento: 'aguardando_conciliacao',
            parcelas: parcelasResumoDepois,
            multaCancelamento: fine,
            multaPercent: cancCase.multaPercent ?? 0,
            dentro7DiasCDC: cancCase.dentro7Dias === true,
            // "Total pago pelo aluno" no diff = entrada + parcelas pagas (sem o
            // complemento de multa, que é exibido em linha própria).
            // `totalPagoEfetivo` (entrada + parcelas + complemento) alimenta o
            // "Resumo do contrato" no topo do card, sem virar linha de diff.
            ...(fine > 0
              ? {
                  multaDeduzidaDoPago: true,
                  totalPago: totalPagoAluno,
                  totalPagoEfetivo: totalPagoFinal,
                  ...(multaComplementarPaga > 0.0049 ? { multaComplementarPaga } : {}),
                  ...(hasNegativar ? { totalNegativar, totalNegativarBase: totalPagoAluno } : {}),
                }
              : {}),
            // Estorno ao aluno é publicado mesmo sem multa (ex.: 7 dias CDC),
            // sempre com o detalhamento das parcelas de devolução.
            ...(hasEstorno
              ? { estornoAluno, ...(estornoAlunoDetalhe ? { estornoAlunoDetalhe } : {}) }
              : {}),
            ...(abatimento && abatimento.valor > 0.0049
              ? {
                  abatimentoValor: abatimento.valor,
                  abatimentoContratoDestino: abatimento.product
                    ? `${abatimento.studentName} · ${abatimento.product}`
                    : abatimento.studentName,
                  abatimentoSaldoAntes: abatimento.saldoAntes,
                  abatimentoSaldoDepois: abatimento.saldoDepois,
                  abatimentoSaldoOrigem: abatimento.estornoBruto,
                  abatimentoEstornoRestante: abatimento.estornoRestante,
                  abatimentoResumo:
                    `Saldo a devolver ${formatCurrency(abatimento.estornoBruto)} → abatido ${formatCurrency(abatimento.valor)} no contrato de ${abatimento.studentName}` +
                    ` (saldo devedor ${formatCurrency(abatimento.saldoAntes)} → ${formatCurrency(abatimento.saldoDepois)})` +
                    (abatimento.estornoRestante > 0.0049
                      ? ` • Restam ${formatCurrency(abatimento.estornoRestante)} a estornar via PIX.`
                      : ' • Nada a estornar ao aluno.'),
                }
              : {}),
            impactoCarteira,
            ...(isExternal ? { impactoCarteiraNota: 'Aluno não impacta na carteira — pagamento à vista' } : {}),
            motivo: cancCase.motivoCancelamento ?? null,

          },
          relatedCaseId: caseId,
          // Nunca auto-concilia: o card fica "Aguardando Conciliação" e a
          // baixa só ocorre quando aprovado na aba Conciliação.
          executaImediatamente: false,
          studentSnapshot: linkedStudent ? buildStudentSnapshot(linkedStudent) : undefined,
        });
        if (cancCase.studentId) {
          import('@/lib/cancelamentoGcConciliacao')
            .then(({ dismissEspelhoItemsForStudent }) => dismissEspelhoItemsForStudent(cancCase.studentId!))
            .catch((e) => console.error('[cancelamento] falha ao arquivar espelho GC', e));
        }
      }).catch(reportDbError("salvar alteração"));
    }



    // Toda formalização de cancelamento com impacto financeiro (multa negativada,
    // multa quitada, baixa de parcelas pendentes ou renegociação) fica AGUARDANDO
    // aprovação manual na aba Conciliação — a baixa real na carteira do aluno só
    // acontece quando `concluirConciliacaoCancelamento` é chamado a partir de lá.
    // Único auto-conclude: caso não haja NENHUMA mudança financeira
    // (sem multa E sem parcelas pendentes originais). Nesse cenário nada há
    // a reconciliar e o caso pode ir direto para Finalizado.
    // Também auto-conclude quando skipConciliation=true — ocorre no fluxo em
    // que o assessor já enviou uma conciliação de reversão parcial e o Jurídico
    // apenas formaliza o cancelamento da parcela remanescente (não gera nova
    // pendência de conciliação).
    const houvePendentes = (linkedStudent?.installments ?? []).some((i) => !i.paid);
    if (skipConciliation || (finalFineValue <= 0 && !houvePendentes)) {
      setTimeout(() => {
        get().concluirConciliacaoCancelamento(caseId);
      }, 0);
    }
  },

  concluirConciliacaoCancelamento: (caseId) => {
    // Comportamento agora é em duas fases:
    //  Fase A — Conciliação manual (botão "Conciliar" na aba Conciliação):
    //    Se ainda existir uma parcela de multa-cancelamento PENDENTE, apenas
    //    move o aluno para o sub-status 'pagamento_multa_pendente'. O caso
    //    permanece em Formalização aguardando o pagamento da multa via Kamino.
    //  Fase B — Pagamento da multa baixado (via importação Kamino) ou multa = 0:
    //    Aluno vai para status final "Cancelado", caso vai para Finalizado.
    //
    // Esta função detecta automaticamente em qual fase estamos.
    const s = get();
    const cancCase = s.cancellationCases.find((c) => c.id === caseId);
    if (!cancCase) return;
    const linkedStudent =
      (cancCase.studentId ? s.students.find((st) => st.id === cancCase.studentId) : undefined)
      ?? s.students.find((st) => st.cancellationCaseId === caseId);
    const now = new Date().toISOString();

    // As parcelas finais (pagas + multa) ficam guardadas no caso desde a
    // formalização. Aqui é o momento em que efetivamente aplicamos no aluno
    // — baixando as pendentes da carteira e somando a multa.
    const finalInstallments = cancCase.cancellationReviewedInstallments
      ?? linkedStudent?.installments
      ?? [];
    const paidCount = finalInstallments.filter((i) => i.paid).length;
    const finePending = finalInstallments.some(
      (i) => !i.paid && (i.tags ?? []).includes('multa-cancelamento'),
    );

    // ── Fase A: ainda há multa pendente — aplica baixa das parcelas + multa,
    //    mas mantém aluno em Formalização aguardando pagamento via Kamino ──
    if (finePending) {
      const entry = {
        date: now,
        from: cancCase.stage,
        to: cancCase.stage,
        operationalStatus: cancCase.operationalStatus,
        note: 'Conciliação manual concluída. Parcelas pendentes baixadas. Aguardando pagamento da multa de cancelamento via Kamino.',
        byName: get().currentUser?.name,
        byUserId: get().currentUser?.id,
      };
      const updatedCase: Partial<CancellationCase> = {
        history: [...cancCase.history, entry],
        // Permanece em Formalização
      };
      const historyEntry: HistoryEntry = {
        date: now,
        type: 'Sistema',
        text: 'Conciliação concluída. Parcelas pendentes baixadas da carteira; multa de cancelamento adicionada. Aguardando pagamento da multa.',
      };
      set((state) => ({
        cancellationCases: state.cancellationCases.map((c) => c.id === caseId ? { ...c, ...updatedCase } : c),
        students: state.students.map((st) => {
          if (st.cancellationCaseId !== caseId) return st;
          return {
            ...st,
            statusCancelamento: 'pagamento_multa_pendente' as StatusCancelamento,
            installments: finalInstallments,
            paidInstallments: paidCount,
            totalInstallments: finalInstallments.length,
            history: [...st.history, historyEntry],
          };
        }),
      }));
      updateCancellationCaseDb(caseId, updatedCase).catch(reportDbError("salvar alteração"));
      if (linkedStudent) {
        updateStudentDb(linkedStudent.id, {
          statusCancelamento: 'pagamento_multa_pendente',
          installments: finalInstallments,
          paidInstallments: paidCount,
          totalInstallments: finalInstallments.length,
          history: [...linkedStudent.history, historyEntry],
        }).catch(reportDbError("salvar alteração"));
      }
      return;
    }

    // ── Fase B: sem multa pendente — finaliza o cancelamento ──
    const entry = {
      date: now,
      from: cancCase.stage,
      to: 'Cancelado' as CancellationStage,
      operationalStatus: 'Cancelado' as CancellationOperationalStatus,
      note: 'Conciliação concluída. Aluno cancelado e baixado da carteira.',
      byName: get().currentUser?.name,
      byUserId: get().currentUser?.id,
    };
    const updatedCase = { stage: 'Cancelado' as CancellationStage, operationalStatus: 'Cancelado' as CancellationOperationalStatus, funnelStage: 'Finalizado' as const, acao: 'Cancelado' as const, movedToCurrentStageAt: now, history: [...cancCase.history, entry] };
    const historyEntry: HistoryEntry = { date: now, type: 'Sistema', text: 'Conciliação de cancelamento concluída. Status completo: Cancelado.' };

    set((state) => ({
      cancellationCases: state.cancellationCases.map((c) => c.id === caseId ? { ...c, ...updatedCase } : c),
      students: state.students.map((st) => {
        if (st.cancellationCaseId !== caseId) return st;
        // Se ainda não aplicamos as installments finais (caso multa = 0 vindo
        // direto da formalização), aplicamos agora para baixar a carteira.
        const needsApply = st.statusCancelamento === 'aguardando_conciliacao';
        return {
          ...st,
          status: 'Cancelado' as StudentStatus,
          statusMode: 'Manual' as const,
          statusCancelamento: 'cancelado' as StatusCancelamento,
          ...(needsApply ? {
            installments: finalInstallments,
            paidInstallments: paidCount,
            totalInstallments: finalInstallments.length,
          } : {}),
          history: [...st.history, historyEntry],
        };
      }),
    }));
    updateCancellationCaseDb(caseId, updatedCase).catch(reportDbError("salvar alteração"));
    if (linkedStudent) {
      const needsApply = linkedStudent.statusCancelamento === 'aguardando_conciliacao';
      updateStudentDb(linkedStudent.id, {
        status: 'Cancelado' as StudentStatus,
        statusMode: 'Manual',
        statusCancelamento: 'cancelado',
        ...(needsApply ? {
          installments: finalInstallments,
          paidInstallments: paidCount,
          totalInstallments: finalInstallments.length,
        } : {}),
        history: [...linkedStudent.history, historyEntry],
      }).catch(reportDbError("salvar alteração"));
    }
  },

  registrarPagamentoMultaCancelamento: (caseId, { valorPago, dataPagamento }) => {
    const s = get();
    const cancCase = s.cancellationCases.find((c) => c.id === caseId);
    const student =
      (cancCase?.studentId ? s.students.find((st) => st.id === cancCase.studentId) : undefined) ??
      s.students.find((st) => st.cancellationCaseId === caseId);
    if (!student) return;

    const isMulta = (i: Installment) => (i.tags ?? []).includes('multa-cancelamento');
    // Ajusta a parcela de multa em aberto para o valor efetivamente pago.
    let touched = false;
    const newInstallments = (student.installments ?? []).map((i) => {
      if (touched || i.paid || !isMulta(i)) return i;
      touched = true;
      return {
        ...i,
        value: valorPago,
        valorReal: valorPago,
        paid: true,
        paidDate: dataPagamento,
        paidValue: valorPago,
        observacao: 'Multa de cancelamento quitada pelo aluno.',
      };
    });
    if (!touched) {
      // Sem parcela marcada — apenas conclui o cancelamento.
      get().concluirConciliacaoCancelamento(caseId);
      return;
    }
    // Cancelamento conciliado: parcelas em aberto (que não sejam a multa quitada)
    // são baixadas da carteira.
    const finalInstallments = newInstallments
      .filter((i) => i.paid)
      .map((i, idx) => ({ ...i, number: idx + 1 }));
    const paidCount = finalInstallments.filter((i) => i.paid).length;
    const historyEntry: HistoryEntry = {
      date: new Date().toISOString(),
      type: 'Sistema',
      text: `Multa de cancelamento paga (${valorPago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Parcela de multa ajustada para o valor pago e baixada. Demais parcelas em aberto baixadas da carteira. Contrato cancelado.`,
    };
    const patch = {
      installments: finalInstallments,
      paidInstallments: paidCount,
      totalInstallments: finalInstallments.length,

      history: [...(student.history ?? []), historyEntry],
    };
    set((state) => ({
      students: state.students.map((st) => (st.id === student.id ? { ...st, ...patch } : st)),
      cancellationCases: state.cancellationCases.map((c) =>
        c.id === caseId ? { ...c, cancellationReviewedInstallments: newInstallments } : c,
      ),
    }));
    updateStudentDb(student.id, patch).catch(reportDbError('salvar alteração'));
    updateCancellationCaseDb(caseId, { cancellationReviewedInstallments: newInstallments }).catch(
      reportDbError('salvar alteração'),
    );
    // Sem multa pendente → Fase B: aluno "Cancelado" e caso Finalizado.
    setTimeout(() => get().concluirConciliacaoCancelamento(caseId), 0);
  },



  markInstallmentAsAntecipada: (studentId, installmentNumber) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const newInstallments = student.installments.map((i) =>
      i.number === installmentNumber
        ? { ...i, tipoParcela: 'antecipada' as const, valorReal: i.valorReal ?? i.value, valorContabil: 0 }
        : i
    );
    set((s) => ({
      students: s.students.map((st) => st.id === studentId ? { ...st, installments: newInstallments } : st),
    }));
    updateStudentDb(studentId, { installments: newInstallments }).catch(reportDbError("salvar alteração"));
  },

  markInstallmentAsPropria: (studentId, installmentNumber) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const newInstallments = student.installments.map((i) =>
      i.number === installmentNumber
        ? { ...i, tipoParcela: 'propria' as const, valorContabil: i.valorReal ?? i.value }
        : i
    );
    set((s) => ({
      students: s.students.map((st) => st.id === studentId ? { ...st, installments: newInstallments } : st),
    }));
    updateStudentDb(studentId, { installments: newInstallments }).catch(reportDbError("salvar alteração"));
  },

  // ── Cancellation Cases ─ persistidos no Supabase ────────────────────────
  cancellationCases: [],
  addCancellationCase: (c) => {
    const newCase = { ...c, id: c.id || generateId() };
    set((s) => ({ cancellationCases: [...s.cancellationCases, newCase] }));
    createCancellationCaseDb(newCase).catch(reportDbError("salvar alteração"));
    logActivity({ action: 'cancellation.create', entity: 'cancellation', entityId: newCase.id, entityLabel: newCase.studentName, summary: `Criou caso de cancelamento — ${newCase.studentName}` });
  },
  updateCancellationCase: (id, data) => {
    const before = get().cancellationCases.find((c) => c.id === id);
    set((s) => ({
      cancellationCases: s.cancellationCases.map((c) => c.id === id ? { ...c, ...data } : c),
    }));
    updateCancellationCaseDb(id, data).catch(reportDbError("salvar alteração"));
    if (before) {
      const changedKeys = Object.keys(data).filter((k) => (before as any)[k] !== (data as any)[k]);
      if (changedKeys.length > 0) logActivity({ action: 'cancellation.update', entity: 'cancellation', entityId: id, entityLabel: before.studentName, summary: `Editou caso de cancelamento — ${before.studentName} (${changedKeys.join(', ')})` });
    }
  },
  moveCancellationCase: (id, newStage, note) => {
    const cancCase = get().cancellationCases.find((c) => c.id === id);
    if (!cancCase) return;
    const now = new Date().toISOString();
    const entry = {
      date: now,
      from: cancCase.stage,
      to: newStage,
      operationalStatus: cancCase.operationalStatus,
      note,
      byName: get().currentUser?.name,
      byUserId: get().currentUser?.id,
    };
    const updatedData = { stage: newStage, movedToCurrentStageAt: now, history: [...cancCase.history, entry] };
    set((s) => ({
      cancellationCases: s.cancellationCases.map((c) => c.id === id ? { ...c, ...updatedData } : c),
    }));
    updateCancellationCaseDb(id, updatedData).catch(reportDbError("salvar alteração"));
    logActivity({ action: 'cancellation.move', entity: 'cancellation', entityId: id, entityLabel: cancCase.studentName, summary: `Moveu cancelamento de ${cancCase.studentName} de "${cancCase.stage}" para "${newStage}"` });
  },
  updateCancellationOperationalStatus: (id, status) => {
    const cancCase = get().cancellationCases.find((c) => c.id === id);
    if (!cancCase) return;
    const now = new Date().toISOString();
    const entry = {
      date: now,
      from: cancCase.stage,
      to: cancCase.stage,
      operationalStatus: status,
      note: `Status operacional: ${status}`,
      byName: get().currentUser?.name,
      byUserId: get().currentUser?.id,
    };
    const updatedData = { operationalStatus: status, history: [...cancCase.history, entry] };
    set((s) => ({
      cancellationCases: s.cancellationCases.map((c) => c.id === id ? { ...c, ...updatedData } : c),
    }));
    updateCancellationCaseDb(id, updatedData).catch(reportDbError("salvar alteração"));
    logActivity({ action: 'cancellation.status', entity: 'cancellation', entityId: id, entityLabel: cancCase.studentName, summary: `Atualizou status operacional de ${cancCase.studentName} para "${status}"` });
  },
  deleteCancellationCase: (id) => {
    const target = get().cancellationCases.find((c) => c.id === id);
    set((s) => ({ cancellationCases: s.cancellationCases.filter((c) => c.id !== id) }));
    deleteCancellationCaseDb(id).catch(reportDbError("salvar alteração"));
    if (target) {
      logActivity({ action: 'cancellation.delete', entity: 'cancellation', entityId: id, entityLabel: target.studentName, summary: `Excluiu caso de cancelamento — ${target.studentName}` });

      // Se o aluno vinculado estava marcado como "Solicitação de Cancelamento",
      // ao excluir o caso (lixeira) restaura o status anterior que ele tinha antes
      // da solicitação. Se por algum motivo não houver status anterior salvo,
      // recalcula automaticamente a partir das parcelas atuais.
      // Vínculo: preferimos o studentId do caso; se não houver, usamos o
      // ponteiro cancellationCaseId do aluno; por último, nome único.
      const students = get().students;
      const norm = (s: string) => (s ?? '').trim().toLowerCase();
      let linked = target.studentId ? students.find((st) => st.id === target.studentId) : null;
      if (!linked) linked = students.find((st) => st.cancellationCaseId === id) ?? null;
      if (!linked) {
        const matches = students.filter((st) => norm(st.name) === norm(target.studentName));
        if (matches.length === 1) linked = matches[0];
      }
      // Restaura sempre que o aluno ainda não foi efetivamente cancelado
      // (solicitado / status "Solicitação Cancelamento" / ponteiro para o caso).
      const deveRestaurar = !!linked && (
        linked.statusCancelamento === 'solicitado' ||
        linked.status === 'Solicitação Cancelamento' ||
        (linked.cancellationCaseId === id && linked.statusCancelamento !== 'cancelado')
      );
      if (linked && deveRestaurar) {
        const alvo = linked;
        const now = new Date().toISOString();
        const previousStatus = alvo.statusAntesCancelamento;
        const restoredStatus = previousStatus || calculateStudentAutoStatus(alvo);
        const historyEntry = { date: now, type: 'Sistema' as const, text: `Caso de cancelamento excluído. Status restaurado para "${restoredStatus}".` };
        const updates: Partial<Student> = {
          statusCancelamento: null,
          status: restoredStatus,
          statusMode: previousStatus ? (previousStatus === 'Negativado' ? 'Manual' : 'Automático') : 'Automático',
          cancellationCaseId: undefined,
          statusAntesCancelamento: undefined,
          history: [...(alvo.history ?? []), historyEntry],
        };
        set((s) => ({
          students: s.students.map((st) => st.id === alvo.id ? { ...st, ...updates } : st),
        }));
        updateStudentDb(alvo.id, updates).catch(reportDbError("salvar alteração"));
      }

    }
  },


  // ── Renda Extra ─────────────────────────────────────────────────────────
  migrarParaRendaExtra: (studentId) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student || student.isRendaExtra) return;
    const now = new Date().toISOString();
    // Regra: ao migrar (manual ou auto), o STATUS PRINCIPAL NÃO muda.
    // Aluno permanece em "Negativado" (calculado) com sub-badge "Renda Extra".
    // O status só vira "Renda Extra" depois da conciliação (setRendaExtraStatus).
    const data: Partial<Student> = {
      isRendaExtra: true,
      rendaExtraStatus: 'Conciliar Exclusão' as RendaExtraStatus,
      rendaExtraInclusionDate: now.split('T')[0],
      rendaExtraInscriptionDate: student.rendaExtraInscriptionDate ?? student.enrollmentDate,
      history: [...student.history, { date: now, type: 'Sistema' as const, text: 'Aluno migrado para Renda Extra após 6 meses de inadimplência. Status principal permanece em "Negativado" até conciliação.' }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
    logActivity({ action: 'renda_extra.migrate', entity: 'renda_extra', entityId: studentId, entityLabel: student.name, summary: `Migrou ${student.name} para Renda Extra` });

    // Espelha pendência para a aba de Conciliação (exclusão a refletir no Kamino).
    const saldoPendente = student.installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0);
    import('@/store/useConciliacaoStore').then(({ registrarConciliacao, buildStudentSnapshot }) => {
      registrarConciliacao({
        tipo: 'renda_extra_exclusao',
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: `Migração para RENDA EXTRA — ${student.name} (excluir aluno no Kamino)`,
        antes: { isRendaExtra: false, rendaExtraStatus: null },
        depois: { isRendaExtra: true, rendaExtraStatus: 'Conciliar Exclusão', saldoPendente },
        studentSnapshot: buildStudentSnapshot(student),
      });
    }).catch(reportDbError("salvar alteração"));
  },

  assumirRendaExtra: (studentId, acName) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const now = new Date().toISOString();
    const data: Partial<Student> = {
      rendaExtraAC: acName,
      rendaExtraACAssignedAt: now,
      rendaExtraStatus: 'Em Negociação' as RendaExtraStatus,
      history: [...student.history, { date: now, type: 'Sistema' as const, text: `AC ${acName} assumiu o aluno para negociação Renda Extra. Prazo: 72h.` }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
  },

  liberarRendaExtra: (studentId) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const now = new Date().toISOString();
    const data: Partial<Student> = {
      rendaExtraAC: undefined,
      rendaExtraACAssignedAt: undefined,
      rendaExtraStatus: 'Disponível Negociação' as RendaExtraStatus,
      history: [...student.history, { date: now, type: 'Sistema' as const, text: `AC ${student.rendaExtraAC} não finalizou acordo em 72h. Aluno devolvido para "Disponível Negociação".` }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
  },

  fazerAcordoRendaExtra: (studentId, acName, valorAcordo, paymentDate, paymentMethod) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    // paymentDate em YYYY-MM-DD; se não informado assume hoje.
    const dataPagamento = paymentDate && paymentDate.length >= 10 ? paymentDate.substring(0, 10) : today;
    const metodo: 'pix' | 'link' = paymentMethod ?? 'pix';
    const saldoOriginal = student.installments
      .filter((i) => !i.paid)
      .reduce((acc, i) => acc + i.value, 0);
    const desconto = get().rules.descontoRendaExtra;
    // Mantém vínculo com o AC até a data efetiva do pagamento.
    const acAssignedAt = (() => {
      const payDt = new Date(dataPagamento + 'T00:00:00');
      if (payDt.getTime() > Date.now()) {
        const extended = new Date(payDt.getTime() - 72 * 3600 * 1000).toISOString();
        return extended;
      }
      return student.rendaExtraACAssignedAt;
    })();
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const metodoLabel = metodo === 'pix' ? 'PIX' : 'Link de Pagamento';
    const histText = `Acordo Renda Extra agendado por ${acName}: ${fmtBRL(valorAcordo)} via ${metodoLabel}. Pagamento previsto: ${dataPagamento.split('-').reverse().join('/')}. Aguardando pagamento.`;
    // IMPORTANTE: não baixa parcelas ainda. O aluno permanece "Em Negociação"
    // com sub-indicador "Aguardando Pagamento" até a data efetiva do pgto.
    const data: Partial<Student> = {
      rendaExtraStatus: 'Em Negociação' as RendaExtraStatus,
      rendaExtraAcordoValue: valorAcordo,
      rendaExtraAC: acName,
      rendaExtraACAssignedAt: acAssignedAt,
      rendaExtraPaymentDate: dataPagamento,
      rendaExtraPaymentMethod: metodo,
      history: [...student.history, { date: now, type: 'Sistema' as const, text: histText }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));

    // Espelha para Conciliação contábil — baixa bancária com desconto Renda Extra.
    import('@/store/useConciliacaoStore').then(({ registrarConciliacao, buildStudentSnapshot }) => {
      registrarConciliacao({
        tipo: 'renda_extra_acordo',
        studentId: student.id,
        studentName: student.name,
        ac: student.ac,
        resumo: `Acordo Renda Extra: ${fmtBRL(saldoOriginal)} → ${fmtBRL(valorAcordo)} (${desconto}% desc.) por ${acName}. Pagto: ${dataPagamento.split('-').reverse().join('/')} via ${metodoLabel}. Conciliar baixa bancária.`,
        antes: { saldoPendente: saldoOriginal, rendaExtraStatus: student.rendaExtraStatus ?? null },
        depois: { valorAcordo, descontoPercent: desconto, acAcordo: acName, dataPagamento, formaPagamento: metodo, rendaExtraStatus: 'Em Negociação (Aguardando Pagamento)' },
        studentSnapshot: buildStudentSnapshot(student),
      });
    }).catch(reportDbError("salvar alteração"));
  },

  editarPagamentoRendaExtra: (studentId, paymentDate, paymentMethod) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const now = new Date().toISOString();
    const dataPagamento = paymentDate.substring(0, 10);
    const metodoLabel = paymentMethod === 'pix' ? 'PIX' : 'Link de Pagamento';
    const acAssignedAt = (() => {
      const payDt = new Date(dataPagamento + 'T00:00:00');
      if (payDt.getTime() > Date.now()) {
        return new Date(payDt.getTime() - 72 * 3600 * 1000).toISOString();
      }
      return student.rendaExtraACAssignedAt;
    })();
    const data: Partial<Student> = {
      rendaExtraPaymentDate: dataPagamento,
      rendaExtraPaymentMethod: paymentMethod,
      rendaExtraACAssignedAt: acAssignedAt,
      history: [...student.history, { date: now, type: 'Sistema' as const, text: `Pagamento Renda Extra editado: ${dataPagamento.split('-').reverse().join('/')} via ${metodoLabel}.` }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
  },

  setRendaExtraStatus: (studentId, status) => {
    const student = get().students.find((st) => st.id === studentId);
    if (!student) return;
    const now = new Date().toISOString();
    // Quando o aluno SAI de "Conciliar Exclusão" (=conciliação concluída),
    // o status principal passa a ser "Renda Extra" e o modo vira Manual
    // (sai da carteira financeira/quantitativa em todos os locais).
    const isConciliacaoConcluida =
      student.rendaExtraStatus === 'Conciliar Exclusão' && status !== 'Conciliar Exclusão';
    const data: Partial<Student> = {
      rendaExtraStatus: status,
      ...(isConciliacaoConcluida
        ? { status: 'Renda Extra' as StudentStatus, statusMode: 'Manual' as const }
        : {}),
      history: [...student.history, { date: now, type: 'Sistema' as const, text: `Status Renda Extra alterado para "${status}".` }],
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
  },

  removerDeRendaExtra: (studentId) => {
    const data: Partial<Student> = {
      isRendaExtra: false,
      rendaExtraStatus: undefined,
      rendaExtraAC: undefined,
      rendaExtraACAssignedAt: undefined,
    };
    set((s) => ({ students: s.students.map((st) => st.id === studentId ? { ...st, ...data } : st) }));
    updateStudentDb(studentId, data).catch(reportDbError("salvar alteração"));
  },

  /**
   * Rotina automática: identifica alunos com mais de 180 dias da parcela mais antiga
   * em atraso e migra automaticamente para Renda Extra com status 'Conciliar Exclusão'.
   * Mantém o aluno na carteira até a conciliação manual.
   * Pode ser chamada na inicialização do app (1x ao carregar dados).
   */
  verificarMigracoesAutomaticasRendaExtra: async () => {
    const today = getTodayBrasilia();
    const state = get();
    const candidatos = state.students.filter((st) => {
      if (st.isRendaExtra) return false;
      if (st.statusCancelamento === 'cancelado' || st.statusCancelamento === 'aguardando_conciliacao' || st.statusCancelamento === 'pagamento_multa_pendente') return false;
      if (st.status === 'Excluído' || st.status === 'Pago') return false;
      const overdueUnpaid = st.installments.filter((i) => !i.paid && new Date(i.dueDate) < today);
      if (overdueUnpaid.length === 0) return false;
      const oldest = overdueUnpaid.reduce((o, c) => new Date(c.dueDate) < new Date(o.dueDate) ? c : o);
      const dias = Math.floor((today.getTime() - new Date(oldest.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      return dias > 180;
    });
    let migrados = 0;
    for (const st of candidatos) {
      const now = new Date().toISOString();
      const data: Partial<Student> = {
        isRendaExtra: true,
        rendaExtraStatus: 'Conciliar Exclusão' as RendaExtraStatus,
        rendaExtraInclusionDate: now.split('T')[0],
        rendaExtraInscriptionDate: st.rendaExtraInscriptionDate ?? st.enrollmentDate,
        rendaExtraDirectedAt: now,
        history: [...st.history, { date: now, type: 'Sistema' as const, text: 'Migração automática para Renda Extra (>180 dias de inadimplência). Aluno permanece em Negativado na carteira até conciliação.' }],
      };
      // NÃO altera status principal nem statusMode — continua sendo calculado
      // automaticamente (Negativado/À Negativar) com sub-badge "Renda Extra".
      set((s) => ({ students: s.students.map((x) => x.id === st.id ? { ...x, ...data } : x) }));
      try {
        await updateStudentDb(st.id, data);
        migrados++;
        // Espelha pendência para Conciliação (exclusão Kamino)
        const saldoPendente = st.installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0);
        try {
          const { registrarConciliacao, buildStudentSnapshot } = await import('@/store/useConciliacaoStore');
          registrarConciliacao({
            tipo: 'renda_extra_exclusao',
            studentId: st.id,
            studentName: st.name,
            ac: st.ac,
            resumo: `Migração AUTOMÁTICA para RENDA EXTRA — ${st.name} (>180 dias inadimplente — excluir aluno no Kamino)`,
            antes: { isRendaExtra: false, rendaExtraStatus: null },
            depois: { isRendaExtra: true, rendaExtraStatus: 'Conciliar Exclusão', saldoPendente, motivo: 'auto_180_dias' },
            studentSnapshot: buildStudentSnapshot(st),
          });
        } catch (e) { console.error('Falha ao espelhar conciliação RE:', e); }
      } catch (e) { console.error('Falha migração automática RE:', st.name, e); }
    }
    if (migrados > 0) console.log(`[RE-Auto] ${migrados} aluno(s) migrado(s) automaticamente para Renda Extra.`);
    return migrados;
  },

  // ── Dev/Test helpers ────────────────────────────────────────────────────
  resetToSeed: () => set(() => ({
    students: [],
    cancellationCases: [],
  })),
  clearAllData: () => {
    set(() => ({ students: [], cancellationCases: [] }));
    import('@/integrations/supabase/client').then(async ({ supabase }) => {
      try {
        await supabase.from('cancellation_cases').delete().neq('id', '');
        await supabase.from('students').delete().neq('id', '');
      } catch (err) { console.error(err); }
    });
  },
    }),
    {
      name: 'iam-app-storage',
      // version 12: ALL entities now come from Supabase.
      // Only persist currentUser locally for session continuity.
      version: 12,
      partialize: (state) => ({
        currentUser: state.currentUser,
      }),
    }
  )
);

// Utility functions (unchanged)
export function calculateInstallmentValue(saleValue: number, downPayment: number, totalInstallments: number): number {
  if (totalInstallments <= 0) return 0;
  return (saleValue - downPayment) / totalInstallments;
}

export function generateInstallments(dueDay: number, totalInstallments: number, installmentValue: number, paidInstallments: number, enrollmentDate: string, firstDueDate?: string): Installment[] {
  const installments: Installment[] = [];
  // Ancora no mês de origem (independente do dia) para evitar overflow do
  // setMonth — ex.: 31/05 + 1 mês virava 01/07 e pulava junho. Usa o
  // construtor Date(ano, mês+i+1, dueDay), que corrige automaticamente
  // dueDay > nº de dias do mês para o último dia válido.
  // Se `firstDueDate` for informado, a primeira parcela usa essa data exata e
  // as demais incrementam mês a mês a partir desse mês-base com o `dueDay`.
  let baseYear: number;
  let baseMonth: number;
  let offset: number;
  if (firstDueDate) {
    const first = new Date(firstDueDate + 'T00:00:00');
    baseYear = first.getFullYear();
    baseMonth = first.getMonth();
    offset = 0;
  } else {
    const start = new Date(enrollmentDate + 'T00:00:00');
    baseYear = start.getFullYear();
    baseMonth = start.getMonth();
    offset = 1;
  }
  for (let i = 0; i < totalInstallments; i++) {
    const dueDate = new Date(baseYear, baseMonth + i + offset, dueDay);
    const iso = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
    installments.push({
      number: i + 1,
      dueDate: iso,
      value: installmentValue,
      paid: i < paidInstallments,
      paidDate: i < paidInstallments ? iso : undefined,
    });
  }
  return installments;
}

/**
 * Recompra/Fundo = cobrança direta de parcela antiga reaberta.
 * Não entra no cálculo de "Vencido" (status/KPI): a data antiga interferia
 * e mantinha o aluno vencido mesmo após regularizar o fluxo normal.
 * Quando a recompra é paga, deixa de afetar qualquer indicador.
 */
export function isRecompraOuFundoParcela(
  installment: Installment,
  tagsCatalog?: { id: string; name: string }[],
): boolean {
  const tags = installment.tags ?? [];
  if (tags.length === 0) return false;
  const catalog = tagsCatalog ?? useAppStore.getState().studentTags;
  const byId = new Map(catalog.map((t) => [t.id, t.name]));
  return tags.some((t) => {
    const name = byId.get(t) ?? String(t);
    return /recompra|fundo/i.test(name);
  });
}

/**
 * Ficha de Recompra (Fundo): contrato à parte cujas parcelas — mesmo com tag
 * recompra/fundo — SÃO o fluxo normal dela. A exclusão de parcela recompra do
 * cálculo de Vencido vale só para ficha comum com parcela antiga reaberta.
 */
export function isRecompraFichaProduct(product?: string | null): boolean {
  return /recompra/i.test(product ?? '');
}

/** Status automático da ficha — recompra conta as próprias parcelas como vencidas. */
export function calculateStudentAutoStatus(
  student: Pick<Student, 'installments' | 'product'>,
): StudentStatus {
  return calculateAutoStatus(student.installments ?? [], {
    includeRecompraParcelas: isRecompraFichaProduct(student.product),
  });
}

/** Versão histórica de `calculateStudentAutoStatus`. */
export function calculateStudentAutoStatusAt(
  student: Pick<Student, 'installments' | 'product'>,
  referenceDate: Date,
): StudentStatus {
  return calculateAutoStatusAt(student.installments ?? [], referenceDate, {
    includeRecompraParcelas: isRecompraFichaProduct(student.product),
  });
}

export function calculateAutoStatus(
  installments: Installment[],
  opts?: { includeRecompraParcelas?: boolean },
): StudentStatus {
  const today = getTodayBrasilia();
  const tagsCatalog = useAppStore.getState().studentTags;
  const paid = installments.filter((i) => i.paid);
  const unpaid = installments.filter((i) => !i.paid);
  // Pago: todas pagas (inclui recompra quitada)
  if (unpaid.length === 0 && installments.length > 0 && paid.length === installments.length) return 'Pago';
  // Vencido = só parcelas do fluxo normal (recompra/fundo ficam de fora).
  // `includeRecompraParcelas`: status conjunto contrato original + recompra
  // vinculada — aí a parcela da recompra vencida conta como vencida.
  const overdueInstallments = unpaid.filter(
    (i) =>
      (opts?.includeRecompraParcelas || !isRecompraOuFundoParcela(i, tagsCatalog)) &&
      effectiveDueDate(i.dueDate).getTime() < today.getTime(),
  );
  // Aluno Novo (regra item 4): 0 pagamentos de parcelas E nenhuma vencida ainda.
  // Pessoas que ainda não pagaram nenhuma parcela das que vão vencer.
  // Exceção: alunos com apenas 1 parcela cadastrada NÃO são "Aluno Novo".
  if (paid.length === 0 && overdueInstallments.length === 0 && installments.length > 1) return 'Aluno Novo';
  // Em Dia: já pagou pelo menos uma parcela e não tem nenhuma vencida (fluxo normal).
  if (overdueInstallments.length === 0) return 'Em Dia';
  const oldestOverdue = overdueInstallments.reduce((oldest, curr) =>
    effectiveDueDate(curr.dueDate).getTime() < effectiveDueDate(oldest.dueDate).getTime() ? curr : oldest
  );
  const diffDays = Math.floor((today.getTime() - effectiveDueDate(oldestOverdue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 30) return 'Vencido 1';
  if (diffDays <= 60) return 'Vencido 2';
  return 'À Negativar';
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Versão compacta de moeda BRL para KPIs em telas estreitas.
 * Ex.: 1234567 → "R$ 1,2 mi"; 350000 → "R$ 350 mil"; 980 → "R$ 980".
 * Mantém uma casa decimal para milhões/bilhões; arredonda para "mil".
 */
export function formatCurrencyCompact(value: number): string {
  const v = value || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    const n = (abs / 1_000_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '');
    return `${sign}R$ ${n} bi`;
  }
  if (abs >= 1_000_000) {
    const n = (abs / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '');
    return `${sign}R$ ${n} mi`;
  }
  if (abs >= 10_000) {
    const n = Math.round(abs / 1_000).toLocaleString('pt-BR');
    return `${sign}R$ ${n} mil`;
  }
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
}

export function calculateAutoStatusAt(
  installments: Installment[],
  referenceDate: Date,
  opts?: { includeRecompraParcelas?: boolean },
): StudentStatus {
  const ref = new Date(referenceDate);
  ref.setHours(23, 59, 59, 999);
  const refDayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const tagsCatalog = useAppStore.getState().studentTags;

  // "Pagas até a data de referência": precisa estar paga E a data de pagamento <= ref.
  const paidAtRef = installments.filter((i) => {
    if (!i.paid || !i.paidDate) return false;
    return new Date(i.paidDate + 'T00:00:00') <= ref;
  });
  const unpaidAtRef = installments.filter((i) => !paidAtRef.includes(i));

  // Pago: todas as parcelas já estavam pagas até a data de referência.
  if (unpaidAtRef.length === 0 && installments.length > 0 && paidAtRef.length === installments.length) {
    return 'Pago';
  }

  // Vencido = fluxo normal apenas (recompra/fundo não interferem),
  // salvo quando a própria ficha é de recompra (`includeRecompraParcelas`).
  const overdueAtRef = unpaidAtRef.filter(
    (i) =>
      (opts?.includeRecompraParcelas || !isRecompraOuFundoParcela(i, tagsCatalog)) &&
      effectiveDueDate(i.dueDate).getTime() < refDayStart.getTime()
  );

  // Aluno Novo (mesma regra do modo atual): 0 pagamentos até a ref E nenhuma vencida ainda,
  // exceto quando o aluno tem apenas 1 parcela cadastrada.
  if (paidAtRef.length === 0 && overdueAtRef.length === 0 && installments.length > 1) {
    return 'Aluno Novo';
  }

  if (overdueAtRef.length === 0) return 'Em Dia';

  const oldestOverdue = overdueAtRef.reduce((oldest, curr) =>
    effectiveDueDate(curr.dueDate).getTime() < effectiveDueDate(oldest.dueDate).getTime() ? curr : oldest
  );
  const diffDays = Math.floor(
    (refDayStart.getTime() - effectiveDueDate(oldestOverdue.dueDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays <= 30) return 'Vencido 1';
  if (diffDays <= 60) return 'Vencido 2';
  return 'À Negativar';
}

export function getInstallmentFinancialValueExport(i: Installment): number {
  if (i.tipoParcela === 'antecipada') return i.valorContabil ?? 0;
  if (!i.paid) return getInstallmentOutstanding(i);
  return i.valorContabil ?? i.value;
}

export function calcularScoreComportamento(installments: Installment[]): number {
  const today = getTodayBrasilia();

  // Pontuação por parcela:
  // 5 = pago antes do vencimento
  // 4 = pago no dia do vencimento
  // 3 = pago ainda dentro do mês do vencimento (atraso > 0, mas mesmo mês/ano)
  // 2 = pago no mês seguinte ao vencimento OU atraso entre 30 e 60 dias
  // 1 = mais de 60 dias em atraso (pago tarde ou ainda em aberto)
  const scoreParcela = (i: Installment): number | null => {
    const due = new Date(i.dueDate + 'T00:00:00');
    if (i.paid && i.paidDate) {
      const paid = new Date(i.paidDate + 'T00:00:00');
      const days = Math.round((paid.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (days < 0) return 5;
      if (days === 0) return 4;
      if (days > 60) return 1;
      // Mesmo mês e ano do vencimento => 3
      if (paid.getFullYear() === due.getFullYear() && paid.getMonth() === due.getMonth()) return 3;
      // Mês seguinte (ou atraso 30-60 dias) => 2
      if (days <= 60) return 2;
      return 1;
    }
    // Parcela em aberto: só conta se já venceu
    if (due < today) {
      const daysOverdue = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 60) return 1;
      if (today.getFullYear() === due.getFullYear() && today.getMonth() === due.getMonth()) return 3;
      if (daysOverdue <= 60) return 2;
      return 1;
    }
    return null;
  };

  // Parcelas elegíveis: pagas ou vencidas em aberto
  const elegiveis = installments
    .filter((i) => (i.paid && i.paidDate) || new Date(i.dueDate + 'T00:00:00') < today)
    .sort((a, b) => new Date(a.dueDate + 'T00:00:00').getTime() - new Date(b.dueDate + 'T00:00:00').getTime());

  // Parcelas vencidas em aberto: SEMPRE entram e SOBRESCREVEM o score quando existirem.
  // Não faz sentido fazer média com pagamentos antecipados quando há débito ativo —
  // o pior score das parcelas em atraso é o que define a nota do aluno.
  const vencidasAbertas = elegiveis.filter((i) => !i.paid);
  if (vencidasAbertas.length > 0) {
    const scoresVencidas = vencidasAbertas.map(scoreParcela).filter((s): s is number => s !== null);
    if (scoresVencidas.length > 0) {
      // Usa o PIOR score (menor) das parcelas vencidas em aberto
      return Math.max(1, Math.min(5, Math.min(...scoresVencidas)));
    }
  }

  // Sem parcelas vencidas em aberto: média das 2 pagas mais recentes
  const pagasRecentes = elegiveis.filter((i) => i.paid).slice(-2);
  const scores = pagasRecentes.map(scoreParcela).filter((s): s is number => s !== null);

  if (scores.length === 0) return 0;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.max(1, Math.min(5, Math.round(avg)));
}

export function calcularMediaDiasPagamento(installments: Installment[]): number | null {
  const paid = installments.filter((i) => i.paid && i.paidDate);
  if (paid.length === 0) return null;
  const total = paid.reduce((acc, i) => {
    const due = new Date(i.dueDate + 'T00:00:00');
    const paidD = new Date(i.paidDate! + 'T00:00:00');
    return acc + Math.round((paidD.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  }, 0);
  return Math.round(total / paid.length);
}

export function calculateChurnRisk(student: Student): { score: number; reason: string } {
  const today = getTodayBrasilia();
  let riskScore = 0;
  let reasons: string[] = [];
  const unpaid = student.installments.filter((i) => !i.paid);
  const overdueInstallments = unpaid.filter((i) => new Date(i.dueDate) < today);
  if (overdueInstallments.length > 0) {
    riskScore += 30;
    reasons.push('Parcelas em atraso');
    const oldestOverdue = overdueInstallments.reduce((oldest, curr) =>
      new Date(curr.dueDate) < new Date(oldest.dueDate) ? curr : oldest
    );
    const daysOverdue = Math.floor((today.getTime() - new Date(oldestOverdue.dueDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysOverdue > 30) riskScore += 40;
  } else if (unpaid.length > 0) {
    const nextDue = unpaid.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
    const daysUntilDue = Math.floor((new Date(nextDue.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue <= 15 && daysUntilDue > 0) {
      riskScore += 20;
      reasons.push('Próximo vencimento em 15 dias');
    }
  }
  const behaviorScore = calcularScoreComportamento(student.installments);
  if (behaviorScore === 0) { /* Novo */ }
  else if (behaviorScore <= 2) { riskScore += 30; reasons.push('Histórico de pagamento ruim'); }
  else if (behaviorScore === 3) { riskScore += 10; }
  const mediaAtraso = calcularMediaDiasPagamento(student.installments);
  if (mediaAtraso !== null && mediaAtraso > 15) { riskScore += 15; reasons.push('Pagamentos consistentemente atrasados'); }
  const brasiliaToday = getTodayBrasilia();
  const enrollmentDate = new Date(student.enrollmentDate);
  const monthsEnrolled = (brasiliaToday.getFullYear() - enrollmentDate.getFullYear()) * 12 +
                         (brasiliaToday.getMonth() - enrollmentDate.getMonth());
  if (monthsEnrolled >= 6 && student.installments.some(i => !i.paid)) {
    riskScore += 15; reasons.push('Aluno há meses com parcelas pendentes');
  }
  riskScore = Math.min(100, Math.max(0, riskScore));
  return { score: riskScore, reason: reasons.length > 0 ? reasons.join(' | ') : 'Sem risco detectado' };
}

export function calculateRendaExtraMetrics(students: Student[], cancellationCases: CancellationCase[]) {
  const directedToRendaExtra = students.filter(s => s.isRendaExtra).length;
  const revertedCancellations = cancellationCases.filter(c => c.operationalStatus === 'Recuperado').length;
  return {
    directedToRendaExtra, revertedCancellations,
    totalCancellationCases: cancellationCases.length,
    reversionRate: cancellationCases.length > 0 ? Math.round((revertedCancellations / cancellationCases.length) * 100) : 0
  };
}

export function calculateProcessingSpeed(cancellationCases: CancellationCase[]) {
  // Velocidade de processamento por COLUNA do funil:
  // mede quanto tempo, em média, os cards permanecem em Entrada,
  // Em Tratativas (Em Execução) e Distrato do Contrato (Formalização).
  const TRACKED = ['Entrada', 'Em Execução', 'Formalização'] as const;
  const LABELS: Record<string, string> = {
    'Entrada': 'Entrada',
    'Em Execução': 'Em Tratativas',
    'Formalização': 'Distrato do Contrato',
  };
  const DAY = 1000 * 60 * 60 * 24;

  function legacyStageToFunnel(stage: CancellationStage): string {
    switch (stage) {
      case 'Aguardando Contato': case 'Em Contato': case 'Orientações (Jurídico)':
        return 'Entrada';
      case 'Ajustes em Geral / Boleto': case 'Cancelamento de Boleto':
      case 'Início do Estorno': case 'Estorno em Andamento':
        return 'Em Execução';
      case 'Confeccionar Termo': case 'Assinar Termo':
        return 'Formalização';
      default:
        return 'Finalizado';
    }
  }

  const now = Date.now();
  const acc: Record<string, { ms: number; count: number }> = {};
  TRACKED.forEach((t) => { acc[t] = { ms: 0, count: 0 }; });
  let cycleMs = 0;
  let cycleCount = 0;
  let totalActive = 0;

  cancellationCases.forEach((c) => {
    const currentFunnel = (c.funnelStage as string) ?? legacyStageToFunnel(c.stage);
    if ((TRACKED as readonly string[]).includes(currentFunnel)) totalActive += 1;

    // Reconstrói a linha do tempo do card a partir das notas de movimentação
    const moves = (c.history ?? [])
      .filter((h) => typeof h.note === 'string' && h.note.includes('Movido no funil:'))
      .map((h) => {
        const raw = (h.note as string).split('Movido no funil:')[1] ?? '';
        const [from, to] = raw.split('→').map((x) => x.trim());
        return { t: new Date(h.date).getTime(), from, to };
      })
      .filter((m) => Number.isFinite(m.t) && m.to)
      .sort((a, b) => a.t - b.t);

    const createdAt = new Date(c.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return;

    let stage = moves.length > 0 && moves[0].from ? moves[0].from : currentFunnel;
    let start = createdAt;
    const segments: { stage: string; start: number; end: number }[] = [];
    moves.forEach((m) => {
      segments.push({ stage, start, end: m.t });
      stage = m.to;
      start = m.t;
    });
    segments.push({ stage, start, end: now });

    // A medição de "Entrada" deve começar na DATA DA SOLICITAÇÃO do aluno
    // (createdAt do caso), mesmo que o card só tenha sido colocado na coluna
    // Entrada dias depois. Ex.: solicitou 01/08, entrou na coluna 06/08 e saiu
    // 10/08 → contabiliza de 01/08 até 10/08.
    const firstEntradaIdx = segments.findIndex((s) => s.stage === 'Entrada');
    if (firstEntradaIdx >= 0) {
      segments[firstEntradaIdx] = {
        ...segments[firstEntradaIdx],
        start: Math.min(segments[firstEntradaIdx].start, createdAt),
      };
    }

    segments.forEach((seg) => {
      if (!(TRACKED as readonly string[]).includes(seg.stage)) return;
      const dur = Math.max(0, seg.end - seg.start);
      acc[seg.stage].ms += dur;
      acc[seg.stage].count += 1;
    });

    // Ciclo completo: da solicitação/entrada na coluna "Entrada" até a saída de
    // "Distrato do Contrato" (ou até agora, se ainda estiver no fluxo).
    const trackedSegs = segments.filter((s) => (TRACKED as readonly string[]).includes(s.stage));
    if (trackedSegs.length > 0) {
      const ini = Math.min(trackedSegs[0].start, createdAt);
      const lastFormalizacao = [...segments].reverse().find((s) => s.stage === 'Formalização');
      const fim = lastFormalizacao ? lastFormalizacao.end : trackedSegs[trackedSegs.length - 1].end;
      cycleMs += Math.max(0, fim - ini);
      cycleCount += 1;
    }
  });

  const columnStatus = TRACKED.map((stageKey) => {
    const data = acc[stageKey];
    return {
      stage: stageKey as string,
      label: LABELS[stageKey],
      avgDays: data.count > 0 ? Math.round(data.ms / data.count / DAY) : 0,
      count: data.count,
    };
  });

  const cycleAvgDays = cycleCount > 0 ? Math.round(cycleMs / cycleCount / DAY) : 0;

  return { totalActive, columnStatus, cycleAvgDays, cycleCount };
}
