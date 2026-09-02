export type StudentStatus = 'Aluno Novo' | 'Em Dia' | 'Vencido 1' | 'Vencido 2' | 'À Negativar' | 'Negativado' | 'Em Negociação' | 'Excluído' | 'Pago' | 'Pendente' | 'Renda Extra' | 'Cancelado' | 'Solicitação Cancelamento';
export type StatusMode = 'Automático' | 'Manual';

export type RendaExtraStatus = 'Conciliar Exclusão' | 'Disponível Negociação' | 'Em Negociação' | 'Acordo Feito';

// ─── Feature: Motivo de Cancelamento ─────────────────────────────────────────
export type MotivoCancelamento =
  | 'Financeiro'
  | 'Saúde'
  | 'Comprou no Impulso'
  | 'Tempo'
  | 'Insatisfação'
  | 'Outros';

export const MOTIVOS_CANCELAMENTO: MotivoCancelamento[] = [
  'Financeiro',
  'Saúde',
  'Comprou no Impulso',
  'Tempo',
  'Insatisfação',
  'Outros',
];

// ─── Feature: Status de Cancelamento do Aluno ────────────────────────────────
export type StatusCancelamento =
  | 'nenhum'
  | 'solicitado'
  | 'em_tratamento'
  | 'juridico'
  | 'revertido'
  | 'aguardando_conciliacao'      // Cancelado pelo funil, aguardando conciliação contábil
  | 'pagamento_multa_pendente'    // Conciliado manualmente: parcelas baixadas, aguardando pagamento da multa via Kamino
  | 'cancelado';                  // Pagamento da multa baixado: cancelamento totalmente concluído

// ─── Feature: Tipo de Parcela (Recompra/Antecipação) ─────────────────────────
export type TipoParcela = 'propria' | 'antecipada';

export interface Installment {
  number: number;
  dueDate: string;
  value: number;
  paid: boolean;
  paidDate?: string;
  /** Momento em que o pagamento foi registrado no sistema (clique/confirmação). */
  paidMarkedAt?: string;
  paidValue?: number;          // valor efetivamente pago (com juros/desconto). Se ausente ou igual a `value`, considerar pagamento exato.
  // Recompra / Antecipação de Recebíveis
  tipoParcela?: TipoParcela;   // 'propria' (default) | 'antecipada'
  valorReal?: number;          // valor original da parcela
  valorContabil?: number;      // 0 se antecipada (não entra na carteira financeira)
  // Tags por parcela (filtros respeitam a parcela específica, não o aluno todo)
  tags?: string[];
  // Renumeração automática após conciliação: número que a parcela tinha
  // antes da alteração de vencimento (preservado para auditoria).
  numeroOriginal?: number;
  // Observação livre exibida na parcela (ex.: "Antes era Parcela 2").
  observacao?: string;
  /** Crédito de abatimento de outro contrato já aplicado nesta parcela (reduz o saldo em aberto). */
  creditApplied?: number;
}

export interface HistoryEntry {
  date: string;
  type: 'Ligação' | 'WhatsApp' | 'E-mail' | 'Sistema';
  text: string;
  /** Comprovantes anexados pelo AC (ex.: comprovante de PIX). */
  attachments?: CaseNoteAttachment[];
  /** Marcado quando o AC enviou o registro para a Conciliação (com data ISO). */
  sentToConciliacaoAt?: string;
  /** Nome de quem enviou para a Conciliação. */
  sentToConciliacaoBy?: string;
}

