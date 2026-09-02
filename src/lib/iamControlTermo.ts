import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/store/useAppStore';
import type { CancellationCase, Student } from '@/types';
import {
  buildCancellationTermoDocument,
  buildCancellationTermoInputFromCase,
  cancellationTermoToPlainText,
  type CancellationTermoDocument,
} from '@/lib/cancellationTermoDocument';

export interface IamTermoTemplate {
  id: string;
  nome: string;
  clausulas: string;
}

export interface IamTermoCreateResult {
  ok: boolean;
  id?: string;
  nome_documento?: string;
  status?: string;
  url_assinatura?: string;
  file_url?: string;
  signers?: Array<{
    nome: string;
    email: string;
    status: string;
    tipo: 'sign' | 'witness';
  }>;
  created_at?: string;
  error?: string;
  detalhe?: string;
}

export interface BuildCancelamentoTermoInput {
  student: Pick<Student, 'iamControlAlunoId' | 'name' | 'product' | 'cpf' | 'saleValue' | 'email' | 'whatsapp'>;
  caseRef: Pick<
    CancellationCase,
    | 'studentName'
    | 'studentWhatsapp'
    | 'motivoCancelamento'
    | 'descricaoCancelamento'
    | 'notes'
    | 'legalNotes'
    | 'quantidadeInscricoes'
    | 'treinamento'
    | 'multaPercent'
    | 'refundPlan'
  >;
  fineValue: number;
  totalPaid: number;
  totalContract: number;
  balance: number;
  templateId?: string;
  semMultaCDC7?: boolean;
  /** Documento já montado (preview). Se omitido, é gerado a partir dos campos. */
  document?: CancellationTermoDocument;
  multaPercent?: number;
  estornoTotal?: number;
}

function formatBalance(balance: number): string {
  if (Math.abs(balance) < 0.01) return 'Quitado';
  if (balance > 0) return `Aluno deve pagar ${formatCurrency(balance)}`;
  return `Devolver ao aluno ${formatCurrency(Math.abs(balance))}`;
}

export function buildCancelamentoTermoPayload(input: BuildCancelamentoTermoInput) {
  const semMulta = !!input.semMultaCDC7;
  const estornoTotal =
    input.estornoTotal ?? (input.balance < 0 ? Math.abs(input.balance) : 0);
  const multaPercent = input.multaPercent ?? input.caseRef.multaPercent ?? 0;

  const doc =
    input.document ??
    buildCancellationTermoDocument(
      buildCancellationTermoInputFromCase({
        caseRef: input.caseRef,
        student: input.student,
        semMultaCDC7: semMulta,
        multaPercent,
        multaValue: input.fineValue,
        totalPago: input.totalPaid,
        estornoTotal,
      }),
    );

  const plain = cancellationTermoToPlainText(doc);
  const motivo = input.caseRef.motivoCancelamento || input.caseRef.descricaoCancelamento || input.caseRef.notes || '';

  const observacoes = [
    plain,
    motivo ? `\nMotivo informado: ${motivo}` : '',
    input.caseRef.legalNotes?.trim() ? `\nObservações jurídicas: ${input.caseRef.legalNotes.trim()}` : '',
  ]
    .filter(Boolean)
    .join('');

  const textoIntroducao = semMulta
    ? 'Pelo presente instrumento, as partes formalizam o cancelamento sem multa rescisória, nos termos do art. 49 do CDC (prazo de reflexão de 7 dias).'
    : 'Pelo presente instrumento, as partes formalizam o cancelamento com aplicação de multa rescisória e eventual estorno, conforme contrato e legislação aplicável.';

  return {
    termo_titulo: `${doc.titulo} — ${input.caseRef.studentName}`,
    texto_introducao: textoIntroducao,
    observacoes,
    local_assinatura: 'Americana/SP',
    template_id: input.templateId,
    campos_variaveis: {
      valor_contrato: formatCurrency(input.totalContract),
      valor_pago: formatCurrency(input.totalPaid),
      valor_multa: semMulta ? 'R$ 0,00 (isento CDC 7 dias)' : formatCurrency(input.fineValue),
      percentual_multa: semMulta ? '0%' : `${multaPercent}%`,
      saldo_final: formatBalance(input.balance),
      estorno: formatCurrency(estornoTotal),
      produto: input.student.product ?? input.caseRef.treinamento ?? '',
      qtd_inscricoes: String(input.caseRef.quantidadeInscricoes ?? 1),
      motivo_cancelamento: motivo,
      variante: doc.variant,
      nome_aluno: doc.studentName,
      cpf: doc.cpf,
      email: doc.email,
      whatsapp: doc.whatsapp,
      chave_pix: input.caseRef.refundPlan?.pixKey ?? '',
      tipo_pix: input.caseRef.refundPlan?.pixKeyType ?? '',
    },
  };
}

