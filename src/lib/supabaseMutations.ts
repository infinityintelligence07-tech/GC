// Mutações Supabase — funções utilitárias chamadas pelos componentes

import { supabase } from '@/integrations/supabase/client';
import { getRulesId, setRulesId } from '@/hooks/useSupabaseSync';
import { pushStudentStatus, rowAffectsIamSync } from '@/lib/iamControlSync';
import {
  noteStudentVersion,
  isStaleSnapshot,
  mergeHistory,
  FINANCIAL_COLUMNS,
} from '@/lib/studentWriteGuard';
import type { AC, Product, StudentTag, FinancialRules, Student, CancellationCase, AntecipacaoItem, AppUser, Notification, NotificationType } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function studentToRow(s: Partial<Student>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (s.name !== undefined) row.name = s.name;
  if (s.whatsapp !== undefined) row.whatsapp = s.whatsapp;
  if (s.email !== undefined) row.email = s.email;
  if (s.cpf !== undefined) row.cpf = s.cpf;
  if (s.address !== undefined) row.address = s.address;
  if (s.numero !== undefined) row.numero = s.numero;
  if (s.cidade !== undefined) row.cidade = s.cidade;
  if (s.estado !== undefined) row.estado = s.estado;
  if (s.cep !== undefined) row.cep = s.cep;
  if (s.status !== undefined) row.status = s.status;
  if (s.statusMode !== undefined) row.status_mode = s.statusMode;
  if (s.ac !== undefined) row.ac = s.ac;
  if (s.product !== undefined) row.product = s.product;
  if (s.enrollmentDate !== undefined) row.enrollment_date = s.enrollmentDate;
  if (s.data_treinamento_origem !== undefined) row.data_treinamento_origem = s.data_treinamento_origem;
  if (s.dueDay !== undefined) row.due_day = s.dueDay;
  if (s.saleValue !== undefined) row.sale_value = s.saleValue;
  if (s.downPayment !== undefined) row.down_payment = s.downPayment;
  if (s.totalInstallments !== undefined) row.total_installments = s.totalInstallments;
  if (s.paidInstallments !== undefined) row.paid_installments = s.paidInstallments;
  if (s.installmentValue !== undefined) row.installment_value = s.installmentValue;
  if (s.isRendaExtra !== undefined) row.is_renda_extra = s.isRendaExtra;
  if (s.rendaExtraStatus !== undefined) row.renda_extra_status = s.rendaExtraStatus;
  if (s.rendaExtraAC !== undefined) row.renda_extra_ac = s.rendaExtraAC;
  if (s.rendaExtraACAssignedAt !== undefined) row.renda_extra_ac_assigned_at = s.rendaExtraACAssignedAt;
  if (s.rendaExtraInclusionDate !== undefined) row.renda_extra_inclusion_date = s.rendaExtraInclusionDate;
  if (s.rendaExtraInscriptionDate !== undefined) row.renda_extra_inscription_date = s.rendaExtraInscriptionDate;
  if (s.rendaExtraAcordoValue !== undefined) row.renda_extra_acordo_value = s.rendaExtraAcordoValue;
  if (s.rendaExtraPaymentDate !== undefined) row.renda_extra_payment_date = s.rendaExtraPaymentDate;
  if (s.rendaExtraPaymentMethod !== undefined) row.renda_extra_payment_method = s.rendaExtraPaymentMethod;
  if (s.rendaExtraDirectedAt !== undefined) row.renda_extra_directed_at = s.rendaExtraDirectedAt;
  if (s.rendaExtraValueAtDirection !== undefined) row.renda_extra_value_at_direction = s.rendaExtraValueAtDirection;
  if (s.statusCancelamento !== undefined) row.status_cancelamento = s.statusCancelamento;
  if (s.cancellationCaseId !== undefined) row.cancellation_case_id = s.cancellationCaseId;
  if (s.statusAntesCancelamento !== undefined) row.status_antes_cancelamento = s.statusAntesCancelamento;

  if (s.tags !== undefined) row.tags = s.tags;
  if (s.productHistory !== undefined) row.product_history = s.productHistory;
  if (s.installments !== undefined) row.installments = s.installments;
  if (s.history !== undefined) row.history = s.history;
  if ((s as any).detalhes !== undefined) row.detalhes = (s as any).detalhes;
  if (s.ciclo !== undefined) row.ciclo = s.ciclo;
  if ((s as Student).iamControlContratoStatus !== undefined) {
    row.iam_control_contrato_status = (s as Student).iamControlContratoStatus;
  }
  if ((s as Student).iamControlPendenteTipo !== undefined) {
    row.iam_control_pendente_tipo = (s as Student).iamControlPendenteTipo;
  }
  if ((s as Student).iamControlPendenteLink !== undefined) {
    row.iam_control_pendente_link = (s as Student).iamControlPendenteLink;
  }
  if ((s as Student).iamGcConciliadoAt !== undefined) {
    row.iam_gc_conciliado_at = (s as Student).iamGcConciliadoAt;
  }
  if (s.recompraTreinamento !== undefined) row.recompra_treinamento = s.recompraTreinamento;
  return row;
}

