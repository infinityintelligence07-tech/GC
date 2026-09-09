// Cria e consulta termos na ZapSign (integração direta, sem passar pelo IAM Control).
//
// POST { action: 'create', tipo, nome_documento, markdown_text, signer: { name, email?, phone? },
//        student_id?, cancellation_case_id?, external_id?, enviar_email?, enviar_whatsapp? }
//   → { ok, id (token do documento), url_assinatura, status, nome_documento, signers }
//
// POST { action: 'status', id }
//   → { ok, id, status, url_assinatura, signers, signed_at, signed_file_path }
//
// POST { action: 'delete', id, motivo? }
//   → { ok, id, status: 'deleted' }  (soft delete na ZapSign; termo assinado não é excluído)
//
// Requer usuário logado (verify_jwt) com empresa ativa. Escreve em public.zapsign_documents
// com service role.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  ZapSignError,
  createDoc,
  deleteDoc,
  detailDoc,
  normalizeStatus,
  phoneToZapSign,
  zapsignConfig,
  type ZapSignDoc,
} from '../_shared/zapsign.ts';
import { arquivarTermoAssinado, type ZapSignDocumentRow } from '../_shared/zapsignArquivo.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const TIPOS = new Set(['cancelamento', 'renegociacao', 'aditivo', 'outro']);