export async function listIamTermoTemplates(): Promise<IamTermoTemplate[]> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; templates?: IamTermoTemplate[]; error?: string }>(
    'iam-control-termo',
    { body: { action: 'list_templates' } },
  );

  if (error) throw new Error(error.message || 'Falha ao listar templates de termo.');
  if (!data?.ok) throw new Error(data?.error || 'Não foi possível listar templates de termo.');
  return data.templates ?? [];
}

export interface BuildAditivoTermoInput {
  student: Pick<Student, 'iamControlAlunoId' | 'name' | 'product' | 'cpf' | 'saleValue' | 'whatsapp' | 'email' | 'enrollmentDate'>;
  originalValues: {
    valorVenda: number;
    entrada: number;
    parcelasOriginais: number;
  };
  newValues: {
    novoSaldo: number;
    multaAplicada: number;
    jurosAplicados: number;
    novaEntrada: number;
    novasParcelas: number;
    novoValorParcela: number;
    saldoAposEntrada?: number;
    primeiraParcelaVencimento?: string;
    taxaJurosMes?: number;
    qtdParcelasAberto?: number;
    totalPago?: number;
    quantidadeInscricoes?: number;
    diaVencimento?: number;
    dataEntrada?: string;
    parcelamentoLines?: string[];
  };
  templateId?: string;
}

export function buildAditivoTermoPayload(input: BuildAditivoTermoInput) {
  const totalComEncargos =
    input.newValues.novoSaldo + input.newValues.multaAplicada + input.newValues.jurosAplicados;
  const saldoAposEntrada =
    input.newValues.saldoAposEntrada ??
    Math.max(0, totalComEncargos - input.newValues.novaEntrada);
  const totalAposReneg = input.newValues.novaEntrada + saldoAposEntrada;
  const totalPago = input.newValues.totalPago ?? 0;
  const taxaJuros = input.newValues.taxaJurosMes ?? 0;
  const qtdParcelasAberto = input.newValues.qtdParcelasAberto ?? input.newValues.novasParcelas;
  const parcelamento =
    (input.newValues.parcelamentoLines ?? []).join('\n') ||
    `${input.newValues.novasParcelas}x de ${formatCurrency(input.newValues.novoValorParcela)}`;

  const observacoes = [
    'TERMO DE RENEGOCIAÇÃO',
    `Aluno: ${input.student.name}`,
    `CPF/CNPJ: ${input.student.cpf ?? ''}`,
    `WhatsApp: ${input.student.whatsapp ?? ''}`,
    `E-mail: ${input.student.email ?? ''}`,
    input.student.product ? `Treinamento: ${input.student.product}` : '',
    `Total contratado: ${formatCurrency(input.originalValues.valorVenda)}`,
    `Total pago até o momento: ${formatCurrency(totalPago)}`,
    `Saldo em aberto: ${formatCurrency(input.newValues.novoSaldo)}`,
    `Parcelas em aberto: ${qtdParcelasAberto}`,
    `Total a ser pago após a renegociação: ${formatCurrency(totalAposReneg)}`,
    input.newValues.novaEntrada > 0.0049
      ? `Entrada: ${formatCurrency(input.newValues.novaEntrada)}${input.newValues.dataEntrada ? ` em ${input.newValues.dataEntrada}` : ''}`
      : 'Entrada: R$ 0,00',
    input.newValues.primeiraParcelaVencimento
      ? `1º vencimento: ${input.newValues.primeiraParcelaVencimento} (demais no dia ${input.newValues.diaVencimento ?? '—'})`
      : '',
    `Novo parcelamento:\n${parcelamento}`,
    `Taxa de juros aplicada ao mês: ${taxaJuros.toLocaleString('pt-BR')}%`,
    'Permanecem vigentes as demais cláusulas do contrato principal naquilo que não estiver disposto neste termo.',
  ]
    .filter(Boolean)
    .join('\n');

  const textoIntroducao =
    'Pelo presente instrumento, o(a) ALUNO(A) e o INSTITUTO ACADEMY MIND TREINAMENTOS LTDA (CNPJ 03.727.532/0001-13) ' +
    'ajustam sua relação contratual, formalizando a renegociação do montante pendente de pagamento, ' +
    'permanecendo vigentes as demais cláusulas do contrato principal.';

  return {
    termo_titulo: `Termo de Renegociação — ${input.student.name}`,
    texto_introducao: textoIntroducao,
    observacoes,
    local_assinatura: 'Americana/SP',
    template_id: input.templateId,
    campos_variaveis: {
      nome_completo: input.student.name,
      cpf_cnpj: input.student.cpf ?? '',
      whatsapp: input.student.whatsapp ?? '',
      email: input.student.email ?? '',
      treinamento: input.student.product ?? '',
      total_contratado: formatCurrency(input.originalValues.valorVenda),
      total_pago: formatCurrency(totalPago),
      saldo_em_aberto: formatCurrency(input.newValues.novoSaldo),
      qtd_parcelas_aberto: String(qtdParcelasAberto),
      total_apos_renegociacao: formatCurrency(totalAposReneg),
      nova_entrada: formatCurrency(input.newValues.novaEntrada),
      data_entrada: input.newValues.dataEntrada ?? '',
      primeiro_vencimento: input.newValues.primeiraParcelaVencimento ?? '',
      dia_vencimento: String(input.newValues.diaVencimento ?? ''),
      novas_parcelas: String(input.newValues.novasParcelas),
      valor_parcela: formatCurrency(input.newValues.novoValorParcela),
      parcelamento: parcelamento,
      taxa_juros_mes: `${taxaJuros.toLocaleString('pt-BR')}%`,
      multa: formatCurrency(input.newValues.multaAplicada),
      juros: formatCurrency(input.newValues.jurosAplicados),
    },
  };
}