export function rowToStudent(r: any): Student {
  // Guarda a versão lida para detectar gravações a partir de snapshot velho
  noteStudentVersion(r?.id, r?.updated_at);
  return {
    id: r.id,
    name: r.name,
    whatsapp: r.whatsapp ?? '',
    email: r.email ?? undefined,
    cpf: r.cpf ?? '',
    address: r.address ?? '',
    numero: r.numero ?? '',
    cidade: r.cidade ?? '',
    estado: r.estado ?? '',
    cep: r.cep ?? '',
    status: (r.status === 'Quitado' ? 'Pago' : (r.status ?? 'Aluno Novo')),
    statusMode: r.status_mode ?? 'Automático',
    ac: r.ac ?? '',
    product: r.product ?? '',
    enrollmentDate: r.enrollment_date ?? '',
    data_treinamento_origem: r.data_treinamento_origem ?? undefined,
    dueDay: r.due_day ?? 10,
    saleValue: Number(r.sale_value ?? 0),
    downPayment: Number(r.down_payment ?? 0),
    totalInstallments: r.total_installments ?? 0,
    paidInstallments: r.paid_installments ?? 0,
    installmentValue: Number(r.installment_value ?? 0),
    installments: typeof r.installments === 'string' ? JSON.parse(r.installments) : (r.installments ?? []),
    history: typeof r.history === 'string' ? JSON.parse(r.history) : (r.history ?? []),
    isRendaExtra: r.is_renda_extra ?? false,
    rendaExtraStatus: r.renda_extra_status ?? undefined,
    rendaExtraAC: r.renda_extra_ac ?? undefined,
    rendaExtraACAssignedAt: r.renda_extra_ac_assigned_at ?? undefined,
    rendaExtraInclusionDate: r.renda_extra_inclusion_date ?? undefined,
    rendaExtraInscriptionDate: r.renda_extra_inscription_date ?? undefined,
    rendaExtraAcordoValue: r.renda_extra_acordo_value != null ? Number(r.renda_extra_acordo_value) : undefined,
    rendaExtraPaymentDate: r.renda_extra_payment_date ?? undefined,
    rendaExtraPaymentMethod: (r.renda_extra_payment_method as 'pix' | 'link' | null) ?? undefined,
    rendaExtraDirectedAt: r.renda_extra_directed_at ?? undefined,
    rendaExtraValueAtDirection: r.renda_extra_value_at_direction != null ? Number(r.renda_extra_value_at_direction) : undefined,
    statusCancelamento: r.status_cancelamento ?? 'nenhum',
    cancellationCaseId: r.cancellation_case_id ?? undefined,
    statusAntesCancelamento: r.status_antes_cancelamento ?? undefined,

    tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags ?? []),
    productHistory: typeof r.product_history === 'string' ? JSON.parse(r.product_history) : (r.product_history ?? []),
    ciclo: r.ciclo ?? undefined,
    kaminoSyncedAt: r.kamino_synced_at ?? undefined,
    recompraTreinamento: r.recompra_treinamento ?? undefined,
    // Somente leitura — vindo do IAM Control
    iamControlAlunoId: r.iam_control_aluno_id != null ? Number(r.iam_control_aluno_id) : undefined,
    iamControlSyncedAt: r.iam_control_synced_at ?? undefined,
    iamControlContratoId: r.iam_control_contrato_id ?? undefined,
    iamControlContratoStatus: r.iam_control_contrato_status ?? undefined,
    iamControlPendenteTipo: (r.iam_control_pendente_tipo as 'LINK' | 'PIX' | null) ?? undefined,
    iamControlPendenteLink: r.iam_control_pendente_link ?? undefined,
    iamGcConciliadoAt: r.iam_gc_conciliado_at ?? undefined,
  };
}

function cancellationToRow(c: Partial<CancellationCase>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (c.studentName !== undefined) row.student_name = c.studentName;
  if (c.studentId !== undefined) row.student_id = c.studentId;
  if (c.studentWhatsapp !== undefined) row.student_whatsapp = c.studentWhatsapp;
  if (c.ac !== undefined) row.ac = c.ac;
  if (c.stage !== undefined) row.stage = c.stage;
  if (c.operationalStatus !== undefined) row.operational_status = c.operationalStatus;
  if (c.value !== undefined) row.value = c.value;
  if (c.createdAt !== undefined) row.created_at = c.createdAt;
  if (c.movedToCurrentStageAt !== undefined) row.moved_to_current_stage_at = c.movedToCurrentStageAt;
  if (c.notes !== undefined) row.notes = c.notes;
  if (c.history !== undefined) row.history = c.history;
  if (c.motivoCancelamento !== undefined) row.motivo_cancelamento = c.motivoCancelamento;
  if (c.descricaoCancelamento !== undefined) row.descricao_cancelamento = c.descricaoCancelamento;
  if (c.funnelStage !== undefined) row.funnel_stage = c.funnelStage;
  if (c.acao !== undefined) row.acao = c.acao;
  if (c.responsavel !== undefined) row.responsavel = c.responsavel;
  if (c.isMirror !== undefined) row.is_mirror = c.isMirror;
  if (c.termTemplate !== undefined) row.term_template = c.termTemplate;
  if (c.termSignedAt !== undefined) row.term_signed_at = c.termSignedAt;
  if (c.termSignedByStudent !== undefined) row.term_signed_by_student = c.termSignedByStudent;
  if (c.termAttachments !== undefined) row.term_attachments = c.termAttachments;
  if (c.tags !== undefined) row.tags = c.tags;
  if (c.cancellationFineValue !== undefined) row.cancellation_fine_value = c.cancellationFineValue;
  if (c.cancellationReviewedInstallments !== undefined) row.cancellation_reviewed_installments = c.cancellationReviewedInstallments;
  if (c.dentro7Dias !== undefined) row.dentro_7_dias = c.dentro7Dias;
  if (c.com30DiasAntecedencia !== undefined) row.com_30_dias_antecedencia = c.com30DiasAntecedencia;
  if (c.dataEvento !== undefined) row.data_evento = c.dataEvento;
  if (c.multaPercent !== undefined) row.multa_percent = c.multaPercent;
  if (c.multaValue !== undefined) row.multa_value = c.multaValue;
  if (c.totalPagoAteMomento !== undefined) row.total_pago_ate_momento = c.totalPagoAteMomento;
  if (c.quantidadeInscricoes !== undefined) row.quantidade_inscricoes = c.quantidadeInscricoes;
  if (c.treinamento !== undefined) row.treinamento = c.treinamento;
  if (c.pagamentoTipo !== undefined) row.pagamento_tipo = c.pagamentoTipo;
  if (c.contractPdfUrl !== undefined) row.contract_pdf_url = c.contractPdfUrl;
  if (c.ligacaoAgendadaAt !== undefined) row.ligacao_agendada_at = c.ligacaoAgendadaAt;
  if (c.finalChecklist !== undefined) row.final_checklist = c.finalChecklist;
  if (c.inscricoesRevertidas !== undefined) row.inscricoes_revertidas = c.inscricoesRevertidas;
  if ((c as any).refundPlan !== undefined) row.refund_plan = (c as any).refundPlan;
  if (c.caseNotes !== undefined) row.case_notes = c.caseNotes;
  if (c.externalImport !== undefined) row.external_import = c.externalImport;
  return row;
}

