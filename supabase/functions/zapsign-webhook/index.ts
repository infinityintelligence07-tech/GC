// Receptor dos webhooks da ZapSign (doc_signed, doc_refused, doc_deleted, doc_expired…).
//
// Configurar na ZapSign (Configurações > Integrações > ZapSign API > Webhooks):
//   URL:    https://<project>.supabase.co/functions/v1/zapsign-webhook
//   Header: x-webhook-token: <valor do secret ZAPSIGN_WEBHOOK_TOKEN>
//   Eventos: Documento assinado, recusado, removido, expirado (ou "Todos")
//
// verify_jwt = false (config.toml) — a autenticação é pelo header acima. Só processa
// documentos que existem em public.zapsign_documents (criados pelo GC); o resto é ignorado
// com 200 para a ZapSign não ficar reenviando.
//
// Ao assinar: baixa o PDF assinado para o bucket `cancellation-docs`, marca o caso de
// cancelamento (term_signed_at / term_signed_by_student / anexo "termo_assinado") ou
// registra no histórico do aluno (renegociação), o que libera o "Confirmar" no GC.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { normalizeStatus, tokenEquals, type ZapSignDoc } from '../_shared/zapsign.ts';
import { arquivarTermoAssinado, type ZapSignDocumentRow } from '../_shared/zapsignArquivo.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function autorizado(req: Request): boolean {
  const esperado = (Deno.env.get('ZAPSIGN_WEBHOOK_TOKEN') ?? '').trim();
  if (!esperado) return false;
  const header = (req.headers.get('x-webhook-token') ?? '').trim();
  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const query = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  return tokenEquals(header, esperado) || tokenEquals(auth, esperado) || tokenEquals(query, esperado);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });

  if (!(Deno.env.get('ZAPSIGN_WEBHOOK_TOKEN') ?? '').trim()) {
    return json(500, { ok: false, error: 'ZAPSIGN_WEBHOOK_TOKEN não configurado.' });
  }
  if (!autorizado(req)) return json(401, { ok: false, error: 'Token do webhook inválido.' });

  let evento: Partial<ZapSignDoc> & {
    event_type?: string;
    signer_who_signed?: { name?: string; email?: string; signed_at?: string };
    refused_by?: { name?: string; email?: string };
  };
  try {
    evento = await req.json();
  } catch {
    return json(400, { ok: false, error: 'JSON inválido' });
  }

  const token = String(evento.token ?? '').trim();
  const eventType = String(evento.event_type ?? '').trim() || 'desconhecido';
  if (!token) return json(200, { ok: true, ignorado: true, motivo: 'sem token' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: row, error: rowErr } = await admin
    .from('zapsign_documents')
    .select('*')
    .eq('doc_token', token)
    .maybeSingle();
  if (rowErr) return json(500, { ok: false, error: rowErr.message });
  if (!row) return json(200, { ok: true, ignorado: true, motivo: 'documento não é do GC' });

  const agora = new Date().toISOString();
  const status = normalizeStatus(evento.status, evento.signers);
  const signers = (evento.signers ?? []).map((s) => ({
    nome: s.name,
    email: s.email ?? '',
    status: s.status,
    tipo: 'sign' as const,
    signed_at: s.signed_at ?? null,
    sign_url: s.sign_url ?? '',
  }));

  // Payload enxuto para auditoria (sem links temporários de arquivo).
  const payloadResumo = {
    event_type: eventType,
    status: evento.status,
    signer_who_signed: evento.signer_who_signed
      ? { name: evento.signer_who_signed.name, email: evento.signer_who_signed.email, signed_at: evento.signer_who_signed.signed_at }
      : undefined,
    signers: signers.map((s) => ({ nome: s.nome, status: s.status, signed_at: s.signed_at })),
    last_update_at: evento.last_update_at,
  };

  const patch: Record<string, unknown> = {
    last_event: eventType,
    last_event_at: agora,
    last_payload: payloadResumo,
    ...(signers.length > 0 ? { signers } : {}),
  };

  const jaFinalizado = row.status !== 'pending';
  let assinouAgora = false;
  // Polling do GC já marcou como assinado mas o PDF ainda não foi arquivado
  // (ex.: signed_file indisponível na hora) — o webhook completa o arquivamento.
  const arquivarPendente = status === 'signed' && row.status === 'signed' && !row.signed_file_path && !!evento.signed_file;

  if (status === 'signed' && !jaFinalizado) {
    assinouAgora = true;
    const signedAt =
      evento.signer_who_signed?.signed_at ??
      evento.signers?.find((s) => s.signed_at)?.signed_at ??
      agora;
    patch.status = 'signed';
    patch.signed_at = signedAt;
  } else if ((status === 'refused' || eventType === 'doc_refused') && !jaFinalizado) {
    patch.status = 'refused';
    patch.refused_at = agora;
  } else if ((status === 'deleted' || eventType === 'doc_deleted') && !jaFinalizado) {
    patch.status = 'deleted';
  } else if ((status === 'expired' || eventType === 'doc_expired') && !jaFinalizado) {
    patch.status = 'expired';
  }

  const { error: updErr } = await admin.from('zapsign_documents').update(patch).eq('id', row.id);
  if (updErr) return json(500, { ok: false, error: updErr.message });

  // Reflete no domínio (caso de cancelamento / histórico do aluno).
  const nomeDoc = String(row.nome_documento ?? evento.name ?? 'Termo');
  const quem = evento.signer_who_signed?.name ?? row.signer_name ?? 'aluno';
  let signedFilePath: string | null = row.signed_file_path ?? null;

  if (assinouAgora || arquivarPendente) {
    // PDF assinado: o link do webhook expira em 60 min — salva no nosso bucket,
    // anexa no caso de cancelamento e registra no histórico do aluno.
    const r = await arquivarTermoAssinado(admin, {
      row: { ...(row as ZapSignDocumentRow), nome_documento: nomeDoc },
      fileUrl: evento.signed_file ?? null,
      signedAt: String(patch.signed_at ?? row.signed_at ?? agora),
      quem,
      // Se o polling já registrou a assinatura, aqui só completa o PDF.
      semHistorico: !assinouAgora,
    });
    signedFilePath = r.signedFilePath;
  } else if (patch.status === 'refused' && row.student_id) {
    await admin.rpc('student_history_append', {
      p_student_id: row.student_id,
      p_text: `Assinatura do termo "${nomeDoc}" recusada na ZapSign${evento.refused_by?.name ? ` por ${evento.refused_by.name}` : ''}.`,
      p_type: 'Sistema',
    });
  }

  return json(200, {
    ok: true,
    token,
    event_type: eventType,
    status: patch.status ?? row.status,
    assinou_agora: assinouAgora,
    signed_file_path: signedFilePath,
  });
});