export interface Student {
  id: string;
  name: string;
  whatsapp: string;
  email?: string;
  cpf: string;
  address: string;
  numero: string;
  cidade: string;
  estado: string;
  cep: string;
  status: StudentStatus;
  statusMode: StatusMode;
  ac: string;
  product: string;
  enrollmentDate: string;
  // Data do treinamento de origem — NÃO muda mesmo se o aluno troca de turma
  data_treinamento_origem?: string;
  dueDay: number;
  saleValue: number;
  downPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  installmentValue: number;
  installments: Installment[];
  history: HistoryEntry[];
  isRendaExtra?: boolean;
  rendaExtraStatus?: RendaExtraStatus;
  rendaExtraAC?: string;
  rendaExtraACAssignedAt?: string;
  rendaExtraInclusionDate?: string;
  rendaExtraInscriptionDate?: string;
  rendaExtraAcordoValue?: number;
  // Renda Extra: pagamento agendado (aluno fica "Em Negociação • Aguardando Pagamento")
  rendaExtraPaymentDate?: string; // YYYY-MM-DD
  rendaExtraPaymentMethod?: 'pix' | 'link'; // forma de pagamento
  // Feature: Cancelamento espelho (aluno permanece na carteira)
  statusCancelamento?: StatusCancelamento;
  cancellationCaseId?: string; // link para o CancellationCase espelho
  statusAntesCancelamento?: StudentStatus; // status financeiro anterior ao solicitar cancelamento

  // Feature: Múltiplos cursos/treinamentos
  productHistory?: Array<{
    product: string;
    enrollmentDate: string;
    status: 'ativo' | 'cancelado' | 'concluído';
  }>;
  // Feature: Rastreamento de Renda Extra
  rendaExtraDirectedAt?: string; // data quando foi direcionado para Renda Extra
  rendaExtraValueAtDirection?: number; // valor na carteira quando foi direcionado
  // Feature: Tags customizáveis
  tags?: string[]; // array de tag IDs
  // Campo livre de observações (importado da coluna "Detalhe" do Kamino)
  detalhes?: string;
  // Ciclo / safra do contrato (ex.: "2026", "2027", "Ano 1"). Permite que o mesmo
  // aluno tenha múltiplos contratos independentes (ex.: renovação anual Liberty).
  // Cada ciclo é uma ficha separada com seu próprio fluxo de pagamento.
  ciclo?: string;
  /** Preenchido pela sync Kamino — aluno entra na carteira financeira principal. */
  kaminoSyncedAt?: string;
  /**
   * Fichas de Recompra (Fundo): treinamento ao qual a recompra se refere.
   * NULL/undefined = aguardando vínculo no card "Recompras" da Conciliação.
   */
  recompraTreinamento?: string;
  // Integração IAM Control (somente leitura — nunca editável pela interface)
  iamControlAlunoId?: number;
  iamControlSyncedAt?: string;
  iamControlContratoId?: string;
  iamControlContratoStatus?: string;
  iamControlPendenteTipo?: 'LINK' | 'PIX';
  iamControlPendenteLink?: string;
  /** Aprovado na Conciliação GC — passa a contar nos totais financeiros. */
  iamGcConciliadoAt?: string;
}

export interface AC {
  id: string;
  name: string;
  active: boolean;
  photo?: string;
  /** Usado na ordenação da esteira de distribuição automática. */
  createdAt?: string;
  /** Metas de reversão individualizadas (% sobre inscrições p/ cancelamento).
   *  Se ausentes, o app usa `rules.meta1/meta2/meta3` (global). */
  meta1?: number;
  meta2?: number;
  meta3?: number;
}

export interface Product {
  id: string;
  name: string;
  value?: number;
}

// ─── Feature: Tags customizáveis para Alunos ────────────────────────────────
export type TagScope = 'student' | 'cancellation';

export interface StudentTag {
  id: string;
  name: string;
  color: string; // tailwind color key, e.g. 'blue', 'red', 'green', 'purple', 'orange', 'pink', 'yellow', 'slate'
  scope?: TagScope; // 'student' (default) ou 'cancellation' (somente aba Cancelamentos)
}