export function rowToCancellationCase(r: any): CancellationCase {
  return {
    id: r.id,
    studentName: r.student_name,
    studentId: r.student_id ?? undefined,
    studentWhatsapp: r.student_whatsapp ?? undefined,
    ac: r.ac ?? '',
    stage: r.stage,
    operationalStatus: r.operational_status,
    value: r.value != null ? Number(r.value) : undefined,
    createdAt: r.created_at,
    movedToCurrentStageAt: r.moved_to_current_stage_at,
    notes: r.notes ?? '',
    history: typeof r.history === 'string' ? JSON.parse(r.history) : (r.history ?? []),
    motivoCancelamento: r.motivo_cancelamento ?? undefined,
    descricaoCancelamento: r.descricao_cancelamento ?? undefined,
    funnelStage: r.funnel_stage ?? undefined,
    acao: r.acao ?? undefined,
    responsavel: r.responsavel ?? undefined,
    isMirror: r.is_mirror ?? false,
    termTemplate: r.term_template ?? undefined,
    termSignedAt: r.term_signed_at ?? undefined,
    termSignedByStudent: r.term_signed_by_student ?? false,
    termAttachments: typeof r.term_attachments === 'string' ? JSON.parse(r.term_attachments) : (r.term_attachments ?? []),
    tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags ?? []),
    cancellationFineValue: r.cancellation_fine_value != null ? Number(r.cancellation_fine_value) : undefined,
    cancellationReviewedInstallments: typeof r.cancellation_reviewed_installments === 'string' ? JSON.parse(r.cancellation_reviewed_installments) : (r.cancellation_reviewed_installments ?? undefined),
    dentro7Dias: r.dentro_7_dias ?? undefined,
    com30DiasAntecedencia: r.com_30_dias_antecedencia ?? undefined,
    dataEvento: r.data_evento ?? undefined,
    multaPercent: r.multa_percent != null ? Number(r.multa_percent) : undefined,
    multaValue: r.multa_value != null ? Number(r.multa_value) : undefined,
    totalPagoAteMomento: r.total_pago_ate_momento != null ? Number(r.total_pago_ate_momento) : undefined,
    quantidadeInscricoes: r.quantidade_inscricoes != null ? Number(r.quantidade_inscricoes) : undefined,
    treinamento: (r as any).treinamento ?? undefined,
    pagamentoTipo: (r.pagamento_tipo as any) ?? undefined,
    contractPdfUrl: r.contract_pdf_url ?? undefined,
    ligacaoAgendadaAt: r.ligacao_agendada_at ?? undefined,
    finalChecklist: typeof r.final_checklist === 'string' ? JSON.parse(r.final_checklist) : (r.final_checklist ?? undefined),
    inscricoesRevertidas: r.inscricoes_revertidas != null ? Number(r.inscricoes_revertidas) : 0,
    refundPlan: typeof r.refund_plan === 'string' ? JSON.parse(r.refund_plan) : (r.refund_plan ?? undefined),
    caseNotes: typeof r.case_notes === 'string' ? JSON.parse(r.case_notes) : (r.case_notes ?? []),
    externalImport: r.external_import ?? false,
  };
}

export function rowToAppUser(r: any): AppUser {
  // O toggle "Confirmar Pagamento" é guardado dentro do JSON `permissions`
  // sob a chave especial `_canConfirmarPagamento` (não é uma aba).
  const rawPerms = (r.permissions ?? null) as any;
  let permissions: any = undefined;
  let canConfirmarPagamento = false;
  if (rawPerms && typeof rawPerms === 'object') {
    const { _canConfirmarPagamento, ...rest } = rawPerms;
    canConfirmarPagamento = _canConfirmarPagamento === true;
    permissions = Object.keys(rest).length > 0 ? rest : undefined;
  }
  return {
    id: r.id,
    name: r.name,
    login: r.login,
    role: r.role,
    acId: r.ac_id ?? undefined,
    photo: r.photo ?? undefined,
    permissions,
    canConfirmarPagamento,
    authUserId: r.auth_user_id ?? undefined,
  };
}

