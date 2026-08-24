import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(/\/+$/, '');
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) {
    return json({ ok: false, error: 'IAM_CONTROL_WEBHOOK_TOKEN não configurado no GC.' });
  }

  try {
    const url = new URL(`${apiUrl}/webhooks/gestao-contas/clientes`);
    url.searchParams.set('limit', '20');
    url.searchParams.set('page', '1');
    url.searchParams.set('atualizado_desde', new Date(Date.now() - 7 * 86400000).toISOString());

    const res = await fetch(url.toString(), {
      headers: { 'x-webhook-token': token, Accept: 'application/json' },
    });
    const texto = await res.text();
    if (!res.ok) {
      return json({ ok: false, error: `IAM Control respondeu ${res.status}`, detalhe: texto.slice(0, 300) });
    }

    const body = JSON.parse(texto) as { clientes?: unknown[] };
    const clientes = Array.isArray(body.clientes) ? body.clientes : [];

    let treinamentos = 0;
    let comStatus = 0;
    let comContratoId = 0;
    let pendentes = 0;

    for (const c of clientes) {
      const cliente = c as { matriculas?: Array<{ treinamentos?: Array<Record<string, unknown>> }> };
      for (const m of cliente.matriculas ?? []) {
        for (const t of m.treinamentos ?? []) {
          treinamentos++;
          if (t.status_conciliacao != null) comStatus++;
          if (t.contrato_id != null) comContratoId++;
          if (String(t.status_conciliacao ?? '').toUpperCase() === 'PENDENTE') pendentes++;
        }
      }
    }

    const apiAtualizada = treinamentos === 0 || (comStatus > 0 && comContratoId > 0);
    const pushGcConfigurado = Boolean(Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN'));

    return json({
      ok: true,
      api_atualizada: apiAtualizada,
      push_gc_token_ok: pushGcConfigurado,
      amostra_clientes: clientes.length,
      amostra_treinamentos: treinamentos,
      treinamentos_com_status: comStatus,
      treinamentos_com_contrato_id: comContratoId,
      treinamentos_pendentes: pendentes,
      aviso: apiAtualizada
        ? pendentes === 0 && treinamentos > 0
          ? 'API atualizada, mas nenhum contrato PENDENTE na amostra recente.'
          : null
        : 'Backend IAM desatualizado na VPS: vendas Pendente (link/PIX) não entram no GC até redeploy + GESTAO_CONTAS_CLOUD_ANON_KEY.',
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
