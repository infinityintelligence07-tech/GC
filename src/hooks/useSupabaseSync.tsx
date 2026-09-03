// Sync Bridge — carrega TODAS as entidades do Supabase e mantém o
// useAppStore + useAntecipacaoStore espelhados. Realtime via canais Postgres.

import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { useAntecipacaoStore } from '@/store/useAntecipacaoStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { useNotificationsStore } from '@/store/useNotificationsStore';
import { useCommissionsStore } from '@/store/useCommissionsStore';
import { useAuth } from '@/hooks/useAuth';
import { useCompanyStore } from '@/store/useCompanyStore';
import type { AC, Product, Student, StudentTag, FinancialRules } from '@/types';
import { rowToStudent, rowToCancellationCase, rowToAppUser, rowToAntecipacaoItem, rowToConciliacaoItem, rowToConciliacaoImportError } from '@/lib/supabaseMutations';
import { isProductExcludedFromGc } from '@/lib/acEsteira';

function isStudentHiddenFromGc(s: Student): boolean {
  if (isProductExcludedFromGc(s.product)) return true;
  // Sync IAM de IPR/Imersão costuma vir sem produto preenchido (só sigla no payload).
  return Boolean(s.iamControlAlunoId) && !String(s.product ?? '').trim();
}

// Pagina resultados acima do limite default do Supabase (1000 linhas).
// Sem isso, tabelas com 1001+ registros (ex.: students) chegavam truncadas
// ao front e o KPI "Carteira Total" aparecia menor que o real.
async function fetchAllPaged<T = any>(
  table: string,
  orderColumn: string,
  ascending = true
): Promise<{ data: T[]; error: any }> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table as any)
      .select('*')
      .order(orderColumn, { ascending })
      .range(from, from + PAGE - 1);
    if (error) return { data: all, error };
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { data: all, error: null };
}