async function syncUserCompanyAcs(authUserId: string | null | undefined, perCompanyAcIds: Record<string, string | null> | undefined) {
  if (!authUserId || !perCompanyAcIds) return;
  await Promise.all(Object.entries(perCompanyAcIds).map(([companyId, acId]) => {
    if (acId) {
      return supabase.from('user_company_acs').upsert({ user_id: authUserId, company_id: companyId, ac_id: acId });
    }
    return supabase.from('user_company_acs').delete().eq('user_id', authUserId).eq('company_id', companyId);
  }));
}

export function rowToAntecipacaoItem(r: any): AntecipacaoItem {
  return {
    id: r.id,
    acId: r.ac_id,
    nome: r.nome,
    whatsapp: r.whatsapp ?? '',
    dataVencimento: r.data_vencimento,
    origem: r.origem,
    createdAt: r.created_at,
  };
}

// ─── ACs ─────────────────────────────────────────────────────────────────────
export async function createAC(data: Omit<AC, 'id'>) {
  const { data: row, error } = await supabase
    .from('acs')
    .insert({
      name: data.name,
      active: data.active,
      photo: data.photo ?? null,
      meta_1: data.meta1 ?? null,
      meta_2: data.meta2 ?? null,
      meta_3: data.meta3 ?? null,
    } as any)
    .select()
    .single();
  if (error) throw error;
  return row;
}

export async function updateACDb(id: string, data: Partial<AC>) {
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.active !== undefined) patch.active = data.active;
  if (data.photo !== undefined) patch.photo = data.photo ?? null;
  if (data.meta1 !== undefined) patch.meta_1 = data.meta1 ?? null;
  if (data.meta2 !== undefined) patch.meta_2 = data.meta2 ?? null;
  if (data.meta3 !== undefined) patch.meta_3 = data.meta3 ?? null;
  const { error } = await supabase.from('acs').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteACDb(id: string) {
  const { error } = await supabase.from('acs').delete().eq('id', id);
  if (error) throw error;
}

// ─── Products ────────────────────────────────────────────────────────────────
export async function createProduct(data: Omit<Product, 'id'>) {
  const { data: row, error } = await supabase
    .from('products')
    .insert({ name: data.name, value: data.value ?? null })
    .select()
    .single();
  if (error) throw error;
  return row;
}