export interface FinancialRules {
  multaPercent: number;
  jurosPercent: number;
  descontoRendaExtra: number;
  maxParcelasRenegociacao: number;
  maxParcelasCadastro: number; // limite máximo de parcelas ao cadastrar aluno
  /** Meta nível 1 (%) — abaixo disso, AC não bateu meta */
  meta1: number;
  /** Meta nível 2 (%) */
  meta2: number;
  /** Meta nível 3 (%) — meta máxima */
  meta3: number;
  /** Metas de reversão (%) — usadas no gauge de reversão em Comissões.
   *  Se ausentes, o app usa `meta1/meta2/meta3` (liquidez). */
  metaReversao1?: number;
  metaReversao2?: number;
  metaReversao3?: number;
  /** Multa (%) quando cancelamento é pedido com MAIS de 30 dias de antecedência do evento */
  multaCancelamentoComAntecedencia: number;
  /** Multa (%) quando cancelamento é pedido com MENOS de 30 dias de antecedência do evento */
  multaCancelamentoSemAntecedencia: number;
}

export type TabKey = 'dashboard' | 'alunos' | 'regua' | 'configUsuarios' | 'equipe' | 'rendaExtra' | 'config' | 'perfil' | 'ac' | 'cancelamentos' | 'comissoes' | 'estornos' | 'ranking' | 'conciliacao' | 'extrato' | 'registros' | 'documentos';

// ─── Feature: Antecipação (módulo isolado por AC) ────────────────────────────
export type AntecipacaoOrigem = 'Banco' | 'Sicoob' | 'Fundo';
export type AntecipacaoStatus = 'Vencido 1' | 'Vencido 2';

export interface AntecipacaoItem {
  id: string;
  acId: string;          // vínculo com o Assessor de Conta
  nome: string;
  whatsapp: string;
  dataVencimento: string; // YYYY-MM-DD
  origem: AntecipacaoOrigem;
  createdAt: string;      // YYYY-MM-DD (data de inclusão)
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'ac' | 'acn2' | 'juridico' | 'conciliacao';

// Permissão por aba: 'none' = sem acesso, 'view' = só ver, 'edit' = ver e editar,
// 'own' = ver apenas os próprios dados (usado hoje apenas na aba Comissões).
export type PermissionLevel = 'none' | 'view' | 'edit' | 'own';

// Abas que podem ser permissionadas (perfil é sempre liberado)
export type PermissionTab = 'dashboard' | 'alunos' | 'equipe' | 'rendaExtra' | 'cancelamentos' | 'comissoes' | 'estornos' | 'conciliacao' | 'documentos' | 'config' | 'admin';

export type UserPermissions = Partial<Record<PermissionTab, PermissionLevel>>;

export const PERMISSION_TABS: { key: PermissionTab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'alunos', label: 'Alunos' },
  { key: 'equipe', label: 'Equipe' },
  { key: 'rendaExtra', label: 'Renda Extra' },
  { key: 'cancelamentos', label: 'Cancelamentos' },
  { key: 'comissoes', label: 'Comissões' },
  { key: 'estornos', label: 'Estornos' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'config', label: 'Configurações' },
  { key: 'admin', label: 'Admin' },
];


export interface AppUser {
  id: string;
  name: string;
  login: string;
  /**
   * Senha em texto puro foi REMOVIDA. As senhas agora são gerenciadas
   * pelo Supabase Auth (bcrypt). Esse campo é mantido como opcional apenas
   * para o formulário de criação/edição enviar a senha à edge function.
   */
  password?: string;
  role: UserRole;
  acId?: string | null;
  photo?: string;
  permissions?: UserPermissions;
  canConfirmarPagamento?: boolean;
  /** ID em auth.users — preenchido após login. */
  authUserId?: string;
  /** IDs das empresas que este usuário pode acessar (multi-tenant). */
  companyIds?: string[];
  /** Vínculo de Assessor de Conta por empresa. */
  perCompanyAcIds?: Record<string, string | null>;
}

