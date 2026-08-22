// ─── Conciliação — Store Isolado ─────────────────────────────────────────────
import { reportDbError } from '@/lib/dbError';
// Espelha alterações manuais (parcelas, valores, vencimentos, quitação,
// cancelamento, reversão) para que o setor de conciliação contábil reconcilie
// no Kamino. Pendências viram histórico ao serem marcadas como conciliadas.
//
// Também guarda erros de importação de pagamentos (planilha Kamino) que não
// puderam ser baixados automaticamente — para revisão manual na sub-aba Erros.

import { create } from 'zustand';
import type { ConciliacaoItem, ConciliacaoTipo, ConciliacaoImportError } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useNotificationsStore } from '@/store/useNotificationsStore';
import {
  createConciliacaoItemDb,
  aprovarItemDb,
  conciliarItemDb,
  reprovarItemDb,
  deleteConciliacaoItemDb,
  updateConciliacaoImportErrorDb,
  deleteConciliacaoImportErrorDb,
} from '@/lib/supabaseMutations';
import { logActivity } from '@/lib/activityLog';


interface ConciliacaoState {
  items: ConciliacaoItem[];
  setItems: (items: ConciliacaoItem[]) => void;
  // `silent` evita disparar notificação individual — usado quando o
  // chamador vai consolidar múltiplos itens do MESMO aluno em uma única
  // notificação (ver `notifyConciliacaoGrupo` abaixo).
  conciliar: (id: string, nota?: string, opts?: { silent?: boolean }) => void;
  aprovar: (id: string, nota?: string, opts?: { silent?: boolean }) => void;
  reprovar: (id: string, motivo: string, opts?: { silent?: boolean }) => void;
  remove: (id: string) => void;

  // Erros de importação (Kamino → baixa de pagamentos)
  importErrors: ConciliacaoImportError[];
  setImportErrors: (errs: ConciliacaoImportError[]) => void;
  resolverImportError: (id: string, nota?: string) => void;
  ignorarImportError: (id: string, nota?: string) => void;
  removeImportError: (id: string) => void;
}

// Adiciona entrada no histórico do aluno quando o setor de Conciliação
// aprova ou reprova um ajuste enviado.
function appendStudentHistoryConciliacao(
  item: ConciliacaoItem,
  kind: 'aprovada' | 'reprovada',
  porNome?: string,
  notaOuMotivo?: string,
): void {
  if (!item.studentId) return;
  const appState = useAppStore.getState();
  const student = appState.students.find((s) => s.id === item.studentId);
  if (!student) return;
  const label = kind === 'aprovada' ? 'aprovada' : 'reprovada';
  const extra = notaOuMotivo?.trim()
    ? ` | ${kind === 'aprovada' ? 'Nota' : 'Motivo'}: ${notaOuMotivo.trim()}`
    : '';
  const by = porNome ? ` (por ${porNome})` : '';
  const entry = {
    date: new Date().toISOString(),
    type: 'Sistema' as const,
    text: `Conciliação ${label} — ${item.resumo}${extra}${by}`,
  };
  appState.updateStudent(item.studentId, {
    history: [...(student.history ?? []), entry],
  });
}

// Encontra o acId pelo nome (string) usado em ConciliacaoItem.ac
function findAcIdByName(name?: string): string | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  const acs = useAppStore.getState().acs;
  return acs.find((a) => a.name.trim().toLowerCase() === needle)?.id;
}

/** Resolve o AC destinatário da notificação (item → aluno → autor). */
function resolveAcIdForConciliacao(item: ConciliacaoItem): string | undefined {
  const byName = findAcIdByName(item.ac);
  if (byName) return byName;
  if (item.studentId) {
    const st = useAppStore.getState().students.find((s) => s.id === item.studentId);
    const fromStudent = findAcIdByName(st?.ac);
    if (fromStudent) return fromStudent;
  }
  // Autor do ajuste pode estar vinculado a um AC
  if (item.autorId) {
    const users = useAppStore.getState().appUsers ?? [];
    const autor = users.find((u) => u.id === item.autorId);
    if (autor?.acId) return autor.acId;
  }
  return undefined;
}