export async function updateProductDb(id: string, data: Partial<Product>) {
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.value !== undefined) patch.value = data.value ?? null;
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteProductDb(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ─── Student Tags ────────────────────────────────────────────────────────────
export async function createStudentTag(data: Omit<StudentTag, 'id'>) {
  const { data: row, error } = await supabase
    .from('student_tags')
    .insert({ name: data.name, color: data.color, scope: data.scope ?? 'student' })
    .select()
    .single();
  if (error) throw error;
  return row;
}

export async function updateStudentTagDb(id: string, data: Partial<StudentTag>) {
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.color !== undefined) patch.color = data.color;
  if (data.scope !== undefined) patch.scope = data.scope;
  const { error } = await supabase.from('student_tags').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteStudentTagDb(id: string) {
  const { error } = await supabase.from('student_tags').delete().eq('id', id);
  if (error) throw error;
}

// ─── Financial Rules ─────────────────────────────────────────────────────────
export async function updateRulesDb(data: Partial<FinancialRules>) {
  const patch: any = {};
  if (data.multaPercent !== undefined) patch.multa_percent = data.multaPercent;
  if (data.jurosPercent !== undefined) patch.juros_percent = data.jurosPercent;
  if (data.descontoRendaExtra !== undefined) patch.desconto_renda_extra = data.descontoRendaExtra;
  if (data.maxParcelasRenegociacao !== undefined)
    patch.max_parcelas_renegociacao = data.maxParcelasRenegociacao;
  if (data.maxParcelasCadastro !== undefined)
    patch.max_parcelas_cadastro = data.maxParcelasCadastro;
  if (data.meta1 !== undefined) patch.meta_1 = data.meta1;
  if (data.meta2 !== undefined) patch.meta_2 = data.meta2;
  if (data.meta3 !== undefined) patch.meta_3 = data.meta3;
  if ((data as any).metaReversao1 !== undefined) patch.meta_reversao_1 = (data as any).metaReversao1;
  if ((data as any).metaReversao2 !== undefined) patch.meta_reversao_2 = (data as any).metaReversao2;
  if ((data as any).metaReversao3 !== undefined) patch.meta_reversao_3 = (data as any).metaReversao3;
  if (data.multaCancelamentoComAntecedencia !== undefined)
    patch.multa_cancelamento_com_antecedencia = data.multaCancelamentoComAntecedencia;
  if (data.multaCancelamentoSemAntecedencia !== undefined)
    patch.multa_cancelamento_sem_antecedencia = data.multaCancelamentoSemAntecedencia;
  const id = getRulesId();
  if (id) {
    const { error } = await supabase.from('financial_rules').update(patch).eq('id', id);
    if (error) throw error;
  } else {
    const { data: row, error } = await supabase
      .from('financial_rules')
      .insert(patch)
      .select()
      .single();
    if (error) throw error;
    if (row?.id) setRulesId(row.id);
  }
}


// ─── Students ────────────────────────────────────────────────────────────────
export async function createStudentDb(data: Omit<Student, 'id'>) {
  const row = studentToRow(data as any);
  const { data: result, error } = await supabase
    .from('students')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  const student = rowToStudent(result);
  if (student.id) pushStudentStatus(student.id);
  return student;
}

export async function createStudentsBulkDb(students: Omit<Student, 'id'>[]): Promise<Student[]> {
  if (students.length === 0) return [];
  const rows = students.map((s) => studentToRow(s as any));
  const { data, error } = await supabase.from('students').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map(rowToStudent);
}

export async function updateStudentDb(id: string, data: Partial<Student>) {
  const row = studentToRow(data);
  if (Object.keys(row).length === 0) return;
  let wroteFromStaleState = false;

  // Lê o estado atual do banco antes de gravar: evita (a) regravar financeiro
  // antigo por cima de ajuste mais novo e (b) apagar entradas de histórico.
  const { data: current } = await supabase
    .from('students')
    .select('updated_at, history, sale_value, down_payment, installment_value, total_installments, paid_installments, installments, enrollment_date, due_day')
    .eq('id', id)
    .maybeSingle();

  if (current) {
    // Histórico sempre mesclado (nunca substituído)
    if (row.history !== undefined) {
      row.history = mergeHistory((current as any).history, row.history) as any;
    }

    if (isStaleSnapshot(id, (current as any).updated_at)) {
      const dropped: string[] = [];
      for (const col of FINANCIAL_COLUMNS) {
        if (row[col] === undefined) continue;
        const dbVal = (current as any)[col];
        const same = JSON.stringify(dbVal ?? null) === JSON.stringify(row[col] ?? null);
        if (!same) {
          delete row[col];
          dropped.push(col);
        }
      }
      if (dropped.length > 0) {
        wroteFromStaleState = true;
        console.warn(
          `[studentWriteGuard] Gravação a partir de estado desatualizado do aluno ${id}. ` +
            `Campos financeiros ignorados para não sobrescrever dados mais novos: ${dropped.join(', ')}`
        );
      }
    }
  }

  if (Object.keys(row).length === 0) return;
  const { data: updated, error } = await supabase
    .from('students')
    .update(row)
    .eq('id', id)
    .select('id, updated_at')
    .maybeSingle();
  if (error) throw error;
  // Sem erro e sem linha retornada = a RLS bloqueou a gravação (0 linhas afetadas).
  // Sem essa checagem a alteração aparece na tela e "some" no próximo sync.
  if (!updated) {
    throw new Error('Alteração não gravada: você não tem permissão para editar este aluno.');
  }
  // Se a sessão gravou a partir de estado velho, NÃO registrar a nova versão:
  // registrar faria a próxima gravação da mesma sessão passar pela guarda e
  // sobrescrever o financeiro com dados desatualizados. A versão só volta a
  // valer quando a sessão reler o aluno do banco (rowToStudent).
  if (!wroteFromStaleState) {
    noteStudentVersion(id, (updated as any)?.updated_at);
  }
  if (rowAffectsIamSync(row)) pushStudentStatus(id);
}


export async function markStudentNegativadoDb(id: string, actorName?: string): Promise<Student> {
  const { data, error } = await (supabase as any).rpc('mark_student_negativado', {
    _student_id: id,
    _actor_name: actorName ?? null,
  });
  if (error) throw error;
  pushStudentStatus(id);
  return rowToStudent(data);
}

export async function deleteStudentDb(id: string) {
  // `.select()` devolve as linhas realmente removidas: se a RLS bloquear,
  // o Postgres não retorna erro — só apaga 0 linhas. Sem essa checagem o
  // aluno some da tela e reaparece no próximo sync.
  const { data, error } = await supabase.from('students').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Exclusão não permitida: você não tem permissão para excluir alunos desta empresa.');
  }
}


// ─── Cancellation Cases ─────────────────────────────────────────────────────
export async function createCancellationCaseDb(data: Omit<CancellationCase, 'id'> & { id?: string }) {
  const row = cancellationToRow(data as any);
  // Preserva o mesmo id usado no estado local — sem isso o banco gera outro uuid
  // e todas as atualizações seguintes (mover coluna, jurídico) não encontram a linha.
  if (data.id) row.id = data.id;
  const { data: result, error } = await supabase
    .from('cancellation_cases')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return rowToCancellationCase(result);
}

export async function updateCancellationCaseDb(id: string, data: Partial<CancellationCase>) {
  const row = cancellationToRow(data);
  if (Object.keys(row).length === 0) return;
  const { data: updated, error } = await supabase
    .from('cancellation_cases')
    .update(row)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  // Update que não afeta nenhuma linha = caso inexistente/sem permissão.
  // Falha visivelmente em vez de perder a alteração silenciosamente.
  if (!updated || updated.length === 0) {
    throw new Error('Caso de cancelamento não encontrado no banco (a alteração não foi salva). Recarregue a página e tente novamente.');
  }
}

/** Salva observações manuais (case_notes) via RPC com RLS dedicado. */
export async function saveCancellationCaseNotesDb(
  caseId: string,
  notes: CancellationCase['caseNotes'],
) {
  const { error } = await supabase.rpc('save_cancellation_case_notes', {
    p_case_id: caseId,
    p_notes: notes ?? [],
  });
  if (error) throw error;
}

export async function deleteCancellationCaseDb(id: string) {
  const { error } = await supabase.from('cancellation_cases').delete().eq('id', id);
  if (error) throw error;
}

// ─── Antecipação Items ──────────────────────────────────────────────────────
export async function createAntecipacaoItemDb(item: AntecipacaoItem) {
  const { error } = await supabase
    .from('antecipacao_items')
    .insert({
      id: item.id || undefined,
      ac_id: item.acId,
      nome: item.nome,
      whatsapp: item.whatsapp,
      data_vencimento: item.dataVencimento,
      origem: item.origem,
      created_at: item.createdAt,
    });
  if (error) throw error;
}

