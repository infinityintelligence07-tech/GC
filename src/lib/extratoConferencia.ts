import { calculateAutoStatusAt } from '@/store/useAppStore';
import { isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import type { ConciliacaoItem, Installment, Student } from '@/types';

export interface ExtratoLinha {
  id: string;
  date: string;
  sortAt: string;
  kind: 'saldo_anterior' | 'movimento' | 'saldo_dia' | 'conferencia';
  descricao: string;
  studentName?: string;
  ac?: string;
  tipoConciliacao?: string;
  credito: number;
  debito: number;
  entradaConta?: number;
  saldoExtrato: number;
  saldoDashboard?: number;
  diferenca?: number;
  neutro?: boolean;
}

export interface EntradaConta {
  id: string;
  studentName: string;
  ac: string;
  valor: number;
  parcela?: number;
  paidDate: string;
  descricao: string;
  fonte: 'parcela' | 'kamino' | 'conciliacao';
}

export interface ExtratoDiaResumo {
  date: string;
  saldoInicial: number;
  saldoFinalExtrato: number;
  saldoFinalDashboard: number;
  diferenca: number;
  movimentos: number;
}

export interface ExtratoResultado {
  saldoAtualCarteira: number;
  saldoAtualExtrato: number;
  diferencaAtual: number;
  linhas: ExtratoLinha[];
  dias: ExtratoDiaResumo[];
}

/** Mesmas regras do Dashboard (Carteira Total / forecastBase). */
export function isInCarteiraPortfolio(s: Student): boolean {
  if (s.statusCancelamento === 'cancelado') return false;
  if (isRendaExtraAtivo(s) && s.rendaExtraStatus && s.rendaExtraStatus !== 'Conciliar Exclusão') return false;
  if (s.status === 'Pago') return false;
  return true;
}

/** Soma nominal de todas as parcelas dos alunos na carteira (índice "Todos"). */
export function computeCarteiraTotal(students: Student[]): number {
  let total = 0;
  for (const st of students) {
    if (!isInCarteiraPortfolio(st)) continue;
    for (const inst of st.installments) {
      total += Number(inst.value || 0);
    }
  }
  return Math.round(total * 100) / 100;
}

function sumInstallmentValues(installments: unknown): number | null {
  if (!Array.isArray(installments)) return null;
  return Math.round(
    (installments as Installment[]).reduce((s, i) => s + Number(i.value || 0), 0) * 100,
  ) / 100;
}

function extractCarteiraValor(obj: Record<string, unknown>): number | null {
  const instTotal = sumInstallmentValues(obj.installments);
  if (instTotal !== null) return instTotal;

  const snap = obj._snapshot as Record<string, unknown> | undefined;
  if (snap) {
    const snapTotal = sumInstallmentValues(snap.installments);
    if (snapTotal !== null) return snapTotal;
  }

  if (typeof obj.saldoPendente === 'number') return obj.saldoPendente;
  if (typeof obj.valorCarteira === 'number') return obj.valorCarteira;
  return null;
}

const TIPOS_NEUTROS = new Set(['pagamento_parcela', 'baixa_kamino']);
const TIPOS_ENTRADA_CONTA = new Set(['pagamento_parcela', 'baixa_kamino', 'quitacao', 'renda_extra_acordo']);

function extractValorEntrada(depois: Record<string, unknown>): number {
  const valor = Number(depois.paidValue ?? depois.valor ?? depois.valorPago ?? 0);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0;
}

/** Quanto entrou na conta (pagamentos recebidos) em uma data específica. */
export function computeEntradasNaData(
  students: Student[],
  conciliacaoItems: ConciliacaoItem[],
  dateISO: string,
  acFilter?: string,
): { total: number; qtd: number; entradas: EntradaConta[] } {
  const entradas: EntradaConta[] = [];
  const seen = new Set<string>();

  for (const st of students) {
    if (acFilter && st.ac !== acFilter) continue;
    for (const inst of st.installments) {
      if (!inst.paid || !inst.paidDate || inst.paidDate !== dateISO) continue;
      const valor = Math.round(Number(inst.paidValue ?? inst.value ?? 0) * 100) / 100;
      if (valor <= 0) continue;
      const key = `${st.id}-${inst.number}-${dateISO}`;
      seen.add(key);
      entradas.push({
        id: key,
        studentName: st.name,
        ac: st.ac,
        valor,
        parcela: inst.number,
        paidDate: dateISO,
        descricao: `Parcela ${inst.number} recebida`,
        fonte: 'parcela',
      });
    }
  }

  for (const it of conciliacaoItems) {
    if (it.status !== 'conciliado' || !TIPOS_ENTRADA_CONTA.has(it.tipo)) continue;
    if (acFilter && it.ac !== acFilter) continue;

    const depois = it.depois ?? {};
    const paidDate =
      typeof depois.paidDate === 'string' && depois.paidDate
        ? depois.paidDate
        : it.conciliadoAt
          ? toBrasiliaDate(it.conciliadoAt)
          : '';
    if (paidDate !== dateISO) continue;

    const valor = extractValorEntrada(depois);
    if (valor <= 0) continue;

    const parcela = Number(depois.parcela ?? depois.numero ?? 0) || undefined;
    const dedupeKey = `${it.studentId ?? it.studentName}-${parcela ?? 'x'}-${dateISO}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    entradas.push({
      id: `conc-${it.id}`,
      studentName: it.studentName,
      ac: it.ac ?? '',
      valor,
      parcela,
      paidDate: dateISO,
      descricao: it.resumo || labelTipo(it.tipo),
      fonte: it.tipo === 'baixa_kamino' ? 'kamino' : 'conciliacao',
    });
  }

  entradas.sort((a, b) => b.valor - a.valor);
  const total = Math.round(entradas.reduce((s, e) => s + e.valor, 0) * 100) / 100;
  return { total, qtd: entradas.length, entradas };
}

/** Impacto na Carteira Total (positivo = entra, negativo = sai). */
export function computeConciliacaoImpacto(item: ConciliacaoItem): number {
  if (item.status !== 'conciliado') return 0;
  if (TIPOS_NEUTROS.has(item.tipo)) return 0;

  const antes = item.antes ?? {};
  const depois = item.depois ?? {};

  const antesVal = extractCarteiraValor(antes);
  const depoisVal = extractCarteiraValor(depois);
  if (antesVal !== null && depoisVal !== null) {
    return Math.round((depoisVal - antesVal) * 100) / 100;
  }

  if (typeof depois.impactoCarteira === 'number') {
    return Math.round(depois.impactoCarteira * 100) / 100;
  }

  if (item.tipo === 'renda_extra_exclusao' || item.tipo === 'cancelamento') {
    const saldo = typeof antes.saldoPendente === 'number' ? antes.saldoPendente : antesVal;
    if (saldo !== null && saldo !== undefined) return -Math.abs(saldo);
  }

  return 0;
}

export function mapSnapshotPayloadToStudents(
  payload: Array<Record<string, unknown>>,
  liveById: Map<string, Student>,
): Student[] {
  return payload.map((p) => {
    const cur = liveById.get(String(p.id));
    const frozenInst = Array.isArray(p.installments) ? (p.installments as Installment[]) : [];
    return {
      id: String(p.id),
      name: String(p.name ?? cur?.name ?? ''),
      whatsapp: cur?.whatsapp ?? '',
      cpf: cur?.cpf ?? '',
      address: cur?.address ?? '',
      numero: cur?.numero ?? '',
      cidade: cur?.cidade ?? '',
      estado: cur?.estado ?? '',
      cep: cur?.cep ?? '',
      status: (p.status as Student['status']) ?? cur?.status ?? 'Em Dia',
      statusMode: (p.status_mode as Student['statusMode']) ?? cur?.statusMode ?? 'Automático',
      ac: String(p.ac_id ?? cur?.ac ?? ''),
      product: String(p.product ?? cur?.product ?? ''),
      enrollmentDate: String(p.enrollment_date ?? cur?.enrollmentDate ?? ''),
      dueDay: cur?.dueDay ?? 1,
      saleValue: Number(p.total_open ?? 0) + Number(p.total_paid ?? 0) || cur?.saleValue || 0,
      downPayment: cur?.downPayment ?? 0,
      totalInstallments: frozenInst.length || cur?.totalInstallments || 0,
      paidInstallments: frozenInst.filter((i) => i.paid).length,
      installmentValue: cur?.installmentValue ?? 0,
      installments: frozenInst,
      history: cur?.history ?? [],
      tags: (p.tags as string[]) ?? cur?.tags ?? [],
      isRendaExtra: (p.is_renda_extra as boolean) ?? cur?.isRendaExtra,
      rendaExtraStatus: (p.renda_extra_status as Student['rendaExtraStatus']) ?? cur?.rendaExtraStatus,
      statusCancelamento: (p.status_cancelamento as Student['statusCancelamento']) ?? cur?.statusCancelamento,
    } as Student;
  });
}

/** Reconstrói carteira em uma data (fallback quando não há snapshot). */
export function computeCarteiraAtDate(students: Student[], dateISO: string): number {
  const refEnd = new Date(dateISO + 'T23:59:59');
  const eligible = students.filter((s) => {
    if (!s.enrollmentDate) return true;
    return new Date(s.enrollmentDate + 'T00:00:00') <= refEnd;
  });

  const remapped = eligible.map((s) => {
    if (
      s.status === 'Negativado' ||
      s.status === 'Solicitação Cancelamento' ||
      s.statusCancelamento === 'solicitado'
    ) {
      return s;
    }
    if (s.statusMode === 'Automático') {
      const frozenInst = s.installments.map((i) => {
        const wasPaid = !!(i.paid && i.paidDate && new Date(i.paidDate + 'T00:00:00') <= refEnd);
        return wasPaid ? { ...i, paid: true } : { ...i, paid: false, paidDate: undefined, paidValue: undefined };
      });
      const st = calculateAutoStatusAt(frozenInst, refEnd);
      return { ...s, installments: frozenInst, status: st as Student['status'] };
    }
    return s;
  });

  return computeCarteiraTotal(remapped);
}

function toBrasiliaDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function listDatesInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

function labelTipo(tipo: string): string {
  const map: Record<string, string> = {
    parcela_quantidade: 'Renegociação (parcelas)',
    parcela_valor: 'Alteração de valor',
    parcela_vencimento: 'Alteração de vencimento',
    pagamento_parcela: 'Pagamento de parcela',
    quitacao: 'Quitação',
    renegociacao: 'Renegociação',
    cancelamento: 'Cancelamento',
    reversao: 'Reversão de cancelamento',
    renda_extra_exclusao: 'Saída Renda Extra',
    renda_extra_acordo: 'Acordo Renda Extra',
    baixa_kamino: 'Baixa Kamino',
    encargo_aplicado: 'Encargo aplicado',
    correcao_contrato: 'Correção de contrato',
  };
  return map[tipo] ?? tipo;
}

export function buildExtratoConferencia(input: {
  students: Student[];
  conciliacaoItems: ConciliacaoItem[];
  dateFrom: string;
  dateTo: string;
  snapshotBalances: Map<string, number>;
  todayISO: string;
  acFilter?: string;
}): ExtratoResultado {
  const { students, conciliacaoItems, dateFrom, dateTo, snapshotBalances, todayISO, acFilter } = input;

  const filteredStudents = acFilter ? students.filter((s) => s.ac === acFilter) : students;

  const saldoAtualCarteira = computeCarteiraTotal(filteredStudents);

  const movimentos = conciliacaoItems
    .filter((it) => it.status === 'conciliado' && it.conciliadoAt)
    .filter((it) => !acFilter || it.ac === acFilter)
    .map((it) => {
      const date = toBrasiliaDate(it.conciliadoAt!);
      const impacto = computeConciliacaoImpacto(it);
      const neutro = TIPOS_NEUTROS.has(it.tipo);
      const entradaConta = neutro || TIPOS_ENTRADA_CONTA.has(it.tipo)
        ? extractValorEntrada(it.depois ?? {})
        : 0;
      let credito = 0;
      let debito = 0;
      if (!neutro) {
        if (impacto >= 0) credito = impacto;
        else debito = Math.abs(impacto);
      }
      return {
        id: it.id,
        date,
        sortAt: it.conciliadoAt!,
        kind: 'movimento' as const,
        descricao: it.resumo || labelTipo(it.tipo),
        studentName: it.studentName,
        ac: it.ac,
        tipoConciliacao: it.tipo,
        credito,
        debito,
        entradaConta: entradaConta > 0 ? entradaConta : undefined,
        saldoExtrato: 0,
        neutro,
        impacto,
      };
    })
    .filter((m) => m.date >= dateFrom && m.date <= dateTo)
    .sort((a, b) => a.sortAt.localeCompare(b.sortAt));

  const resolveDashboardSaldo = (dateISO: string): number => {
    if (snapshotBalances.has(dateISO)) return snapshotBalances.get(dateISO)!;
    if (dateISO >= todayISO) return saldoAtualCarteira;
    return computeCarteiraAtDate(filteredStudents, dateISO);
  };

  const diaAnterior = addDaysISO(dateFrom, -1);
  let saldoCorrente = snapshotBalances.get(diaAnterior) ?? computeCarteiraAtDate(filteredStudents, diaAnterior);

  const linhas: ExtratoLinha[] = [];
  const dias: ExtratoDiaResumo[] = [];

  linhas.push({
    id: 'saldo-anterior',
    date: dateFrom,
    sortAt: `${dateFrom}T00:00:00.000Z`,
    kind: 'saldo_anterior',
    descricao: 'SALDO ANTERIOR',
    credito: 0,
    debito: 0,
    saldoExtrato: saldoCorrente,
  });

  for (const date of listDatesInclusive(dateFrom, dateTo)) {
    const movsDia = movimentos.filter((m) => m.date === date);
    const saldoInicialDia = saldoCorrente;

    for (const mov of movsDia) {
      if (!mov.neutro) saldoCorrente = Math.round((saldoCorrente + mov.impacto) * 100) / 100;
      linhas.push({
        ...mov,
        saldoExtrato: saldoCorrente,
      });
    }

    const saldoFinalExtrato = saldoCorrente;
    const saldoFinalDashboard = resolveDashboardSaldo(date);
    const diferenca = Math.round((saldoFinalDashboard - saldoFinalExtrato) * 100) / 100;

    // Ajuste automático para fechar com o dashboard (conferência bancária).
    if (Math.abs(diferenca) >= 0.01) {
      saldoCorrente = saldoFinalDashboard;
      linhas.push({
        id: `ajuste-${date}`,
        date,
        sortAt: `${date}T23:59:58.000Z`,
        kind: 'movimento',
        descricao: 'Ajuste de conferência (variação não detalhada)',
        credito: diferenca > 0 ? diferenca : 0,
        debito: diferenca < 0 ? Math.abs(diferenca) : 0,
        saldoExtrato: saldoCorrente,
        neutro: false,
      });
    }

    linhas.push({
      id: `saldo-dia-${date}`,
      date,
      sortAt: `${date}T23:59:59.000Z`,
      kind: 'saldo_dia',
      descricao: 'SALDO DO DIA',
      credito: 0,
      debito: 0,
      saldoExtrato: saldoFinalDashboard,
      saldoDashboard: saldoFinalDashboard,
      diferenca: 0,
    });

    linhas.push({
      id: `conferencia-${date}`,
      date,
      sortAt: `${date}T23:59:59.999Z`,
      kind: 'conferencia',
      descricao: 'CONFERÊNCIA — Carteira Dashboard',
      credito: 0,
      debito: 0,
      saldoExtrato: saldoFinalDashboard,
      saldoDashboard: saldoFinalDashboard,
      diferenca: 0,
    });

    dias.push({
      date,
      saldoInicial: saldoInicialDia,
      saldoFinalExtrato: saldoFinalDashboard,
      saldoFinalDashboard,
      diferenca: 0,
      movimentos: movsDia.length,
    });
  }

  const saldoAtualExtrato = saldoCorrente;
  const diferencaAtual = Math.round((saldoAtualCarteira - saldoAtualExtrato) * 100) / 100;

  return {
    saldoAtualCarteira,
    saldoAtualExtrato: dateTo >= todayISO ? saldoAtualCarteira : saldoAtualExtrato,
    diferencaAtual: dateTo >= todayISO ? 0 : diferencaAtual,
    linhas,
    dias,
  };
}
