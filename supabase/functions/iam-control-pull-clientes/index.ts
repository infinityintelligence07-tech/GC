import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { aplicarResumoUpsertIam } from '../_shared/iamUpsertResumo.ts';

const SYNC_STATE_ID = 'clientes';
const TAMANHO_PAGINA = 200;
const MAX_PAGINAS_DEFAULT = 5;
const MAX_PAGINAS_CAP = 20;
const TIMEOUT_MS = 30_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Opcoes {
  completo: boolean;
  desde: string | null;
  max_paginas: number;
  page_inicio: number | null;
}

interface Resumo {
  recebidos: number;
  criados: number;
  atualizados: number;
  ambiguos: number;
  ignorados: number;
  erros: number;
  ocorrencias: string[];
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function lerOpcoes(req: Request): Promise<Opcoes> {
  if (req.method !== 'POST') {
    return { completo: false, desde: null, max_paginas: MAX_PAGINAS_DEFAULT, page_inicio: null };
  }
  try {
    const corpo = await req.json();
    const maxRaw = Number(corpo?.max_paginas);
    const max_paginas =
      Number.isFinite(maxRaw) && maxRaw > 0
        ? Math.min(Math.floor(maxRaw), MAX_PAGINAS_CAP)
        : MAX_PAGINAS_DEFAULT;
    const pageRaw = Number(corpo?.page_inicio);
    return {
      completo: corpo?.completo === true,
      desde: typeof corpo?.desde === 'string' ? corpo.desde : null,
      max_paginas,
      page_inicio: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : null,
    };
  } catch {
    return { completo: false, desde: null, max_paginas: MAX_PAGINAS_DEFAULT, page_inicio: null };
  }
}

async function buscarPagina(
  apiUrl: string,
  token: string,
  page: number,
  atualizadoDesde: string | null,
) {
  const url = new URL(`${apiUrl}/webhooks/gestao-contas/clientes`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(TAMANHO_PAGINA));
  if (atualizadoDesde) url.searchParams.set('atualizado_desde', atualizadoDesde);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(url.toString(), {
      headers: { 'x-webhook-token': token, Accept: 'application/json' },
      signal: controller.signal,
    });
    const texto = await resposta.text();
    if (!resposta.ok) {
      throw new Error(`IAM Control respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
    }
    return JSON.parse(texto);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const inicio = Date.now();

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
  const opcoes = await lerOpcoes(req);

  const { data: estado } = await supabase
    .from('iam_control_sync_state')
    .select('last_synced_at, last_result')
    .eq('id', SYNC_STATE_ID)
    .maybeSingle();

  const atualizadoDesde = opcoes.completo
    ? null
    : (opcoes.desde ?? estado?.last_synced_at ?? null);
  const pageCursorSalvo = Number(
    (estado?.last_result as { proxima_pagina?: number } | null)?.proxima_pagina,
  );
  let page =
    opcoes.page_inicio ??
    (opcoes.completo && Number.isFinite(pageCursorSalvo) && pageCursorSalvo >= 1
      ? pageCursorSalvo
      : 1);

  const resumo: Resumo = {
    recebidos: 0,
    criados: 0,
    atualizados: 0,
    ambiguos: 0,
    ignorados: 0,
    erros: 0,
    ocorrencias: [],
  };
  let sincronizadoAte: string | null = null;
  let totalPaginas = 1;
  let paginasProcessadas = 0;
  let continuar = false;

  try {
    while (paginasProcessadas < opcoes.max_paginas) {
      const corpo = await buscarPagina(apiUrl, token, page, atualizadoDesde);
      totalPaginas = Number(corpo?.total_pages ?? 1) || 1;
      sincronizadoAte = corpo?.sincronizado_ate ?? sincronizadoAte;
      const clientes: unknown[] = Array.isArray(corpo?.clientes) ? corpo.clientes : [];

      for (const cliente of clientes) {
        resumo.recebidos++;
        const { data, error } = await supabase.rpc('iam_control_upsert_student', { p: cliente });
        if (error) {
          resumo.erros++;
          if (resumo.ocorrencias.length < 25) resumo.ocorrencias.push(error.message);
          continue;
        }
        aplicarResumoUpsertIam(data, resumo);
      }

      paginasProcessadas++;
      page++;
      if (page > totalPaginas) break;
      if (clientes.length === 0) break;
    }
    continuar = page <= totalPaginas;
  } catch (erro) {
    resumo.erros++;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    resumo.ocorrencias.push(mensagem);
    await supabase.from('iam_control_sync_state').upsert({
      id: SYNC_STATE_ID,
      last_run_at: new Date().toISOString(),
      last_result: { ...resumo, falhou_na_pagina: page, proxima_pagina: page, continuar: true },
    });
    return json(502, { ok: false, error: mensagem, page_atual: page, resumo });
  }

  const cicloCompleto = !continuar && resumo.erros === 0;
  await supabase.from('iam_control_sync_state').upsert({
    id: SYNC_STATE_ID,
    last_run_at: new Date().toISOString(),
    ...(cicloCompleto && sincronizadoAte ? { last_synced_at: sincronizadoAte } : {}),
    last_result: {
      ...resumo,
      proxima_pagina: continuar ? page : 1,
      continuar,
      total_paginas: totalPaginas,
    },
  });

  return json(200, {
    ok: true,
    modo: opcoes.completo ? 'completo' : 'incremental',
    atualizado_desde: atualizadoDesde,
    sincronizado_ate: cicloCompleto ? sincronizadoAte : (estado?.last_synced_at ?? null),
    page_proxima: continuar ? page : null,
    page_atual: page - 1,
    total_paginas: totalPaginas,
    continuar,
    duracao_ms: Date.now() - inicio,
    resumo,
  });
});
