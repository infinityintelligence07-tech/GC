import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const IAM_URL = Deno.env.get('IAM_CONTROL_API_URL') ?? '';
const IAM_TOKEN = Deno.env.get('IAM_CONTROL_WEBHOOK_TOKEN') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BATCH = 500;
const PAGE = 1000;

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  status: string | null;
  status_cancelamento: string | null;
  iam_control_aluno_id: number | null;
};

type CaseRow = {
  id: string;
  student_id: string | null;
  student_name: string | null;
  student_whatsapp: string | null;
  funnel_stage: string | null;
  stage: string | null;
  acao: string | null;
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

/** Cadastro manual da aba Cancelamentos, com ou sem ficha na aba Alunos. */
function mapCaseStatus(r: CaseRow): 'Cancelamento solicitado' | 'Cancelado' | null {
  const acao = (r.acao ?? '').toLowerCase();
  const stage = (r.stage ?? '').toLowerCase();
  const funnel = (r.funnel_stage ?? '').toLowerCase();
  if (acao === 'revertido' || stage === 'recuperado') return null;
  if (acao === 'cancelado' || stage === 'cancelado' || funnel === 'finalizado') return 'Cancelado';
  return 'Cancelamento solicitado';
}

function normalizePhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) d = d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

function normalizeEmail(raw: unknown): string {
  const e = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!e || !e.includes('@')) return '';
  return /^[^@\s]+@[^@\s.]+\.[a-z]{2,}$/.test(e) ? e : '';
}

function itemFromStudent(r: Row, status: string): Record<string, unknown> {
  const email = normalizeEmail(r.email);
  const telefone = normalizePhone(r.whatsapp);
  return {
    ...(r.iam_control_aluno_id != null ? { iam_control_aluno_id: r.iam_control_aluno_id } : {}),
    gestao_contas_student_id: r.id,
    nome: r.name ?? '',
    ...(email ? { email } : {}),
    telefone,
    status,
    inadimplente: false,
  };
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

    // Body opcional: sem body sincroniza alunos em cancelamento + cadastros manuais.
    let studentIds: string[] | null = null;
    let caseIds: string[] | null = null;
    try {
      const raw = await req.text();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.student_ids)) {
          studentIds = parsed.student_ids.filter((v: unknown) => typeof v === 'string');
        }
        if (Array.isArray(parsed?.case_ids)) {
          caseIds = parsed.case_ids.filter((v: unknown) => typeof v === 'string');
        }
      }
    } catch (_) {
      // body inválido → trata como sem body
    }

    const soCasos = Boolean(caseIds && caseIds.length > 0) && !(studentIds && studentIds.length > 0);

    const rowsById = new Map<string, Row>();
    if (!soCasos) {
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from('students')
          .select('id, name, email, whatsapp, status, status_cancelamento, iam_control_aluno_id')
          .or(
            'status_cancelamento.in.(cancelado,solicitado,aguardando_conciliacao),status.eq.Cancelado',
          )
          .range(from, from + PAGE - 1);
        if (studentIds && studentIds.length > 0) q = q.in('id', studentIds);

        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        for (const r of (data ?? []) as Row[]) rowsById.set(r.id, r);
        if (!data || data.length < PAGE) break;
      }
    }

    const cases: CaseRow[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase
        .from('cancellation_cases')
        .select('id, student_id, student_name, student_whatsapp, funnel_stage, stage, acao')
        .eq('external_import', true)
        .range(from, from + PAGE - 1);
      if (caseIds && caseIds.length > 0) q = q.in('id', caseIds);

      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      cases.push(...((data ?? []) as CaseRow[]));
      if (!data || data.length < PAGE) break;
    }

    // Casos vinculados a ficha: carrega contato + iam_control_aluno_id.
    // Sem isso o push só com case_ids ia sem e-mail e o IAM não atualizava a turma.
    const linkedIds = [
      ...new Set(
        cases
          .map((c) => c.student_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0 && !rowsById.has(id)),
      ),
    ];
    for (let i = 0; i < linkedIds.length; i += PAGE) {
      const chunk = linkedIds.slice(i, i + PAGE);
      const { data, error } = await supabase
        .from('students')
        .select('id, name, email, whatsapp, status, status_cancelamento, iam_control_aluno_id')
        .in('id', chunk);
      if (error) return json({ error: error.message }, 500);
      for (const r of (data ?? []) as Row[]) {
        // Cadastro manual já marca a ficha; se ainda não estiver em cancelamento,
        // trata como solicitado para o IAM (espelha o caso ativo).
        if (!r.status_cancelamento || r.status_cancelamento === 'nenhum') {
          r.status_cancelamento = 'solicitado';
          if (!r.status || !String(r.status).toLowerCase().includes('cancela')) {
            r.status = 'Solicitação Cancelamento';
          }
        }
        rowsById.set(r.id, r);
      }
    }

    const studentIdsJa = new Set(rowsById.keys());

    const itens = [
      ...[...rowsById.values()]
        .map((r) => {
          const status = mapStatus(r);
          if (!status) return null;
          return itemFromStudent(r, status);
        })
        .filter(Boolean),
      ...cases
        .map((c) => {
          // Ficha vinculada já vai pelo caminho do aluno (com e-mail / iam id).
          if (c.student_id && studentIdsJa.has(c.student_id)) return null;
          const status = mapCaseStatus(c);
          if (!status) return null;
          const telefone = normalizePhone(c.student_whatsapp);
          return {
            gestao_contas_student_id: c.student_id || `caso-${c.id}`,
            nome: c.student_name ?? '',
            telefone,
            status,
            inadimplente: false,
          };
        })
        .filter(Boolean),
    ] as Record<string, unknown>[];

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
            if (
              !resultado.includes('nao_encontrado') &&
              !resultado.includes('ambiguo') &&
              !resultado.includes('não_encontrado')
            ) {
              continue;
            }
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