async function fetchAll(activeCompanyId?: string | null) {
  const [acsRes, productsRes, tagsRes, rulesRes, studentsRes, casesRes, usersRes, antRes, concRes, concErrRes, userCompaniesRes, userCompanyAcsRes] = await Promise.all([
    supabase.from('acs').select('*').order('name'),
    supabase.from('products').select('*').order('name'),
    supabase.from('student_tags').select('*').order('name'),
    supabase.from('financial_rules').select('*').limit(1).maybeSingle(),
    fetchAllPaged('students', 'name'),
    fetchAllPaged('cancellation_cases', 'created_at'),
    supabase.from('app_users').select('*').order('name'),
    fetchAllPaged('antecipacao_items', 'created_at'),
    fetchAllPaged('conciliacao_items', 'created_at', false),
    fetchAllPaged('conciliacao_import_errors', 'created_at', false),
    supabase.from('user_companies').select('user_id, company_id'),
    supabase.from('user_company_acs').select('user_id, company_id, ac_id'),
  ]);

  if (acsRes.error) console.error('Erro ACs:', acsRes.error);
  if (productsRes.error) console.error('Erro Products:', productsRes.error);
  if (tagsRes.error) console.error('Erro Tags:', tagsRes.error);
  if (rulesRes.error) console.error('Erro Rules:', rulesRes.error);
  if (studentsRes.error) console.error('Erro Students:', studentsRes.error);
  if (casesRes.error) console.error('Erro CancellationCases:', casesRes.error);
  if (usersRes.error) console.error('Erro AppUsers:', usersRes.error);
  if (antRes.error) console.error('Erro Antecipacao:', antRes.error);
  if (concRes.error) console.error('Erro Conciliacao:', concRes.error);
  if (concErrRes.error) console.error('Erro ConciliacaoImportErrors:', concErrRes.error);
  if (userCompanyAcsRes.error) console.error('Erro UserCompanyACs:', userCompanyAcsRes.error);

  const acs: AC[] = (acsRes.data ?? []).map((r: any) => ({
    id: r.id, name: r.name, active: r.active, photo: r.photo ?? undefined,
    createdAt: r.created_at ?? undefined,
    meta1: r.meta_1 != null ? Number(r.meta_1) : undefined,
    meta2: r.meta_2 != null ? Number(r.meta_2) : undefined,
    meta3: r.meta_3 != null ? Number(r.meta_3) : undefined,
    metaTaxaEmDia: r.meta_taxa_em_dia != null ? Number(r.meta_taxa_em_dia) : undefined,
    metaTaxaEmDiaBase: r.meta_taxa_em_dia_base != null ? Number(r.meta_taxa_em_dia_base) : undefined,
    metaTaxaEmDiaEm: r.meta_taxa_em_dia_em ?? undefined,
  }));

  const products: Product[] = (productsRes.data ?? []).map((r: any) => ({
    id: r.id, name: r.name, value: r.value ?? undefined,
  }));

  const studentTags: StudentTag[] = (tagsRes.data ?? []).map((r: any) => ({
    id: r.id, name: r.name, color: r.color, scope: r.scope ?? 'student',
  }));

  const rules: FinancialRules | null = rulesRes.data
    ? {
        multaPercent: Number(rulesRes.data.multa_percent),
        jurosPercent: Number(rulesRes.data.juros_percent),
        descontoRendaExtra: Number(rulesRes.data.desconto_renda_extra),
        maxParcelasRenegociacao: rulesRes.data.max_parcelas_renegociacao,
        maxParcelasCadastro: rulesRes.data.max_parcelas_cadastro,
        meta1: Number((rulesRes.data as any).meta_1 ?? 60),
        meta2: Number((rulesRes.data as any).meta_2 ?? 80),
        meta3: Number((rulesRes.data as any).meta_3 ?? 95),
        metaReversao1: (rulesRes.data as any).meta_reversao_1 != null ? Number((rulesRes.data as any).meta_reversao_1) : undefined,
        metaReversao2: (rulesRes.data as any).meta_reversao_2 != null ? Number((rulesRes.data as any).meta_reversao_2) : undefined,
        metaReversao3: (rulesRes.data as any).meta_reversao_3 != null ? Number((rulesRes.data as any).meta_reversao_3) : undefined,
        metaTaxaEmDia: (rulesRes.data as any).meta_taxa_em_dia != null ? Number((rulesRes.data as any).meta_taxa_em_dia) : undefined,
        metaTaxaEmDiaBase: (rulesRes.data as any).meta_taxa_em_dia_base != null ? Number((rulesRes.data as any).meta_taxa_em_dia_base) : undefined,
        metaTaxaEmDiaEm: (rulesRes.data as any).meta_taxa_em_dia_em ?? undefined,
        emDiaNovosBase: (rulesRes.data as any).em_dia_novos_base != null ? Number((rulesRes.data as any).em_dia_novos_base) : undefined,
        emDiaNovosBaseMes: (rulesRes.data as any).em_dia_novos_base_mes ?? undefined,
        multaCancelamentoComAntecedencia: Number((rulesRes.data as any).multa_cancelamento_com_antecedencia ?? 30),
        multaCancelamentoSemAntecedencia: Number((rulesRes.data as any).multa_cancelamento_sem_antecedencia ?? 40),
      }
    : null;

  const students = (studentsRes.data ?? []).map(rowToStudent).filter((s) => !isStudentHiddenFromGc(s));
  const cancellationCases = (casesRes.data ?? []).map(rowToCancellationCase);
  const ucRows = (userCompaniesRes.data ?? []) as Array<{ user_id: string; company_id: string }>;
  const ucByAuthId = new Map<string, string[]>();
  for (const row of ucRows) {
    const arr = ucByAuthId.get(row.user_id) ?? [];
    arr.push(row.company_id);
    ucByAuthId.set(row.user_id, arr);
  }
  const acRows = (userCompanyAcsRes.data ?? []) as Array<{ user_id: string; company_id: string; ac_id: string }>;
  const appUsers = (usersRes.data ?? []).map((r: any) => {
    const u = rowToAppUser(r);
    u.companyIds = u.authUserId ? (ucByAuthId.get(u.authUserId) ?? []) : [];
    u.perCompanyAcIds = u.authUserId
      ? Object.fromEntries(acRows.filter((row) => row.user_id === u.authUserId).map((row) => [row.company_id, row.ac_id]))
      : {};
    if (activeCompanyId) u.acId = u.perCompanyAcIds[activeCompanyId] ?? null;
    return u;
  });
  const antecipacaoItems = (antRes.data ?? []).map(rowToAntecipacaoItem);
  const conciliacaoItems = (concRes.data ?? []).map(rowToConciliacaoItem);
  const conciliacaoImportErrors = (concErrRes.data ?? []).map(rowToConciliacaoImportError);

  return { acs, products, studentTags, rules, rulesId: rulesRes.data?.id, students, studentsLoadOk: !studentsRes.error, cancellationCases, appUsers, antecipacaoItems, conciliacaoItems, conciliacaoImportErrors };
}