export async function createAntecipacaoItemsBulkDb(items: AntecipacaoItem[]) {
  const rows = items.map((item) => ({
    ac_id: item.acId,
    nome: item.nome,
    whatsapp: item.whatsapp,
    data_vencimento: item.dataVencimento,
    origem: item.origem,
    created_at: item.createdAt,
  }));
  const { error } = await supabase.from('antecipacao_items').insert(rows);
  if (error) throw error;
}

export async function deleteAntecipacaoItemDb(id: string) {
  const { error } = await supabase.from('antecipacao_items').delete().eq('id', id);
  if (error) throw error;
}

export async function clearAntecipacaoByACDb(acId: string) {
  const { error } = await supabase.from('antecipacao_items').delete().eq('ac_id', acId);
  if (error) throw error;
}

// ─── App Users ──────────────────────────────────────────────────────────────
function buildPermissionsPayload(permissions: any, canConfirmarPagamento: boolean | undefined): any {
  const base = (permissions && typeof permissions === 'object') ? { ...permissions } : {};
  if (canConfirmarPagamento) {
    base._canConfirmarPagamento = true;
  } else {
    delete base._canConfirmarPagamento;
  }
  return Object.keys(base).length > 0 ? base : null;
}

async function syncUserCompanies(authUserId: string | null | undefined, companyIds: string[] | undefined) {
  if (!authUserId || !companyIds) return;
  // Lê acessos atuais e calcula diff
  const { data: existing } = await supabase
    .from('user_companies')
    .select('company_id')
    .eq('user_id', authUserId);
  const have = new Set((existing ?? []).map((r: any) => r.company_id as string));
  const want = new Set(companyIds);
  const toAdd = [...want].filter((c) => !have.has(c));
  const toRemove = [...have].filter((c) => !want.has(c));
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('user_companies')
      .insert(toAdd.map((company_id) => ({ user_id: authUserId, company_id })));
    if (error) console.error('Falha ao adicionar empresas ao usuário:', error);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_companies')
      .delete()
      .eq('user_id', authUserId)
      .in('company_id', toRemove);
    if (error) console.error('Falha ao remover empresas do usuário:', error);
  }
}

export async function createAppUserDb(data: Omit<AppUser, 'id'>) {
  // Cria via edge function (precisa de service_role para criar auth.users)
  const { data: result, error } = await supabase.functions.invoke('create-app-user', {
    body: {
      name: data.name,
      login: data.login,
      password: data.password,
      role: data.role,
      ac_id: data.acId ?? null,
      photo: data.photo ?? null,
      permissions: buildPermissionsPayload(data.permissions, data.canConfirmarPagamento),
    },
  });
  if (error) throw error;
  if (!result?.ok) throw new Error(result?.error ?? 'Falha ao criar usuário');
  const created = rowToAppUser(result.row);
  // Sincroniza empresas acessíveis (padrão: empresa atual se nada informado)
  const companyIds = data.companyIds && data.companyIds.length > 0
    ? data.companyIds
    : (result.row?.company_id ? [result.row.company_id] : []);
  await syncUserCompanies(created.authUserId, companyIds);
  await syncUserCompanyAcs(created.authUserId, data.perCompanyAcIds);
  created.companyIds = companyIds;
  created.perCompanyAcIds = data.perCompanyAcIds ?? {};
  return created;
}

export async function updateAppUserDb(id: string, data: Partial<AppUser>) {
  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.login !== undefined) patch.login = data.login;
  if (data.role !== undefined) patch.role = data.role;
  if (data.acId !== undefined) patch.ac_id = data.acId ?? null;
  if (data.photo !== undefined) patch.photo = data.photo ?? null;
  if (data.permissions !== undefined || data.canConfirmarPagamento !== undefined) {
    const { data: current } = await supabase.from('app_users').select('permissions').eq('id', id).single();
    const currentRaw = (current?.permissions ?? null) as any;
    const currentPerms = (currentRaw && typeof currentRaw === 'object')
      ? Object.fromEntries(Object.entries(currentRaw).filter(([k]) => k !== '_canConfirmarPagamento'))
      : {};
    const currentFlag = currentRaw && typeof currentRaw === 'object' && currentRaw._canConfirmarPagamento === true;
    const nextPerms = data.permissions !== undefined ? (data.permissions ?? {}) : currentPerms;
    const nextFlag = data.canConfirmarPagamento !== undefined ? data.canConfirmarPagamento : currentFlag;
    patch.permissions = buildPermissionsPayload(nextPerms, nextFlag);
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('app_users').update(patch).eq('id', id);
    if (error) throw error;
  }
  // Trocar senha → edge function
  if (data.password) {
    const { error: pwErr } = await supabase.functions.invoke('update-app-user-password', {
      body: { app_user_id: id, password: data.password },
    });
    if (pwErr) throw pwErr;
  }
  // Sincroniza empresas acessíveis
  if (data.companyIds !== undefined) {
    const { data: row } = await supabase.from('app_users').select('auth_user_id').eq('id', id).maybeSingle();
    await syncUserCompanies((row as any)?.auth_user_id, data.companyIds);
  }
  if (data.perCompanyAcIds !== undefined) {
    const { data: row } = await supabase.from('app_users').select('auth_user_id').eq('id', id).maybeSingle();
    await syncUserCompanyAcs((row as any)?.auth_user_id, data.perCompanyAcIds);
  }
}

