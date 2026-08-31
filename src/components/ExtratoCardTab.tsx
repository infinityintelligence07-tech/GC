// Aba "Extrato do Card" — histórico de leituras diárias do card
// "A Vencer / Vencido" (Carteira Total) + região de lançamentos manuais para
// conferir ("bater") a variação entre duas leituras, no modelo de planilha de
// conciliação: saldo inicial → (+/−) movimentações → saldo esperado vs. real.

import { useEffect, useMemo, useState } from 'react';
import { useAppStore, formatCurrency } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { getTodayBrasilia } from '@/lib/brasiliaDate';
import {
  fetchCarteiraCardSnapshots,
  fetchCarteiraExtratoLancamentos,
  createCarteiraExtratoLancamento,
  deleteCarteiraExtratoLancamento,
  type CarteiraCardSnapshot,
  type CarteiraExtratoLancamento,
  type ExtratoLancamentoTipo,
} from '@/lib/carteiraCardExtrato';
import {
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  Camera,
  ClipboardList,
  Scale,
  Info,
} from 'lucide-react';

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

/** Converte "5.909.923,94", "5909923.94" ou "R$ 1.234,56" em número. */
function parseValorBR(raw: string): number {
  const s = raw.replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}

function firstDayOfMonthISO(): string {
  const d = getTodayBrasilia();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function ExtratoCardTab() {
  const { currentUser } = useAppStore();
  const activeCompanyId = useCompanyStore((s) => s.activeCompanyId);

  const todayISO = getTodayBrasilia().toISOString().slice(0, 10);
  const [dataInicial, setDataInicial] = useState(firstDayOfMonthISO);
  const [dataFinal, setDataFinal] = useState(todayISO);

  const [snapshots, setSnapshots] = useState<CarteiraCardSnapshot[]>([]);
  const [lancamentos, setLancamentos] = useState<CarteiraExtratoLancamento[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Saldos editáveis (pré-preenchidos pelas leituras, mas o usuário pode
  // digitar valores anotados manualmente — ex.: prints antigos do card).
  const [saldoInicialStr, setSaldoInicialStr] = useState('');
  const [saldoFinalStr, setSaldoFinalStr] = useState('');
  const [saldoInicialTouched, setSaldoInicialTouched] = useState(false);
  const [saldoFinalTouched, setSaldoFinalTouched] = useState(false);

  // Form de novo lançamento
  const [novoData, setNovoData] = useState(todayISO);
  const [novoDescricao, setNovoDescricao] = useState('');
  const [novoTipo, setNovoTipo] = useState<ExtratoLancamentoTipo>('debito');
  const [novoValor, setNovoValor] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Reset dos campos "tocados" quando o período muda (repreenche das leituras)
  useEffect(() => {
    setSaldoInicialTouched(false);
    setSaldoFinalTouched(false);
  }, [dataInicial, dataFinal, activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId || !dataInicial || !dataFinal) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [snaps, lancs] = await Promise.all([
          fetchCarteiraCardSnapshots(activeCompanyId, dataInicial, dataFinal),
          fetchCarteiraExtratoLancamentos(activeCompanyId, dataInicial, dataFinal),
        ]);
        if (cancelled) return;
        setSnapshots(snaps);
        setLancamentos(lancs);
      } catch (err) {
        console.warn('[extrato-card] load:', err);
        if (!cancelled) {
          setSnapshots([]);
          setLancamentos([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, dataInicial, dataFinal, reloadKey]);

  const snapInicial = useMemo(
    () => snapshots.find((s) => s.snapshotDate === dataInicial) ?? snapshots[0],
    [snapshots, dataInicial],
  );
  const snapFinal = useMemo(
    () => [...snapshots].reverse().find((s) => s.snapshotDate === dataFinal) ?? snapshots[snapshots.length - 1],
    [snapshots, dataFinal],
  );

  // Pré-preenche os saldos com as leituras assim que carregam
  useEffect(() => {
    if (!saldoInicialTouched && snapInicial) {
      setSaldoInicialStr(snapInicial.aVencer.toFixed(2).replace('.', ','));
    }
  }, [snapInicial, saldoInicialTouched]);
  useEffect(() => {
    if (!saldoFinalTouched && snapFinal) {
      setSaldoFinalStr(snapFinal.aVencer.toFixed(2).replace('.', ','));
    }
  }, [snapFinal, saldoFinalTouched]);

  const saldoInicial = parseValorBR(saldoInicialStr);
  const saldoFinal = parseValorBR(saldoFinalStr);
  const saldosValidos = Number.isFinite(saldoInicial) && Number.isFinite(saldoFinal);

  const totalCreditos = lancamentos.filter((l) => l.tipo === 'credito').reduce((a, l) => a + l.valor, 0);
  const totalDebitos = lancamentos.filter((l) => l.tipo === 'debito').reduce((a, l) => a + l.valor, 0);
  const saldoEsperado = saldosValidos ? saldoInicial + totalCreditos - totalDebitos : NaN;
  const diferenca = saldosValidos ? saldoFinal - saldoEsperado : NaN;
  const bateu = saldosValidos && Math.abs(diferenca) < 0.01;

  const addLancamento = async () => {
    setFormError('');
    if (!activeCompanyId) return;
    const valor = parseValorBR(novoValor);
    if (!novoData) { setFormError('Informe a data do lançamento.'); return; }
    if (!novoDescricao.trim()) { setFormError('Informe a descrição.'); return; }
    if (!Number.isFinite(valor) || valor <= 0) { setFormError('Valor inválido. Use o formato 1.234,56.'); return; }
    setSaving(true);
    try {
      await createCarteiraExtratoLancamento({
        companyId: activeCompanyId,
        data: novoData,
        descricao: novoDescricao.trim(),
        tipo: novoTipo,
        valor,
        autorId: currentUser?.id,
        autorNome: currentUser?.name,
      });
      setNovoDescricao('');
      setNovoValor('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.warn('[extrato-card] criar lançamento:', err);
      setFormError('Falha ao salvar o lançamento. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const removeLancamento = async (id: string) => {
    try {
      await deleteCarteiraExtratoLancamento(id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.warn('[extrato-card] excluir lançamento:', err);
    }
  };

  if (!activeCompanyId) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Selecione uma empresa para ver o extrato do card.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Período */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
              Data inicial (leitura de partida)
            </label>
            <input
              type="date"
              value={dataInicial}
              max={dataFinal}
              onChange={(e) => setDataInicial(e.target.value)}
              className="input-field text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">
              Data final (leitura de chegada)
            </label>
            <input
              type="date"
              value={dataFinal}
              min={dataInicial}
              max={todayISO}
              onChange={(e) => setDataFinal(e.target.value)}
              className="input-field text-xs"
            />
          </div>
          {loading && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground pb-2">
              <Loader2 size={12} className="animate-spin" /> Carregando…
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 flex items-start gap-1">
          <Info size={11} className="mt-0.5 shrink-0" />
          A leitura de cada dia é gravada automaticamente quando o Dashboard é aberto na visão "Todos" sem filtros.
          A leitura de hoje se atualiza a cada abertura do Dashboard.
        </p>
      </div>

      {/* Conferência (modelo planilha) */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <Scale size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Conferência do período — {formatDateBR(dataInicial)} → {formatDateBR(dataFinal)}
          </h2>
        </div>
        <div className="p-4">
          <table className="w-full max-w-xl">
            <tbody>
              <tr>
                <td className="py-1.5 text-xs text-foreground">
                  Saldo inicial <span className="text-[10px] text-muted-foreground">(card em {formatDateBR(dataInicial)})</span>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={saldoInicialStr}
                    placeholder="0,00"
                    onChange={(e) => { setSaldoInicialStr(e.target.value); setSaldoInicialTouched(true); }}
                    className="input-field text-xs text-right tabular-nums w-40"
                  />
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-emerald-700">(+) Entradas lançadas no período</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-emerald-700 pr-2">
                  {formatCurrency(totalCreditos)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-rose-700">(−) Saídas lançadas no período</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-rose-700 pr-2">
                  {formatCurrency(totalDebitos)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5 text-xs font-semibold text-foreground">(=) Saldo esperado</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-bold text-foreground pr-2">
                  {saldosValidos ? formatCurrency(saldoEsperado) : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-foreground">
                  Saldo final <span className="text-[10px] text-muted-foreground">(card em {formatDateBR(dataFinal)})</span>
                </td>
                <td className="py-1.5 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={saldoFinalStr}
                    placeholder="0,00"
                    onChange={(e) => { setSaldoFinalStr(e.target.value); setSaldoFinalTouched(true); }}
                    className="input-field text-xs text-right tabular-nums w-40"
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <div className={`mt-3 rounded-lg border p-3 flex items-center justify-between gap-3 max-w-xl ${
            !saldosValidos
              ? 'border-border bg-muted/20'
              : bateu
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
          }`}>
            <div className={`flex items-center gap-2 text-xs font-semibold ${
              !saldosValidos ? 'text-muted-foreground' : bateu ? 'text-emerald-800' : 'text-amber-800'
            }`}>
              {saldosValidos && bateu ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {!saldosValidos
                ? 'Preencha os saldos para conferir'
                : bateu
                  ? 'Bateu! Saldo final = saldo esperado'
                  : diferenca > 0
                    ? 'Sobra a explicar (falta lançar entrada)'
                    : 'Falta a explicar (falta lançar saída)'}
            </div>
            <span className={`text-sm font-bold tabular-nums ${
              !saldosValidos ? 'text-muted-foreground' : bateu ? 'text-emerald-900' : 'text-amber-900'
            }`}>
              {saldosValidos ? formatCurrency(diferenca) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Região de inserção de lançamentos */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <ClipboardList size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Lançamentos do período
          </h2>
        </div>

        <div className="p-4 border-b border-border bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2 flex-wrap">
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">Data</label>
              <input
                type="date"
                value={novoData}
                onChange={(e) => setNovoData(e.target.value)}
                className="input-field text-xs"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">Descrição</label>
              <input
                type="text"
                value={novoDescricao}
                onChange={(e) => setNovoDescricao(e.target.value)}
                placeholder="Ex.: Baixas conciliadas do dia, cancelamento João Silva…"
                className="input-field text-xs w-full"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">Tipo</label>
              <select
                value={novoTipo}
                onChange={(e) => setNovoTipo(e.target.value === 'credito' ? 'credito' : 'debito')}
                className="input-field text-xs"
              >
                <option value="debito">Saída (− diminui o card)</option>
                <option value="credito">Entrada (+ aumenta o card)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">Valor (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={novoValor}
                onChange={(e) => setNovoValor(e.target.value)}
                placeholder="1.234,56"
                className="input-field text-xs text-right tabular-nums w-32"
                onKeyDown={(e) => { if (e.key === 'Enter') void addLancamento(); }}
              />
            </div>
            <button
              onClick={() => void addLancamento()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Adicionar
            </button>
          </div>
          {formError && <p className="text-[11px] text-rose-600 mt-2">{formError}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-right">Entrada (+)</th>
                <th className="px-3 py-2 text-right">Saída (−)</th>
                <th className="px-3 py-2 text-left">Autor</th>
                <th className="px-3 py-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lancamentos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Nenhum lançamento no período. Use o formulário acima para registrar as movimentações do card.
                  </td>
                </tr>
              ) : (
                lancamentos.map((l) => (
                  <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatDateBR(l.data)}</td>
                    <td className="px-3 py-2 text-xs text-foreground">{l.descricao}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-700 font-medium">
                      {l.tipo === 'credito' ? formatCurrency(l.valor) : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-700 font-medium">
                      {l.tipo === 'debito' ? formatCurrency(l.valor) : ''}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{l.autorNome ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => void removeLancamento(l.id)}
                        className="text-muted-foreground hover:text-rose-600 transition-colors"
                        title="Excluir lançamento"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
              {lancamentos.length > 0 && (
                <tr className="border-t border-border bg-muted/30 font-semibold">
                  <td className="px-3 py-2 text-xs text-foreground" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-800">{formatCurrency(totalCreditos)}</td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-800">{formatCurrency(totalDebitos)}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Histórico de leituras do card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <Camera size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Leituras diárias do card
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-right">Abertura</th>
                <th className="px-3 py-2 text-right">Fechamento (A Vencer)</th>
                <th className="px-3 py-2 text-right">Variação do dia</th>
                <th className="px-3 py-2 text-right">Pago</th>
                <th className="px-3 py-2 text-right">Alunos</th>
                <th className="px-3 py-2 text-right">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Wallet size={14} />
                      Nenhuma leitura registrada no período. As leituras passam a ser gravadas quando o Dashboard é aberto.
                    </span>
                  </td>
                </tr>
              ) : (
                snapshots.map((s, i) => {
                  const anterior = i > 0 ? snapshots[i - 1] : null;
                  const variacao = anterior ? s.aVencer - anterior.aVencer : null;
                  return (
                    <tr key={s.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-medium text-foreground whitespace-nowrap">{formatDateBR(s.snapshotDate)}</td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">
                        {s.aberturaAVencer != null ? formatCurrency(s.aberturaAVencer) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums font-semibold text-foreground">
                        {formatCurrency(s.aVencer)}
                      </td>
                      <td className={`px-3 py-2 text-xs text-right tabular-nums font-medium ${
                        variacao == null ? 'text-muted-foreground' : variacao < 0 ? 'text-rose-700' : variacao > 0 ? 'text-emerald-700' : 'text-muted-foreground'
                      }`}>
                        {variacao == null ? '—' : `${variacao > 0 ? '+' : ''}${formatCurrency(variacao)}`}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-700">{formatCurrency(s.pago)}</td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">{s.qtdAlunos}</td>
                      <td className="px-3 py-2 text-[11px] text-right text-muted-foreground whitespace-nowrap">{formatTimeBR(s.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
