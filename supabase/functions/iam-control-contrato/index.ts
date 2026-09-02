import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEOUT_MS = 45_000;

/** Resposta JSON sempre com HTTP 200 — evita toast genérico do cliente Supabase em erros de negócio. */
function apiResult(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function lerIamConfig(): { apiUrl: string; token: string } | null {
  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(/\/$/, '');
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) return null;
  return { apiUrl, token };
}

async function fetchIam(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cfg = lerIamConfig();
  if (!cfg) throw new Error('IAM_CONTROL_WEBHOOK_TOKEN não configurado.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${cfg.apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'x-webhook-token': cfg.token,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type ContratoMeta = {
  contrato_id?: string;
  treinamento?: string;
  signed_file_url?: string | null;
  status_conciliacao?: string;
  pendente_tipo?: 'LINK' | 'PIX' | null;
  pendente_link?: string | null;
};

function isStatusPendente(status: string | null | undefined): boolean {
  const s = String(status ?? '').toUpperCase().trim();
  return s === 'PENDENTE' || s.startsWith('PENDENTE_');
}

function extrairErroIam(meta: Record<string, unknown>, status: number): string {
  const msg = meta.message ?? meta.error ?? meta.detalhe;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (status === 404) {
    return 'Contrato não encontrado no IAM Control (conciliado ou pendente). Confirme se o endpoint /contrato está publicado.';
  }
  return `IAM Control respondeu ${status}.`;
}

async function resolverContratoMeta(iamId: number, produto?: string): Promise<ContratoMeta> {
  const tentativas: Array<string | undefined> = produto ? [produto, undefined] : [undefined];
  let ultimoErro = 'Contrato não encontrado no IAM Control.';

  for (const prod of tentativas) {
    const params = new URLSearchParams({ iam_control_aluno_id: String(iamId) });
    if (prod) params.set('produto', prod);

    const metaRes = await fetchIam(`/webhooks/gestao-contas/contrato?${params.toString()}`);
    const meta = await metaRes.json().catch(() => ({} as Record<string, unknown>));

    if (metaRes.ok && meta?.contrato_id) {
      return meta as ContratoMeta;
    }

    ultimoErro = extrairErroIam(meta, metaRes.status);
    if (!prod) break;
  }

  throw new Error(ultimoErro);
}

async function carregarPdfContrato(contratoId: string, signedFileUrl?: string | null): Promise<ArrayBuffer> {
  if (signedFileUrl) {
    try {
      const signedRes = await fetch(signedFileUrl);
      if (signedRes.ok) {
        return await signedRes.arrayBuffer();
      }
    } catch {
      // segue para endpoint /pdf do IAM
    }
  }

  const pdfRes = await fetchIam(
    `/webhooks/gestao-contas/contrato/${encodeURIComponent(contratoId)}/pdf`,
    { headers: { Accept: 'application/pdf' } },
  );
  if (!pdfRes.ok) {
    const texto = await pdfRes.text().catch(() => '');
    throw new Error(
      texto.trim()
        ? `PDF indisponível (${pdfRes.status}): ${texto.slice(0, 200)}`
        : `PDF do contrato indisponível (${pdfRes.status}).`,
    );
  }
  return await pdfRes.arrayBuffer();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return apiResult({ ok: false, error: 'Use POST' });
  }

  if (!lerIamConfig()) {
    return apiResult({ ok: false, error: 'Integração IAM Control não configurada no servidor (IAM_CONTROL_WEBHOOK_TOKEN).' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiResult({ ok: false, error: 'JSON inválido' });
  }

  const contratoIdBody = typeof body.contrato_id === 'string' ? body.contrato_id.trim() : '';
  const iamIdRaw = body.iam_control_aluno_id;
  const iamId = typeof iamIdRaw === 'number' ? iamIdRaw : Number(iamIdRaw);
  const produto = typeof body.produto === 'string' ? body.produto.trim() : '';
  const somenteMeta = body.somente_meta === true;
  const statusLocal = typeof body.status_conciliacao === 'string' ? body.status_conciliacao.trim().toUpperCase() : '';
  const pendenteTipoLocalRaw = typeof body.pendente_tipo === 'string' ? body.pendente_tipo.trim().toUpperCase() : '';
  const pendenteTipoLocal =
    pendenteTipoLocalRaw === 'LINK' || pendenteTipoLocalRaw === 'PIX'
      ? (pendenteTipoLocalRaw as 'LINK' | 'PIX')
      : statusLocal === 'PENDENTE_LINK'
        ? 'LINK' as const
        : statusLocal === 'PENDENTE_PIX'
          ? 'PIX' as const
          : null;

  try {
    let meta: ContratoMeta = {};

    // Sempre tenta resolver a meta no IAM quando temos o aluno: status, signed_file_url
    // e pendente_tipo/link. Antes, se o GC mandasse só contrato_id, pulávamos isso e
    // tentávamos baixar PDF de contratos PENDENTE (PIX/LINK) — o IAM respondia 500.
    if (Number.isFinite(iamId) && iamId > 0) {
      try {
        meta = await resolverContratoMeta(iamId, produto || undefined);
      } catch (metaErr) {
        if (!contratoIdBody) throw metaErr;
        // Fallback: usa o contrato_id já salvo na ficha do GC + status local.
        meta = {
          contrato_id: contratoIdBody,
          status_conciliacao: statusLocal || undefined,
          pendente_tipo: pendenteTipoLocal,
        };
      }
    } else if (contratoIdBody) {
      meta = {
        contrato_id: contratoIdBody,
        status_conciliacao: statusLocal || undefined,
        pendente_tipo: pendenteTipoLocal,
      };
    } else {
      return apiResult({ ok: false, error: 'Informe iam_control_aluno_id válido.' });
    }

    // Preferência: contrato_id salvo no GC, se a meta não trouxe um.
    if (!meta.contrato_id?.trim() && contratoIdBody) {
      meta = { ...meta, contrato_id: contratoIdBody };
    }
    // Completa status/tipo a partir da ficha do GC quando a meta do IAM veio incompleta.
    if (!meta.status_conciliacao && statusLocal) {
      meta = { ...meta, status_conciliacao: statusLocal };
    }
    if (!meta.pendente_tipo && pendenteTipoLocal) {
      meta = { ...meta, pendente_tipo: pendenteTipoLocal };
    }

    const id = meta.contrato_id?.trim();
    if (!id) {
      return apiResult({ ok: false, error: 'Contrato localizado sem identificador válido.' });
    }

    const status = String(meta.status_conciliacao ?? '').toUpperCase();
    const pendenteTipo = meta.pendente_tipo ?? null;
    const pendenteLink = meta.pendente_link ?? null;
    const pendente = isStatusPendente(status);

    const basePayload: Record<string, unknown> = {
      ok: true,
      contrato_id: id,
      treinamento: meta.treinamento,
      status_conciliacao: status || undefined,
      pendente_tipo: pendenteTipo,
      pendente_link: pendenteLink,
    };

    // Pendente com link: devolve o link, sem tentar PDF.
    if (somenteMeta || (pendente && pendenteTipo === 'LINK' && pendenteLink)) {
      return apiResult(basePayload);
    }

    // Pendente PIX (ou pendente sem documento): não força /pdf — o IAM costuma
    // responder 500 ao tentar gerar layout de contrato ainda não assinado.
    if (somenteMeta || (pendente && pendenteTipo === 'PIX') || (pendente && !meta.signed_file_url)) {
      return apiResult({
        ...basePayload,
        aviso: pendenteTipo === 'PIX'
          ? 'Contrato pendente de pagamento via PIX no IAM Control — PDF ainda não disponível.'
          : 'Contrato pendente no IAM Control — PDF ainda não disponível.',
      });
    }

    try {
      const bytes = await carregarPdfContrato(id, meta.signed_file_url);
      return apiResult({
        ...basePayload,
        pdf_base64: arrayBufferToBase64(bytes),
        filename: `contrato-${id}.pdf`,
      });
    } catch (pdfErr) {
      if (pendente) {
        return apiResult({
          ...basePayload,
          aviso: pdfErr instanceof Error ? pdfErr.message : 'PDF indisponível para contrato pendente.',
        });
      }
      throw pdfErr;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiResult({ ok: false, error: msg });
  }
});
