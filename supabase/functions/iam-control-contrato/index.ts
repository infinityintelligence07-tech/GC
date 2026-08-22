import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEOUT_MS = 45_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });

  if (!lerIamConfig()) {
    return json(500, { ok: false, error: 'Integração IAM Control não configurada no servidor.' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'JSON inválido' });
  }

  const contratoId = typeof body.contrato_id === 'string' ? body.contrato_id.trim() : '';
  const iamIdRaw = body.iam_control_aluno_id;
  const iamId = typeof iamIdRaw === 'number' ? iamIdRaw : Number(iamIdRaw);
  const produto = typeof body.produto === 'string' ? body.produto.trim() : '';

  try {
    if (contratoId) {
      const pdfRes = await fetchIam(`/webhooks/gestao-contas/contrato/${encodeURIComponent(contratoId)}/pdf`, {
        headers: { Accept: 'application/pdf' },
      });
      if (!pdfRes.ok) {
        const texto = await pdfRes.text().catch(() => '');
        return json(pdfRes.status, {
          ok: false,
          error: `Não foi possível carregar o PDF do contrato (${pdfRes.status}).`,
          detalhe: texto.slice(0, 300),
        });
      }
      const bytes = await pdfRes.arrayBuffer();
      return json(200, {
        ok: true,
        contrato_id: contratoId,
        pdf_base64: arrayBufferToBase64(bytes),
        filename: `contrato-${contratoId}.pdf`,
      });
    }

    if (!Number.isFinite(iamId) || iamId <= 0) {
      return json(400, { ok: false, error: 'Informe iam_control_aluno_id válido.' });
    }

    const params = new URLSearchParams({
      iam_control_aluno_id: String(iamId),
    });
    if (produto) params.set('produto', produto);

    const metaRes = await fetchIam(`/webhooks/gestao-contas/contrato?${params.toString()}`);
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok) {
      return json(metaRes.status, {
        ok: false,
        error: meta?.message ?? meta?.error ?? 'Contrato não encontrado no IAM Control.',
      });
    }

    if (meta.signed_file_url) {
      return json(200, {
        ok: true,
        contrato_id: meta.contrato_id,
        treinamento: meta.treinamento,
        signed_file_url: meta.signed_file_url,
      });
    }

    const pdfRes = await fetchIam(
      `/webhooks/gestao-contas/contrato/${encodeURIComponent(meta.contrato_id)}/pdf`,
      { headers: { Accept: 'application/pdf' } },
    );
    if (!pdfRes.ok) {
      const texto = await pdfRes.text().catch(() => '');
      return json(pdfRes.status, {
        ok: false,
        error: 'Contrato localizado, mas o PDF não pôde ser gerado.',
        detalhe: texto.slice(0, 300),
      });
    }
    const bytes = await pdfRes.arrayBuffer();
    return json(200, {
      ok: true,
      contrato_id: meta.contrato_id,
      treinamento: meta.treinamento,
      pdf_base64: arrayBufferToBase64(bytes),
      filename: `contrato-${meta.contrato_id}.pdf`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { ok: false, error: msg });
  }
});
