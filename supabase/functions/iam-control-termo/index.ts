import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TIMEOUT_MS = 60_000;

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

async function fetchIam(path: string, init?: RequestInit): Promise<Response> {
  const cfg = lerIamConfig();
  if (!cfg) throw new Error('IAM_CONTROL_WEBHOOK_TOKEN não configurado.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${cfg.apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-webhook-token': cfg.token,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
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

  const action = typeof body.action === 'string' ? body.action.trim() : 'create';

  try {
    if (action === 'list_templates') {
      const res = await fetchIam('/webhooks/gestao-contas/termos/templates');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return json(res.status, {
          ok: false,
          error: data?.message ?? data?.error ?? 'Não foi possível listar templates de termo.',
        });
      }
      return json(200, data);
    }

    if (action !== 'create') {
      return json(400, { ok: false, error: 'Ação inválida. Use list_templates ou create.' });
    }

    const iamIdRaw = body.iam_control_aluno_id;
    const iamId = typeof iamIdRaw === 'number' ? iamIdRaw : Number(iamIdRaw);
    if (!Number.isFinite(iamId) || iamId <= 0) {
      return json(400, { ok: false, error: 'Informe iam_control_aluno_id válido.' });
    }

    const payload: Record<string, unknown> = {
      iam_control_aluno_id: iamId,
    };

    const optionalStringFields = [
      'template_id',
      'termo_titulo',
      'texto_introducao',
      'clausulas',
      'observacoes',
      'local_assinatura',
    ] as const;

    for (const field of optionalStringFields) {
      const value = body[field];
      if (typeof value === 'string' && value.trim()) payload[field] = value.trim();
    }

    if (body.campos_variaveis && typeof body.campos_variaveis === 'object' && !Array.isArray(body.campos_variaveis)) {
      payload.campos_variaveis = body.campos_variaveis;
    }

    const res = await fetchIam('/webhooks/gestao-contas/termos/zapsign', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json(res.status, {
        ok: false,
        error: data?.message ?? data?.error ?? 'Não foi possível gerar o termo na ZapSign.',
        detalhe: typeof data?.detalhe === 'string' ? data.detalhe : undefined,
      });
    }

    return json(200, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(500, { ok: false, error: msg });
  }
});
