import { supabase } from '@/integrations/supabase/client';
import { openCancellationPdf } from '@/lib/openCancellationPdf';
import type { Student } from '@/types';

export interface IamContratoResolveResult {
  ok: boolean;
  contrato_id?: string;
  treinamento?: string;
  signed_file_url?: string;
  pdf_base64?: string;
  filename?: string;
  error?: string;
  detalhe?: string;
}

function base64ToBlob(base64: string, mime = 'application/pdf'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function openPdfBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function resolveIamControlContrato(
  student: Pick<Student, 'iamControlAlunoId' | 'product'>,
): Promise<IamContratoResolveResult> {
  if (!student.iamControlAlunoId) {
    return { ok: false, error: 'Aluno não está vinculado ao IAM Control.' };
  }

  const { data, error } = await supabase.functions.invoke<IamContratoResolveResult>('iam-control-contrato', {
    body: {
      iam_control_aluno_id: student.iamControlAlunoId,
      produto: student.product?.trim() || undefined,
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Falha ao buscar contrato no IAM Control.' };
  }
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Contrato não encontrado no IAM Control.' };
  }
  return data;
}

export async function openIamControlContrato(student: Pick<Student, 'iamControlAlunoId' | 'product' | 'name'>) {
  const res = await resolveIamControlContrato(student);
  if (!res.ok) {
    throw new Error(res.error || 'Não foi possível abrir o contrato.');
  }

  if (res.signed_file_url) {
    await openCancellationPdf(res.signed_file_url, res.filename || `contrato-${student.name}.pdf`);
    return res;
  }

  if (res.pdf_base64) {
    const blob = base64ToBlob(res.pdf_base64);
    openPdfBlob(blob);
    return res;
  }

  throw new Error('Contrato encontrado, mas sem PDF disponível.');
}
