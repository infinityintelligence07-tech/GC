/**
 * Diagnóstico: por que a soma dos cards de status não bate com o card
 * "Carteira Total" da dashboard.
 *
 * Em vez de reescrever as regras, importa as funções reais do app e reproduz
 * exatamente as duas populações que a DashboardPage monta na visão padrão
 * (modo Performance, período Todos, base vencimento, sem filtros):
 *
 *   - cards de status  → kpiStudents agrupado por status
 *   - Carteira Total   → forecastBase com ao menos uma parcela em aberto
 *
 * Depois lista, nome a nome, quem está em uma lista e não na outra.
 *
 * Uso: npx vitest run --config vitest.diag.config.ts
 */
import fs from "node:fs";
import pg from "pg";
import { test } from "vitest";

import { rowToStudent, rowToCancellationCase } from "@/lib/supabaseMutations";
import { useAppStore, calculateAutoStatus } from "@/store/useAppStore";
import {
  countsInFinancialTotals,
  isInstallmentExcludedFromFinancialTotals,
  isIamConciliadoQuitadoAvista,
} from "@/lib/iamPendenteConciliacao";
import {
  cancelamentoOverridesFinancialStatus,
  filterCarteiraActiveStudents,
  matchesCancelamentoFilter,
} from "@/lib/acPortfolioVisibility";
import { isOperationalPendente } from "@/lib/studentDisplayStatus";
import { isRendaExtraAtivo } from "@/lib/rendaExtraEligibility";
import { isProductExcludedFromGc } from "@/lib/acEsteira";
import type { CancellationCase, Student, StudentTag } from "@/types";

const BUCKETS = [
  "Em Dia",
  "Aluno Novo",
  "Vencido 1",
  "Vencido 2",
  "À Negativar",
  "Negativado",
] as const;

function readDatabaseUrl(): string {
  const text = fs.readFileSync(".env", "utf8");
  const m = text.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL não encontrado em .env");
  return m[1].replaceAll('"', "");
}

async function conectar(): Promise<pg.Client> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const base = readDatabaseUrl().replace(/[?&]sslmode=[^&]*/g, "");
  const candidatos = [base];
  for (const [de, para] of [
    ["aws-0-", "aws-1-"],
    ["aws-1-", "aws-0-"],
  ]) {
    if (base.includes(de)) candidatos.push(base.replace(de, para));
  }
  for (const cs of candidatos) {
    const c = new pg.Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      return c;
    } catch {
      await c.end().catch(() => {});
    }
  }
  throw new Error("não foi possível conectar ao banco");
}

/** Mesma regra do useSupabaseSync: produtos fora do GC não chegam ao front. */
function isStudentHiddenFromGc(s: Student): boolean {
  if (isProductExcludedFromGc(s.product)) return true;
  return Boolean(s.iamControlAlunoId) && !String(s.product ?? "").trim();
}

