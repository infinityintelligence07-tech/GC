import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/store/useAppStore';
import type { CancellationCase, Student } from '@/types';

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
  student: Pick<Student, 'iamControlAlunoId' | 'name' | 'product' | 'cpf' | 'saleValue'>;
  caseRef: Pick<
    CancellationCase,
    'studentName' | 'motivoCancelamento' | 'descricaoCancelamento' | 'notes' | 'legalNotes'
  >;
  fineValue: number;
  totalPaid: number;
  totalContract: number;
  balance: number;
  templateId?: string;
  semMultaCDC7?: boolean;
}

function formatBalance(balance: number): string {
  if (Math.abs(balance) < 0.01) return 'Quitado';
  if (balance > 0) return `Aluno deve pagar ${formatCurrency(balance)}`;
  return `Devolver ao aluno ${formatCurrency(Math.abs(balance))}`;
}

export function buildCancelamentoTermoPayload(input: BuildCancelamentoTermoInput) {
  const motivo = input.caseRef.motivoCancelamento || input.caseRef.descricaoCancelamento || input.caseRef.notes || '';
  const observacoes = [
    `Caso de cancelamento — ${input.caseRef.studentName}`,
    input.student.product ? `Produto: ${input.student.product}` : '',
    `Valor do contrato: ${formatCurrency(input.totalContract)}`,
    `Total pago: ${formatCurrency(input.totalPaid)}`,
    input.semMultaCDC7
      ? 'Multa: isenta (direito de arrependimento — 7 dias CDC)'
      : `Multa de cancelamento: ${formatCurrency(input.fineValue)}`,
    `Saldo final: ${formatBalance(input.balance)}`,
    motivo ? `Motivo: ${motivo}` : '',
    input.caseRef.legalNotes?.trim() ? `Observações jurídicas: ${input.caseRef.legalNotes.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const textoIntroducao =
    'Pelo presente instrumento, as partes formalizam o cancelamento do contrato de prestação de serviços educacionais, ' +
    'nos termos e condições abaixo descritos, em conformidade com a legislação aplicável.';

  return {
    termo_titulo: `Termo de Cancelamento — ${input.caseRef.studentName}`,
    texto_introducao: textoIntroducao,
    observacoes,
    local_assinatura: 'Americana/SP',
    template_id: input.templateId,
    campos_variaveis: {
      valor_contrato: formatCurrency(input.totalContract),
      valor_pago: formatCurrency(input.totalPaid),
      valor_multa: input.semMultaCDC7 ? 'R$ 0,00 (isento CDC 7 dias)' : formatCurrency(input.fineValue),
      saldo_final: formatBalance(input.balance),
      produto: input.student.product ?? '',
      motivo_cancelamento: motivo,
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
  student: Pick<Student, 'iamControlAlunoId' | 'name' | 'product' | 'cpf' | 'saleValue'>;
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
  };
  templateId?: string;
}

export function buildAditivoTermoPayload(input: BuildAditivoTermoInput) {
  const totalComEncargos =
    input.newValues.novoSaldo + input.newValues.multaAplicada + input.newValues.jurosAplicados;
  const saldoAposEntrada =
    input.newValues.saldoAposEntrada ??
    Math.max(0, totalComEncargos - input.newValues.novaEntrada);

  const observacoes = [
    `Renegociação financeira — ${input.student.name}`,
    input.student.product ? `Produto: ${input.student.product}` : '',
    `Valor original do contrato: ${formatCurrency(input.originalValues.valorVenda)}`,
    `Entrada original: ${formatCurrency(input.originalValues.entrada)}`,
    `Parcelas originais: ${input.originalValues.parcelasOriginais}x`,
    `Saldo devedor renegociado: ${formatCurrency(input.newValues.novoSaldo)}`,
    `Multa aplicada: ${formatCurrency(input.newValues.multaAplicada)}`,
    `Juros aplicados: ${formatCurrency(input.newValues.jurosAplicados)}`,
    `Total com encargos: ${formatCurrency(totalComEncargos)}`,
    input.newValues.novaEntrada > 0.0049
      ? `Nova entrada: ${formatCurrency(input.newValues.novaEntrada)}`
      : '',
    `Saldo após entrada: ${formatCurrency(saldoAposEntrada)}`,
    `Novo plano: ${input.newValues.novasParcelas}x de ${formatCurrency(input.newValues.novoValorParcela)}`,
    input.newValues.primeiraParcelaVencimento
      ? `1ª parcela do novo plano: ${input.newValues.primeiraParcelaVencimento}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const textoIntroducao =
    'Pelo presente instrumento aditivo, as partes retificam as condições de parcelamento do contrato de ' +
    'prestação de serviços educacionais, permanecendo em vigor as demais cláusulas do contrato original.';

  return {
    termo_titulo: `Termo Aditivo — ${input.student.name}`,
    texto_introducao: textoIntroducao,
    observacoes,
    local_assinatura: 'Americana/SP',
    template_id: input.templateId,
    campos_variaveis: {
      valor_contrato_original: formatCurrency(input.originalValues.valorVenda),
      entrada_original: formatCurrency(input.originalValues.entrada),
      parcelas_originais: String(input.originalValues.parcelasOriginais),
      saldo_devedor: formatCurrency(input.newValues.novoSaldo),
      multa: formatCurrency(input.newValues.multaAplicada),
      juros: formatCurrency(input.newValues.jurosAplicados),
      total_com_encargos: formatCurrency(totalComEncargos),
      nova_entrada: formatCurrency(input.newValues.novaEntrada),
      saldo_apos_entrada: formatCurrency(saldoAposEntrada),
      novas_parcelas: String(input.newValues.novasParcelas),
      valor_parcela: formatCurrency(input.newValues.novoValorParcela),
      produto: input.student.product ?? '',
      primeira_parcela: input.newValues.primeiraParcelaVencimento ?? '',
    },
  };
}

/** Busca template de aditivo no IAM Control (nome contém "aditivo"). */
export async function findAditivoTemplateId(): Promise<string | undefined> {
  const templates = await listIamTermoTemplates();
  const match = templates.find((t) => /aditivo/i.test(t.nome));
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