// Helpers de permissão (derivam de permissions; com fallback no role legado)
export function getEffectivePermissions(user: AppUser | null | undefined): UserPermissions {
  if (!user) return {};
  // Admin sempre tem acesso total a todas as abas (mesmo que permissions
  // salvas em banco estejam desatualizadas e não contenham abas novas).
  if (user.role === 'admin') {
    // Admin tem acesso total a todas as abas funcionais; a chave 'admin'
    // (permissão master) vem do que está salvo em permissions.
    const stored = user.permissions || {};
    return {
      dashboard: 'edit', alunos: 'edit', equipe: 'edit', rendaExtra: 'edit',
      cancelamentos: 'edit', comissoes: 'edit', estornos: 'edit', conciliacao: 'edit',
      documentos: 'edit', config: 'edit',
      admin: stored.admin ?? 'edit',
    };
  }

  // Role 'conciliacao' sempre vê a aba Conciliação, mesmo se permissions
  // salvas não tiverem a chave (retrocompatibilidade com usuários antigos).
  if (user.role === 'conciliacao') {
    return { ...(user.permissions || {}), conciliacao: 'edit' };
  }
  if (user.permissions) {
    // Jurídico antigo sem chave documentos: libera edição de modelos.
    if (user.role === 'juridico' && !user.permissions.documentos) {
      return { ...user.permissions, documentos: 'edit' };
    }
    return user.permissions;
  }
  // Fallback derivado do role (retrocompatibilidade)
  switch (user.role) {
    case 'ac':
      return { equipe: 'edit', rendaExtra: 'edit' };
    case 'acn2':
      return { equipe: 'edit', rendaExtra: 'edit', cancelamentos: 'edit' };
    case 'juridico':
      return { cancelamentos: 'edit', documentos: 'edit' };
    default:
      return {};
  }
}

export function canViewTab(user: AppUser | null | undefined, tab: PermissionTab): boolean {
  const lvl = getEffectivePermissions(user)[tab];
  return lvl === 'view' || lvl === 'edit' || lvl === 'own';
}

export function canEditTab(user: AppUser | null | undefined, tab: PermissionTab): boolean {
  return getEffectivePermissions(user)[tab] === 'edit';
}

/** Gerenciar usuários e permissões (Configurações → Controle de Acesso). */
export function canManageUsers(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return getEffectivePermissions(user).admin === 'edit';
}

/**
 * Escopo do usuário na aba Comissões:
 * - 'all'  → vê todas as comissões (view/edit)
 * - 'own'  → vê apenas as próprias comissões (permissão "Apenas visualizar sua comissão")
 * - 'none' → sem acesso
 */
export function getComissoesScope(user: AppUser | null | undefined): 'all' | 'own' | 'none' {
  const lvl = getEffectivePermissions(user)['comissoes'];
  if (lvl === 'own') return 'own';
  if (lvl === 'view' || lvl === 'edit') return 'all';
  return 'none';
}

/**
 * Retorna true se o usuário pode confirmar pagamentos (parcelas pagas,
 * quitação, acordo de Renda Extra). Admin sempre pode; demais usuários
 * precisam do toggle explícito habilitado em Configurações.
 */
export function canConfirmarPagamento(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.canConfirmarPagamento === true;
}

// ─── Cancelamentos ────────────────────────────────────────────────────────────

export type CancellationStage =
  // Fase 1 – Jurídico
  | 'Aguardando Contato'
  | 'Em Contato'
  | 'Orientações (Jurídico)'
  | 'Confeccionar Termo'
  | 'Assinar Termo'
  // Fase 2 – Financeiro / Boleto
  | 'Ajustes em Geral / Boleto'
  | 'Cancelamento de Boleto'
  // Fase 3 – Desfecho
  | 'Recuperado'
  | 'Início do Estorno'
  | 'Estorno em Andamento'
  | 'Cancelado'
  // Fase 4 – Pós-Cancelamento
  | 'Saldo a Receber - Sem Resposta'
  | 'PROCON ou Judicial'
  | 'Iniciar Negativação'
  | 'Negativação Efetivada'
  | 'Pagando Parcelado (Negativado)'
  | 'Negativação Retirada';