export async function deleteAppUserDb(id: string) {
  // Edge function remove auth.user e app_users em cascata
  const { error } = await supabase.functions.invoke('delete-app-user', {
    body: { app_user_id: id },
  });
  if (error) throw error;
}

// ─── Conciliação ─────────────────────────────────────────────────────────────
import type { ConciliacaoItem, ConciliacaoImportError } from '@/types';

export function rowToConciliacaoItem(r: any): ConciliacaoItem {
  return {
    id: r.id,
    tipo: r.tipo,
    studentId: r.student_id ?? undefined,
    studentName: r.student_name,
    ac: r.ac ?? undefined,
    resumo: r.resumo,
    antes: r.antes ?? {},
    depois: r.depois ?? {},
    autorId: r.autor_id ?? undefined,
    autorNome: r.autor_nome ?? undefined,
    autorObservacao: r.autor_observacao ?? undefined,
    status: r.status,
    aprovadoAt: r.aprovado_at ?? undefined,
    aprovadoPorId: r.aprovado_por_id ?? undefined,
    aprovadoPorNome: r.aprovado_por_nome ?? undefined,
    aprovadoNota: r.aprovado_nota ?? undefined,
    conciliadoAt: r.conciliado_at ?? undefined,
    conciliadoPorId: r.conciliado_por_id ?? undefined,
    conciliadoPorNome: r.conciliado_por_nome ?? undefined,
    conciliadoNota: r.conciliado_nota ?? undefined,
    reprovadoAt: r.reprovado_at ?? undefined,
    reprovadoPorId: r.reprovado_por_id ?? undefined,
    reprovadoPorNome: r.reprovado_por_nome ?? undefined,
    reprovadoMotivo: r.reprovado_motivo ?? undefined,
    relatedCaseId: r.related_case_id ?? undefined,
    createdAt: r.created_at,
  };
}

export async function createConciliacaoItemDb(item: Omit<ConciliacaoItem, 'id' | 'createdAt'> & { id?: string }) {
  const row: Record<string, unknown> = {
    tipo: item.tipo,
    student_id: item.studentId ?? null,
    student_name: item.studentName,
    ac: item.ac ?? null,
    resumo: item.resumo,
    antes: item.antes ?? {},
    depois: item.depois ?? {},
    autor_id: item.autorId ?? null,
    autor_nome: item.autorNome ?? null,
    autor_observacao: item.autorObservacao ?? null,
    status: item.status ?? 'pendente',
    related_case_id: item.relatedCaseId ?? null,
  };
  if (item.id) row.id = item.id;
  if (item.conciliadoAt) row.conciliado_at = item.conciliadoAt;
  if (item.conciliadoPorId) row.conciliado_por_id = item.conciliadoPorId;
  if (item.conciliadoPorNome) row.conciliado_por_nome = item.conciliadoPorNome;
  if (item.conciliadoNota) row.conciliado_nota = item.conciliadoNota;
  const { data, error } = await supabase.from('conciliacao_items').insert(row).select().single();
  if (error) throw error;
  return rowToConciliacaoItem(data);
}

// Bulk insert (usado para registrar várias baixas Kamino de uma vez no histórico)
export async function createConciliacaoItemsBulkDb(items: Array<Omit<ConciliacaoItem, 'id' | 'createdAt'>>) {
  if (items.length === 0) return [];
  const rows = items.map((item) => {
    const r: Record<string, unknown> = {
      tipo: item.tipo,
      student_id: item.studentId ?? null,
      student_name: item.studentName,
      ac: item.ac ?? null,
      resumo: item.resumo,
      antes: item.antes ?? {},
      depois: item.depois ?? {},
      autor_id: item.autorId ?? null,
      autor_nome: item.autorNome ?? null,
      autor_observacao: item.autorObservacao ?? null,
      status: item.status ?? 'pendente',
      related_case_id: item.relatedCaseId ?? null,
    };
    if (item.conciliadoAt) r.conciliado_at = item.conciliadoAt;
    if (item.conciliadoPorId) r.conciliado_por_id = item.conciliadoPorId;
    if (item.conciliadoPorNome) r.conciliado_por_nome = item.conciliadoPorNome;
    if (item.conciliadoNota) r.conciliado_nota = item.conciliadoNota;
    return r;
  });
  const { data, error } = await supabase.from('conciliacao_items').insert(rows).select();
  if (error) throw error;
  return (data ?? []).map(rowToConciliacaoItem);
}

export async function conciliarItemDb(id: string, patch: { conciliadoPorId?: string; conciliadoPorNome?: string; conciliadoNota?: string }) {
  const { error } = await supabase.from('conciliacao_items').update({
    status: 'conciliado',
    conciliado_at: new Date().toISOString(),
    conciliado_por_id: patch.conciliadoPorId ?? null,
    conciliado_por_nome: patch.conciliadoPorNome ?? null,
    conciliado_nota: patch.conciliadoNota ?? null,
  }).eq('id', id);
  if (error) throw error;
}

// Aprovação intermediária: marca o item como 'aprovado' sem executar as
// alterações. A execução real só ocorre quando o item aprovado for conciliado.
export async function aprovarItemDb(id: string, patch: { aprovadoPorId?: string; aprovadoPorNome?: string; aprovadoNota?: string }) {
  const { error } = await supabase.from('conciliacao_items').update({
    status: 'aprovado',
    aprovado_at: new Date().toISOString(),
    aprovado_por_id: patch.aprovadoPorId ?? null,
    aprovado_por_nome: patch.aprovadoPorNome ?? null,
    aprovado_nota: patch.aprovadoNota ?? null,
  }).eq('id', id);
  if (error) throw error;
}



