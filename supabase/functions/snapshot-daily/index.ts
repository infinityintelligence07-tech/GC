// Daily dashboard snapshot generator.
// Writes one row per (snapshot_date, company_id) into public.dashboard_snapshots
// capturing the FROZEN state of each student's installments/status as of the
// snapshot_date (Brasília timezone).
//
// Invoked by pg_cron every day at 03:05 UTC (00:05 Brasília) and can also be
// invoked manually for a specific date via POST { "date": "YYYY-MM-DD" }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Installment = {
  number: number;
  dueDate: string;
  value: number;
  paid: boolean;
  paidDate?: string | null;
  paidValue?: number | null;
  tags?: string[] | null;
  tipoParcela?: string | null;
  valorReal?: number | null;
  valorContabil?: number | null;
  numeroOriginal?: number | null;
  observacao?: string | null;
};

function todayBrasiliaISO(): string {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const br = new Date(utc - 3 * 3600 * 1000);
  return br.toISOString().slice(0, 10);
}

// Espelha `effectiveDueDate` do frontend (src/lib/brasiliaDate.ts): parcelas
// que caem em sáb/dom rolam para a próxima segunda antes de contar como vencidas.
function effectiveDueDate(dueDateStr: string): Date {
  const d = new Date(dueDateStr + "T00:00:00");
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// IMPORTANTE: as regras aqui têm que refletir EXATAMENTE o `calculateAutoStatusAt`
// do frontend (src/store/useAppStore.ts). Caso contrário, o modo Histórico
// mostra números diferentes do modo Performance para a MESMA data.
//
// Regras (idem ao ao vivo):
//   - Pago: todas as parcelas pagas até a data de referência.
//   - Aluno Novo: 0 pagas + 0 vencidas + mais de 1 parcela cadastrada.
//   - Em Dia: sem parcelas vencidas.
//   - Vencido 1: maior atraso ≤ 30d.
//   - Vencido 2: 31–60d.
//   - À Negativar: > 60d.
//   - "Negativado" só é setado MANUALMENTE (nunca automático) — preservado via status_mode='Manual'.
//   - Vencimento efetivo: sáb/dom rolam para 2ª (via effectiveDueDate).
function calcStatusAt(
  installments: Installment[],
  refISO: string
): string {
  const ref = new Date(refISO + "T23:59:59");
  const refDayStart = new Date(refISO + "T00:00:00");
  const paidAtRef = installments.filter(
    (i) => i.paid && i.paidDate && new Date(i.paidDate + "T00:00:00") <= ref
  );
  const unpaidAtRef = installments.filter((i) => !paidAtRef.includes(i));
  if (
    installments.length > 0 &&
    paidAtRef.length === installments.length
  ) {
    return "Pago";
  }
  const overdue = unpaidAtRef.filter(
    (i) => effectiveDueDate(i.dueDate).getTime() < refDayStart.getTime()
  );
  if (overdue.length === 0) {
    if (paidAtRef.length === 0 && installments.length > 1) return "Aluno Novo";
    return "Em Dia";
  }
  const oldest = overdue.reduce((min, i) => {
    const d = Math.floor(
      (refDayStart.getTime() - effectiveDueDate(i.dueDate).getTime()) / 86400000
    );
    return d > min ? d : min;
  }, 0);
  if (oldest <= 30) return "Vencido 1";
  if (oldest <= 60) return "Vencido 2";
  return "À Negativar";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Padrão: foto do DIA ANTERIOR (Brasília). O cron roda ~00:05 e precisa
    // congelar o dia que acabou de fechar — não o dia que acabou de começar.
    let snapshotDate = (() => {
      const today = todayBrasiliaISO();
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
          snapshotDate = body.date;
        } else if (body?.today === true) {
          snapshotDate = todayBrasiliaISO();
        }
      } catch (_) {
        // ignore body parse errors, use yesterday
      }
    }

    const { data: companies, error: cErr } = await supabase
      .from("companies")
      .select("id, slug, name");
    if (cErr) throw cErr;

    const results: Array<{ company_id: string; students: number }> = [];

    for (const c of companies ?? []) {
      const { data: students, error: sErr } = await supabase
        .from("students")
        .select(
          "id, name, ac, product, status, status_mode, is_renda_extra, renda_extra_status, status_cancelamento, enrollment_date, installments, tags"
        )
        .eq("company_id", c.id);
      if (sErr) throw sErr;

      const eligible = (students ?? []).filter(
        (s: any) =>
          !s.enrollment_date ||
          new Date(s.enrollment_date).toISOString().slice(0, 10) <= snapshotDate
      );

      const refEnd = new Date(snapshotDate + "T23:59:59");
      const payload = eligible.map((s: any) => {
        const inst: Installment[] = Array.isArray(s.installments)
          ? s.installments
          : [];
        // Freeze each installment's paid state to the snapshot date.
        const frozenInst = inst.map((i) => {
          const wasPaid = !!(
            i.paid &&
            i.paidDate &&
            new Date(i.paidDate + "T00:00:00") <= refEnd
          );
          return {
            number: i.number,
            dueDate: i.dueDate,
            value: Number(i.value || 0),
            paid: wasPaid,
            paidDate: wasPaid ? i.paidDate : null,
            paidValue: wasPaid ? i.paidValue ?? i.value : null,
            tags: i.tags ?? [],
            // Preservados p/ paridade com o Performance (score/valor financeiro):
            tipoParcela: i.tipoParcela ?? null,
            valorReal: i.valorReal ?? null,
            valorContabil: i.valorContabil ?? null,
            numeroOriginal: i.numeroOriginal ?? null,
            observacao: i.observacao ?? null,
          };
        });
        // Preserva estados especiais (idem ao ao vivo):
        //  - Solicitação Cancelamento: quando o aluno tem case aberto (status_cancelamento='solicitado').
        //  - Renda Extra: quando a migração automática já rodou (is_renda_extra=true).
        //  - Manual (Negativado, etc.): preserva o valor manual.
        //  - Caso contrário: recalcula pelas mesmas regras do frontend.
        const statusAt =
          s.status_cancelamento === "solicitado"
            ? "Solicitação Cancelamento"
            : s.status_mode === "Manual"
              ? s.status
              : calcStatusAt(inst, snapshotDate);
        const totalOpen = frozenInst
          .filter((i) => !i.paid)
          .reduce((a, i) => a + Number(i.value || 0), 0);
        const totalPaid = frozenInst
          .filter((i) => i.paid)
          .reduce((a, i) => a + Number(i.paidValue ?? i.value ?? 0), 0);
        return {
          id: s.id,
          name: s.name,
          ac_id: s.ac,
          product: s.product,
          status: statusAt,
          status_mode: s.status_mode,
          is_renda_extra: s.is_renda_extra,
          renda_extra_status: s.renda_extra_status,
          status_cancelamento: s.status_cancelamento,
          enrollment_date: s.enrollment_date,
          tags: s.tags ?? [],
          
          total_open: totalOpen,
          total_paid: totalPaid,
          installments: frozenInst,
        };
      });

      const { error: uErr } = await supabase
        .from("dashboard_snapshots")
        .upsert(
          {
            snapshot_date: snapshotDate,
            company_id: c.id,
            payload,
            student_count: payload.length,
          },
          { onConflict: "snapshot_date,company_id" }
        );
      if (uErr) throw uErr;

      results.push({ company_id: c.id, students: payload.length });
    }

    return new Response(
      JSON.stringify({ ok: true, date: snapshotDate, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("snapshot-daily error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