function resolveAutorUserId(item: ConciliacaoItem): string | undefined {
  if (!item.autorId) return undefined;
  // app_users.id pode ser diferente de auth uid — a coluna notifications.user_id
  // espera auth.users id. Preferimos o auth_user_id se existir no store.
  const users = useAppStore.getState().appUsers ?? [];
  const autor = users.find((u) => u.id === item.autorId);
  return (autor as { authUserId?: string } | undefined)?.authUserId ?? undefined;
}

export const useConciliacaoStore = create<ConciliacaoState>()((set, get) => ({
  items: [],
  setItems: (items) => set({ items }),
  conciliar: (id, nota, opts) => {
    const u = useAppStore.getState().currentUser;
    const now = new Date().toISOString();
    const item = get().items.find((i) => i.id === id);
    // ─── RASCUNHO → EFETIVAÇÃO ─────────────────────────────────────────────
    // Double-check: rascunhos com `_after` já foram aplicados no envio
    // (`_appliedUpfront`). Reaplicar aqui sobrescreve o aluno e desfaz
    // pagamentos/ajustes posteriores. Só efetivar se ainda não aplicado.
    if (item) {
      import('@/lib/conciliacaoApply')
        .then(({ applyConciliacaoEfetivacao, isDraftAlreadyApplied }) => {
          if (isDraftAlreadyApplied(item)) return;
          applyConciliacaoEfetivacao(item);
        })
        .catch((e) => console.error('Falha ao efetivar rascunho:', e));
    }
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'conciliado',
              conciliadoAt: now,
              conciliadoPorId: u?.id,
              conciliadoPorNome: u?.name,
              conciliadoNota: nota,
            }
          : i,
      ),
    }));
    conciliarItemDb(id, {
      conciliadoPorId: u?.id,
      conciliadoPorNome: u?.name,
      conciliadoNota: nota,
    }).catch(reportDbError("salvar alteração"));
    if (item) {
      appendStudentHistoryConciliacao(item, 'aprovada', u?.name, nota);
      logActivity({ action: 'conciliacao.conciliar', entity: 'conciliacao', entityId: id, entityLabel: item.studentName, summary: `Conciliou ajuste de ${item.studentName} — ${item.resumo}` });
    }

    // Notifica o AC autor (se houver) — Item 2
    // Em conciliações em lote (mesmo aluno) o chamador passa silent=true
    // e dispara UMA notificação consolidada via notifyConciliacaoGrupo.
    if (item && !opts?.silent) {
      const acId = resolveAcIdForConciliacao(item);
      const userId = resolveAutorUserId(item);
      if (acId || userId) {
        useNotificationsStore.getState().notify({
          acId,
          userId,
          type: 'conciliacao_aprovada',
          title: 'Conciliação aprovada ✓',
          body: `${item.studentName} — ${item.resumo}`,
          meta: { studentId: item.studentId, conciliacaoItemId: item.id, tipo: item.tipo },
        });
      }
    }
  },
  aprovar: (id, nota, opts) => {
    const u = useAppStore.getState().currentUser;
    const now = new Date().toISOString();
    const item = get().items.find((i) => i.id === id);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'aprovado',
              aprovadoAt: now,
              aprovadoPorId: u?.id,
              aprovadoPorNome: u?.name,
              aprovadoNota: nota,
            }
          : i,
      ),
    }));
    aprovarItemDb(id, {
      aprovadoPorId: u?.id,
      aprovadoPorNome: u?.name,
      aprovadoNota: nota,
    }).catch(reportDbError("salvar alteração"));
    if (item) logActivity({ action: 'conciliacao.aprovar', entity: 'conciliacao', entityId: id, entityLabel: item.studentName, summary: `Aprovou ajuste de ${item.studentName} — ${item.resumo}` });

    // Histórico no aluno (entrada de "pré-aprovação")
    if (item?.studentId) {
      const appState = useAppStore.getState();
      const student = appState.students.find((s) => s.id === item.studentId);
      if (student) {
        const extra = nota?.trim() ? ` | Nota: ${nota.trim()}` : '';
        const by = u?.name ? ` (por ${u.name})` : '';
        appState.updateStudent(item.studentId, {
          history: [
            ...(student.history ?? []),
            {
              date: new Date().toISOString(),
              type: 'Sistema' as const,
              text: `Conciliação aprovada (aguardando execução) — ${item.resumo}${extra}${by}`,
            },
          ],
        });
      }
    }
    // Notifica o AC autor — sinaliza que o ajuste foi aprovado mas ainda
    // não foi efetivado no Kamino.
    if (item && !opts?.silent) {
      const acId = resolveAcIdForConciliacao(item);
      const userId = resolveAutorUserId(item);
      if (acId || userId) {
        useNotificationsStore.getState().notify({
          acId,
          userId,
          type: 'conciliacao_pre_aprovada',
          title: 'Ajuste aprovado ✓ (aguardando conciliação)',
          body: `${item.studentName} — ${item.resumo}`,
          meta: { studentId: item.studentId, conciliacaoItemId: item.id, tipo: item.tipo },
        });
      }
    }
  },
  reprovar: (id, motivo, opts) => {
    const u = useAppStore.getState().currentUser;
    const now = new Date().toISOString();
    const item = get().items.find((i) => i.id === id);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'reprovado',
              reprovadoAt: now,
              reprovadoPorId: u?.id,
              reprovadoPorNome: u?.name,
              reprovadoMotivo: motivo,
            }
          : i,
      ),
    }));
    reprovarItemDb(id, {
      reprovadoPorId: u?.id,
      reprovadoPorNome: u?.name,
      reprovadoMotivo: motivo,
    }).catch(reportDbError("salvar alteração"));
    if (item) {
      appendStudentHistoryConciliacao(item, 'reprovada', u?.name, motivo);
      logActivity({ action: 'conciliacao.reprovar', entity: 'conciliacao', entityId: id, entityLabel: item.studentName, summary: `Reprovou ajuste de ${item.studentName}: ${motivo}` });
    }

    // Notifica o AC autor (Item 3) — clique abre Gestão Financeira do aluno
    if (item && !opts?.silent) {
      const acId = resolveAcIdForConciliacao(item);
      const userId = resolveAutorUserId(item);
      if (acId || userId) {
        useNotificationsStore.getState().notify({
          acId,
          userId,
          type: 'conciliacao_reprovada',
          title: 'Conciliação recusada ✗ — resolver',
          body: `${item.studentName}: ${motivo}`,
          meta: { studentId: item.studentId, conciliacaoItemId: item.id, tipo: item.tipo, motivo },
        });
      } else {
        console.warn('[conciliacao.reprovar] Sem AC/autor para notificar', item.id, item.ac, item.studentName);
      }
    }
  },
  remove: (id) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    deleteConciliacaoItemDb(id).catch(reportDbError("salvar alteração"));
  },

  importErrors: [],
  setImportErrors: (errs) => set({ importErrors: errs }),
  resolverImportError: (id, nota) => {
    const u = useAppStore.getState().currentUser;
    const now = new Date().toISOString();
    set((s) => ({
      importErrors: s.importErrors.map((e) =>
        e.id === id
          ? { ...e, status: 'resolvido', resolvidoAt: now, resolvidoPorId: u?.id, resolvidoPorNome: u?.name, resolvidoNota: nota }
          : e,
      ),
    }));
    updateConciliacaoImportErrorDb(id, {
      status: 'resolvido',
      resolvidoAt: now,
      resolvidoPorId: u?.id,
      resolvidoPorNome: u?.name,
      resolvidoNota: nota,
    }).catch(reportDbError("salvar alteração"));
  },
  ignorarImportError: (id, nota) => {
    const u = useAppStore.getState().currentUser;
    const now = new Date().toISOString();
    set((s) => ({
      importErrors: s.importErrors.map((e) =>
        e.id === id
          ? { ...e, status: 'ignorado', resolvidoAt: now, resolvidoPorId: u?.id, resolvidoPorNome: u?.name, resolvidoNota: nota }
          : e,
      ),
    }));
    updateConciliacaoImportErrorDb(id, {
      status: 'ignorado',
      resolvidoAt: now,
      resolvidoPorId: u?.id,
      resolvidoPorNome: u?.name,
      resolvidoNota: nota,
    }).catch(reportDbError("salvar alteração"));
  },
  removeImportError: (id) => {
    set((s) => ({ importErrors: s.importErrors.filter((e) => e.id !== id) }));
    deleteConciliacaoImportErrorDb(id).catch(reportDbError("salvar alteração"));
  },
}));

