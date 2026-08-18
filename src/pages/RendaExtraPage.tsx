import { useState, useMemo, useEffect } from 'react';
import { Student, RendaExtraStatus, canConfirmarPagamento } from '@/types';
import { useAppStore, formatCurrency, formatCurrencyCompact } from '@/store/useAppStore';
import HistoryModal from '@/components/modals/HistoryModal';
import DeleteModal from '@/components/modals/DeleteModal';
import { getCurrentMonthDates } from '@/lib/periodFilter';
import { Clock, Trash2, Wallet, Users, TrendingUp, CheckCircle2, XCircle, HandCoins, Lock, AlertCircle, CalendarDays, Pencil, Link2, QrCode } from 'lucide-react';
import { statusColors } from '@/lib/statusColors';
import { isStudentCancelado, isRendaExtraAtivo } from '@/lib/rendaExtraEligibility';
import { toast } from 'sonner';

// ─── PAGAR modal ──────────────────────────────────────────────────────────────
interface PagarModalProps {
  student: Student;
  onClose: () => void;
}

function PagarModal({ student, onClose }: PagarModalProps) {
  const { rules, fazerAcordoRendaExtra, acs, currentUser } = useAppStore();
  const podeConfirmarPagto = canConfirmarPagamento(currentUser);
  const [selectedAC, setSelectedAC] = useState(student.rendaExtraAC ?? '');
  // Fase 2: pedir data + forma de pagamento
  const [askingDate, setAskingDate] = useState(false);
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'link'>('pix');

  const saldoOriginal = student.installments
    .filter((i) => !i.paid)
    .reduce((acc, i) => acc + i.value, 0);
  const valorComDesconto = saldoOriginal * (1 - rules.descontoRendaExtra / 100);

  const handleClickConfirm = () => {
    if (!selectedAC.trim()) {
      toast.error('Selecione o Assessor de Conta antes de confirmar o acordo.');
      return;
    }
    setAskingDate(true);
  };

  const handleConfirmWithDate = () => {
    if (!paymentDate) {
      toast.error('Informe a data de pagamento.');
      return;
    }
    fazerAcordoRendaExtra(student.id, selectedAC, valorComDesconto, paymentDate, paymentMethod);
    const ddmmyy = paymentDate.split('-').reverse().join('/');
    const metodoLbl = paymentMethod === 'pix' ? 'PIX' : 'Link de Pagamento';
    toast.success(`Acordo agendado. ${metodoLbl} para ${ddmmyy}. Aguardando pagamento.`);
    onClose();
  };

  // Modal secundário: data + forma de pagamento
  if (askingDate) {
    return (
      <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
        <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-primary" />
            <h2 className="text-base font-bold text-foreground">Agendar pagamento</h2>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Informe quando e como o pagamento de <span className="font-semibold text-foreground">{formatCurrency(valorComDesconto)}</span> será efetivado.
            O aluno seguirá vinculado a <span className="font-semibold text-foreground">{selectedAC}</span> até essa data.
          </p>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Data de Pagamento</label>
            <input
              type="date"
              className="input-field w-full"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Forma de Pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('pix')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                  paymentMethod === 'pix'
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 shadow-sm'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <QrCode size={14} />
                PIX
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('link')}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                  paymentMethod === 'link'
                    ? 'bg-blue-500/10 border-blue-500 text-blue-700 shadow-sm'
                    : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Link2 size={14} />
                Link de Pagamento
              </button>
            </div>
          </div>
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-700 leading-snug">
              O aluno permanece <strong>Em Negociação • Aguardando Pagamento</strong> até a data informada. Após confirmação, segue para <strong>Conciliação</strong>.
            </p>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setAskingDate(false)} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
              Voltar
            </button>
            <button
              onClick={handleConfirmWithDate}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 shadow-md transition-all"
            >
              Confirmar Acordo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border p-6 space-y-4">
        <h2 className="text-base font-bold text-foreground">Pagamento Renda Extra</h2>
        <p className="text-xs text-muted-foreground -mt-2">{student.name}</p>

        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
            <span className="text-xs text-muted-foreground">De (Valor Pendente):</span>
            <span className="text-sm font-semibold text-foreground">{formatCurrency(saldoOriginal)}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <span className="text-xs text-emerald-700 font-medium">Por (c/ {rules.descontoRendaExtra}% desc.):</span>
            <span className="text-lg font-bold text-emerald-600">{formatCurrency(valorComDesconto)}</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">
            AC que realizou o acordo <span className="text-destructive">*</span>
          </label>
          <select
            className={`input-field w-full ${!selectedAC ? 'border-amber-400/60' : ''}`}
            value={selectedAC}
            onChange={(e) => setSelectedAC(e.target.value)}
          >
            <option value="">— Selecione —</option>
            {acs.filter((g) => g.active).map((g) => (
              <option key={g.id} value={g.name}>{g.name}</option>
            ))}
          </select>
          {!selectedAC && (
            <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
              <AlertCircle size={11} /> Selecione o AC para continuar
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleClickConfirm}
            disabled={!podeConfirmarPagto || !selectedAC}
            title={
              !podeConfirmarPagto ? 'Você não tem permissão para confirmar pagamentos'
              : !selectedAC ? 'Selecione o AC primeiro' : undefined
            }
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {!podeConfirmarPagto && <Lock size={13} />}
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Editar Pagamento Modal ───────────────────────────────────────────────────
interface EditPagtoProps {
  student: Student;
  onClose: () => void;
}

function EditPagamentoModal({ student, onClose }: EditPagtoProps) {
  const { editarPagamentoRendaExtra } = useAppStore();
  const [paymentDate, setPaymentDate] = useState<string>(student.rendaExtraPaymentDate ?? new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'link'>(student.rendaExtraPaymentMethod ?? 'pix');

  const handleSave = () => {
    if (!paymentDate) {
      toast.error('Informe a data de pagamento.');
      return;
    }
    editarPagamentoRendaExtra(student.id, paymentDate, paymentMethod);
    toast.success('Pagamento atualizado.');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Pencil size={16} className="text-primary" />
          <h2 className="text-base font-bold text-foreground">Editar Pagamento</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">{student.name}</p>

        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Data de Pagamento</label>
          <input
            type="date"
            className="input-field w-full"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Forma de Pagamento</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMethod('pix')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                paymentMethod === 'pix'
                  ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700 shadow-sm'
                  : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <QrCode size={14} />
              PIX
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('link')}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                paymentMethod === 'link'
                  ? 'bg-blue-500/10 border-blue-500 text-blue-700 shadow-sm'
                  : 'bg-muted/40 border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Link2 size={14} />
              Link
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KPI card (same style as dashboard) ──────────────────────────────────────
interface KpiRectProps {
  title: string;
  value: string;
  /** Versão curta do valor para telas estreitas. Se omitido, usa `value`. */
  valueCompact?: string;
  sub1?: string;
  sub2?: string;
  borderColor: string;
  valueColor?: string;
}

function KpiRect({ title, value, valueCompact, sub1, sub2, borderColor, valueColor = 'text-foreground' }: KpiRectProps) {
  return (
    <div className={`min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 ${borderColor} transition-transform hover:-translate-y-0.5`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2 truncate" title={title}>{title}</p>
      <p className={`kpi-value ${valueColor}`} title={value}>
        <span className="hidden sm:inline">{value}</span>
        <span className="sm:hidden">{valueCompact ?? value}</span>
      </p>
      {sub1 && <p className="text-[11px] text-muted-foreground mt-1 truncate" title={sub1}>{sub1}</p>}
      {sub2 && <p className="text-[11px] text-muted-foreground truncate" title={sub2}>{sub2}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const RE_STATUS_ORDER: RendaExtraStatus[] = ['Conciliar Exclusão', 'Disponível Negociação', 'Em Negociação', 'Acordo Feito'];

export default function RendaExtraPage() {
  const {
    students: allStudents, acs, rules,
    migrarParaRendaExtra, assumirRendaExtra, liberarRendaExtra,
    setRendaExtraStatus, removerDeRendaExtra,
    currentUser,
  } = useAppStore();
  const podeConfirmarPagto = canConfirmarPagamento(currentUser);
  // Scope by AC for ac/acn2 roles — see only students linked to their carteira
  const myACName = (currentUser?.role === 'ac' || currentUser?.role === 'acn2') && currentUser.acId
    ? acs.find((a) => a.id === currentUser.acId)?.name
    : undefined;
  const students = myACName ? allStudents.filter((s) => s.ac === myACName) : allStudents;

  const { firstDay: currentMonthStart, lastDay: currentMonthEnd } = getCurrentMonthDates();
  const [filterInclusionStart, setFilterInclusionStart] = useState(currentMonthStart);
  const [filterInclusionEnd, setFilterInclusionEnd] = useState(currentMonthEnd);
  const [filterAcordoStart, setFilterAcordoStart] = useState('');
  const [filterAcordoEnd, setFilterAcordoEnd] = useState('');
  const [filterStatus, setFilterStatus] = useState<RendaExtraStatus | ''>('');
  const [filterAC, setFilterAC] = useState('');

  // Helper: extrai a data do acordo a partir do histórico do aluno
  // (entrada padronizada: "Acordo Renda Extra feito por …")
  const getAcordoDate = (s: Student): string | null => {
    const entry = [...s.history].reverse().find((h) => h.type === 'Sistema' && /Acordo Renda Extra feito/i.test(h.text));
    return entry ? entry.date.split('T')[0] : null;
  };
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [pagarStudent, setPagarStudent] = useState<Student | null>(null);
  const [editPagtoStudent, setEditPagtoStudent] = useState<Student | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ── Auto-migrate students with 6+ months overdue ──────────────────────────
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const SIX_MONTHS_DAYS = 180;

    students.forEach((s) => {
      if (s.isRendaExtra || s.status === 'Excluído') return;
      // Aluno cancelado não entra em Renda Extra (contrato encerrado)
      if (isStudentCancelado(s)) return;
      const unpaid = s.installments.filter((i) => !i.paid);
      if (unpaid.length === 0) return;
      const overdue = unpaid.filter((i) => new Date(i.dueDate) < today);
      if (overdue.length === 0) return;
      const oldest = overdue.reduce((a, b) => new Date(a.dueDate) < new Date(b.dueDate) ? a : b);
      const diffDays = Math.floor((today.getTime() - new Date(oldest.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= SIX_MONTHS_DAYS) {
        migrarParaRendaExtra(s.id);
      }
    });
  }, []);

  // ── Auto-release 72h ────────────────────────────────────────────────────
  // Rotina principal roda no servidor (edge function `auto-renda-extra` via
  // pg_cron diário). Este intervalo é apenas FALLBACK/UX: se o usuário deixa a
  // tela aberta e o tempo expira ali na frente, mostra o reflexo na hora.
  // Roda a cada 5 min em vez de 60s (servidor é fonte da verdade).
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      students.forEach((s) => {
        if (!s.isRendaExtra || s.rendaExtraStatus !== 'Em Negociação') return;
        if (!s.rendaExtraACAssignedAt) return;
        const diffMs = now - new Date(s.rendaExtraACAssignedAt).getTime();
        if (diffMs > 72 * 60 * 60 * 1000) {
          liberarRendaExtra(s.id);
        }
      });
    }, 5 * 60 * 1000); // Fallback de UX a cada 5 min

    return () => clearInterval(intervalId);
  }, [students, liberarRendaExtra]);

  const rendaExtraStudents = students.filter((s) => isRendaExtraAtivo(s));

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return rendaExtraStudents.filter((s) => {
      if (filterInclusionStart || filterInclusionEnd) {
        const d = s.rendaExtraInclusionDate ?? '';
        if (filterInclusionStart && d < filterInclusionStart) return false;
        if (filterInclusionEnd && d > filterInclusionEnd) return false;
      }
      if (filterAcordoStart || filterAcordoEnd) {
        const ad = getAcordoDate(s);
        if (!ad) return false;
        if (filterAcordoStart && ad < filterAcordoStart) return false;
        if (filterAcordoEnd && ad > filterAcordoEnd) return false;
      }
      if (filterStatus && s.rendaExtraStatus !== filterStatus) return false;
      if (filterAC && s.rendaExtraAC !== filterAC) return false;
      return true;
    });
  }, [rendaExtraStudents, filterAC, filterInclusionStart, filterInclusionEnd, filterAcordoStart, filterAcordoEnd, filterStatus]);

  // ── KPI calculations ───────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = filtered.length;
    const pendente = (arr: Student[]) =>
      arr.reduce((acc, s) => acc + s.installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0), 0);
    const comDesconto = (arr: Student[]) =>
      pendente(arr) * (1 - rules.descontoRendaExtra / 100);
    const pct = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%';

    const byStatus = (st: RendaExtraStatus) => filtered.filter((s) => s.rendaExtraStatus === st);

    const conciliar = byStatus('Conciliar Exclusão');
    const disponivel = byStatus('Disponível Negociação');
    const emNeg = byStatus('Em Negociação');
    const acordo = byStatus('Acordo Feito');

    // Per AC (from all renda extra students, respecting inclusion date filter)
    const acNames = [...new Set(filtered.map((s) => s.rendaExtraAC).filter(Boolean) as string[])];
    const perAC = acNames.map((acName) => {
      const forAC = filtered.filter((s) => s.rendaExtraAC === acName);
      const assumidos = forAC.length;
      const emNegAC = forAC.filter((s) => s.rendaExtraStatus === 'Em Negociação');
      const acordos = forAC.filter((s) => s.rendaExtraStatus === 'Acordo Feito');
      const valorEmNeg = comDesconto(emNegAC);
      const valorAcordo = acordos.reduce((acc, s) => acc + (s.rendaExtraAcordoValue ?? 0), 0);
      const pctAcordo = assumidos > 0 ? ((acordos.length / assumidos) * 100).toFixed(0) : '0';
      return { acName, assumidos, emNeg: emNegAC.length, acordos: acordos.length, pctAcordo, valorEmNeg, valorAcordo };
    });

    // "Assumiu" = aluno que entrou em negociação (tem AC vinculado: Em Negociação ou Acordo Feito)
    const assumiuList = filtered.filter((s) => !!s.rendaExtraAC && (s.rendaExtraStatus === 'Em Negociação' || s.rendaExtraStatus === 'Acordo Feito'));
    const acordoFeitoList = filtered.filter((s) => s.rendaExtraStatus === 'Acordo Feito');
    const valorAcordoFeito = acordoFeitoList.reduce((acc, s) => acc + (s.rendaExtraAcordoValue ?? 0), 0);
    const pctAcordoSobreAssumiu = assumiuList.length > 0
      ? ((acordoFeitoList.length / assumiuList.length) * 100).toFixed(0)
      : '0';

    // KPI "Carteira Renda Extra" inclui valor com desconto dos pendentes + valor real dos acordos já fechados
    const totalCarteira = comDesconto(filtered.filter((s) => s.rendaExtraStatus !== 'Acordo Feito')) + valorAcordoFeito;

    return {
      total,
      totalPendente: pendente(filtered),
      totalComDesconto: totalCarteira,
      conciliar: { list: conciliar, valor: comDesconto(conciliar), pct: pct(conciliar.length), count: conciliar.length },
      disponivel: { list: disponivel, valor: comDesconto(disponivel), valorSemDesc: pendente(disponivel), pct: pct(disponivel.length) },
      emNeg: { list: emNeg, valor: comDesconto(emNeg), valorSemDesc: pendente(emNeg), pct: pct(emNeg.length) },
      acordo: { list: acordo, valor: valorAcordoFeito, pct: pct(acordo.length) },
      perAC,
      resumoAssumiu: {
        assumiu: assumiuList.length,
        acordos: acordoFeitoList.length,
        pctAcordo: pctAcordoSobreAssumiu,
        valorAcordo: valorAcordoFeito,
      },
    };
  }, [filtered, rules.descontoRendaExtra]);

  const activeACs = acs.filter((g) => g.active);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-card border border-border rounded-2xl p-5 saas-shadow">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Data de Inclusão</label>
            <div className="flex gap-2">
              <input type="date" className="input-field flex-1 text-xs" value={filterInclusionStart} onChange={(e) => setFilterInclusionStart(e.target.value)} />
              <input type="date" className="input-field flex-1 text-xs" value={filterInclusionEnd} onChange={(e) => setFilterInclusionEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Data Acordo Feito</label>
            <div className="flex gap-2">
              <input type="date" className="input-field flex-1 text-xs" value={filterAcordoStart} onChange={(e) => setFilterAcordoStart(e.target.value)} />
              <input type="date" className="input-field flex-1 text-xs" value={filterAcordoEnd} onChange={(e) => setFilterAcordoEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Status</label>
            <select className="input-field w-full" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as RendaExtraStatus | '')}>
              <option value="">Todos</option>
              {RE_STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Assessor de Conta</label>
            <select className="input-field w-full" value={filterAC} onChange={(e) => setFilterAC(e.target.value)}>
              <option value="">Todos</option>
              {activeACs.map((ac) => <option key={ac.id} value={ac.name}>{ac.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <div className="rounded-xl px-3 py-2 bg-purple-50 border border-purple-200 flex items-center gap-2 w-full">
              <span className="text-[10px] font-semibold text-purple-700 uppercase">Conciliar Exclusão</span>
              <span className="ml-auto text-xs font-bold text-purple-700">{kpi.conciliar.count}</span>
            </div>
          </div>
        </div>
      </div>


      {/* KPIs Row 1 — 4 Main Indicators */}
      <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {/* Carteira Renda Extra */}
        <div className="min-w-0 rounded-2xl p-4 sm:p-5 saas-shadow-md bg-card border border-border border-l-4 border-l-primary transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between mb-2 gap-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase truncate">Carteira Renda Extra</p>
            <Wallet size={15} className="text-primary/50 shrink-0" />
          </div>
          <p className="kpi-value text-primary" title={formatCurrency(kpi.totalComDesconto)}>
            <span className="hidden sm:inline">{formatCurrency(kpi.totalComDesconto)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(kpi.totalComDesconto)}</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">com desconto</p>
          <p className="text-[11px] text-muted-foreground truncate">{kpi.total} alunos</p>
          <p className="text-[11px] text-muted-foreground mt-2 truncate" title={`${formatCurrency(kpi.totalPendente)} sem desc.`}>
            <span className="hidden sm:inline">{formatCurrency(kpi.totalPendente)}</span>
            <span className="sm:hidden">{formatCurrencyCompact(kpi.totalPendente)}</span> sem desc.
          </p>
        </div>

        <KpiRect title="Disponível Negociação"
          value={formatCurrency(kpi.disponivel.valor)}
          valueCompact={formatCurrencyCompact(kpi.disponivel.valor)}
          sub1={`${kpi.disponivel.list.length} alunos`}
          sub2={`${kpi.disponivel.pct} da base • ${formatCurrencyCompact(kpi.disponivel.valorSemDesc)} sem desc.`}
          borderColor="border-l-cyan-500" valueColor="text-cyan-600" />

        <KpiRect title="Em Negociação"
          value={formatCurrency(kpi.emNeg.valor)}
          valueCompact={formatCurrencyCompact(kpi.emNeg.valor)}
          sub1={`${kpi.emNeg.list.length} alunos`}
          sub2={`${kpi.emNeg.pct} da base • ${formatCurrencyCompact(kpi.emNeg.valorSemDesc)} sem desc.`}
          borderColor="border-l-blue-500" valueColor="text-blue-600" />

        <KpiRect title="Acordo Feito"
          value={formatCurrency(kpi.acordo.valor)}
          valueCompact={formatCurrencyCompact(kpi.acordo.valor)}
          sub1={`${kpi.acordo.list.length} alunos`}
          sub2={`${((kpi.acordo.list.length / (kpi.total || 1)) * 100).toFixed(1)}% da carteira`}
          borderColor="border-l-emerald-500" valueColor="text-emerald-600" />
      </div>

      {/* Histórico por AC — centralized */}
      {kpi.perAC.length > 0 && (filterAC === '') && (
        <div className="bg-card border border-border rounded-2xl p-5 saas-shadow">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users size={14} />
            Histórico por Assessor de Conta
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {kpi.perAC.map(({ acName, assumidos, emNeg, acordos, pctAcordo, valorEmNeg, valorAcordo }) => {
              const acEntity = acs.find((a) => a.name === acName);
              return (
                <div key={acName} className="rounded-xl p-4 bg-muted/30 border border-border transition-all hover:shadow-md">
                  <div className="flex items-center gap-2 mb-3">
                    {acEntity?.photo ? (
                      <img src={acEntity.photo} alt={acName} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {acName.charAt(0)}
                      </div>
                    )}
                    <p className="text-xs font-semibold text-foreground truncate">{acName}</p>
                  </div>
                  <div className="space-y-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Assumidos</span>
                      <span className="font-semibold text-foreground">{assumidos}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Em Negociação</span>
                      <span className="font-semibold text-blue-600">{emNeg} • {formatCurrency(valorEmNeg)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Acordo Feito</span>
                      <span className="font-semibold text-emerald-600">{acordos} ({pctAcordo}%) • {formatCurrency(valorAcordo)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden saas-shadow">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Nome Completo', 'WhatsApp', 'Assumir / AC', 'Status', 'Pagamento', 'Ações'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Nenhum aluno em Renda Extra.
                  </td>
                </tr>
              ) : (
                filtered.map((student) => {
                  const saldoPendente = student.installments.filter((i) => !i.paid).reduce((a, i) => a + i.value, 0);
                  const valorDesc = saldoPendente * (1 - rules.descontoRendaExtra / 100);
                  const isAssumed = !!student.rendaExtraAC && student.rendaExtraStatus === 'Em Negociação';
                  const assignedAt = student.rendaExtraACAssignedAt ? new Date(student.rendaExtraACAssignedAt) : null;
                  const hoursLeft = assignedAt ? Math.max(0, 72 - ((Date.now() - assignedAt.getTime()) / (1000 * 60 * 60))) : 0;
                  const reStatus = student.rendaExtraStatus ?? 'Conciliar Exclusão';
                  const isAcordo = reStatus === 'Acordo Feito';
                  const aguardandoPagto = !!student.rendaExtraPaymentDate && reStatus === 'Em Negociação';
                  const pgtoBR = student.rendaExtraPaymentDate ? student.rendaExtraPaymentDate.split('-').reverse().join('/') : null;
                  const metodoLabel = student.rendaExtraPaymentMethod === 'link' ? 'Link de Pagamento' : 'PIX';

                  return (
                    <tr key={student.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      {/* Nome */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{student.name}</span>
                          {student.product && (
                            <span className="text-[9px] font-normal text-muted-foreground leading-none" title={student.product}>
                              {student.product}
                            </span>
                          )}
                          {student.rendaExtraInclusionDate && (
                            <span className="text-[10px] text-muted-foreground">
                              Inclusão: {new Date(student.rendaExtraInclusionDate).toLocaleDateString('pt-BR')}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* WhatsApp */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">{student.whatsapp}</td>

                      {/* Assumir / AC */}
                      <td className="px-4 py-3">
                        {isAcordo ? (
                          <span className="text-xs text-muted-foreground italic">
                            {student.rendaExtraAC ?? '—'}
                          </span>
                        ) : isAssumed ? (
                          <div>
                            <span className="text-xs font-semibold text-foreground">{student.rendaExtraAC}</span>
                            <span className={`block text-[10px] font-medium ${hoursLeft < 12 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {Math.floor(hoursLeft)}h restantes
                            </span>
                          </div>
                        ) : reStatus === 'Conciliar Exclusão' ? (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        ) : (
                          <select
                            className="text-[11px] px-2 py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary font-medium cursor-pointer"
                            defaultValue=""
                            onChange={(e) => { if (e.target.value) assumirRendaExtra(student.id, e.target.value); }}
                          >
                            <option value="" disabled>Assumir</option>
                            {activeACs.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
                          </select>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {isAcordo ? (
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg ${statusColors['Acordo Feito']}`}>
                            Acordo Feito
                          </span>
                        ) : (
                          (() => {
                            // "Conciliar Exclusão" é INTOCÁVEL na Renda Extra:
                            // só sai dessa etapa pela aba Conciliação (após
                            // confirmar exclusão do aluno no Kamino).
                            const isConciliarExclusao = reStatus === 'Conciliar Exclusão';
                            const isDisabled = reStatus === 'Em Negociação' || isConciliarExclusao;
                            const lockTitle = isConciliarExclusao
                              ? 'A liberação deste aluno só pode ser feita pela aba Conciliação, após o setor confirmar a exclusão no Kamino.'
                              : undefined;
                            return (
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={reStatus}
                                    onChange={(e) => setRendaExtraStatus(student.id, e.target.value as RendaExtraStatus)}
                                    disabled={isDisabled}
                                    title={lockTitle}
                                    className={`text-[10px] font-semibold px-2 py-1 rounded-lg border-0 ${isConciliarExclusao ? 'cursor-not-allowed' : 'cursor-pointer'} ${statusColors[reStatus] ?? ''} disabled:opacity-90`}
                                  >
                                    {RE_STATUS_ORDER.filter((s) => s !== 'Acordo Feito').map((s) => (
                                      <option key={s} value={s}>{s}</option>
                                    ))}
                                  </select>
                                  {isConciliarExclusao && <Lock size={11} className="text-purple-500" />}
                                </div>
                                {aguardandoPagto && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200/60 w-fit">
                                    <Clock size={9} />
                                    Aguardando Pagamento
                                  </span>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </td>

                      {/* Pagamento */}
                      <td className="px-4 py-3">
                        {isAcordo ? (
                          (() => {
                            // Item 4 — Onda 2: mostra a data de pagamento
                            // abaixo do valor do acordo. Pegamos a maior
                            // paidDate entre as parcelas baixadas no acordo.
                            const paidDates = student.installments
                              .filter((i) => i.paid && i.paidDate)
                              .map((i) => i.paidDate as string)
                              .sort();
                            const dataPgto = paidDates.length ? paidDates[paidDates.length - 1] : null;
                            const dataPgtoBR = dataPgto
                              ? dataPgto.split('-').reverse().join('/')
                              : null;
                            return (
                              <button
                                type="button"
                                onClick={() => setHistoryStudent(student)}
                                title="Ver histórico do acordo (com possibilidade de editar)"
                                className="text-left rounded-lg px-2 py-1 -mx-2 -my-1 hover:bg-emerald-500/10 transition-colors"
                              >
                                <span className="text-xs font-bold text-emerald-600 underline decoration-dotted underline-offset-2">{formatCurrency(student.rendaExtraAcordoValue ?? 0)}</span>
                                {dataPgtoBR && (
                                  <span className="block text-[10px] font-medium text-emerald-700/80">
                                    Pgto: {dataPgtoBR}
                                  </span>
                                )}
                                <span className="block text-[10px] text-muted-foreground">Acordo realizado • ver histórico</span>
                              </button>
                            );
                          })()
                        ) : aguardandoPagto ? (
                          <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2">
                            <div className="flex flex-col leading-tight">
                              <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                                {student.rendaExtraPaymentMethod === 'link' ? <Link2 size={10} /> : <QrCode size={10} />}
                                {metodoLabel}
                              </span>
                              <span className="text-xs font-bold text-amber-900">
                                {pgtoBR}
                              </span>
                              <span className="text-[10px] text-amber-700/80">
                                {formatCurrency(student.rendaExtraAcordoValue ?? 0)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditPagtoStudent(student)}
                              title="Editar pagamento"
                              className="ml-auto p-1.5 rounded-lg text-amber-700 hover:bg-amber-200/60 transition-colors"
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        ) : (
                          (() => {
                            const isConciliarExclusao = reStatus === 'Conciliar Exclusão';
                            const disabled = saldoPendente === 0 || !podeConfirmarPagto || isConciliarExclusao;
                            const tooltip = isConciliarExclusao
                              ? 'Aguardando conciliação da exclusão. Disponibilize a negociação primeiro.'
                              : !podeConfirmarPagto
                                ? 'Você não tem permissão para confirmar pagamentos'
                                : undefined;
                            const handleClick = () => {
                              if (isConciliarExclusao) {
                                toast.error('Não é possível pagar enquanto o status estiver em "Conciliar Exclusão". Aguarde a conciliação.');
                                return;
                              }
                              setPagarStudent(student);
                            };
                            return (
                              <button
                                onClick={handleClick}
                                disabled={disabled}
                                title={tooltip}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-400/30 hover:bg-emerald-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                {(!podeConfirmarPagto || isConciliarExclusao) ? <Lock size={12} /> : <HandCoins size={12} />}
                                PAGAR
                              </button>
                            );
                          })()
                        )}
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setHistoryStudent(student)} className="action-btn" title="Histórico">
                            <Clock size={12} />
                          </button>
                          <button onClick={() => setDeleteId(student.id)} className="action-btn text-destructive" title="Excluir">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {pagarStudent && <PagarModal student={pagarStudent} onClose={() => setPagarStudent(null)} />}
      {editPagtoStudent && <EditPagamentoModal student={editPagtoStudent} onClose={() => setEditPagtoStudent(null)} />}
      {historyStudent && <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />}
      {deleteId && (
        <DeleteModal
          onConfirm={() => { removerDeRendaExtra(deleteId); setDeleteId(null); }}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}
