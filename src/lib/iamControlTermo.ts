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

export async function createIamCancelamentoTermo(
  input: BuildCancelamentoTermoInput,
): Promise<IamTermoCreateResult> {
  if (!input.student.iamControlAlunoId) {
    return { ok: false, error: 'Aluno não está vinculado ao IAM Control.' };
  }

  const termo = buildCancelamentoTermoPayload(input);

  const { data, error } = await supabase.functions.invoke<IamTermoCreateResult>('iam-control-termo', {
    body: {
      action: 'create',
      iam_control_aluno_id: input.student.iamControlAlunoId,
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

export function openZapSignUrl(url?: string) {
  if (!url) throw new Error('Link de assinatura não disponível.');
  window.open(url, '_blank', 'noopener,noreferrer');
}
