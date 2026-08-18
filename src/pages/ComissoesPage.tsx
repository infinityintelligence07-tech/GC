import { useEffect, useMemo, useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { useCommissionsStore, Commission, CommissionPaymentType, CommissionRates, isCommissionRejected, commissionRejectionReason } from '@/store/useCommissionsStore';
import { toast } from 'sonner';

import { getComissoesScope } from '@/types';
import { Trophy, CheckCircle2, Clock, Ban, Trash2, RotateCcw, Settings2, DollarSign, CalendarDays, GraduationCap } from 'lucide-react';
import { computeAcReversalMetrics, roundReversalPercent, type AcMetric } from '@/lib/acReversalMetrics';

const PT_LABEL: Record<CommissionPaymentType, string> = {
  boleto: 'Boleto',
  pix: 'Pix',
  cartao: 'Cartão de Crédito',
};

export default function ComissoesPage() {
  const { acs, currentUser, cancellationCases, rules, students } = useAppStore();
  const { commissions, rates, setRates, markPaga, markPendente, cancel, remove } = useCommissionsStore();
  const [detail, setDetail] = useState<Commission | null>(null);
  const isAdmin = currentUser?.role === 'admin';
  const scope = getComissoesScope(currentUser);
  const ownOnly = scope === 'own';
  // Assessores (escopo próprio) não podem gerenciar comissões — apenas visualizar.
  const canManage = !ownOnly;
  // Nome do AC do próprio usuário (usado quando ownOnly = true)
  const ownAcId = currentUser?.acId ?? null;
  const ownAcName = useMemo(() => acs.find((a) => a.id === ownAcId)?.name ?? null, [acs, ownAcId]);

  const [filterAc, setFilterAc] = useState<string>(ownOnly && ownAcId ? ownAcId : 'all');
  useEffect(() => {
    if (ownOnly && ownAcId) setFilterAc(ownAcId);
  }, [ownOnly, ownAcId]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pendente' | 'paga' | 'cancelada'>('all');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  // Default: todo o período (sem recorte de data) — evita esconder comissões antigas
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [filterDateStart, setFilterDateStart] = useState<string>('');
  const [filterDateEnd, setFilterDateEnd] = useState<string>('');
  

  const applyDatePreset = (preset: '7d' | '30d' | 'quarter' | 'year' | 'month' | 'last-month') => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    switch (preset) {
      case '7d': start.setDate(end.getDate() - 7); break;
      case '30d': start.setDate(end.getDate() - 30); break;
      case 'quarter': start.setMonth(end.getMonth() - 3); break;
      case 'year': start.setFullYear(end.getFullYear() - 1); break;
      case 'month': start.setTime(firstDayOfMonth.getTime()); break;
      case 'last-month':
        start.setDate(1);
        start.setMonth(end.getMonth() - 1);
        end.setDate(0);
        break;
    }
    setFilterDateStart(fmtDate(start));
    setFilterDateEnd(fmtDate(end));
  };
  const [draftRates, setDraftRates] = useState<CommissionRates>(rates);
  useEffect(() => { setDraftRates(rates); }, [rates]);

  const products = useMemo(() => {
    const set = new Set(commissions.map((c) => c.product).filter(Boolean));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }, [commissions]);

  const filtered = useMemo(() => {
    return commissions.filter((c) => {
      if (filterAc !== 'all') {
        // Registros antigos podem ter vindo sem `acId` — casa também pelo nome do AC.
        const acRow = acs.find((a) => a.id === filterAc);
        const matches = c.acId ? c.acId === filterAc : (!!c.acName && c.acName === acRow?.name);
        if (!matches) return false;
      }

      if (filterStatus !== 'all' && c.status !== filterStatus) return false;
      if (filterProduct !== 'all' && c.product !== filterProduct) return false;
      if (filterDateStart || filterDateEnd) {
        const d = new Date(c.createdAt);
        d.setHours(0, 0, 0, 0);
        if (filterDateStart) {
          const start = new Date(filterDateStart + 'T00:00:00');
          if (d.getTime() < start.getTime()) return false;
        }
        if (filterDateEnd) {
          const end = new Date(filterDateEnd + 'T23:59:59');
          if (d.getTime() > end.getTime()) return false;
        }
      }
      return true;
    });
  }, [commissions, acs, filterAc, filterStatus, filterProduct, filterDateStart, filterDateEnd]);

  const kpis = useMemo(() => {
    // Comissões já conciliadas (liberadas) e as que aguardam conciliação.
    const eligible = filtered.filter((c) => !c.pendingApproval);
    const active = eligible.filter((c) => c.status !== 'cancelada');
    const total = active.reduce((s, c) => s + c.value, 0);
    const pend = active.filter((c) => c.status === 'pendente').reduce((s, c) => s + c.value, 0);
    const pago = active.filter((c) => c.status === 'paga').reduce((s, c) => s + c.value, 0);
    const awaitingList = filtered.filter((c) => c.pendingApproval && c.status !== 'cancelada');
    const awaiting = awaitingList.reduce((s, c) => s + c.value, 0);
    // Visão total do assessor: conciliadas + aguardando conciliação.
    const totalGeral = total + awaiting;
    return { count: active.length + awaitingList.length, total, totalGeral, pend, pago, awaiting };
  }, [filtered]);

  // Métricas por assessor (baseadas nos casos de cancelamento, respeitando filtros de AC e data)
  const acMetrics = useMemo(() => {
    const acNameFilter = filterAc === 'all' ? null : (acs.find((a) => a.id === filterAc)?.name ?? null);
    return computeAcReversalMetrics({
      cancellationCases, commissions, acs, rules,
      acNameFilter, dateStart: filterDateStart, dateEnd: filterDateEnd,
    });
  }, [cancellationCases, commissions, filterAc, filterDateStart, filterDateEnd, acs, rules]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Trophy size={18} className="text-amber-600" /> Comissões
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Comissões geradas automaticamente ao reverter alunos na coluna <b>Em Tratativas</b>.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Total geral" value={formatCurrency(kpis.totalGeral)} icon={<DollarSign size={14} />} tone="neutral" />
        <KpiCard label="Conciliado" value={formatCurrency(kpis.total)} icon={<CheckCircle2 size={14} />} tone="neutral" />
        <KpiCard label="Aguardando conciliação" value={formatCurrency(kpis.awaiting)} icon={<Clock size={14} />} tone="neutral" />
        <KpiCard label="Pendente" value={formatCurrency(kpis.pend)} icon={<Clock size={14} />} tone="amber" />
        <KpiCard label="Paga" value={formatCurrency(kpis.pago)} icon={<CheckCircle2 size={14} />} tone="emerald" />
        <KpiCard label="Reversões" value={String(kpis.count)} icon={<Trophy size={14} />} tone="neutral" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {ownOnly ? (
          <div className="px-3 py-1.5 rounded-lg text-xs bg-violet-500/5 border border-violet-300 text-violet-700 font-medium">
            👤 Minhas comissões{ownAcName ? ` · ${ownAcName}` : ''}
          </div>
        ) : (
          <select value={filterAc} onChange={(e) => setFilterAc(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs bg-card border border-border">
            <option value="all">Todos os assessores</option>
            {acs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="px-3 py-1.5 rounded-lg text-xs bg-card border border-border">
          <option value="all">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="paga">Paga</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-card border border-border">
          <GraduationCap size={12} className="text-muted-foreground" />
          <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}
            className="bg-transparent border-none p-0 text-xs focus:ring-0">
            <option value="all">Todos os treinamentos</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-card border border-border">
          <CalendarDays size={12} className="text-muted-foreground" />
          <input
            type="date"
            value={filterDateStart}
            onChange={(e) => setFilterDateStart(e.target.value)}
            className="bg-transparent border-none p-0 text-xs focus:ring-0 w-[110px]"
            placeholder="Início"
          />
          <span className="text-muted-foreground">—</span>
          <input
            type="date"
            value={filterDateEnd}
            onChange={(e) => setFilterDateEnd(e.target.value)}
            className="bg-transparent border-none p-0 text-xs focus:ring-0 w-[110px]"
            placeholder="Fim"
          />
        </div>
        <div className="flex items-center gap-1">
          {[
            { key: '7d', label: '7 dias' },
            { key: '30d', label: '30 dias' },
            { key: 'month', label: 'Mês atual' },
            { key: 'last-month', label: 'Mês passado' },
            { key: 'quarter', label: 'Trimestre' },
            { key: 'year', label: 'Ano' },
          ].map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyDatePreset(preset.key as '7d' | '30d' | 'quarter' | 'year' | 'month' | 'last-month')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {(filterProduct !== 'all' || filterDateStart || filterDateEnd) && (
          <button
            onClick={() => { setFilterProduct('all'); setFilterDateStart(''); setFilterDateEnd(''); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Métricas por Assessor — Ranking Pódio */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Trophy size={13} className="text-amber-600" /> Métricas por Assessor
          </h2>
          <span className="text-[10px] text-muted-foreground">
            Ranqueado por financeiro revertido (respeita filtros de assessor e data)
          </span>
        </div>
        {acMetrics.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center text-xs text-muted-foreground">
            Nenhum caso de cancelamento no filtro atual.
          </div>
        ) : (
          <ACMetricsRanking metrics={acMetrics} />
        )}
      </div>



      {/* Tabela */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Data</th>
                <th className="text-left px-3 py-2 font-semibold">Aluno</th>
                <th className="text-left px-3 py-2 font-semibold">Assessor</th>
                <th className="text-left px-3 py-2 font-semibold">Treinamento</th>
                <th className="text-left px-3 py-2 font-semibold">Método</th>
                <th className="text-right px-3 py-2 font-semibold">Valor Revertido</th>
                <th className="text-right px-3 py-2 font-semibold">%</th>
                <th className="text-right px-3 py-2 font-semibold">Comissão</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                {canManage && <th className="text-right px-3 py-2 font-semibold">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 10 : 9} className="text-center py-8 text-muted-foreground">
                    Nenhuma comissão registrada ainda. Reverta um aluno em <b>Em Tratativas</b> para gerar.
                  </td>
                </tr>
              ) : filtered.map((c) => (
                <Row key={c.id} c={c}
                  onPaga={() => markPaga(c.id)}
                  onPendente={() => markPendente(c.id)}
                  onCancel={() => cancel(c.id)}
                  onRemove={() => remove(c.id)}
                  onOpenDetail={() => setDetail(c)}
                  isAdmin={isAdmin}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {detail && (
        <CommissionDetailModal
          commission={detail}
          caseRef={cancellationCases.find((cc) => cc.id === detail.cancellationCaseId)}
          student={students.find((s) => s.id === detail.studentId) || students.find((s) => s.name === detail.studentName)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone: 'indigo' | 'emerald' | 'rose' | 'amber' }) {
  const toneMap = {
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    rose: 'bg-rose-50 border-rose-100 text-rose-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
  } as const;
  return (
    <div className={`rounded-xl border p-2.5 ${toneMap[tone]}`}>
      <div className="text-[10px] font-medium opacity-80">{label}</div>
      <div className="text-sm font-bold mt-0.5 text-foreground">{value}</div>
    </div>
  );
}

export function ACMetricsRanking({ metrics }: { metrics: AcMetric[] }) {
  const podium = metrics.slice(0, 3);
  const rest = metrics.slice(3);
  const [first, second, third] = [podium[0], podium[1], podium[2]];
  const visualOrder = [second, first, third].filter(Boolean) as AcMetric[];

  return (
    <div className="relative overflow-hidden bg-card border border-border rounded-2xl p-6 saas-shadow-sm">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-72 h-56 rounded-full blur-3xl opacity-25"
          style={{ background: 'radial-gradient(circle, hsl(38 45% 65% / 0.55), transparent 70%)' }}
        />
        <div className="relative flex items-end justify-center gap-4 sm:gap-8 pb-2">
          {visualOrder.map((m) => {
            const place = m.acName === first?.acName ? 1 : m.acName === second?.acName ? 2 : 3;
            return <PodiumMetric key={m.acName} m={m} place={place as 1 | 2 | 3} />;
          })}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="mt-8 pt-5 border-t border-border/60">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Demais posições
          </p>
          <ul className="space-y-1.5">
            {rest.map((m, idx) => (
              <li key={m.acName} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-muted/60 transition-colors">
                <span className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-[11px] font-bold flex items-center justify-center">
                  {idx + 4}
                </span>
                {m.acPhoto ? (
                  <img src={m.acPhoto} alt={m.acName} className="w-8 h-8 rounded-full object-cover border border-border" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground border border-border">
                    {m.acName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{m.acName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {m.inscricoesRevertidas}/{m.inscricoesTotal} revertidas · {formatCurrency(m.financeiroRevertido)}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-emerald-700 tabular-nums">{formatCurrency(m.comissaoValor)}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {m.reversalPercent.toFixed(1).replace('.', ',')}% de reversão
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabela detalhada por assessor */}
      <div className="mt-6 pt-5 border-t border-border/60">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Comissões do período
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {metrics.map((m) => (
            <div key={`d-${m.acName}`} className="bg-muted/30 border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {m.acPhoto ? (
                    <img src={m.acPhoto} alt={m.acName} className="w-7 h-7 rounded-full object-cover border border-border" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-muted-foreground border border-border">
                      {m.acName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="font-semibold text-sm text-foreground">{m.acName}</div>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {m.casos} {m.casos === 1 ? 'caso' : 'casos'}
                </span>
              </div>
              <div className="mt-3">
                <MetricTile label="Comissão gerada" value={formatCurrency(m.comissaoValor)} tone="amber" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PodiumMetric({ m, place }: { m: AcMetric; place: 1 | 2 | 3 }) {
  const palette = {
    1: {
      ring: { boxShadow: '0 0 0 3px hsl(38 50% 60%), 0 0 28px -4px hsl(38 55% 55% / 0.55)' },
      avatar: 'w-20 h-20 sm:w-24 sm:h-24',
      badge: 'bg-[hsl(38_50%_60%)] text-[hsl(36_60%_15%)] ring-2 ring-[hsl(40_60%_75%)]',
      name: 'text-sm sm:text-base font-bold',
      valueColor: 'hsl(36 50% 45%)',
      order: 'order-2',
      height: 'h-24',
      cyl: { top: 'hsl(40 55% 78%)', mid: 'hsl(38 48% 60%)', bot: 'hsl(34 38% 38%)', edge: 'hsl(38 45% 50%)' },
    },
    2: {
      ring: { boxShadow: '0 0 0 2px hsl(220 12% 70%)' },
      avatar: 'w-16 h-16 sm:w-20 sm:h-20',
      badge: 'bg-[hsl(220_12%_75%)] text-[hsl(220_25%_25%)] ring-2 ring-[hsl(220_15%_85%)]',
      name: 'text-xs sm:text-sm font-semibold',
      valueColor: 'hsl(220 12% 45%)',
      order: 'order-1',
      height: 'h-16',
      cyl: { top: 'hsl(220 14% 88%)', mid: 'hsl(220 12% 72%)', bot: 'hsl(220 10% 48%)', edge: 'hsl(220 10% 60%)' },
    },
    3: {
      ring: { boxShadow: '0 0 0 2px hsl(22 40% 55%)' },
      avatar: 'w-16 h-16 sm:w-20 sm:h-20',
      badge: 'bg-[hsl(22_42%_55%)] text-[hsl(22_60%_15%)] ring-2 ring-[hsl(22_45%_70%)]',
      name: 'text-xs sm:text-sm font-semibold',
      valueColor: 'hsl(22 45% 42%)',
      order: 'order-3',
      height: 'h-12',
      cyl: { top: 'hsl(22 45% 70%)', mid: 'hsl(22 42% 52%)', bot: 'hsl(20 35% 32%)', edge: 'hsl(22 40% 45%)' },
    },
  }[place];

  return (
    <div className={`flex flex-col items-center flex-1 max-w-[180px] ${palette.order}`}>
      <div className="relative">
        {m.acPhoto ? (
          <img src={m.acPhoto} alt={m.acName} className={`${palette.avatar} rounded-full object-cover bg-muted`} style={palette.ring} />
        ) : (
          <div className={`${palette.avatar} rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center text-xl font-bold text-muted-foreground`} style={palette.ring}>
            {m.acName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className={`absolute -top-2 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full ${palette.badge} text-xs font-extrabold flex items-center justify-center shadow-md`}>
          {place}
        </span>
      </div>
      <div className="mt-3 text-center min-w-0 w-full px-1">
        <p className={`${palette.name} text-foreground truncate`}>{m.acName}</p>
        <p className="mt-0.5 text-sm sm:text-base font-bold tabular-nums" style={{ color: palette.valueColor }}>
          {formatCurrency(m.financeiroRevertido)}
        </p>
      </div>
      <div className={`relative mt-3 w-full ${palette.height}`}>
        <div
          className="absolute inset-0 rounded-b-md overflow-hidden"
          style={{
            background: `linear-gradient(180deg, ${palette.cyl.mid} 0%, ${palette.cyl.mid} 55%, ${palette.cyl.bot} 100%)`,
            boxShadow: `inset 0 -4px 12px ${palette.cyl.bot}, inset 0 0 0 1px ${palette.cyl.edge}`,
          }}
        >
          <span className="absolute inset-0 flex items-center justify-center text-white/90 font-bold tracking-wide drop-shadow-sm text-sm">
            {place}º
          </span>
        </div>
        <div
          className="absolute -top-[10px] left-0 right-0 h-[20px] rounded-[50%]"
          style={{
            background: `radial-gradient(ellipse at 35% 30%, ${palette.cyl.top} 0%, ${palette.cyl.mid} 75%, ${palette.cyl.edge} 100%)`,
            boxShadow: `inset 0 1px 0 hsl(0 0% 100% / 0.4), inset 0 -2px 4px ${palette.cyl.edge}`,
          }}
        />
      </div>
      <div className="mt-3 w-full">
        <ReversalGauge
          percent={m.reversalPercent}
          meta1={m.meta1}
          meta2={m.meta2}
          meta3={m.meta3}
          revertidas={m.inscricoesRevertidas}
          total={m.inscricoesTotal}
        />
      </div>
    </div>
  );
}


function KpiCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'neutral' | 'emerald' | 'amber' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-muted-foreground';
  return (
    <div className="bg-card border border-border rounded-2xl p-3">
      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${toneClass}`}>{icon}{label}</div>
      <div className="text-base font-bold text-foreground mt-1">{value}</div>
    </div>
  );
}

function RateField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" step="0.01" min={0} value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="flex-1 px-3 py-2 rounded-lg text-xs bg-card border border-border" />
        <span className="text-xs text-muted-foreground">%</span>
      </div>
    </label>
  );
}

function Row({ c, onPaga, onPendente, onCancel, onRemove, onOpenDetail, isAdmin, canManage }: {
  c: Commission;
  onPaga: () => void; onPendente: () => void; onCancel: () => void; onRemove: () => void;
  onOpenDetail: () => void;
  isAdmin: boolean;
  canManage: boolean;
}) {
  const isAwaiting = !!c.pendingApproval;
  const isRejected = isCommissionRejected(c);
  const statusChip =
    isRejected ? 'bg-rose-50 text-rose-700 border-rose-200' :
    isAwaiting ? 'bg-violet-50 text-violet-700 border-violet-200' :
    c.status === 'paga' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    c.status === 'cancelada' ? 'bg-muted text-muted-foreground border-border' :
    'bg-amber-50 text-amber-700 border-amber-200';
  const statusLabel = isRejected
    ? 'Conciliação reprovada'
    : isAwaiting
    ? 'Aguardando conciliação'
    : c.status === 'paga' ? 'Paga' : c.status === 'cancelada' ? 'Cancelada' : 'Pendente';
  return (
    <tr className={`border-t border-border hover:bg-muted/30 ${isRejected ? 'bg-rose-50/40 line-through decoration-rose-500 decoration-2 text-rose-700' : isAwaiting ? 'bg-violet-50/30' : ''}`}>

      <td className="px-3 py-2 whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</td>
      <td className="px-3 py-2 font-medium text-foreground">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-left text-primary hover:underline focus:outline-none"
          title="Ver resumo do comissionamento"
        >
          {c.studentName}
        </button>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{c.acName ?? '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{c.product ?? '—'}</td>
      <td className="px-3 py-2">
        <span className="inline-block px-2 py-1 rounded-md text-[11px] bg-muted/60 border border-border text-muted-foreground">
          {PT_LABEL[c.paymentType]}
        </span>
      </td>

      <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(c.revertedValue)}</td>
      <td className="px-3 py-2 text-right">{c.percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
      <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${isRejected ? 'text-rose-700' : isAwaiting ? 'text-violet-700' : 'text-emerald-700'}`}>{formatCurrency(c.value)}</td>
      <td className="px-3 py-2 no-underline">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border no-underline ${statusChip}`}>
          {statusLabel}
        </span>
        {isRejected && (
          <button
            type="button"
            onClick={() => toast.error('Motivo da reprovação', { description: commissionRejectionReason(c) })}
            className="mt-1 block px-2 py-0.5 rounded-md text-[10px] font-semibold border border-rose-300 text-rose-700 hover:bg-rose-100 no-underline"
          >
            Ver motivo
          </button>
        )}
        {isAwaiting && (
          <p className="text-[9px] text-violet-600 mt-1 leading-tight no-underline">Pendente de liberação</p>
        )}
      </td>

      {canManage && (
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-1">
            {!isAwaiting && c.status === 'pendente' && (
              <button onClick={onPaga} title="Marcar como paga"
                className="p-1.5 rounded-md hover:bg-emerald-50 text-emerald-600"><CheckCircle2 size={13} /></button>
            )}
            {!isAwaiting && c.status === 'paga' && (
              <button onClick={onPendente} title="Reabrir"
                className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600"><RotateCcw size={13} /></button>
            )}
            {!isAwaiting && c.status !== 'cancelada' && (
              <button onClick={onCancel} title="Cancelar"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"><Ban size={13} /></button>
            )}
            {isAdmin && (
              <button onClick={onRemove} title="Excluir"
                className="p-1.5 rounded-md hover:bg-rose-50 text-rose-600"><Trash2 size={13} /></button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

// ─── Gauge de reversão (semicírculo com 4 zonas + ponteiro) ─────────────────
function ReversalGauge({ percent, meta1, meta2, meta3, revertidas, total }: {
  percent: number; meta1: number; meta2: number; meta3: number;
  revertidas: number; total: number;
}) {
  // Zonas baseadas nas metas configuradas:
  // vermelho = abaixo da meta1; azul claro = meta1→meta2; azul médio = meta2→meta3; azul escuro = acima da meta3.
  const sortedMetas = [meta1, meta2, meta3]
    .map((v) => Math.max(0, Math.min(100, v)))
    .sort((a, b) => a - b);
  const zoneStops = [0, sortedMetas[0], sortedMetas[1], sortedMetas[2], 100];
  const zoneColors = ['#dc2626', '#93c5fd', '#3b82f6', '#1e3a8a'];
  const cx = 100, cy = 100, r = 80, stroke = 22;
  // Ângulo: 180° (esquerda) → 0° (direita)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const pointFor = (pct: number) => {
    const angle = 180 - (pct / 100) * 180;
    return { x: cx + r * Math.cos(toRad(angle)), y: cy - r * Math.sin(toRad(angle)) };
  };
  const arcPath = (pStart: number, pEnd: number) => {
    const s = pointFor(pStart);
    const e = pointFor(pEnd);
    return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
  };
  const pctClamped = Math.max(0, Math.min(100, percent));
  const needleAngle = 180 - (pctClamped / 100) * 180;
  const needleTip = { x: cx + (r - 4) * Math.cos(toRad(needleAngle)), y: cy - (r - 4) * Math.sin(toRad(needleAngle)) };
  const labelPos = (pct: number) => {
    const angle = 180 - (pct / 100) * 180;
    return { x: cx + (r + 14) * Math.cos(toRad(angle)), y: cy - (r + 14) * Math.sin(toRad(angle)) };
  };
  // Evita sobreposição de labels quando as metas estão próximas — separa no mínimo 10% no arco.
  const spreadMetas = (() => {
    const arr = [meta1, meta2, meta3]
      .map((v) => Math.max(0, Math.min(100, v)))
      .sort((a, b) => a - b);
    const min = 10;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - arr[i - 1] < min) arr[i] = Math.min(100, arr[i - 1] + min);
    }
    return arr;
  })();
  const meta1Pos = labelPos(spreadMetas[0]);
  const meta2Pos = labelPos(spreadMetas[1]);
  const meta3Pos = labelPos(spreadMetas[2]);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Reversão vs Metas
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {revertidas}/{total} inscrições
        </span>
      </div>
      <svg viewBox="-8 -14 216 138" className="w-full" preserveAspectRatio="xMidYMid meet">
        {zoneStops.slice(0, -1).map((s, i) => (
          <path key={i} d={arcPath(s, zoneStops[i + 1])} stroke={zoneColors[i]} strokeWidth={stroke} fill="none" strokeLinecap="butt" />
        ))}
        {/* labels das metas */}
        <text x={meta1Pos.x} y={meta1Pos.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
          {meta1}%
        </text>
        <text x={meta2Pos.x} y={meta2Pos.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
          {meta2}%
        </text>
        <text x={meta3Pos.x} y={meta3Pos.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">
          {meta3}%
        </text>
        {/* ponteiro */}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={8} fill="#0f172a" />
        <circle cx={cx} cy={cy} r={3} fill="#ef4444" />
      </svg>
      <div className="text-center -mt-1">
        <div className="text-lg font-bold text-foreground tabular-nums">
          {pctClamped.toFixed(1).replace('.', ',')}%
        </div>
        <div className="text-[10px] text-muted-foreground">de reversão</div>
      </div>
    </div>
  );
}

// ─── Resumo do Comissionamento (clique no nome do aluno) ───────────────────
function CommissionDetailModal({
  commission, caseRef, student, onClose,
}: {
  commission: Commission;
  caseRef?: { quantidadeInscricoes?: number; inscricoesRevertidas?: number; value?: number; operationalStatus?: string; funnelStage?: string; product?: string; createdAt?: string };
  student?: { saleValue?: number; downPayment?: number; installments?: Array<{ paid?: boolean; value?: number; paidValue?: number }> };
  onClose: () => void;
}) {
  const totalInsc = Math.max(1, caseRef?.quantidadeInscricoes ?? 1);
  const revertidas = Math.min(totalInsc, caseRef?.inscricoesRevertidas ?? 0);
  const contractTotal = student?.saleValue ?? caseRef?.value ?? 0;
  const perInsc = contractTotal / totalInsc;
  const valorRevertidoProporcional = perInsc * revertidas;
  const entrada = Number(student?.downPayment) || 0;
  const parcelasPagas = (student?.installments ?? [])
    .filter((i) => i.paid)
    .reduce((s, i) => s + (Number(i.paidValue) || Number(i.value) || 0), 0);
  const totalPago = Math.round((entrada + parcelasPagas) * 100) / 100;
  const status = commission.status === 'paga' ? 'Paga' : commission.status === 'cancelada' ? 'Cancelada' : 'Pendente';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto saas-shadow-md"
      >
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground truncate">{commission.studentName}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Resumo do comissionamento · {commission.acName ?? '—'}
              {commission.product ? ` · ${commission.product}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none px-2">×</button>
        </div>

        <div className="p-5 space-y-4">
          <section className="grid grid-cols-2 gap-2">
            <DetailTile label="Total do contrato" value={formatCurrency(contractTotal)} tone="indigo" />
            <DetailTile label="Total pago (entrada + parcelas)" value={formatCurrency(totalPago)} tone="emerald" />
            <DetailTile label="Total de inscrições" value={String(totalInsc)} tone="amber" />
            <DetailTile label="Inscrições revertidas" value={`${revertidas} / ${totalInsc}`} tone="emerald" />
            <DetailTile label="Valor por inscrição" value={formatCurrency(perInsc)} tone="indigo" />
            <DetailTile label="Valor revertido proporcional" value={formatCurrency(valorRevertidoProporcional)} tone="emerald" />
          </section>

          <section className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Comissão</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <span className="text-muted-foreground">Método de pagamento</span>
              <span className="text-right font-medium">{PT_LABEL[commission.paymentType]}</span>
              <span className="text-muted-foreground">Base (valor revertido)</span>
              <span className="text-right font-medium tabular-nums">{formatCurrency(commission.revertedValue)}</span>
              <span className="text-muted-foreground">Percentual aplicado</span>
              <span className="text-right font-medium tabular-nums">{commission.percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</span>
              <span className="text-muted-foreground">Valor da comissão</span>
              <span className="text-right font-bold text-emerald-700 tabular-nums">{formatCurrency(commission.value)}</span>
              <span className="text-muted-foreground">Status</span>
              <span className="text-right font-medium">{status}</span>
              <span className="text-muted-foreground">Registrada em</span>
              <span className="text-right font-medium">{new Date(commission.createdAt).toLocaleDateString('pt-BR')}</span>
              {commission.paidAt && (
                <>
                  <span className="text-muted-foreground">Paga em</span>
                  <span className="text-right font-medium">{new Date(commission.paidAt).toLocaleDateString('pt-BR')}</span>
                </>
              )}
            </div>
          </section>

          {commission.observacao && (
            <section className="rounded-xl border border-border bg-background p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Observação</h3>
              <p className="text-xs text-foreground whitespace-pre-line">{commission.observacao}</p>
            </section>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-3 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailTile({ label, value, tone }: { label: string; value: string; tone: 'indigo' | 'emerald' | 'amber' }) {
  const toneMap = {
    indigo: 'bg-indigo-50 border-indigo-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    amber: 'bg-amber-50 border-amber-100',
  } as const;
  return (
    <div className={`rounded-xl border p-3 ${toneMap[tone]}`}>
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5 text-foreground tabular-nums">{value}</div>
    </div>
  );
}