// ─── Feature: Novo Funil de Cancelamento ─────────────────────────────────────
// Ordem exibida: Entrada → Em Execução (label "Em Tratativas") → Formalização
// (label "Distrato do Contrato") → Pendente → Finalizado
export type FunnelStage = 'Entrada' | 'Em Execução' | 'Formalização' | 'Pendente' | 'Finalizado';

export type CancellationAction =
  | 'Aguardando Contato'
  | 'Em Contato'
  | 'Conversa WhatsApp'
  | 'Ligação Agendada'
  | 'Enviar Proposta ao Aluno'
  | 'Proposta Enviada (cobrar retorno)'
  | 'Aguardando Retorno Aluno'
  | 'Iniciar Tratativa'
  | 'Em Tratativa'
  | 'Cobrar Informação ou Pagamento'
  | 'Ajustes Financeiros'
  | 'Cancelamento de Boletos'
  | 'Fazer Estorno'
  | 'Confeccionar Termo'
  | 'Em Assinatura'
  | 'Assinar Termo'
  | 'Renegociação Jurídico'
  | 'Conciliação Reprovada'
  | 'Corrigir por Erro'
  | 'Procon'
  | 'Processo Judicial'
  | 'Cancelado'
  | 'Revertido';


export type CancellationResponsavel = 'Jurídico' | 'Financeiro';

export type CancellationOperationalStatus =
  | 'Sem contato'
  | 'Em contato'
  | 'Negociando'
  | 'Aguardando'
  | 'Jurídico'
  | 'Recuperado'
  | 'Cancelado';

export interface CancellationHistoryEntry {
  date: string;
  from: CancellationStage;
  to: CancellationStage;
  operationalStatus?: CancellationOperationalStatus;
  note?: string;
  /** Quem registrou a alteração (nome do usuário logado). */
  byName?: string;
  /** Id do usuário que registrou a alteração. */
  byUserId?: string;
}

// ─── Checklist final (Distrato → Finalizado, respondido pelo Jurídico) ───────
export interface CancellationFinalChecklist {
  cancelamentoBoleto?: boolean;              // Sim / Não
  cancelamentoBonus?: boolean;               // Sim / Não (retirar acesso dos bônus)
  retirarAlunoTurma?: boolean;               // Padrão: Sim
  multaRecebida?: boolean;                   // Sim / Não (conciliar)
  fazerEstorno?: boolean;                    // Sim / Não
  negativarAluno?: boolean;                  // Sim / Não
  negativarValor?: number;                   // valor a negativar (só se negativarAluno=true)
  liberarTreinamentoOnline?: boolean;        // Sim / Não
  termoUrl?: string;                         // link do termo anexado (storage)
  observacoes?: string;                      // livre
  preenchidoPorId?: string;
  preenchidoPorNome?: string;
  preenchidoAt?: string;
  // Confirmação de conciliação (feita por quem concilia — Admin/Conciliação)
  conciliadoBoletos?: boolean;               // "Você cancelou os boletos?"
  conciliadoPorId?: string;
  conciliadoPorNome?: string;
  conciliadoAt?: string;
}

export type PagamentoTipo = 'Pix' | 'Cartão de Crédito' | 'Boleto' | 'Outro';

export type RefundPaymentMethod = 'pix' | 'boleto';

export type RefundPixKeyType = 'CPF' | 'CNPJ' | 'Email' | 'Telefone' | 'Aleatória';

export interface RefundPlanLogEntry {
  action: string;
  at: string;
  byName: string;
  byUserId?: string | null;
  detail?: string;
}

export interface RefundPlanInstallment {
  date: string;
  value: number;
  /** Dados do estorno específicos desta parcela, quando diferentes do plano geral. */
  refundOverrides?: {
    studentName?: string;
    ac?: string;
    product?: string;
    quantidadeInscricoes?: number;
    totalValue?: number;
    paymentMethod?: RefundPaymentMethod;
    pixKeyType?: RefundPixKeyType;
    pixKey?: string;
  };
  lancadoParaPagamento?: boolean;
  lancadoAt?: string;
  lancadoPorNome?: string;
  lancadoPorUserId?: string | null;
  lancadoLog?: Array<{ action: string; at: string; byName: string; byUserId?: string | null }>;
  /** PDF/imagem do boleto desta parcela (path no bucket cancellation-docs) */
  boletoFileUrl?: string;
  boletoFileName?: string;
  boletoUploadedAt?: string;
  boletoUploadedByNome?: string;
}