const brl = (n: number) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function descrever(s: Student, statusExibido?: string): string {
  const inst = s.installments ?? [];
  const abertas = inst.filter((i) => !i.paid).length;
  return [
    `status="${statusExibido ?? s.status}"`,
    `statusMode=${s.statusMode}`,
    `parcelas=${inst.length} (${abertas} em aberto)`,
    `quitadoAvista=${isIamConciliadoQuitadoAvista(s)}`,
    s.statusCancelamento && s.statusCancelamento !== "nenhum"
      ? `cancelamento=${s.statusCancelamento}`
      : null,
    s.isRendaExtra ? `rendaExtra=${s.rendaExtraStatus ?? "sim"}` : null,
    `venda=${brl(Number(s.saleValue ?? 0))}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

test("diferença entre a soma dos cards de status e a Carteira Total", async () => {
  const client = await conectar();
  const q = async (sql: string) => (await client.query(sql)).rows as any[];

  const companies = await q("select id, name from public.companies order by name");
  const studentRows = await q("select * from public.students");
  const caseRows = await q("select * from public.cancellation_cases");
  const tagRows = await q("select * from public.student_tags");
  await client.end();

  // calculateAutoStatus lê o catálogo de tags do store para saber quais
  // parcelas são recompra/fundo — sem isso o status sai errado.
  useAppStore.setState({
    studentTags: tagRows.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? "",
    })) as StudentTag[],
  } as never);

  const todosCasos: CancellationCase[] = caseRows.map(rowToCancellationCase);

  for (const comp of companies) {
    const students: Student[] = studentRows
      .filter((r) => r.company_id === comp.id)
      .map(rowToStudent)
      .filter((s: Student) => !isStudentHiddenFromGc(s));

    if (students.length === 0) continue;

    const idsDaEmpresa = new Set(students.map((s) => s.id));
    const casos = todosCasos.filter(
      (c) => !c.studentId || idsDaEmpresa.has(c.studentId),
    );

    // ── kpiStudents, igual à DashboardPage (sem filtros, modo performance) ──
    const baseStudents = students.filter((s) => countsInFinancialTotals(s));
    const mapped = baseStudents.map((s) => {
      if (
        s.status === "Negativado" ||
        cancelamentoOverridesFinancialStatus(s) ||
        isOperationalPendente(s)
      ) {
        return cancelamentoOverridesFinancialStatus(s) && s.status !== "Cancelado"
          ? ({ ...s, status: "Solicitação Cancelamento" } as Student)
          : isOperationalPendente(s)
            ? ({ ...s, status: "Pendente" } as Student)
            : s;
      }
      if (s.statusMode === "Automático") {
        return { ...s, status: calculateAutoStatus(s.installments) } as Student;
      }
      return s;
    });
    const semPagos = filterCarteiraActiveStudents(mapped, "");
    const semCancelados = semPagos.filter((s) => s.statusCancelamento !== "cancelado");
    const kpiStudents = semCancelados.filter(
      (s) =>
        !(
          isRendaExtraAtivo(s) &&
          s.rendaExtraStatus &&
          s.rendaExtraStatus !== "Conciliar Exclusão"
        ),
    );

    const isSolic = (s: Student) => matchesCancelamentoFilter(s, casos);
    const cardDe = (s: Student): string | null => {
      if (isSolic(s)) return "Solicitação Cancelamento";
      return (BUCKETS as readonly string[]).includes(s.status) ? s.status : null;
    };

    // Mesma régua do sumUnpaid da DashboardPage (período Todos).
    const sumUnpaid = (arr: Student[]) =>
      arr.reduce((acc, s) => {
        if (s.statusCancelamento === "cancelado") return acc;
        if (isRendaExtraAtivo(s) && s.rendaExtraStatus !== "Conciliar Exclusão") return acc;
        return (
          acc +
          (s.installments ?? [])
            .filter((i) => !i.paid && !isInstallmentExcludedFromFinancialTotals(s, i))
            .reduce((a, i) => a + i.value, 0)
        );
      }, 0);

    const contagem: Record<string, number> = {};
    const valor: Record<string, number> = {};
    const porCard: Record<string, Student[]> = {};
    const emAlgumCard: Student[] = [];
    const semCard: Student[] = [];
    for (const s of kpiStudents) {
      const card = cardDe(s);
      if (card) {
        contagem[card] = (contagem[card] ?? 0) + 1;
        (porCard[card] ??= []).push(s);
        emAlgumCard.push(s);
      } else {
        semCard.push(s);
      }
    }
    for (const [card, lista] of Object.entries(porCard)) valor[card] = sumUnpaid(lista);

    // ── Carteira Total, igual ao getForecastTotals (Todos + vencimento) ─────
    const forecastBase = baseStudents.filter(
      (s) =>
        s.statusCancelamento !== "cancelado" &&
        countsInFinancialTotals(s) &&
        !(
          isRendaExtraAtivo(s) &&
          s.rendaExtraStatus &&
          s.rendaExtraStatus !== "Conciliar Exclusão"
        ),
    );
    const naCarteira = forecastBase.filter(
      (s) =>
        !isIamConciliadoQuitadoAvista(s) &&
        (s.installments ?? []).some((i) => !i.paid),
    );

    const idsCarteira = new Set(naCarteira.map((s) => s.id));
    const idsCards = new Set(emAlgumCard.map((s) => s.id));
    const statusExibido = new Map(mapped.map((s) => [s.id, s.status]));

    const soNosCards = emAlgumCard.filter((s) => !idsCarteira.has(s.id));
    const soNaCarteira = naCarteira.filter((s) => !idsCards.has(s.id));

    const somaCards = Object.values(contagem).reduce((a, b) => a + b, 0);
    const somaValor = Object.values(valor).reduce((a, b) => a + b, 0);
    const carteiraValor = naCarteira.reduce(
      (acc, s) =>
        acc +
        (s.installments ?? [])
          .filter((i) => !i.paid && !isInstallmentExcludedFromFinancialTotals(s, i))
          .reduce((a, i) => a + i.value, 0),
      0,
    );

    console.log(`\n${"=".repeat(78)}\nEMPRESA: ${comp.name}\n${"=".repeat(78)}`);
    console.log(`alunos carregados: ${students.length} | base financeira: ${baseStudents.length}`);
    console.log("\n--- CARDS DE STATUS ---");
    for (const k of [...BUCKETS, "Solicitação Cancelamento"]) {
      if (contagem[k]) console.log(`  ${k}: ${contagem[k]} alunos · ${brl(valor[k] ?? 0)}`);
    }
    console.log(`  SOMA DOS CARDS: ${somaCards} alunos · ${brl(somaValor)}`);
    console.log(`  CARTEIRA TOTAL: ${naCarteira.length} alunos · ${brl(carteiraValor)}`);
    console.log(
      `  DIFERENÇA: ${somaCards - naCarteira.length} alunos · ${brl(somaValor - carteiraValor)}`,
    );

    if (soNosCards.length > 0) {
      console.log(`\n--- EM CARD MAS FORA DA CARTEIRA (${soNosCards.length}) ---`);
      console.log("  (contam no card de status, mas não têm parcela em aberto)");
      for (const s of soNosCards) {
        console.log(`  • ${s.name} [${cardDe(s)}]\n      ${descrever(s, statusExibido.get(s.id))}`);
      }
    }

    if (soNaCarteira.length > 0) {
      console.log(`\n--- NA CARTEIRA MAS SEM CARD (${soNaCarteira.length}) ---`);
      console.log("  (somam no total, mas não aparecem em nenhum card de status)");
      for (const s of soNaCarteira) {
        console.log(`  • ${s.name}\n      ${descrever(s, statusExibido.get(s.id))}`);
      }
    }

    if (semCard.length > 0) {
      const porStatus: Record<string, number> = {};
      for (const s of semCard) porStatus[s.status] = (porStatus[s.status] ?? 0) + 1;
      console.log(`\n--- STATUS SEM CARD NA DASHBOARD (${semCard.length}) ---`);
      for (const [st, n] of Object.entries(porStatus)) console.log(`  ${st}: ${n}`);
    }
  }
});
