// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: auto-renda-extra
//
// Roda diariamente via pg_cron e executa duas rotinas que antes só rodavam
// quando alguém abria o app:
//   1) Migração para Renda Extra de alunos com >180 dias de inadimplência
//   2) Auto-release de Renda Extra cujo AC não fechou acordo em 72h
//
// Pode ser chamada também manualmente via POST.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function nowBrasiliaIso(): string {
  // ISO sempre em UTC, mas o relógio do Postgres é UTC mesmo — só usamos pra registros
  return new Date().toISOString();
}

function todayBrasiliaDate(): Date {
  // Calcula "hoje" no fuso de Brasília (America/Sao_Paulo, UTC-3)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const str = fmt.format(new Date()); // "2026-04-26"
  return new Date(str + 'T00:00:00');
}

interface Installment {
  paid: boolean;
  dueDate: string;
  value: number;
}

interface StudentRow {
  id: string;
  name: string;
  ac: string | null;
  status: string;
  status_cancelamento: string | null;
  is_renda_extra: boolean;
  renda_extra_status: string | null;
  renda_extra_ac: string | null;
  renda_extra_ac_assigned_at: string | null;
  renda_extra_inscription_date: string | null;
  enrollment_date: string | null;
  installments: Installment[] | string | null;
  history: any[] | string | null;
}

function parseJson<T>(v: T | string | null, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const result = {
    migrated180d: 0,
    released72h: 0,
    errors: [] as string[],
  };

  try {
    // ── Carrega todos os alunos relevantes ─────────────────────────────────
    const { data: students, error: stErr } = await supabase
      .from('students')
      .select('id,name,ac,status,status_cancelamento,is_renda_extra,renda_extra_status,renda_extra_ac,renda_extra_ac_assigned_at,renda_extra_inscription_date,enrollment_date,installments,history');
    if (stErr) throw stErr;

    const today = todayBrasiliaDate();
    const now = nowBrasiliaIso();

    // ── 1) Migração 180 dias ────────────────────────────────────────────────
    for (const raw of students ?? []) {
      const s = raw as StudentRow;
      if (s.is_renda_extra) continue;
      if (s.status_cancelamento === 'cancelado' || s.status_cancelamento === 'aguardando_conciliacao') continue;
      if (s.status === 'Excluído' || s.status === 'Quitado') continue;

      const installments = parseJson<Installment[]>(s.installments, []);
      const overdueUnpaid = installments.filter((i) => !i.paid && new Date(i.dueDate) < today);
      if (overdueUnpaid.length === 0) continue;

      const oldest = overdueUnpaid.reduce((o, c) => new Date(c.dueDate) < new Date(o.dueDate) ? c : o);
      const dias = Math.floor((today.getTime() - new Date(oldest.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (dias <= 180) continue;

      const history = parseJson<any[]>(s.history, []);
      const newHistory = [...history, {
        date: now,
        type: 'Sistema',
        text: 'Migração automática para Renda Extra (>180 dias de inadimplência). Aluno permanece em Negativado na carteira até conciliação.',
      }];

      const { error: upErr } = await supabase
        .from('students')
        .update({
          is_renda_extra: true,
          renda_extra_status: 'Conciliar Exclusão',
          renda_extra_inclusion_date: now.split('T')[0],
          renda_extra_inscription_date: s.renda_extra_inscription_date ?? s.enrollment_date,
          renda_extra_directed_at: now,
          history: newHistory,
        })
        .eq('id', s.id);

      if (upErr) {
        result.errors.push(`Migrar ${s.name}: ${upErr.message}`);
        continue;
      }

      // Espelha pendência em conciliação (exclusão Kamino)
      const saldoPendente = installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0);
      const { error: cErr } = await supabase
        .from('conciliacao_items')
        .insert({
          tipo: 'renda_extra_exclusao',
          student_id: s.id,
          student_name: s.name,
          ac: s.ac,
          resumo: `Migração AUTOMÁTICA para RENDA EXTRA — ${s.name} (>180 dias inadimplente — excluir aluno no Kamino)`,
          antes: { isRendaExtra: false, rendaExtraStatus: null },
          depois: { isRendaExtra: true, rendaExtraStatus: 'Conciliar Exclusão', saldoPendente, motivo: 'auto_180_dias' },
          status: 'pendente',
        });
      if (cErr) result.errors.push(`Conciliação ${s.name}: ${cErr.message}`);

      result.migrated180d++;
    }

    // ── 2) Auto-release 72h ────────────────────────────────────────────────
    const SETENTA_DUAS_H_MS = 72 * 60 * 60 * 1000;
    const nowMs = Date.now();
    for (const raw of students ?? []) {
      const s = raw as StudentRow;
      if (!s.is_renda_extra) continue;
      if (s.renda_extra_status !== 'Em Negociação') continue;
      if (!s.renda_extra_ac_assigned_at) continue;

      const diffMs = nowMs - new Date(s.renda_extra_ac_assigned_at).getTime();
      if (diffMs < SETENTA_DUAS_H_MS) continue;

      const history = parseJson<any[]>(s.history, []);
      const newHistory = [...history, {
        date: now,
        type: 'Sistema',
        text: `AC ${s.renda_extra_ac ?? ''} não finalizou acordo em 72h. Aluno devolvido para "Disponível Negociação".`,
      }];

      const { error: relErr } = await supabase
        .from('students')
        .update({
          renda_extra_ac: null,
          renda_extra_ac_assigned_at: null,
          renda_extra_status: 'Disponível Negociação',
          history: newHistory,
        })
        .eq('id', s.id);

      if (relErr) {
        result.errors.push(`Release ${s.name}: ${relErr.message}`);
        continue;
      }
      result.released72h++;
    }

    return new Response(JSON.stringify({ ok: true, ...result, ranAt: now }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    console.error('[auto-renda-extra] fatal:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