export interface RefundPlan {
  /** Método de pagamento do estorno; padrão PIX quando ausente (planos antigos). */
  paymentMethod?: RefundPaymentMethod;
  pixKey: string;
  pixKeyType: RefundPixKeyType;
  /** true = chave PIX de terceiro (não do aluno). */
  pixOtherHolder?: boolean;
  /** Nome do titular da chave quando `pixOtherHolder`. */
  pixHolderName?: string;
  /** Telefone do titular da chave quando `pixOtherHolder`. */
  pixHolderPhone?: string;
  totalValue: number;
  installments: RefundPlanInstallment[];
  createdAt: string;
  planLog?: RefundPlanLogEntry[];
}

export function refundPaymentMethodLabel(method?: RefundPaymentMethod | null): string {
  return method === 'boleto' ? 'Boleto' : 'PIX';
}

export function resolveRefundPaymentMethod(plan?: Pick<RefundPlan, 'paymentMethod'> | null): RefundPaymentMethod {
  return plan?.paymentMethod === 'boleto' ? 'boleto' : 'pix';
}

export interface CancellationCase {
  id: string;
  studentName: string;
  studentId?: string;
  studentWhatsapp?: string; // WhatsApp do aluno para contato rápido
  ac: string;
  stage: CancellationStage;
  operationalStatus: CancellationOperationalStatus;
  value?: number;
  createdAt: string;
  movedToCurrentStageAt: string;
  notes: string;
  history: CancellationHistoryEntry[];
  // Feature: Motivo de cancelamento estruturado
  motivoCancelamento?: MotivoCancelamento;
  descricaoCancelamento?: string;
  // Feature: Novo funil de cancelamento
  funnelStage?: FunnelStage;
  acao?: CancellationAction;
  responsavel?: CancellationResponsavel;
  // Feature: espelho do aluno (aluno permanece na carteira)
  isMirror?: boolean;
  // Feature: Termo de cancelamento
  termTemplate?: string; // conteúdo do termo pré-preenchido
  termSignedAt?: string; // data de assinatura do termo
  termSignedByStudent?: boolean;
  termAttachments?: Array<{
    name: string;
    url: string;
    uploadedAt: string;
    type: 'termo_assinado' | 'print' | 'outro';
  }>;
  // Tags do setor de cancelamento
  tags?: string[];
  // Revisão financeira: parcelas mantidas como multa antes da conciliação
  cancellationFineValue?: number;
  cancellationReviewedInstallments?: Installment[];

