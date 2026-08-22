import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Tokens conhecidos do IAM Control (espelho dos guards no backend). */
const TOKENS_CONHECIDOS = [
  // Token dedicado Gestão de Contas (preferencial)
  'iamctrl_gc_1aa30225c9cd186138cb0a3a967d921a285455dc79afec835fd2b69a6a01dfff',
  // Token mestre de webhooks (legado / debug)
  'iamctrl_whk_20ce9fca6b56a9ae32162eb6c4087da2d9116f6234aeb9aec050bcbe371daa5d',
];

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function tokenOk(req: Request, esperados: string[]): boolean {
  const enviado =
    req.headers.get('x-webhook-token') ??
    req.headers.get('X-Webhook-Token') ??
    '';
  if (!enviado || esperados.length === 0) return false;
  return esperados.some((esperado) => {
    if (!esperado || enviado.length !== esperado.length) return false;
    let diff = 0;
    for (let i = 0; i < esperado.length; i++) {
      diff |= enviado.charCodeAt(i) ^ esperado.charCodeAt(i);
    }
    return diff === 0;
  });
}

function extrairClientes(corpo: unknown): unknown[] {
  if (corpo == null) return [];
  if (Array.isArray(corpo)) return corpo;
  if (typeof corpo !== 'object') return [];
  const o = corpo as Record<string, unknown>;
  if (Array.isArray(o.clientes)) return o.clientes;
  if (o.cliente && typeof o.cliente === 'object') return [o.cliente];
  if (o.iam_control_aluno_id != null || o.nome != null) return [o];
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST' });

  const tokens = Array.from(
    new Set(
      [
        Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '',
        Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN_ALT') ?? '',
        ...TOKENS_CONHECIDOS,
      ].filter(Boolean),
    ),
  );
  if (!tokenOk(req, tokens)) {
    return json(401, { ok: false, error: 'Token do webhook inválido' });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return json(400, { ok: false, error: 'JSON inválido' });
  }

  const clientes = extrairClientes(corpo);
  if (clientes.length === 0) {
    return json(400, { ok: false, error: 'Nenhum cliente no body' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const resumo = { recebidos: clientes.length, criados: 0, atualizados: 0, ambiguos: 0, erros: 0, ocorrencias: [] as string[] };

  for (const cliente of clientes) {
    const { data, error } = await supabase.rpc('iam_control_upsert_student', { p: cliente });
    if (error) {
      resumo.erros++;
      if (resumo.ocorrencias.length < 25) resumo.ocorrencias.push(error.message);
      continue;
    }
    switch (data?.acao) {
      case 'criado':
        resumo.criados++;
        break;
      case 'atualizado':
        resumo.atualizados++;
        break;
      case 'ambiguo':
        resumo.ambiguos++;
        break;
      default:
        break;
    }
  }

  return json(200, { ok: resumo.erros === 0, resumo });
});
