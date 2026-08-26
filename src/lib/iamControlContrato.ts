import { supabase } from '@/integrations/supabase/client';
import type { Student } from '@/types';

export type IamContratoStatus = 'CONCILIADO' | 'PENDENTE' | string;
export type IamPendenteTipo = 'LINK' | 'PIX';

export interface IamContratoResolveResult {
  ok: boolean;
  contrato_id?: string;
  treinamento?: string;
  signed_file_url?: string;
  pdf_base64?: string;
  filename?: string;
  status_conciliacao?: IamContratoStatus;
  pendente_tipo?: IamPendenteTipo | null;
  pendente_link?: string | null;
  aviso?: string;
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
  student: Pick<Student, 'iamControlAlunoId' | 'product' | 'iamControlContratoId'>,
  opts?: { somenteMeta?: boolean },
): Promise<IamContratoResolveResult> {
  if (!student.iamControlAlunoId && !student.iamControlContratoId) {
    return { ok: false, error: 'Aluno não está vinculado ao IAM Control.' };
  }

  const { data, error } = await supabase.functions.invoke<IamContratoResolveResult>('iam-control-contrato', {
    body: {
      iam_control_aluno_id: student.iamControlAlunoId,
      produto: student.product?.trim() || undefined,
      contrato_id: student.iamControlContratoId,
      somente_meta: opts?.somenteMeta ?? false,
    },
  });

  if (error || !data?.ok) {
    const msg = await extrairErroInvoke(error, data);
    return { ok: false, error: msg, detalhe: data?.detalhe };
  }
  return data;
}

export async function openIamControlContrato(
  student: Pick<Student, 'iamControlAlunoId' | 'product' | 'name' | 'iamControlContratoId'>,
) {
  const res = await resolveIamControlContrato(student);
  if (!res.ok) {
    throw new Error(res.error || 'Não foi possível abrir o contrato.');
  }

  if (res.pdf_base64) {
    const blob = base64ToBlob(res.pdf_base64);
    openPdfBlob(blob);
    return res;
  }

  if (String(res.status_conciliacao).toUpperCase().startsWith('PENDENTE')) {
    return res;
  }

  throw new Error(res.aviso || 'Contrato encontrado, mas sem PDF disponível.');
}

export function isIamContratoPendenteLink(student: Pick<Student, 'iamControlContratoStatus' | 'iamControlPendenteTipo' | 'iamControlPendenteLink'>): boolean {
  const status = String(student.iamControlContratoStatus ?? '').toUpperCase();
  const tipo = String(student.iamControlPendenteTipo ?? '').toUpperCase();
  return (status === 'PENDENTE' || status === 'PENDENTE_LINK') && (tipo === 'LINK' || status === 'PENDENTE_LINK');
}

export function isIamContratoPendentePix(student: Pick<Student, 'iamControlContratoStatus' | 'iamControlPendenteTipo'>): boolean {
  const status = String(student.iamControlContratoStatus ?? '').toUpperCase();
  const tipo = String(student.iamControlPendenteTipo ?? '').toUpperCase();
  return (status === 'PENDENTE' || status === 'PENDENTE_PIX') && (tipo === 'PIX' || status === 'PENDENTE_PIX');
}

export async function fetchIamControlPaymentLink(
  student: Pick<Student, 'iamControlAlunoId' | 'product' | 'iamControlContratoId' | 'iamControlPendenteLink'>,
): Promise<string> {
  const cached = student.iamControlPendenteLink?.trim();
  if (cached) return cached;

  const res = await resolveIamControlContrato(student, { somenteMeta: true });
  if (!res.ok) {
    throw new Error(res.error || 'Não foi possível buscar o link de pagamento.');
  }
  const link = res.pendente_link?.trim();
  if (!link) {
    throw new Error('Este contrato pendente não possui link de pagamento cadastrado no IAM Control.');
  }
  return link;
}

export async function openIamControlPaymentLink(
  student: Pick<Student, 'iamControlAlunoId' | 'product' | 'name' | 'iamControlContratoId' | 'iamControlPendenteLink'>,
) {
  const link = await fetchIamControlPaymentLink(student);
  window.open(link, '_blank', 'noopener,noreferrer');
  return link;
}
