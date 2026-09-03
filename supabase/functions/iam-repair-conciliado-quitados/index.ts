import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TAMANHO_PAGINA = 200;
const MAX_PAGINAS_CAP = 60;
const TIMEOUT_MS = 30_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Opcoes {
  /** Só lista o que seria reparado; não grava nada. */
  dry_run: boolean;
  /** Restringe aos clientes com estes iam_control_aluno_id. */
  iam_aluno_ids: number[] | null;
  /** Só clientes alterados no IAM a partir desta data (ISO). */
  atualizado_desde: string | null;
  max_paginas: number;
}

interface Resumo {
  clientes: number;
  clientes_filtrados: number;
  treinamentos: number;
  reparados: number;
  ja_corretos: number;
  ignorados: number;
  erros: number;
  paginas: number;
  amostra: unknown[];
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function lerOpcoes(req: Request): Promise<Opcoes> {
  const padrao: Opcoes = { dry_run: false, iam_aluno_ids: null, atualizado_desde: null, max_paginas: MAX_PAGINAS_CAP };
  if (req.method !== 'POST') return padrao;
  try {
    const corpo = await req.json();
    const ids = Array.isArray(corpo?.iam_aluno_ids)
      ? corpo.iam_aluno_ids.map((v: unknown) => Number(v)).filter((n: number) => Number.isFinite(n))
      : null;
    const maxRaw = Number(corpo?.max_paginas);
    return {
      dry_run: corpo?.dry_run === true,
      iam_aluno_ids: ids && ids.length > 0 ? ids : null,
      atualizado_desde: typeof corpo?.atualizado_desde === 'string' ? corpo.atualizado_desde : null,
      max_paginas:
        Number.isFinite(maxRaw) && maxRaw > 0 ? Math.min(Math.floor(maxRaw), MAX_PAGINAS_CAP) : MAX_PAGINAS_CAP,
    };
  } catch {
    return padrao;
  }
}

async function buscarPagina(apiUrl: string, token: string, page: number, atualizadoDesde: string | null) {
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

  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(/\/+$/, '');
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) {
    return json(500, { ok: false, error: 'Secret IAM_CONTROL_WEBHOOK_TOKEN nao configurado.' });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const opcoes = await lerOpcoes(req);
  const filtroIds = opcoes.iam_aluno_ids ? new Set(opcoes.iam_aluno_ids) : null;
  const limiteAmostra = opcoes.dry_run ? 300 : 100;

  const resumo: Resumo = {
    clientes: 0,
    clientes_filtrados: 0,
    treinamentos: 0,
    reparados: 0,
    ja_corretos: 0,
    ignorados: 0,
    erros: 0,
    paginas: 0,
    amostra: [],
  };

  let page = 1;
  let totalPaginas = 1;

  try {
    while (page <= totalPaginas && resumo.paginas < opcoes.max_paginas) {
      const corpo = await buscarPagina(apiUrl, token, page, opcoes.atualizado_desde);
      totalPaginas = Number(corpo?.total_pages ?? 1) || 1;
      const clientes: unknown[] = Array.isArray(corpo?.clientes) ? corpo.clientes : [];
      resumo.paginas++;

      for (const cliente of clientes) {
        resumo.clientes++;
        const iamId = Number((cliente as { iam_control_aluno_id?: unknown })?.iam_control_aluno_id);
        if (filtroIds && !filtroIds.has(iamId)) continue;
        resumo.clientes_filtrados++;

        const { data, error } = await supabase.rpc('iam_repair_conciliado_quitados_from_cliente', {
          p: cliente,
          p_dry_run: opcoes.dry_run,
        });
        if (error) {
          resumo.erros++;
          if (resumo.amostra.length < limiteAmostra) resumo.amostra.push({ erro: error.message, iam_control_aluno_id: iamId });
          continue;
        }

        const r = data as {
          treinamentos?: number;
          reparados?: number;
          ja_corretos?: number;
          ignorados?: number;
          detalhes?: Array<{ acao?: string }>;
        };
        resumo.treinamentos += Number(r?.treinamentos ?? 0);
        resumo.reparados += Number(r?.reparados ?? 0);
        resumo.ja_corretos += Number(r?.ja_corretos ?? 0);
        resumo.ignorados += Number(r?.ignorados ?? 0);

        for (const det of r?.detalhes ?? []) {
          if ((det?.acao === 'reparado' || det?.acao === 'reparavel') && resumo.amostra.length < limiteAmostra) {
            resumo.amostra.push(det);
          }
        }
      }

      page++;
      if (clientes.length === 0) break;
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return json(502, { ok: false, error: mensagem, page_atual: page, resumo });
  }

  return json(200, {
    ok: true,
    modo: opcoes.dry_run ? 'dry_run' : 'reparo',
    filtro_iam_aluno_ids: opcoes.iam_aluno_ids,
    atualizado_desde: opcoes.atualizado_desde,
    total_paginas: totalPaginas,
    incompleto: page <= totalPaginas,
    resumo,
  });
});