function signersOut(doc: Pick<ZapSignDoc, 'signers'>) {
  return (doc.signers ?? []).map((s) => ({
    nome: s.name,
    email: s.email ?? '',
    status: s.status,
    tipo: 'sign' as const,
    signed_at: s.signed_at ?? null,
    sign_url: s.sign_url ?? '',
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });

  if (!zapsignConfig()) {
    return json(500, {
      ok: false,
      error: 'Integração ZapSign não configurada no servidor (secret ZAPSIGN_API_TOKEN).',
    });
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { ok: false, error: 'Sem token de autenticação.' });

  const anon = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
  if (userErr || !userData.user) return json(401, { ok: false, error: 'Token inválido.' });
  const userId = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ativa } = await admin
    .from('user_active_company')
    .select('company_id')
    .eq('user_id', userId)
    .maybeSingle();
  const companyId = (ativa?.company_id as string | undefined) ?? null;
  if (!companyId) return json(400, { ok: false, error: 'Empresa ativa não identificada para o usuário.' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'JSON inválido' });
  }

  const action = String(body.action ?? 'create');

  try {
    if (action === 'status') {
      const id = String(body.id ?? body.termo_id ?? '').trim();
      if (!id) return json(400, { ok: false, error: 'Informe "id" (token do documento).' });

      const { data: row, error: rowErr } = await admin
        .from('zapsign_documents')
        .select('*')
        .eq('doc_token', id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (rowErr) throw new Error(rowErr.message);
      if (!row) return json(404, { ok: false, error: 'Termo não encontrado nesta empresa.' });

      // Estado final já conhecido (webhook chegou): não precisa bater na ZapSign.
      if (row.status !== 'pending') {
        let signedFilePath: string | null = row.signed_file_path ?? null;
        // Assinado mas sem PDF arquivado (falha anterior de download): tenta de novo.
        if (row.status === 'signed' && !signedFilePath) {
          const r = await arquivarTermoAssinado(admin, {
            row: row as ZapSignDocumentRow,
            signedAt: row.signed_at ?? new Date().toISOString(),
            semHistorico: true,
          });
          signedFilePath = r.signedFilePath;
        }
        return json(200, {
          ok: true,
          id: row.doc_token,
          nome_documento: row.nome_documento,
          status: row.status,
          url_assinatura: row.sign_url,
          signers: row.signers ?? [],
          signed_at: row.signed_at,
          signed_file_path: signedFilePath,
          origem: 'banco',
        });
      }

      const doc = await detailDoc(id);
      const status = normalizeStatus(doc.status, doc.signers);
      const signers = signersOut(doc);
      const signedAt =
        status === 'signed'
          ? (doc.signers?.find((s) => s.signed_at)?.signed_at ?? new Date().toISOString())
          : null;
      await admin
        .from('zapsign_documents')
        .update({
          status,
          signers,
          ...(signedAt ? { signed_at: signedAt } : {}),
          last_event: 'status_poll',
          last_event_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      // Assinatura descoberta pelo polling antes do webhook: arquiva o PDF assinado
      // e reflete no caso/histórico do mesmo jeito (senão o webhook, ao chegar,
      // veria o documento já finalizado e o PDF nunca ficaria disponível no GC).
      let signedFilePath: string | null = row.signed_file_path ?? null;
      if (status === 'signed' && signedAt) {
        const r = await arquivarTermoAssinado(admin, {
          row: row as ZapSignDocumentRow,
          fileUrl: doc.signed_file ?? null,
          signedAt,
          quem: doc.signers?.find((s) => s.signed_at)?.name ?? row.signer_name ?? null,
        });
        signedFilePath = r.signedFilePath;
      }

      return json(200, {
        ok: true,
        id: doc.token,
        nome_documento: doc.name,
        status,
        url_assinatura: row.sign_url || doc.signers?.[0]?.sign_url || '',
        signers,
        signed_at: signedAt,
        signed_file_path: signedFilePath,
        file_url: doc.signed_file ?? undefined,
        origem: 'zapsign',
      });
    }

    if (action === 'delete') {
      const id = String(body.id ?? body.termo_id ?? '').trim();
      if (!id) return json(400, { ok: false, error: 'Informe "id" (token do documento).' });

      const { data: row, error: rowErr } = await admin
        .from('zapsign_documents')
        .select('id, doc_token, status, student_id, nome_documento, tipo')
        .eq('doc_token', id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (rowErr) throw new Error(rowErr.message);
      if (!row) return json(404, { ok: false, error: 'Termo não encontrado nesta empresa.' });

      if (row.status === 'deleted') {
        return json(200, { ok: true, id: row.doc_token, status: 'deleted', ja_excluido: true });
      }
      // Termo já assinado é documento jurídico: nunca some por descarte de rascunho.
      if (row.status === 'signed') {
        return json(409, { ok: false, error: 'Termo já assinado não pode ser excluído.' });
      }

      await deleteDoc(id);

      const now = new Date().toISOString();
      await admin
        .from('zapsign_documents')
        .update({ status: 'deleted', last_event: 'deleted_by_user', last_event_at: now })
        .eq('id', row.id);

      if (row.student_id) {
        const { data: appUser } = await admin
          .from('app_users')
          .select('name')
          .eq('auth_user_id', userId)
          .maybeSingle();
        const quem = (appUser?.name as string | undefined) ?? userData.user.email ?? 'usuário';
        const motivo = body.motivo ? String(body.motivo) : 'rascunho descartado';
        const rotulo =
          row.tipo === 'cancelamento' ? 'Termo de cancelamento' : row.tipo === 'renegociacao' ? 'Termo de renegociação' : 'Termo';
        await admin.rpc('student_history_append', {
          p_student_id: row.student_id,
          p_text: `${rotulo} excluído na ZapSign (${motivo}) por ${quem}. Documento: ${row.nome_documento ?? id}. O link de assinatura deixou de valer.`,
          p_type: 'Sistema',
        });
      }

      return json(200, { ok: true, id: row.doc_token, status: 'deleted' });
    }

    if (action !== 'create') return json(400, { ok: false, error: `Ação desconhecida: ${action}` });

    const tipo = String(body.tipo ?? 'outro');
    if (!TIPOS.has(tipo)) return json(400, { ok: false, error: `tipo inválido: ${tipo}` });
    const nomeDocumento = String(body.nome_documento ?? '').trim();
    const markdown = String(body.markdown_text ?? '').trim();
    if (!nomeDocumento) return json(400, { ok: false, error: 'nome_documento obrigatório.' });
    if (markdown.length < 40) return json(400, { ok: false, error: 'markdown_text vazio ou muito curto.' });

    const signer = (body.signer ?? {}) as Record<string, unknown>;
    const signerName = String(signer.name ?? '').trim();
    const signerEmail = String(signer.email ?? '').trim().toLowerCase();
    const signerPhone = phoneToZapSign(String(signer.phone ?? ''));
    if (!signerName) return json(400, { ok: false, error: 'Nome do signatário obrigatório.' });
    if (!signerEmail && !signerPhone) {
      return json(400, { ok: false, error: 'Signatário precisa de e-mail ou WhatsApp para assinar.' });
    }

    const studentId = body.student_id ? String(body.student_id) : null;
    const caseId = body.cancellation_case_id ? String(body.cancellation_case_id) : null;
    const externalId =
      (body.external_id ? String(body.external_id) : '') ||
      `gc:${tipo}:${caseId ?? studentId ?? crypto.randomUUID()}`;

    const { data: appUser } = await admin
      .from('app_users')
      .select('name')
      .eq('auth_user_id', userId)
      .maybeSingle();

    const doc = await createDoc({
      name: nomeDocumento,
      markdown_text: markdown,
      external_id: externalId,
      folder_path: `/GC/${tipo}/`,
      signers: [
        {
          name: signerName,
          email: signerEmail || undefined,
          phone_number: signerPhone || undefined,
          external_id: studentId ?? undefined,
          send_automatic_email: body.enviar_email === true,
          send_automatic_whatsapp: body.enviar_whatsapp === true,
          custom_message: body.mensagem ? String(body.mensagem) : undefined,
        },
      ],
      metadata: [
        { key: 'gc_tipo', value: tipo },
        { key: 'gc_company_id', value: companyId },
        ...(studentId ? [{ key: 'gc_student_id', value: studentId }] : []),
        ...(caseId ? [{ key: 'gc_case_id', value: caseId }] : []),
      ],
    });

    const primeiro = doc.signers?.[0];
    const signUrl = primeiro?.sign_url || (primeiro?.token ? `https://app.zapsign.com.br/verificar/${primeiro.token}` : '');
    const status = normalizeStatus(doc.status, doc.signers);
    const signers = signersOut(doc);

    const { error: insErr } = await admin.from('zapsign_documents').insert({
      company_id: companyId,
      tipo,
      student_id: studentId,
      cancellation_case_id: caseId,
      doc_token: doc.token,
      doc_open_id: doc.open_id ?? null,
      signer_token: primeiro?.token ?? null,
      sign_url: signUrl || null,
      external_id: externalId,
      nome_documento: doc.name || nomeDocumento,
      status,
      signer_name: signerName,
      signer_email: signerEmail || null,
      signer_phone: signerPhone || null,
      signers,
      created_by: userId,
      created_by_nome: (appUser?.name as string | undefined) ?? userData.user.email ?? null,
      last_event: 'created',
      last_event_at: new Date().toISOString(),
    });
    if (insErr) {
      // Documento já existe na ZapSign; não perde o link mesmo se o registro local falhar.
      console.error('zapsign_documents insert', insErr.message);
    }

    if (studentId) {
      const rotulo = tipo === 'cancelamento' ? 'Termo de cancelamento' : tipo === 'renegociacao' ? 'Termo de renegociação' : 'Termo';
      const canais: string[] = [];
      if (body.enviar_email === true && signerEmail) canais.push(`e-mail (${signerEmail})`);
      if (body.enviar_whatsapp === true && signerPhone) canais.push(`WhatsApp (${signerPhone})`);
      await admin.rpc('student_history_append', {
        p_student_id: studentId,
        p_text: `${rotulo} enviado para assinatura eletrônica (ZapSign). Documento: ${doc.name}. ${
          canais.length > 0
            ? `Link enviado automaticamente pela ZapSign por ${canais.join(' e ')}.`
            : 'Link de assinatura gerado para envio manual.'
        }`,
        p_type: 'Sistema',
      });
    }

    return json(200, {
      ok: true,
      id: doc.token,
      nome_documento: doc.name || nomeDocumento,
      status,
      url_assinatura: signUrl,
      signers,
      created_at: doc.created_at,
      registro_local: !insErr,
    });
  } catch (err) {
    if (err instanceof ZapSignError) {
      return json(err.status >= 500 ? 502 : 400, { ok: false, error: err.message, detalhe: err.detalhe });
    }
    return json(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
