// Arquivamento do PDF assinado na ZapSign — compartilhado por `zapsign-webhook`
// (evento doc_signed) e `zapsign-termo` (action 'status', quando o polling do GC
// descobre a assinatura antes do webhook chegar).
//
// O link `signed_file` da ZapSign expira em ~60 min, então o PDF é copiado para
// o bucket `cancellation-docs` e o caminho fica em zapsign_documents.signed_file_path.
// Em seguida reflete no domínio: anexo "termo_assinado" no caso de cancelamento
// (libera o Confirmar e o download no GC) e entrada no histórico do aluno.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { detailDoc, zapsignConfig } from './zapsign.ts';

export const ZAPSIGN_BUCKET = 'cancellation-docs';

export interface ZapSignDocumentRow {
  id: string;
  company_id: string;
  tipo: string;
  student_id: string | null;
  cancellation_case_id: string | null;
  doc_token: string;
  nome_documento: string | null;
  signer_name: string | null;
  signed_file_path: string | null;
}

export interface ArquivarTermoInput {
  row: ZapSignDocumentRow;
  /** URL temporária do PDF assinado (webhook `signed_file`). Se faltar, consulta a ZapSign. */
  fileUrl?: string | null;
  signedAt: string;
  /** Quem assinou (para o histórico). */
  quem?: string | null;
  /**
   * Nova tentativa de arquivar um documento já marcado como assinado: não repete a
   * entrada no histórico (só baixa o PDF e garante o anexo no caso).
   */
  semHistorico?: boolean;
}

export interface ArquivarTermoResult {
  /** Path no bucket, ou null se o PDF não pôde ser baixado. */
  signedFilePath: string | null;
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function baixarPdfAssinado(admin: SupabaseClient, fileUrl: string, path: string): Promise<boolean> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    console.error('download signed_file', res.status);
    return false;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { error } = await admin.storage.from(ZAPSIGN_BUCKET).upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) {
    console.error('upload signed pdf', error.message);
    return false;
  }
  return true;
}

/**
 * Baixa o PDF assinado (se ainda não arquivado), grava `signed_file_path` e
 * reflete no caso de cancelamento / histórico do aluno. Idempotente: se o
 * documento já tem `signed_file_path`, só garante o anexo no caso.
 */
export async function arquivarTermoAssinado(admin: SupabaseClient, input: ArquivarTermoInput): Promise<ArquivarTermoResult> {
  const { row, signedAt } = input;
  const agora = new Date().toISOString();
  let signedPath: string | null = row.signed_file_path ?? null;

  if (!signedPath) {
    let fileUrl = input.fileUrl ?? null;
    if (!fileUrl && zapsignConfig()) {
      try {
        fileUrl = (await detailDoc(row.doc_token)).signed_file ?? null;
      } catch (err) {
        console.error('detailDoc', err instanceof Error ? err.message : err);
      }
    }
    if (fileUrl) {
      const pasta = row.tipo === 'cancelamento' ? 'termos' : `termos-${row.tipo}`;
      const ref = row.cancellation_case_id ?? row.student_id ?? row.doc_token;
      const path = `${row.company_id}/${pasta}/${ref}_zapsign_${row.doc_token}.pdf`;
      if (await baixarPdfAssinado(admin, fileUrl, path)) {
        signedPath = path;
        await admin.from('zapsign_documents').update({ signed_file_path: path }).eq('id', row.id);
      }
    }
  }

  const nomeDoc = String(row.nome_documento ?? 'Termo');

  // Caso de cancelamento: marca assinado e anexa o PDF (aparece em "Termos" com download).
  if (row.tipo === 'cancelamento' && row.cancellation_case_id) {
    const { data: caso } = await admin
      .from('cancellation_cases')
      .select('id, term_attachments, term_signed_at')
      .eq('id', row.cancellation_case_id)
      .maybeSingle();
    if (caso) {
      const atuais: Array<{ name: string; url: string; uploadedAt: string; type: string }> = Array.isArray(caso.term_attachments)
        ? caso.term_attachments
        : [];
      const novo =
        signedPath && !atuais.some((a) => a.url === signedPath)
          ? [
              ...atuais,
              {
                name: `Termo assinado (ZapSign) — ${nomeDoc}.pdf`,
                url: signedPath,
                uploadedAt: agora,
                type: 'termo_assinado',
              },
            ]
          : atuais;
      await admin
        .from('cancellation_cases')
        .update({
          term_signed_at: caso.term_signed_at ?? signedAt,
          term_signed_by_student: true,
          term_attachments: novo,
          updated_at: agora,
        })
        .eq('id', caso.id);
    }
  }

  if (row.student_id && !input.semHistorico) {
    const rotulo =
      row.tipo === 'cancelamento' ? 'Termo de cancelamento' : row.tipo === 'renegociacao' ? 'Termo de renegociação' : 'Termo';
    const quem = input.quem ?? row.signer_name ?? 'aluno';
    await admin.rpc('student_history_append', {
      p_student_id: row.student_id,
      p_text: `${rotulo} assinado eletronicamente via ZapSign por ${quem} em ${fmtDataHora(signedAt)}.${
        signedPath ? ' PDF assinado arquivado no GC.' : ''
      }`,
      p_type: 'Sistema',
    });
  }

  return { signedFilePath: signedPath };
}