  // ─── NOVOS CAMPOS (fluxo de perguntas e cálculo de multa) ──────────────────
  /** Cancelamento pedido dentro do prazo de 7 dias do contrato (arrependimento) */
  dentro7Dias?: boolean;
  /** Cancelamento pedido com >30 dias de antecedência da data do evento */
  com30DiasAntecedencia?: boolean;
  /** Data do primeiro dia do evento/treinamento (YYYY-MM-DD) */
  dataEvento?: string;
  /** Percentual de multa calculado (30% ou 40%) */
  multaPercent?: number;
  /** Valor da multa em R$ (contractTotal * multaPercent / 100) */
  multaValue?: number;
  /** Total já pago pelo aluno no Kamino no momento da solicitação (informado pelo AC) */
  totalPagoAteMomento?: number;
  /** Quantidade de inscrições que compõem o contrato (informada pelo AC) */
  quantidadeInscricoes?: number;
  /** Treinamento do contrato (usado quando o caso não está vinculado a um aluno cadastrado) */
  treinamento?: string;
  /** Forma de pagamento do contrato original */
  pagamentoTipo?: PagamentoTipo;
  /** URL/path no storage do PDF do contrato (bucket cancellation-docs) */
  contractPdfUrl?: string;
  /** Caso criado via "Importar Aluno Cancelamento" (contrato pago à vista — PIX/Cartão). Não impacta carteira. */
  externalImport?: boolean;
  /** Data/hora de ligação agendada (ISO) — usado na etapa "Em Tratativas" */
  ligacaoAgendadaAt?: string;
  /** Checklist respondido ao mover para Finalizado */
  finalChecklist?: CancellationFinalChecklist;
  /** Qtd de inscrições já revertidas (para suportar reversão parcial em contratos multi-inscrição) */
  inscricoesRevertidas?: number;
  /** Plano de estorno ao aluno quando saldo final é negativo (multa < pago) */
  refundPlan?: RefundPlan;
  /** Última reprovação da Conciliação vinculada a este caso (motivo preenchido pelo revisor) */
  conciliacaoReprovadaMotivo?: string;
  conciliacaoReprovadaAt?: string;
  conciliacaoReprovadaPorNome?: string;
  /** Anotações internas do Jurídico sobre o cancelamento */
  legalNotes?: string;
  legalNotesUpdatedAt?: string;
  /** Observações manuais registradas na visualização do caso (Pendente / Finalizado). */
  caseNotes?: CaseNote[];
  /** Abatimento do saldo a devolver aplicado em outro contrato */
  abatimento?: AbatimentoInfo;
}

/** Abatimento do saldo a devolver do cancelamento no contrato de outro aluno */
export interface AbatimentoInfo {
  valor: number;
  studentId: string;
  studentName: string;
  product?: string | null;
  saldoAntes: number;
  saldoDepois: number;
  /** Saldo a devolver antes do abatimento */
  estornoBruto: number;
  /** Saldo que ainda será estornado via PIX após o abatimento */
  estornoRestante: number;
  appliedAt: string;
}

export interface CaseNoteAttachment {
  name: string;
  url: string;          // path no bucket cancellation-docs
  size: number;         // bytes
  mime?: string;
  uploadedAt: string;
}

export interface CaseNote {
  id: string;
  text: string;
  authorId?: string | null;
  authorName?: string;
  createdAt: string;
  attachments?: CaseNoteAttachment[];
}

// ─── Conciliação contábil (espelho de alterações para reconciliar com Kamino) ─
export type ConciliacaoTipo =
  | 'parcela_quantidade'   // total de parcelas alterado (renegociação, etc.)
  | 'parcela_valor'        // valor de uma parcela alterado
  | 'parcela_vencimento'   // data de vencimento alterada
  | 'pagamento_parcela'    // baixa manual de parcela (aguarda confirmação do setor)
  | 'quitacao'             // contrato pago integralmente
  | 'renegociacao'         // renegociação completa em RASCUNHO — só efetiva ao conciliar
  | 'cancelamento'         // caso de cancelamento finalizado (Cancelado)
  | 'reversao'             // cancelamento revertido (nova negociação)
  | 'renda_extra_exclusao' // aluno migrado para Renda Extra — precisa conciliar exclusão no Kamino
  | 'renda_extra_acordo'   // acordo de quitação fechado em Renda Extra (com desconto) — conciliar baixa bancária
  | 'baixa_kamino'         // parcela baixada via importação Kamino → GC (histórico)
  | 'encargo_aplicado'     // encargo (multa/juros) declarado pelo AC ao alterar parcelas
  | 'correcao_contrato'    // correção de erro de registro no saleValue (com justificativa)
  | 'iam_pendente'         // import IAM com contrato PENDENTE — aguarda aprovação p/ CONCILIADO
  | 'recompra_vinculo';    // ficha de Recompra aguardando vínculo com o treinamento de origem

export type ConciliacaoStatus = 'pendente' | 'aprovado' | 'conciliado' | 'reprovado';

