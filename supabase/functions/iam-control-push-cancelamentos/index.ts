import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const IAM_URL = Deno.env.get('IAM_CONTROL_API_URL') ?? '';
const IAM_TOKEN = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BATCH = 500;

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  status: string | null;
  status_cancelamento: string | null;
  iam_control_aluno_id?: string | null;
};

function mapStatus(r: Row): 'Cancelamento solicitado' | 'Cancelado' | null {
  const sc = (r.status_cancelamento ?? '').toLowerCase();
  const st = (r.status ?? '').toLowerCase();
  if (sc === 'cancelado' || st === 'cancelado') return 'Cancelado';
  if (
    sc === 'solicitado' ||
    sc === 'aguardando_conciliacao' ||
    st.includes('solicita')
  ) {
    return 'Cancelamento solicitado';
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    if (!IAM_URL || !IAM_TOKEN) {
      return json({ error: 'IAM_CONTROL_API_URL/IAM_CONTROL_WEBHOOK_TOKEN não configurados' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Body é opcional: sem body sincroniza todos os cancelamentos.
    let studentIds: string[] | null = null;
    try {
      const raw = await req.text();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.student_ids)) {
          studentIds = parsed.student_ids.filter((v: unknown) => typeof v === 'string');
        }
      }
    } catch (_) {
      // body inválido → trata como sem body
    }

    const rows: Row[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('students')
        .select('id, name, email, whatsapp, status, status_cancelamento')
        .or(
          'status_cancelamento.in.(cancelado,solicitado,aguardando_conciliacao),status.eq.Cancelado',
        )
        .range(from, from + PAGE - 1);
      if (studentIds && studentIds.length > 0) q = q.in('id', studentIds);

      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }

    const itens = rows
      .map((r) => {
        const status = mapStatus(r);
        if (!status) return null;
        return {
          gestao_contas_student_id: r.id,
          nome: r.name ?? '',
          email: r.email ?? '',
          telefone: r.whatsapp ?? '',
          status,
          inadimplente: false,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    let respostaBruta = '';
    let enviados = 0;
    let lotes = 0;
    const erros: string[] = [];
    const problemas: Record<string, unknown>[] = [];

    const byId = new Map(itens.map((it) => [String(it.gestao_contas_student_id), it]));

    for (let i = 0; i < itens.length; i += BATCH) {
      const lote = itens.slice(i, i + BATCH);
      lotes++;
      const url = `${IAM_URL.replace(/\/$/, '')}/webhooks/gestao-contas/status`;
      const send = (payload: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-webhook-token': IAM_TOKEN },
          body: JSON.stringify(payload),
        });

      let res = await send({ somente_cancelamentos: true, itens: lote });
      let text = await res.text();
      // Alguns ambientes do IAM Control rejeitam campos extras no body.
      if (!res.ok && text.includes('somente_cancelamentos')) {
        res = await send({ itens: lote });
        text = await res.text();
      }
      if (!res.ok) {
        erros.push(`lote ${lotes}: HTTP ${res.status} ${text.slice(0, 200)}`);
      } else {
        enviados += lote.length;
        // Extrai resultados por item, quando o IAM devolve detalhamento.
        try {
          const parsed = JSON.parse(text);
          const lista: Record<string, unknown>[] = Array.isArray(parsed)
            ? parsed
            : (parsed?.resultados ?? parsed?.itens ?? parsed?.detalhes ?? parsed?.results ?? []);
          for (const r of lista ?? []) {
            const resultado = String(
              (r as Record<string, unknown>)?.resultado ??
                (r as Record<string, unknown>)?.status_processamento ??
                (r as Record<string, unknown>)?.result ??
                '',
            ).toLowerCase();
            if (!resultado.includes('nao_encontrado') && !resultado.includes('ambiguo') && !resultado.includes('não_encontrado')) continue;
            const gid = String((r as Record<string, unknown>)?.gestao_contas_student_id ?? '');
            const orig = byId.get(gid);
            problemas.push({
              resultado,
              gestao_contas_student_id: gid,
              nome: orig?.nome ?? (r as Record<string, unknown>)?.nome ?? '',
              email: orig?.email ?? (r as Record<string, unknown>)?.email ?? '',
              telefone: orig?.telefone ?? (r as Record<string, unknown>)?.telefone ?? '',
              mensagem:
                (r as Record<string, unknown>)?.mensagem ??
                (r as Record<string, unknown>)?.message ??
                (r as Record<string, unknown>)?.motivo ??
                '',
            });
          }
        } catch (_) {
          // resposta sem JSON estruturado
        }
        if (!respostaBruta) respostaBruta = text.slice(0, 4000);
      }
    }

    return json({
      resumo: { total: itens.length, enviados, lotes, erros: erros.length, ocorrencias: erros },
      problemas,
      resposta_iam: respostaBruta,
    });

  } catch (err) {
    console.error('[iam-control-push-cancelamentos]', err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
