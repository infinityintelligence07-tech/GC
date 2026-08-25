import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TAMANHO_PAGINA = 200;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Resumo {
  clientes: number;
  treinamentos: number;
  reparados: number;
  ja_corretos: number;
  ignorados: number;
  erros: number;
  amostra: unknown[];
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function buscarPagina(apiUrl: string, token: string, page: number) {
  const url = new URL(`${apiUrl}/webhooks/gestao-contas/clientes`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(TAMANHO_PAGINA));

  const resposta = await fetch(url.toString(), {
    headers: { 'x-webhook-token': token, Accept: 'application/json' },
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`IAM Control respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return JSON.parse(texto);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(
    /\/+$/,
    '',
  );
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) {
    return json(500, { ok: false, error: 'Secret IAM_CONTROL_WEBHOOK_TOKEN nao configurado.' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const resumo: Resumo = {
    clientes: 0,
    treinamentos: 0,
    reparados: 0,
    ja_corretos: 0,
    ignorados: 0,
    erros: 0,
    amostra: [],
  };

  let page = 1;
  let totalPaginas = 1;

  while (page <= totalPaginas) {
    const corpo = await buscarPagina(apiUrl, token, page);
    totalPaginas = Number(corpo?.total_pages ?? 1) || 1;
    const clientes: unknown[] = Array.isArray(corpo?.clientes) ? corpo.clientes : [];

    for (const cliente of clientes) {
      resumo.clientes++;
      const { data, error } = await supabase.rpc('iam_repair_conciliado_quitados_from_cliente', {
        p: cliente,
      });
      if (error) {
        resumo.erros++;
        if (resumo.amostra.length < 10) {
          resumo.amostra.push({ erro: error.message });
        }
        continue;
      }

      const r = data as {
        treinamentos?: number;
        reparados?: number;
        ja_corretos?: number;
        ignorados?: number;
        detalhes?: Array<{ acao?: string; nome?: string }>;
      };
      resumo.treinamentos += Number(r?.treinamentos ?? 0);
      resumo.reparados += Number(r?.reparados ?? 0);
      resumo.ja_corretos += Number(r?.ja_corretos ?? 0);
      resumo.ignorados += Number(r?.ignorados ?? 0);

      for (const det of r?.detalhes ?? []) {
        if (det?.acao === 'reparado' && resumo.amostra.length < 25) {
          resumo.amostra.push(det);
        }
      }
    }

    page++;
    if (clientes.length === 0) break;
  }

  return json(200, { ok: true, resumo });
});