export interface ConciliacaoItem {
  id: string;
  tipo: ConciliacaoTipo;
  studentId?: string;
  studentName: string;
  ac?: string;
  resumo: string;            // texto curto exibido na lista
  antes: Record<string, unknown>;  // estado anterior (campos relevantes)
  depois: Record<string, unknown>; // estado novo
  autorId?: string;
  autorNome?: string;
  // Observação livre escrita pelo autor do ajuste para quem vai conciliar
  autorObservacao?: string;
  status: ConciliacaoStatus;
  // Aprovação intermediária (entre pendente e conciliado): o item foi
  // validado mas as alterações ainda NÃO foram executadas. A execução
  // ocorre quando alguém concilia esse item já aprovado.
  aprovadoAt?: string;
  aprovadoPorId?: string;
  aprovadoPorNome?: string;
  aprovadoNota?: string;
  conciliadoAt?: string;
  conciliadoPorId?: string;
  conciliadoPorNome?: string;
  conciliadoNota?: string;
  // Reprovação (Item 3 — Onda 2)
  reprovadoAt?: string;
  reprovadoPorId?: string;
  reprovadoPorNome?: string;
  reprovadoMotivo?: string;
  relatedCaseId?: string;    // se vier de um cancelamento/reversão
  createdAt: string;
}


// ─── Notificações por AC (Item 2 — Onda 2) ───────────────────────────────────
export type NotificationType =
  | 'vencimento_hoje'         // valor que vence hoje na carteira do AC
  | 'conciliacao_pre_aprovada' // ajuste passou pela 1ª aprovação (ainda não conciliado)
  | 'conciliacao_aprovada'    // ajuste do AC foi conciliado
  | 'conciliacao_reprovada'   // ajuste do AC foi reprovado
  | 'renda_extra'             // mudanças em RE
  | 'sistema';                // genérico

export interface Notification {
  id: string;
  acId?: string;       // notificação direcionada a um AC
  userId?: string;     // ou direcionada a um usuário específico
  type: NotificationType;
  title: string;
  body?: string;
  meta: Record<string, unknown>;  // ex: { studentId, conciliacaoItemId } para clique
  readAt?: string;
  createdAt: string;
}

// ─── Importação Kamino → Conciliação de Pagamentos ───────────────────────────
// Linhas que falharam o match de pagamento ficam aqui para revisão manual.
export type ConciliacaoImportErrorMotivo =
  | 'aluno_nao_encontrado'        // nome não bateu com nenhum aluno
  | 'multiplos_alunos'             // nome bateu com 2+ alunos (ambíguo)
  | 'parcela_nao_encontrada'       // aluno achado, mas vencimento não bate com nenhuma parcela
  | 'valor_diverge'                // vencimento bateu, mas valor é diferente
  | 'vencimento_diverge'           // valor bateu, mas vencimento é diferente (escolher: trocar data ou manter)
  | 'parcela_ja_paga'              // parcela existe e já estava marcada como paga
  | 'sem_pagamento';               // linha sem data/valor de pagamento

export type ConciliacaoImportErrorStatus = 'pendente' | 'resolvido' | 'ignorado';

export interface ConciliacaoImportError {
  id: string;
  batchId: string;
  fileName?: string;
  rowIndex?: number;
  studentName: string;
  studentId?: string;
  vencimento?: string;       // YYYY-MM-DD
  valor?: number;
  dataPagamento?: string;    // YYYY-MM-DD
  motivo: ConciliacaoImportErrorMotivo;
  raw: Record<string, unknown>;
  status: ConciliacaoImportErrorStatus;
  resolvidoPorId?: string;
  resolvidoPorNome?: string;
  resolvidoAt?: string;
  resolvidoNota?: string;
  createdAt: string;
}

export interface ConciliacaoImportSummary {
  batchId: string;
  fileName: string;
  totalRows: number;
  pagas: number;          // parcelas baixadas com sucesso
  jaPagas: number;        // já estavam pagas (no-op)
  semPagamento: number;   // linhas sem Recebimento/Valor Recebido
  erros: number;          // foram para a aba de erros
}