let cachedRulesId: string | null = null;
export function getRulesId() {
  return cachedRulesId;
}
export function setRulesId(id: string | null) {
  cachedRulesId = id;
}


/**
 * Suspende temporariamente os reloads disparados pelo realtime do Supabase
 * enquanto uma operação em massa (limpeza, importação, etc.) está rodando.
 * Sem isso, cada DELETE/INSERT emite um evento e cada evento dispara um
 * fetchAll() de 10 tabelas — congelando a UI por vários segundos.
 *
 * Uso:
 *   await withSyncSuspended(async () => {
 *     await supabase.from('students').delete()...
 *     await supabase.from('cancellation_cases').delete()...
 *   });
 */
export async function withSyncSuspended<T>(fn: () => Promise<T>): Promise<T> {
  (window as any).__suppressFullSync = true;
  try {
    return await fn();
  } finally {
    (window as any).__suppressFullSync = false;
  }
}

export function useSupabaseSync() {
  const { session } = useAuth();
  const activeCompanyId = useCompanyStore((s) => s.activeCompanyId);
  const setStore = (patch: Partial<ReturnType<typeof useAppStore.getState>>) =>
    useAppStore.setState(patch as any);

  useEffect(() => {
    if (!session || !activeCompanyId) return;

    let mounted = true;

    const reload = async () => {
      const { acs, products, studentTags, rules, rulesId, students, studentsLoadOk, cancellationCases, appUsers, antecipacaoItems, conciliacaoItems, conciliacaoImportErrors } = await fetchAll(activeCompanyId);
      if (!mounted) return;
      cachedRulesId = rulesId ?? null;

      // ── Reconciliação: garante que todo aluno vinculado a um caso de
      // cancelamento ATIVO apareça com sub-badge "Solicitação Cancelamento"
      // na carteira (Alunos / Assessor). Casos com stage final (Recuperado,
      // Cancelado, Estorno) ou aluno já cancelado/conciliado não disparam.
      const STAGES_ENCERRADAS = new Set<string>([
        'Recuperado', 'Cancelado', 'Início do Estorno', 'Estorno em Andamento',
      ]);
      const casosAtivosPorStudentId = new Map<string, string>();
      // Fallback por nome normalizado: usado APENAS quando existe um único
      // aluno com aquele nome na carteira. Se houver homônimos (ex.: mesmo
      // aluno com contratos de treinamentos diferentes), casar por nome
      // vincularia o caso ao contrato errado — então o fallback é ignorado.
      // Além disso, o vínculo por nome nunca é persistido no banco.
      const normalize = (s: string) => (s ?? '').trim().toLowerCase();
      const nameCount = new Map<string, number>();
      for (const s of students) {
        const n = normalize(s.name);
        nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      }
      const casosAtivosPorNome = new Map<string, string>();
      for (const c of cancellationCases) {
        if (STAGES_ENCERRADAS.has(c.stage as string)) continue;
        if (c.studentId) {
          casosAtivosPorStudentId.set(c.studentId, c.id);
          // Caso já nasceu vinculado a um contrato específico: NUNCA casar por
          // nome. Se o aluno original foi excluído, o caso é órfão e não pode
          // "migrar" para outro contrato/treinamento do mesmo aluno.
          continue;
        }
        const nome = normalize(c.studentName);
        if (nome && !casosAtivosPorNome.has(nome)) casosAtivosPorNome.set(nome, c.id);
      }
      const casosExistentes = new Set(cancellationCases.map((c) => c.id));
      const studentsReconciled = students.map((s) => {
        const nome = normalize(s.name);
        const byId = casosAtivosPorStudentId.get(s.id);
        const byName = (nameCount.get(nome) ?? 0) === 1 ? casosAtivosPorNome.get(nome) : undefined;
        const caseId = byId ?? byName;
        if (!caseId) {
          // Ponteiro órfão: caso vinculado não existe mais (aluno/caso excluído).
          // Limpa o badge de "Solicitação Cancelamento" em vez de deixá-lo preso.
          if (s.cancellationCaseId && !casosExistentes.has(s.cancellationCaseId)) {
            return {
              ...s,
              statusCancelamento: 'nenhum' as const,
              cancellationCaseId: null,
              status: s.status === 'Solicitação Cancelamento'
                ? ((s as any).statusAntesCancelamento || 'Em Dia')
                : s.status,
              statusMode: s.status === 'Solicitação Cancelamento' ? ('Automático' as const) : s.statusMode,
              __orphanCleanup: true,
            } as any;
          }
          return s;
        }
        const sc = s.statusCancelamento;
        if ((!sc || sc === 'nenhum') && caseId) {
          return {
            ...s,
            status: 'Solicitação Cancelamento' as const,
            statusMode: 'Manual' as const,
            statusCancelamento: 'solicitado' as const,
            cancellationCaseId: caseId,
            __fallbackByName: !byId,
          } as typeof s & { __fallbackByName?: boolean };
        }
        // Se já está cancelado de fato ou em conciliação, não rebaixar.
        if (sc === 'cancelado' || sc === 'aguardando_conciliacao') {
          if (
            sc === 'aguardando_conciliacao' &&
            (s.statusMode !== 'Manual' || s.status !== 'Solicitação Cancelamento')
          ) {
            return {
              ...s,
              status: 'Solicitação Cancelamento' as const,
              statusMode: 'Manual' as const,
            };
          }
          return s;
        }
        if (sc === 'pagamento_multa_pendente' || sc === 'em_tratamento' || sc === 'juridico') {
          if (s.statusMode === 'Manual' && s.status === 'Solicitação Cancelamento') return s;
          return {
            ...s,
            status: 'Solicitação Cancelamento' as const,
            statusMode: 'Manual' as const,
          };
        }
        // Só considera reconciliado se o badge de status também já reflete
        // a solicitação — antes bastava o vínculo, e o aluno seguia com o
        // status antigo ("À Negativar", "Vencido 1"...), o que fazia o KPI
        // "Solicitação Cancelamento" do Dashboard contar quase ninguém.
        if (sc === 'solicitado' && s.cancellationCaseId === caseId && s.status === 'Solicitação Cancelamento') return s;
        return {
          ...s,
          status: 'Solicitação Cancelamento' as const,
          statusMode: 'Manual' as const,
          statusCancelamento: 'solicitado' as const,
          cancellationCaseId: caseId,
          __fallbackByName: !byId,
        } as typeof s & { __fallbackByName?: boolean };
      });

      const patch: any = { acs, products, studentTags, students: studentsReconciled, cancellationCases, appUsers };
      if (rules) patch.rules = rules;
      setStore(patch);

      try {
        const { fetchKaminoDashboardForecastTotals } = await import('@/lib/kaminoDashboardTotals');
        const kaminoPortfolioTotals = await fetchKaminoDashboardForecastTotals();
        if (mounted) setStore({ kaminoPortfolioTotals });
      } catch (e) {
        console.warn('[kamino] falha ao carregar totais da carteira:', e);
      }
      // Sync antecipação store
      useAntecipacaoStore.setState({ items: antecipacaoItems });
      // Fila de aprovação para imports IAM PENDENTE
      let finalConciliacaoItems = conciliacaoItems;
      try {
        const { ensureIamPendenteConciliacaoItems } = await import('@/lib/iamPendenteConciliacao');
        finalConciliacaoItems = await ensureIamPendenteConciliacaoItems(studentsReconciled, conciliacaoItems);
      } catch (e) {
        console.error('Falha ao garantir fila IAM pendente:', e);
      }
      // Fila de vínculo de treinamento para fichas de Recompra
      try {
        const { ensureRecompraVinculoConciliacaoItems } = await import('@/lib/recompraConciliacao');
        finalConciliacaoItems = await ensureRecompraVinculoConciliacaoItems(studentsReconciled, finalConciliacaoItems, studentsLoadOk);
      } catch (e) {
        console.error('Falha ao garantir fila Recompras:', e);
      }
      try {
        const { ensureCancelamentoEspelhoConciliacaoItems } = await import('@/lib/cancelamentoGcConciliacao');
        finalConciliacaoItems = await ensureCancelamentoEspelhoConciliacaoItems(
          studentsReconciled,
          cancellationCases,
          finalConciliacaoItems,
        );
      } catch (e) {
        console.error('Falha ao garantir fila Cancelamentos espelho:', e);
      }
      // Sync conciliação store
      useConciliacaoStore.setState({ items: finalConciliacaoItems, importErrors: conciliacaoImportErrors });

      // Comissões: carrega do banco e recupera reversões antigas sem comissão
      useCommissionsStore.getState().loadAll().then(async () => {
        try {
          // v2 também recupera comissões que ficaram fora quando o primeiro
          // backfill foi executado antes de todos os casos serem carregados.
          const key = `iam-comissoes-backfill-v2-${activeCompanyId}`;
          if (localStorage.getItem(key)) return;
          const { backfillCommissionsFromCases } = await import('@/lib/commissionsBackfill');
          backfillCommissionsFromCases();
          localStorage.setItem(key, new Date().toISOString());
        } catch (e) { console.error('Falha backfill de comissões:', e); }
      }).catch(console.error);

      // Persistência em background do que foi reconciliado (só onde mudou e
      // apenas quando o vínculo veio do studentId — nunca do fallback por nome)
      const { updateStudentDb } = await import('@/lib/supabaseMutations');
      for (let i = 0; i < students.length; i++) {
        const before = students[i];
        const after = studentsReconciled[i] as any;
        if (before === after) continue;
        if (after.__fallbackByName) continue;
        updateStudentDb(after.id, {
          statusCancelamento: after.statusCancelamento,
          cancellationCaseId: after.cancellationCaseId,
          ...(after.__orphanCleanup ? { status: after.status, statusMode: after.statusMode } : {}),
        }).catch((e) => console.error('Falha ao reconciliar statusCancelamento:', e));
      }

    };

    // Debounce do reload disparado por eventos realtime: durante uma importação
    // ou limpeza em massa, o Postgres emite dezenas/centenas de eventos em
    // rajada. Sem debounce, cada evento dispara um fetchAll() (10 tabelas) em
    // paralelo, congelando a UI. Com debounce de 400ms, todos colapsam em 1.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if ((window as any).__suppressFullSync) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        reload().catch((e) => console.error('reload falhou:', e));
      }, 400);
    };

    reload().then(() => {
      // Rotina diária: migra automaticamente alunos com >180 dias para Renda Extra
      // (status 'Conciliar Exclusão'). Aluno permanece em Negativado na carteira até conciliação manual.
      try {
        const todayKey = new Date().toISOString().split('T')[0];
        const lastRun = localStorage.getItem('iam-re-auto-migration-day');
        if (lastRun !== todayKey) {
          useAppStore.getState().verificarMigracoesAutomaticasRendaExtra().then(() => {
            localStorage.setItem('iam-re-auto-migration-day', todayKey);
          }).catch(console.error);
        }
      } catch (e) { console.error('Falha rotina migração RE auto:', e); }

      // Notificações (Item 2): carrega + cleanup + gera vencimento_hoje 1x/dia.
      useNotificationsStore.getState().loadAll(15).catch(console.error);
      useNotificationsStore.getState().cleanupOld().catch(console.error);
      try {
        const todayKey = new Date().toISOString().split('T')[0];
        const lastNotifyDay = localStorage.getItem('iam-notify-vencto-hoje-day');
        if (lastNotifyDay !== todayKey) {
          import('@/lib/notificationsAuto').then(({ gerarNotificacoesVencimentoHoje }) => {
            gerarNotificacoesVencimentoHoje().then(() => {
              localStorage.setItem('iam-notify-vencto-hoje-day', todayKey);
            }).catch(console.error);
          });
        }
      } catch (e) { console.error('Falha rotina notificação venc. hoje:', e); }
    });

    const channel = supabase
      .channel('full-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'acs' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_tags' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_rules' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cancellation_cases' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_company_acs' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'antecipacao_items' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conciliacao_items' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conciliacao_import_errors' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'commissions' }, () => {
        useCommissionsStore.getState().loadAll().catch(console.error);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        useNotificationsStore.getState().loadAll(15).catch(console.error);
      })
      .subscribe();

    return () => {
      mounted = false;
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [session, activeCompanyId]);
}
