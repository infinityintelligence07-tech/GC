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
};

function extrairErroIam(meta: Record<string, unknown>, status: number): string {
  const msg = meta.message ?? meta.error ?? meta.detalhe;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  if (status === 404) {
    return 'Contrato conciliado não encontrado no IAM Control. Confirme se o endpoint /contrato está publicado e se o aluno tem contrato CONCILIADO.';
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

  const contratoId = typeof body.contrato_id === 'string' ? body.contrato_id.trim() : '';
  const iamIdRaw = body.iam_control_aluno_id;
  const iamId = typeof iamIdRaw === 'number' ? iamIdRaw : Number(iamIdRaw);
  const produto = typeof body.produto === 'string' ? body.produto.trim() : '';

  try {
    let meta: ContratoMeta;

    if (contratoId) {
      meta = { contrato_id: contratoId };
    } else {
      if (!Number.isFinite(iamId) || iamId <= 0) {
        return apiResult({ ok: false, error: 'Informe iam_control_aluno_id válido.' });
      }
      meta = await resolverContratoMeta(iamId, produto || undefined);
    }

    const id = meta.contrato_id?.trim();
    if (!id) {
      return apiResult({ ok: false, error: 'Contrato localizado sem identificador válido.' });
    }

    const bytes = await carregarPdfContrato(id, meta.signed_file_url);
    return apiResult({
      ok: true,
      contrato_id: id,
      treinamento: meta.treinamento,
      pdf_base64: arrayBufferToBase64(bytes),
      filename: `contrato-${id}.pdf`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiResult({ ok: false, error: msg });
  }
});