// ─── Helper: snapshot do aluno p/ revert ─────────────────────────────────────
// Captura os campos financeiros/operacionais que `revertConciliacaoItem`
// sabe restaurar. Chame ANTES de aplicar `updateStudent`.
export function buildStudentSnapshot(student: {
  installments?: unknown;
  totalInstallments?: unknown;
  paidInstallments?: unknown;
  installmentValue?: unknown;
  saleValue?: unknown;
  downPayment?: unknown;
  statusCancelamento?: unknown;
  cancellationCaseId?: unknown;
  isRendaExtra?: unknown;
  rendaExtraStatus?: unknown;
  rendaExtraAcordoValue?: unknown;
  product?: unknown;
  productHistory?: unknown;
}): Record<string, unknown> {
  return {
    installments: JSON.parse(JSON.stringify(student.installments ?? [])),
    totalInstallments: student.totalInstallments,
    paidInstallments: student.paidInstallments,
    installmentValue: student.installmentValue,
    saleValue: student.saleValue,
    downPayment: student.downPayment,
    statusCancelamento: student.statusCancelamento,
    cancellationCaseId: student.cancellationCaseId,
    isRendaExtra: student.isRendaExtra,
    rendaExtraStatus: student.rendaExtraStatus,
    rendaExtraAcordoValue: student.rendaExtraAcordoValue,
    product: student.product,
    productHistory: student.productHistory
      ? JSON.parse(JSON.stringify(student.productHistory))
      : undefined,
  };
}

