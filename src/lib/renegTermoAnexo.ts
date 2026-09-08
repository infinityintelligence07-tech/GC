import { supabase } from '@/integrations/supabase/client';
import { useCompanyStore } from '@/store/useCompanyStore';

export const RENEG_ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const RENEG_ANEXO_ACCEPT = '.pdf,image/*';

export interface TermoAnexadoInfo {
  /** Path no bucket `cancellation-docs`. */
  path: string;
  nomeArquivo: string;
}

/**
 * Sobe o termo/contrato de renegociação já assinado para o bucket
 * `cancellation-docs` (pasta `termos-renegociacao/<aluno>`). O anexo vale como
 * assinatura confirmada e libera o Confirmar da renegociação.
 */
export async function uploadRenegTermoAnexado(studentId: string, file: File): Promise<TermoAnexadoInfo> {
  if (file.size > RENEG_ANEXO_MAX_BYTES) {
    throw new Error('Arquivo muito grande. Limite de 10 MB.');
  }
  const activeCompanyId = useCompanyStore.getState().activeCompanyId;
  if (!activeCompanyId) throw new Error('Empresa ativa não identificada.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${activeCompanyId}/termos-renegociacao/${studentId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage.from('cancellation-docs').upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
  return { path, nomeArquivo: file.name };
}