export async function reprovarItemDb(id: string, patch: { reprovadoPorId?: string; reprovadoPorNome?: string; reprovadoMotivo?: string }) {
  const { error } = await supabase.from('conciliacao_items').update({
    status: 'reprovado',
    reprovado_at: new Date().toISOString(),
    reprovado_por_id: patch.reprovadoPorId ?? null,
    reprovado_por_nome: patch.reprovadoPorNome ?? null,
    reprovado_motivo: patch.reprovadoMotivo ?? null,
  }).eq('id', id);
  if (error) throw error;
}

export async function deleteConciliacaoItemDb(id: string) {
  const { error } = await supabase.from('conciliacao_items').delete().eq('id', id);
  if (error) throw error;
}

/** Remove pendências/aprovados de conciliação vinculados a um caso (ex.: reativação). */
export async function deleteConciliacaoItemsByCaseIdDb(caseId: string) {
  const { error } = await supabase
    .from('conciliacao_items')
    .delete()
    .eq('related_case_id', caseId)
    .in('status', ['pendente', 'aprovado']);
  if (error) throw error;
}

// ─── Notificações por AC (Item 2 — Onda 2) ───────────────────────────────────
export function rowToNotification(r: any): Notification {
  return {
    id: r.id,
    acId: r.ac_id ?? undefined,
    userId: r.user_id ?? undefined,
    type: r.type,
    title: r.title,
    body: r.body ?? undefined,
    meta: r.meta ?? {},
    readAt: r.read_at ?? undefined,
    createdAt: r.created_at,
  };
}

export async function fetchNotificationsDb(opts: { acId?: string; daysBack?: number }): Promise<Notification[]> {
  const days = opts.daysBack ?? 15;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let q = supabase.from('notifications').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(200);
  if (opts.acId) q = q.eq('ac_id', opts.acId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToNotification);
}

export async function createNotificationDb(n: { acId?: string; userId?: string; type: NotificationType; title: string; body?: string; meta?: Record<string, unknown> }): Promise<Notification> {
  const row: Record<string, unknown> = {
    ac_id: n.acId ?? null,
    user_id: n.userId ?? null,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    meta: n.meta ?? {},
  };
  const { data, error } = await supabase.from('notifications').insert(row).select().single();
  if (error) throw error;
  return rowToNotification(data);
}

export async function markNotificationsReadDb(acId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('ac_id', acId)
    .is('read_at', null);
  if (error) throw error;
}

export async function deleteOldNotificationsDb(daysToKeep = 15): Promise<void> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('notifications').delete().lt('created_at', cutoff);
}

// ─── Conciliação: erros de importação Kamino ─────────────────────────────────
export function rowToConciliacaoImportError(r: any): ConciliacaoImportError {
  return {
    id: r.id,
    batchId: r.batch_id,
    fileName: r.file_name ?? undefined,
    rowIndex: r.row_index ?? undefined,
    studentName: r.student_name,
    studentId: r.student_id ?? undefined,
    vencimento: r.vencimento ?? undefined,
    valor: r.valor != null ? Number(r.valor) : undefined,
    dataPagamento: r.data_pagamento ?? undefined,
    motivo: r.motivo,
    raw: r.raw ?? {},
    status: r.status ?? 'pendente',
    resolvidoPorId: r.resolvido_por_id ?? undefined,
    resolvidoPorNome: r.resolvido_por_nome ?? undefined,
    resolvidoAt: r.resolvido_at ?? undefined,
    resolvidoNota: r.resolvido_nota ?? undefined,
    createdAt: r.created_at,
  };
}

export async function createConciliacaoImportErrorsBulkDb(
  errors: Omit<ConciliacaoImportError, 'id' | 'createdAt'>[]
): Promise<ConciliacaoImportError[]> {
  if (errors.length === 0) return [];
  const rows = errors.map((e) => ({
    batch_id: e.batchId,
    file_name: e.fileName ?? null,
    row_index: e.rowIndex ?? null,
    student_name: e.studentName,
    student_id: e.studentId ?? null,
    vencimento: e.vencimento ?? null,
    valor: e.valor ?? null,
    data_pagamento: e.dataPagamento ?? null,
    motivo: e.motivo,
    raw: e.raw ?? {},
    status: e.status ?? 'pendente',
  }));
  const { data, error } = await supabase
    .from('conciliacao_import_errors')
    .insert(rows)
    .select();
  if (error) throw error;
  return (data ?? []).map(rowToConciliacaoImportError);
}

export async function updateConciliacaoImportErrorDb(
  id: string,
  patch: Partial<Pick<ConciliacaoImportError, 'status' | 'resolvidoPorId' | 'resolvidoPorNome' | 'resolvidoAt' | 'resolvidoNota'>>
) {
  const row: any = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.resolvidoPorId !== undefined) row.resolvido_por_id = patch.resolvidoPorId ?? null;
  if (patch.resolvidoPorNome !== undefined) row.resolvido_por_nome = patch.resolvidoPorNome ?? null;
  if (patch.resolvidoAt !== undefined) row.resolvido_at = patch.resolvidoAt ?? null;
  if (patch.resolvidoNota !== undefined) row.resolvido_nota = patch.resolvidoNota ?? null;
  const { error } = await supabase.from('conciliacao_import_errors').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteConciliacaoImportErrorDb(id: string) {
  const { error } = await supabase.from('conciliacao_import_errors').delete().eq('id', id);
  if (error) throw error;
}