// ─── Helper público ──────────────────────────────────────────────────────────
// Cria uma pendência de conciliação. Chamado a partir dos pontos de
// alteração manual (FinancialModal, fluxo de cancelamento, etc.).
//
// IMPORTANTE: este helper é o único ponto de criação. Se o usuário corrente
// for do role 'conciliacao', a alteração já parte de quem concilia — então
// não geramos pendência (evita ruído do próprio setor).
export function registrarConciliacao(input: {
  tipo: ConciliacaoTipo;
  studentId?: string;
  studentName: string;
  ac?: string;
  resumo: string;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
  relatedCaseId?: string;
  autorObservacao?: string;
  /**
   * Snapshot do aluno ANTES da alteração. Quando presente, permite que
   * `revertConciliacaoItem` restaure 100% do estado em caso de reprovação
   * (parcelas, valores, contrato, status). Deve ser capturado pelo
   * chamador imediatamente ANTES de aplicar `updateStudent`.
   */
  studentSnapshot?: Record<string, unknown>;
  /**
   * RASCUNHO: estado completo proposto do aluno que ainda NÃO foi aplicado.
   * Quando presente, o item é tratado como rascunho: só é efetivado no
   * aluno quando o setor de Conciliação clicar em "Conciliar". Se
   * reprovado, é simplesmente descartado (nada havia sido aplicado).
   */
  draftAfter?: Record<string, unknown>;
  /**
   * Conciliação imediata: aplica as alterações direto no aluno e grava o
   * item já como `conciliado` (auditoria). Usado quando admin / setor de
   * conciliação edita pela aba Alunos — não precisa passar pela aba
   * Conciliação. Não tem efeito para o role 'conciliacao' (cuja regra de
   * "não gerar pendência" já vale por padrão).
   */
  executaImediatamente?: boolean;
}): void {
  const u = useAppStore.getState().currentUser;
  // Role 'conciliacao' é o próprio setor — por padrão a alteração é
  // conciliada imediatamente. Porém, quando o chamador passa
  // `executaImediatamente` explicitamente (ex.: modal com escolha entre
  // "Conciliação Total" e "Enviar para Conciliação"), respeitamos a
  // escolha do usuário.
  // EXCEÇÃO: itens de cancelamento NUNCA são auto-conciliados — o card fica
  // "Aguardando Conciliação" e precisa aparecer na aba Conciliação.
  if (u?.role === 'conciliacao' && input.executaImediatamente === undefined && input.tipo !== 'cancelamento') {
    input = { ...input, executaImediatamente: true };
  }


  // Embute snapshot dentro do antes (chave reservada `_snapshot`)
  if (input.studentSnapshot) {
    input = { ...input, antes: { ...input.antes, _snapshot: input.studentSnapshot } };
  }
  // Embute rascunho dentro do depois (chave reservada `_after`).
  // `_appliedUpfront` marca que o efeito imediato será (e é) aplicado abaixo —
  // o Conciliar só confirma, sem reaplicar o snapshot.
  if (input.draftAfter) {
    input = {
      ...input,
      depois: {
        ...input.depois,
        _after: input.draftAfter,
        _appliedUpfront: true,
      },
    };
  }

  const tempId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `conc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const imediato = !!input.executaImediatamente;
  const nowIso = new Date().toISOString();
  const status: ConciliacaoItem['status'] = imediato ? 'conciliado' : 'pendente';

  const optimistic: ConciliacaoItem = {
    id: tempId,
    tipo: input.tipo,
    studentId: input.studentId,
    studentName: input.studentName,
    ac: input.ac,
    resumo: input.resumo,
    antes: input.antes,
    depois: input.depois,
    autorId: u?.id,
    autorNome: u?.name,
    autorObservacao: input.autorObservacao,
    status,
    relatedCaseId: input.relatedCaseId,
    createdAt: nowIso,
    ...(imediato
      ? {
          conciliadoAt: nowIso,
          conciliadoPorId: u?.id,
          conciliadoPorNome: u?.name,
          conciliadoNota: 'Conciliado automaticamente (alteração feita pela aba Alunos por admin/conciliação).',
        }
      : {}),
  };

  useConciliacaoStore.setState((s) => ({ items: [optimistic, ...s.items] }));

  logActivity({
    action: imediato ? 'conciliacao.imediata' : 'conciliacao.pendente',
    entity: 'conciliacao',
    entityId: tempId,
    entityLabel: input.studentName,
    summary: imediato
      ? `Aplicou alteração conciliada (${input.tipo}) em ${input.studentName} — ${input.resumo}`
      : `Registrou ajuste para conciliação (${input.tipo}) em ${input.studentName} — ${input.resumo}`,
    meta: { tipo: input.tipo, studentId: input.studentId, ac: input.ac },
  });


  // Aplica imediatamente no aluno (se for o caso).
  if (imediato) {
    import('@/lib/conciliacaoImmediate')
      .then(({ applyConciliacaoImmediate }) => applyConciliacaoImmediate(optimistic))
      .catch((e) => console.error('Falha ao aplicar conciliação imediata:', e));
  } else if (input.draftAfter && input.studentId) {
    // ─── RASCUNHO COM EFEITO IMEDIATO ────────────────────────────────────────
    // Regra de negócio: a Conciliação é um DOUBLE-CHECK. O ajuste feito pelo
    // assessor já vale em todo o sistema (ficha, carteira, cancelamentos)
    // desde o envio. O `_after` permanece gravado apenas como registro do que
    // foi proposto/efetivado.
    import('@/lib/conciliacaoApply')
      .then(({ applyConciliacaoEfetivacao }) => applyConciliacaoEfetivacao(optimistic, { upfront: true }))
      .catch((e) => console.error('Falha ao aplicar rascunho imediatamente:', e));
  }


  // Registra no histórico do aluno para consulta futura
  if (input.studentId) {
    const appState = useAppStore.getState();
    const student = appState.students.find((s) => s.id === input.studentId);
    if (student) {
      const obsTxt = input.autorObservacao?.trim();
      const text = imediato
        ? `Alteração conciliada automaticamente — ${input.resumo}${obsTxt ? ` | Obs: ${obsTxt}` : ''}${u?.name ? ` (por ${u.name})` : ''}`
        : `Enviado para Conciliação — ${input.resumo}${obsTxt ? ` | Obs: ${obsTxt}` : ''}${u?.name ? ` (por ${u.name})` : ''}`;
      const entry = {
        date: new Date().toISOString(),
        type: 'Sistema' as const,
        text,
      };
      appState.updateStudent(input.studentId, {
        history: [...(student.history ?? []), entry],
      });
    }
  }

  createConciliacaoItemDb({
    tipo: input.tipo,
    studentId: input.studentId,
    studentName: input.studentName,
    ac: input.ac,
    resumo: input.resumo,
    antes: input.antes,
    depois: input.depois,
    autorId: u?.id,
    autorNome: u?.name,
    autorObservacao: input.autorObservacao,
    status,
    relatedCaseId: input.relatedCaseId,
    ...(imediato
      ? {
          conciliadoAt: nowIso,
          conciliadoPorId: u?.id,
          conciliadoPorNome: u?.name,
          conciliadoNota: 'Conciliado automaticamente (alteração feita pela aba Alunos por admin/conciliação).',
        }
      : {}),
  })
    .then((created) => {
      useConciliacaoStore.setState((s) => ({
        items: s.items.map((i) => (i.id === tempId ? created : i)),
      }));
    })
    .catch((e) => {
      console.error('Falha ao registrar conciliação:', e);
      useConciliacaoStore.setState((s) => ({
        items: s.items.filter((i) => i.id !== tempId),
      }));
    });
}

// ─── Notificação consolidada (Item 2 — Onda 2) ───────────────────────────────
// Quando o setor de Conciliação aprova/reprova vários ajustes do MESMO aluno
// no mesmo lote, mandamos UMA única notificação para o AC com o resumo de
// todos os ajustes — em vez de N notificações separadas.
export function notifyConciliacaoGrupo(
  items: ConciliacaoItem[],
  kind: 'aprovada' | 'reprovada' | 'pre_aprovada',
  motivo?: string,
): void {
  if (!items.length) return;
  const first = items[0];
  const acId = resolveAcIdForConciliacao(first);
  const userId = resolveAutorUserId(first);
  if (!acId && !userId) {
    console.warn('[notifyConciliacaoGrupo] Sem AC/autor para notificar', first.studentName, first.ac);
    return;
  }
  const studentName = first.studentName;
  const qtd = items.length;
  const resumos = items.map((i) => `• ${i.resumo}`).join('\n');
  let type: 'conciliacao_aprovada' | 'conciliacao_reprovada' | 'conciliacao_pre_aprovada';
  let title: string;
  let body: string;
  if (kind === 'pre_aprovada') {
    type = 'conciliacao_pre_aprovada';
    title = qtd > 1
      ? `${qtd} ajustes aprovados ✓ (aguardando conciliação)`
      : 'Ajuste aprovado ✓ (aguardando conciliação)';
    body = qtd > 1
      ? `${studentName} — ${qtd} alterações aprovadas:\n${resumos}`
      : `${studentName} — ${first.resumo}`;
  } else if (kind === 'aprovada') {
    type = 'conciliacao_aprovada';
    title = qtd > 1 ? `${qtd} ajustes conciliados ✓` : 'Conciliação concluída ✓';
    body = qtd > 1
      ? `${studentName} — ${qtd} alterações conciliadas:\n${resumos}`
      : `${studentName} — ${first.resumo}`;
  } else {
    type = 'conciliacao_reprovada';
    title = qtd > 1
      ? `${qtd} ajustes recusados ✗ — resolver`
      : 'Conciliação recusada ✗ — resolver';
    body = qtd > 1
      ? `${studentName} — ${qtd} alterações recusadas:\n${resumos}${motivo ? `\nMotivo: ${motivo}` : ''}\n\nAbra a gestão financeira do aluno para corrigir.`
      : `${studentName}${motivo ? `: ${motivo}` : ` — ${first.resumo}`}\n\nAbra a gestão financeira do aluno para corrigir.`;
  }
  useNotificationsStore.getState().notify({
    acId,
    userId,
    type,
    title,
    body,
    meta: {
      studentId: first.studentId,
      conciliacaoItemIds: items.map((i) => i.id),
      qtd,
      ...(motivo ? { motivo } : {}),
    },
  });
}
