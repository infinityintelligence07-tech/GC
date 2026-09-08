import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

/**
 * Diagnóstico: procura clientes pelo nome na API do IAM Control e devolve o
 * payload bruto, para investigar por que um aluno não subiu no pull.
 * Somente leitura — não grava nada no GC.
 *
 * POST { nome: string, max_paginas?: number }
 */

const TAMANHO_PAGINA = 200;
const MAX_PAGINAS_CAP = 30;
const TIMEOUT_MS = 30_000;

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

function normalizar(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function buscarPagina(apiUrl: string, token: string, page: number) {
  const url = new URL(`${apiUrl}/webhooks/gestao-contas/clientes`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(TAMANHO_PAGINA));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'x-webhook-token': token, Accept: 'application/json' },
      signal: controller.signal,
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(`IAM Control respondeu ${res.status}: ${texto.slice(0, 300)}`);
    return JSON.parse(texto);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' });

  const apiUrl = (Deno.env.get('IAM_CONTROL_API_URL') ?? 'https://iamcontrol.com.br/api').replace(/\/+$/, '');
  const token = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
  if (!token) return json(500, { ok: false, error: 'Secret IAM_CONTROL_WEBHOOK_TOKEN nao configurado.' });

  let nomes: string[] = [];
  let maxPaginas = MAX_PAGINAS_CAP;
  try {
    const corpo = await req.json();
    const lista = Array.isArray(corpo?.nomes) ? corpo.nomes : [corpo?.nome];
    nomes = lista.map(normalizar).filter((n: string) => n.length >= 3);
    const m = Number(corpo?.max_paginas);
    if (Number.isFinite(m) && m > 0) maxPaginas = Math.min(Math.floor(m), MAX_PAGINAS_CAP);
  } catch {
    // corpo inválido → nomes vazio
  }
  if (nomes.length === 0) return json(400, { ok: false, error: 'Informe "nome" (ou "nomes") com pelo menos 3 letras.' });

  const encontrados: unknown[] = [];
  let totalPaginas = 1;
  let totalClientes = 0;
  let page = 1;
  try {
    while (page <= maxPaginas) {
      const corpo = await buscarPagina(apiUrl, token, page);
      totalPaginas = Number(corpo?.total_pages ?? 1) || 1;
      const clientes: Array<Record<string, unknown>> = Array.isArray(corpo?.clientes) ? corpo.clientes : [];
      totalClientes += clientes.length;
      for (const c of clientes) {
        const nomeCliente = normalizar(c.nome ?? c.name);
        if (nomes.some((n) => nomeCliente.includes(n))) encontrados.push({ pagina: page, cliente: c });
      }
      page++;
      if (page > totalPaginas || clientes.length === 0) break;
    }
  } catch (erro) {
    return json(502, {
      ok: false,
      error: erro instanceof Error ? erro.message : String(erro),
      pagina_falha: page,
      encontrados,
    });
  }

  return json(200, {
    ok: true,
    procurados: nomes,
    paginas_lidas: page - 1,
    total_paginas: totalPaginas,
    clientes_lidos: totalClientes,
    encontrados,
  });
});
