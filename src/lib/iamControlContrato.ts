import { supabase } from '@/integrations/supabase/client';
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

async function extrairErroInvoke(error: unknown, data: IamContratoResolveResult | null): Promise<string> {
  if (data?.error) return data.error;
  if (data && 'message' in data && typeof (data as { message?: string }).message === 'string') {
    return (data as { message: string }).message;
  }

  if (error && typeof error === 'object' && 'context' in error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json() as IamContratoResolveResult & { message?: string };
        if (body?.error) return body.error;
        if (body?.message) return body.message;
      } catch {
        // ignora parse
      }
    }
  }

  if (error instanceof Error && error.message && !error.message.includes('non-2xx')) {
    return error.message;
  }

  return 'Falha ao buscar contrato no IAM Control.';
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

  if (error || !data?.ok) {
    const msg = await extrairErroInvoke(error, data);
    return { ok: false, error: msg, detalhe: data?.detalhe };
  }
  return data;
}

export async function openIamControlContrato(student: Pick<Student, 'iamControlAlunoId' | 'product' | 'name'>) {
  const res = await resolveIamControlContrato(student);
  if (!res.ok) {
    throw new Error(res.error || 'Não foi possível abrir o contrato.');
  }

  if (res.pdf_base64) {
    const blob = base64ToBlob(res.pdf_base64);
    openPdfBlob(blob);
    return res;
  }

  throw new Error('Contrato encontrado, mas sem PDF disponível.');
}