/** Busca template de aditivo/renegociação no IAM Control. */
export async function findAditivoTemplateId(): Promise<string | undefined> {
  const templates = await listIamTermoTemplates();
  const match = templates.find((t) => /aditivo|renegocia/i.test(t.nome));
  return match?.id;
}

async function invokeIamTermoCreate(
  iamControlAlunoId: number,
  termo: ReturnType<typeof buildCancelamentoTermoPayload> | ReturnType<typeof buildAditivoTermoPayload>,
): Promise<IamTermoCreateResult> {
  const { data, error } = await supabase.functions.invoke<IamTermoCreateResult>('iam-control-termo', {
    body: {
      action: 'create',
      iam_control_aluno_id: iamControlAlunoId,
      ...termo,
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Falha ao gerar termo na ZapSign.' };
  }
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Não foi possível gerar o termo na ZapSign.', detalhe: data?.detalhe };
  }
  return data;
}

export async function createIamAditivoTermo(
  input: BuildAditivoTermoInput,
): Promise<IamTermoCreateResult> {
  if (!input.student.iamControlAlunoId) {
    return { ok: false, error: 'Aluno não está vinculado ao IAM Control.' };
  }

  let templateId = input.templateId;
  if (!templateId) {
    try {
      templateId = await findAditivoTemplateId();
    } catch {
      /* segue sem template — IAM pode usar padrão */
    }
  }

  const termo = buildAditivoTermoPayload({ ...input, templateId });
  return invokeIamTermoCreate(input.student.iamControlAlunoId, termo);
}

export async function createIamCancelamentoTermo(
  input: BuildCancelamentoTermoInput,
): Promise<IamTermoCreateResult> {
  if (!input.student.iamControlAlunoId) {
    return { ok: false, error: 'Aluno não está vinculado ao IAM Control.' };
  }

  const termo = buildCancelamentoTermoPayload(input);
  return invokeIamTermoCreate(input.student.iamControlAlunoId, termo);
}

export function openZapSignUrl(url?: string) {
  if (!url) throw new Error('Link de assinatura não disponível.');
  window.open(url, '_blank', 'noopener,noreferrer');
}
