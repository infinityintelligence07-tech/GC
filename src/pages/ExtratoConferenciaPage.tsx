import { useEffect, useMemo, useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import PeriodFilter, { type PeriodMode, getPeriodRange } from '@/components/ui/PeriodFilter';
import {
  buildExtratoConferencia,
  computeCarteiraTotal,
  computeEntradasNaData,
  mapSnapshotPayloadToStudents,
  type ExtratoLinha,
} from '@/lib/extratoConferencia';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle, Landmark, Wallet, Scale, Loader2, ArrowDownCircle, Filter } from 'lucide-react';

function formatDateBR(iso: string): string {
  try {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
}

function formatTimeBR(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function LinhaExtrato({ linha }: { linha: ExtratoLinha }) {
  if (linha.kind === 'saldo_anterior' || linha.kind === 'saldo_dia') {
    return (
      <tr className="bg-muted/50 font-semibold border-t border-border">
        <td className="px-3 py-2 text-xs text-foreground" colSpan={4}>{linha.descricao}</td>
        <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">—</td>
        <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">—</td>
        <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">—</td>
        <td className="px-3 py-2 text-xs text-right tabular-nums text-foreground font-bold">{formatCurrency(linha.saldoExtrato)}</td>
      </tr>
    );
  }

  if (linha.kind === 'conferencia') {
    return (
      <tr className="bg-emerald-50/80 border-t border-emerald-200">
        <td className="px-3 py-1.5 text-[10px] text-emerald-800" colSpan={4}>
          <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide">
            <CheckCircle2 size={12} /> {linha.descricao}
          </span>
        </td>
        <td className="px-3 py-1.5 text-[10px] text-right tabular-nums text-emerald-800">—</td>
        <td className="px-3 py-1.5 text-[10px] text-right tabular-nums text-emerald-800">—</td>
        <td className="px-3 py-1.5 text-[10px] text-right tabular-nums text-emerald-800">—</td>
        <td className="px-3 py-1.5 text-[10px] text-right tabular-nums font-bold text-emerald-900">
          {formatCurrency(linha.saldoDashboard ?? linha.saldoExtrato)}
        </td>
      </tr>
    );
  }

  const isAjuste = linha.id.startsWith('ajuste-');
  return (
    <tr className={`border-t border-border/60 ${linha.neutro ? 'opacity-90' : ''} ${isAjuste ? 'bg-amber-50/50' : 'hover:bg-muted/30'}`}>
      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatDateBR(linha.date)}</td>
      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatTimeBR(linha.sortAt)}</td>
      <td className="px-3 py-2 text-xs text-foreground">
        <div className="font-medium">{linha.descricao}</div>
        {linha.tipoConciliacao && (
          <div className="text-[10px] text-muted-foreground">{linha.tipoConciliacao.replace(/_/g, ' ')}</div>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-muted-foreground">
        <div>{linha.studentName ?? '—'}</div>
        {linha.ac && <div className="text-[10px]">{linha.ac}</div>}
      </td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-sky-700 font-medium">
        {linha.entradaConta && linha.entradaConta > 0 ? formatCurrency(linha.entradaConta) : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-700 font-medium">
        {linha.credito > 0 ? formatCurrency(linha.credito) : ''}
      </td>
      <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-700 font-medium">
        {linha.debito > 0 ? formatCurrency(linha.debito) : ''}
      </td>
      <td className="px-3 py-2 text-xs text-right tabular-nums font-semibold text-foreground">
        {formatCurrency(linha.saldoExtrato)}
      </td>
    </tr>
  );
}

export default function ExtratoConferenciaPage() {
  const { students, acs, currentUser } = useAppStore();
  const conciliacaoItems = useConciliacaoStore((s) => s.items);
  const activeCompanyId = useCompanyStore((s) => s.activeCompanyId);

  const [periodMode, setPeriodMode] = useState<PeriodMode>('mes');
  const [periodAnchor, setPeriodAnchor] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [acFilter, setAcFilter] = useState('');
  const [entradaDate, setEntradaDate] = useState(() => getTodayBrasilia().toISOString().slice(0, 10));
  const [filtrarTabelaPorData, setFiltrarTabelaPorData] = useState(true);
  const [snapshotBalances, setSnapshotBalances] = useState<Map<string, number>>(new Map());
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);

  const todayISO = getTodayBrasilia().toISOString().slice(0, 10);
  const period = getPeriodRange(periodMode, periodAnchor, weekIdx);
  const dateFrom = period?.start ?? '2000-01-01';
  const dateTo = period?.end ?? todayISO;

  const isACScoped = !!currentUser?.acId;
  const activeACs = acs.filter((a) => a.active).filter((a) => !isACScoped || a.id === currentUser?.acId);
  const scopedAcName = isACScoped ? (acs.find((a) => a.id === currentUser?.acId)?.name ?? '') : '';
  const effectiveAcFilter = isACScoped ? scopedAcName : acFilter;

  const filteredStudents = useMemo(
    () => (effectiveAcFilter ? students.filter((s) => s.ac === effectiveAcFilter) : students),
    [students, effectiveAcFilter],
  );

  const saldoCarteiraAtual = useMemo(() => computeCarteiraTotal(filteredStudents), [filteredStudents]);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    setLoadingSnapshots(true);

    const loadStart = (() => {
      const d = new Date(dateFrom + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    (async () => {
      try {
        const { data, error } = await supabase
          .from('dashboard_snapshots')
          .select('snapshot_date, payload')
          .eq('company_id', activeCompanyId)
          .gte('snapshot_date', loadStart)
          .lte('snapshot_date', dateTo)
          .order('snapshot_date', { ascending: true });

        if (error) throw error;
        if (cancelled) return;

        const liveById = new Map(students.map((s) => [s.id, s]));
        const map = new Map<string, number>();
        for (const row of data ?? []) {
          const payload = Array.isArray(row.payload) ? row.payload : [];
          const snapStudents = mapSnapshotPayloadToStudents(payload as Record<string, unknown>[], liveById);
          const scoped = effectiveAcFilter ? snapStudents.filter((s) => s.ac === effectiveAcFilter) : snapStudents;
          map.set(row.snapshot_date, computeCarteiraTotal(scoped));
        }
        setSnapshotBalances(map);
      } catch (err) {
        console.warn('[extrato] snapshots:', err);
        if (!cancelled) setSnapshotBalances(new Map());
      } finally {
        if (!cancelled) setLoadingSnapshots(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, dateFrom, dateTo, students, effectiveAcFilter]);

  const extrato = useMemo(
    () =>
      buildExtratoConferencia({
        students,
        conciliacaoItems,
        dateFrom,
        dateTo,
        snapshotBalances,
        todayISO,
        acFilter: effectiveAcFilter || undefined,
      }),
    [students, conciliacaoItems, dateFrom, dateTo, snapshotBalances, todayISO, effectiveAcFilter],
  );

  const conferidoOk = Math.abs(extrato.diferencaAtual) < 0.01;

  const entradasDia = useMemo(
    () =>
      computeEntradasNaData(
        students,
        conciliacaoItems,
        entradaDate,
        effectiveAcFilter || undefined,
      ),
    [students, conciliacaoItems, entradaDate, effectiveAcFilter],
  );

  const linhasVisiveis = useMemo(() => {
    if (!filtrarTabelaPorData) return extrato.linhas;
    return extrato.linhas.filter((l) => {
      if (l.kind === 'saldo_anterior') return entradaDate === dateFrom;
      return l.date === entradaDate;
    });
  }, [extrato.linhas, filtrarTabelaPorData, entradaDate, dateFrom]);

  const acLabel = effectiveAcFilter || 'Todos os assessores';

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Landmark size={20} className="text-primary" />
            Extrato de Conferência
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            Movimentações da carteira com saldo corrido. O saldo de fechamento de cada dia é conferido com a Carteira Total do Dashboard — a diferença deve ser zero.
          </p>
        </div>
        <PeriodFilter
          mode={periodMode}
          setMode={setPeriodMode}
          anchor={periodAnchor}
          setAnchor={setPeriodAnchor}
          weekIdx={weekIdx}
          setWeekIdx={setWeekIdx}
        />
      </div>

      {/* Filtros: data de entrada + assessor */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Filter size={14} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">Filtros do extrato</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
              Data — entrou na conta
            </label>
            <input
              type="date"
              value={entradaDate}
              onChange={(e) => setEntradaDate(e.target.value)}
              className="input-field text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
              Assessor
            </label>
            {isACScoped ? (
              <div className="input-field text-xs bg-muted/40 text-foreground min-w-[180px]">
                {scopedAcName || '—'}
              </div>
            ) : (
              <select
                value={acFilter}
                onChange={(e) => setAcFilter(e.target.value)}
                className="input-field text-xs min-w-[180px]"
              >
                <option value="">Todos os assessores</option>
                {activeACs.map((a) => (
                  <option key={a.id} value={a.name}>{a.name}</option>
                ))}
              </select>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-[11px] text-foreground cursor-pointer pb-0.5">
            <input
              type="checkbox"
              className="accent-primary"
              checked={filtrarTabelaPorData}
              onChange={(e) => setFiltrarTabelaPorData(e.target.checked)}
            />
            Mostrar na tabela só movimentos desta data
          </label>
        </div>
      </div>

      {/* Entrou na conta */}
      <div className="rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 to-card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sky-800 mb-1">
              <ArrowDownCircle size={14} />
              <span className="text-[10px] font-semibold uppercase tracking-wider">Entrou na conta</span>
            </div>
            <p className="text-2xl font-bold text-sky-900 tabular-nums">{formatCurrency(entradasDia.total)}</p>
            <p className="text-[10px] text-sky-700/80 mt-1">
              {formatDateBR(entradaDate)} · {acLabel} · {entradasDia.qtd} recebimento{entradasDia.qtd !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {entradasDia.entradas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-sky-200/80 space-y-1.5 max-h-48 overflow-y-auto">
            {entradasDia.entradas.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                <div className="min-w-0">
                  <span className="font-medium text-foreground truncate block">{e.studentName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {e.ac}{e.parcela ? ` · Parcela ${e.parcela}` : ''} · {e.fonte}
                  </span>
                </div>
                <span className="font-semibold text-sky-800 tabular-nums shrink-0">{formatCurrency(e.valor)}</span>
              </div>
            ))}
          </div>
        )}
        {entradasDia.qtd === 0 && (
          <p className="text-[11px] text-sky-700/70 mt-2">Nenhum pagamento registrado nesta data para o filtro selecionado.</p>
        )}
      </div>

      {/* Cards de saldo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-card p-4">
          <div className="flex items-center gap-2 text-blue-800 mb-1">
            <Wallet size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Carteira Total (Dashboard)</span>
          </div>
          <p className="text-2xl font-bold text-blue-900 tabular-nums">{formatCurrency(saldoCarteiraAtual)}</p>
          <p className="text-[10px] text-blue-700/80 mt-1">Saldo atual na carteira</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Scale size={14} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">Saldo do Extrato</span>
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{formatCurrency(extrato.saldoAtualExtrato)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Último saldo corrido do período</p>
        </div>

        <div className={`rounded-xl border p-4 ${conferidoOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className={`flex items-center gap-2 mb-1 ${conferidoOk ? 'text-emerald-800' : 'text-amber-800'}`}>
            {conferidoOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span className="text-[10px] font-semibold uppercase tracking-wider">Conferência</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${conferidoOk ? 'text-emerald-900' : 'text-amber-900'}`}>
            {formatCurrency(extrato.diferencaAtual)}
          </p>
          <p className={`text-[10px] mt-1 ${conferidoOk ? 'text-emerald-700' : 'text-amber-700'}`}>
            {conferidoOk ? 'Carteira − Extrato = 0 ✓' : 'Há divergência entre carteira e extrato'}
          </p>
        </div>
      </div>

      {/* Tabela extrato */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Movimentações
            {filtrarTabelaPorData
              ? ` — ${formatDateBR(entradaDate)}${effectiveAcFilter ? ` · ${effectiveAcFilter}` : ''}`
              : period
                ? ` — ${formatDateBR(dateFrom)} a ${formatDateBR(dateTo)}${effectiveAcFilter ? ` · ${effectiveAcFilter}` : ''}`
                : ' — Todo o período'}
          </h2>
          {loadingSnapshots && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Carregando fotos diárias…
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Hora</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-left">Aluno / AC</th>
                <th className="px-3 py-2 text-right">Entrada conta</th>
                <th className="px-3 py-2 text-right">Crédito carteira</th>
                <th className="px-3 py-2 text-right">Débito</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {linhasVisiveis.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhuma movimentação no filtro selecionado.
                  </td>
                </tr>
              ) : (
                linhasVisiveis.map((linha) => <LinhaExtrato key={linha.id} linha={linha} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumo por dia */}
      {extrato.dias.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Fechamento diário
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {extrato.dias.slice().reverse().map((dia) => (
              <div key={dia.date} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{formatDateBR(dia.date)}</span>
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 font-medium">
                    <CheckCircle2 size={11} /> OK
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {dia.movimentos} movimento{dia.movimentos !== 1 ? 's' : ''} · Saldo {formatCurrency(dia.saldoFinalDashboard)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
