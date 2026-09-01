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
  fetchCarteiraCardSnapshotPayload,
  fetchCarteiraExtratoLancamentos,
  fetchConciliacaoRegistrosPeriodo,
  createCarteiraExtratoLancamento,
  deleteCarteiraExtratoLancamento,
  diffCardPayloads,
  lancamentoSign,
  LANCAMENTO_TIPOS,
  type CarteiraCardSnapshot,
  type CarteiraExtratoLancamento,
  type CardDiffLinha,
  type ConciliacaoRegistro,
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
  History,
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

function formatDateTimeBR(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const REGISTRO_TIPO_LABEL: Record<string, string> = {
  baixa_kamino: 'Baixa de parcela',
  pagamento: 'Pagamento',
  parcela_paga: 'Baixa de parcela',
  correcao_contrato: 'Correção de contrato',
  parcela_vencimento: 'Alteração de vencimento',
  cancelamento: 'Cancelamento',
  exclusao: 'Exclusão',
  iam_pendente: 'Ficha IAM p/ conciliar',
  quitacao: 'Quitação',
  renegociacao: 'Renegociação',
};

const SITUACAO_LABEL: Record<CardDiffLinha['situacao'], { label: string; cls: string }> = {
  saiu: { label: 'Saiu do card', cls: 'bg-rose-100 text-rose-800' },
  entrou: { label: 'Entrou no card', cls: 'bg-emerald-100 text-emerald-800' },
  alterado: { label: 'Valor alterado', cls: 'bg-amber-100 text-amber-800' },
};

export default function ExtratoCardTab() {
  const { currentUser } = useAppStore();
  const activeCompanyId = useCompanyStore((s) => s.activeCompanyId);

  const todayISO = getTodayBrasilia().toISOString().slice(0, 10);
  const [dataInicial, setDataInicial] = useState(firstDayOfMonthISO);
  const [dataFinal, setDataFinal] = useState(todayISO);

  const [snapshots, setSnapshots] = useState<CarteiraCardSnapshot[]>([]);
  const [lancamentos, setLancamentos] = useState<CarteiraExtratoLancamento[]>([]);
  const [diffLinhas, setDiffLinhas] = useState<CardDiffLinha[] | null>(null);
  const [registros, setRegistros] = useState<ConciliacaoRegistro[]>([]);
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
  const [novoTipo, setNovoTipo] = useState<ExtratoLancamentoTipo>('pagamento');
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
        const [snaps, lancs, payloadIni, payloadFim, regs] = await Promise.all([
          fetchCarteiraCardSnapshots(activeCompanyId, dataInicial, dataFinal),
          fetchCarteiraExtratoLancamentos(activeCompanyId, dataInicial, dataFinal),
          fetchCarteiraCardSnapshotPayload(activeCompanyId, dataInicial),
          fetchCarteiraCardSnapshotPayload(activeCompanyId, dataFinal),
          fetchConciliacaoRegistrosPeriodo(activeCompanyId, dataInicial, dataFinal),
        ]);
        if (cancelled) return;
        setSnapshots(snaps);
        setLancamentos(lancs);
        setDiffLinhas(payloadIni && payloadFim ? diffCardPayloads(payloadIni, payloadFim) : null);
        setRegistros(regs);
      } catch (err) {
        console.warn('[extrato-card] load:', err);
        if (!cancelled) {
          setSnapshots([]);
          setLancamentos([]);
          setDiffLinhas(null);
          setRegistros([]);
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

  const somaPorTipo = useMemo(() => {
    const acc: Record<ExtratoLancamentoTipo, number> = {
      pagamento: 0,
      entrada_aberto: 0,
      saida_desconto: 0,
      cancelamento: 0,
    };
    for (const l of lancamentos) acc[l.tipo] += l.valor;
    return acc;
  }, [lancamentos]);

  const totalEntradas = somaPorTipo.entrada_aberto;
  const totalSaidas = somaPorTipo.pagamento + somaPorTipo.saida_desconto + somaPorTipo.cancelamento;
  const saldoEsperado = saldosValidos ? saldoInicial + totalEntradas - totalSaidas : NaN;
  const diferenca = saldosValidos ? saldoFinal - saldoEsperado : NaN;
  const bateu = saldosValidos && Math.abs(diferenca) < 0.01;

  // Saldo corrido linha a linha (coluna "Total do Saldo" da planilha)
  const linhasComSaldo = useMemo(() => {
    let saldo = Number.isFinite(saldoInicial) ? saldoInicial : NaN;
    return lancamentos.map((l) => {
      saldo = Number.isFinite(saldo) ? saldo + lancamentoSign(l.tipo) * l.valor : NaN;
      return { ...l, saldoCorrido: saldo };
    });
  }, [lancamentos, saldoInicial]);

  // Totais do comparativo aluno a aluno (O que mudou)
  const diffResumo = useMemo(() => {
    if (!diffLinhas) return null;
    const soma = (s: CardDiffLinha['situacao']) =>
      diffLinhas.filter((l) => l.situacao === s).reduce((acc, l) => acc + l.delta, 0);
    return {
      saiu: soma('saiu'),
      entrou: soma('entrou'),
      alterado: soma('alterado'),
      total: diffLinhas.reduce((acc, l) => acc + l.delta, 0),
    };
  }, [diffLinhas]);

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
                  Saldo anterior <span className="text-[10px] text-muted-foreground">(card em {formatDateBR(dataInicial)})</span>
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
                <td className="py-1.5 text-xs text-rose-700">(−) Pagamento / Juros pagos</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-rose-700 pr-2">
                  {formatCurrency(somaPorTipo.pagamento)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-emerald-700">(+) Entrada valor em aberto</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-emerald-700 pr-2">
                  {formatCurrency(somaPorTipo.entrada_aberto)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-rose-700">(−) Saída / Desconto</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-rose-700 pr-2">
                  {formatCurrency(somaPorTipo.saida_desconto)}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-rose-700">(−) Cancelamento</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-semibold text-rose-700 pr-2">
                  {formatCurrency(somaPorTipo.cancelamento)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className="py-1.5 text-xs font-semibold text-foreground">(=) Total do Saldo</td>
                <td className="py-1.5 text-xs text-right tabular-nums font-bold text-foreground pr-2">
                  {saldosValidos ? formatCurrency(saldoEsperado) : '—'}
                </td>
              </tr>
              <tr>
                <td className="py-1.5 text-xs text-foreground">
                  Saldo Atual GC <span className="text-[10px] text-muted-foreground">(card em {formatDateBR(dataFinal)})</span>
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
                  ? 'Bateu! Saldo Atual GC = Total do Saldo'
                  : diferenca > 0
                    ? 'Sobra a explicar (falta lançar entrada em aberto)'
                    : 'Falta a explicar (falta lançar pagamento/saída/cancelamento)'}
            </div>
            <span className={`text-sm font-bold tabular-nums ${
              !saldosValidos ? 'text-muted-foreground' : bateu ? 'text-emerald-900' : 'text-amber-900'
            }`}>
              {saldosValidos ? formatCurrency(diferenca) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* O que mudou — histórico automático aluno a aluno */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <History size={14} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            O que mudou — {formatDateBR(dataInicial)} → {formatDateBR(dataFinal)}
          </h2>
        </div>

        {diffLinhas === null ? (
          <div className="p-4 text-xs text-muted-foreground flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              Sem detalhamento por aluno para uma das datas. O detalhamento passou a ser gravado junto
              com a leitura diária do card — a partir de agora, cada dia com leitura permite comparar
              aluno a aluno. Escolha datas que tenham leitura com detalhamento.
            </span>
          </div>
        ) : diffLinhas.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">
            Nenhuma mudança de valor por aluno entre as duas leituras.
          </div>
        ) : (
          <>
            {diffResumo && (
              <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2.5 py-1 text-[11px] font-semibold tabular-nums">
                  Saíram do card: {formatCurrency(diffResumo.saiu)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[11px] font-semibold tabular-nums">
                  Entraram: +{formatCurrency(diffResumo.entrou)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-[11px] font-semibold tabular-nums">
                  Valores alterados: {diffResumo.alterado >= 0 ? '+' : ''}{formatCurrency(diffResumo.alterado)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted text-foreground px-2.5 py-1 text-[11px] font-bold tabular-nums">
                  Efeito total: {diffResumo.total >= 0 ? '+' : ''}{formatCurrency(diffResumo.total)}
                </span>
              </div>
            )}
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full min-w-[720px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Aluno</th>
                    <th className="px-3 py-2 text-right">Aberto em {formatDateBR(dataInicial)}</th>
                    <th className="px-3 py-2 text-right">Aberto em {formatDateBR(dataFinal)}</th>
                    <th className="px-3 py-2 text-right">Diferença</th>
                    <th className="px-3 py-2 text-left">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {diffLinhas.map((l) => {
                    const sit = SITUACAO_LABEL[l.situacao];
                    return (
                      <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs text-foreground">{l.name}</td>
                        <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(l.openIni)}</td>
                        <td className="px-3 py-2 text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(l.openFim)}</td>
                        <td className={`px-3 py-2 text-xs text-right tabular-nums font-semibold ${l.delta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {l.delta > 0 ? '+' : ''}{formatCurrency(l.delta)}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${sit.cls}`}>{sit.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Registros da Conciliação no período (contexto do porquê) */}
        <div className="border-t border-border">
          <div className="px-4 py-2 bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Registros na Conciliação no período ({registros.length})
          </div>
          {registros.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Nenhum registro conciliado no período. Mudanças sem registro aqui foram edições diretas
              na ficha, importações de planilha ou vínculos do IAM Control (fichas que entram/saem da
              fila de aprovação).
            </div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full min-w-[720px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left whitespace-nowrap">Quando</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Tipo</th>
                    <th className="px-3 py-2 text-left">Aluno</th>
                    <th className="px-3 py-2 text-left">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatDateTimeBR(r.conciliadoAt)}</td>
                      <td className="px-3 py-2 text-[11px] text-foreground whitespace-nowrap">{REGISTRO_TIPO_LABEL[r.tipo] ?? r.tipo}</td>
                      <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">{r.studentName}</td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">{r.resumo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              <label className="text-[10px] font-semibold uppercase text-muted-foreground block mb-1">Categoria</label>
              <select
                value={novoTipo}
                onChange={(e) => setNovoTipo(e.target.value as ExtratoLancamentoTipo)}
                className="input-field text-xs"
              >
                {LANCAMENTO_TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
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
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Descrição</th>
                <th className="px-3 py-2 text-right">Pagamento / Juros</th>
                <th className="px-3 py-2 text-right">Entrada em aberto</th>
                <th className="px-3 py-2 text-right">Saída / Desc.</th>
                <th className="px-3 py-2 text-right">Cancelamento</th>
                <th className="px-3 py-2 text-right">Total do Saldo</th>
                <th className="px-3 py-2 text-left">Autor</th>
                <th className="px-3 py-2 text-center w-10"></th>
              </tr>
            </thead>
            <tbody>
              {linhasComSaldo.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Nenhum lançamento no período. Use o formulário acima para registrar as movimentações do card.
                  </td>
                </tr>
              ) : (
                <>
                  <tr className="border-t border-border/60 bg-muted/20">
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatDateBR(dataInicial)}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-foreground" colSpan={5}>SALDO ANTERIOR</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums font-bold text-foreground">
                      {Number.isFinite(saldoInicial) ? formatCurrency(saldoInicial) : '—'}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                  {linhasComSaldo.map((l) => (
                    <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{formatDateBR(l.data)}</td>
                      <td className="px-3 py-2 text-xs text-foreground">{l.descricao}</td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-700 font-medium">
                        {l.tipo === 'pagamento' ? formatCurrency(l.valor) : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-700 font-medium">
                        {l.tipo === 'entrada_aberto' ? formatCurrency(l.valor) : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-700 font-medium">
                        {l.tipo === 'saida_desconto' ? formatCurrency(l.valor) : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-700 font-medium">
                        {l.tipo === 'cancelamento' ? formatCurrency(l.valor) : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-right tabular-nums font-semibold text-foreground">
                        {Number.isFinite(l.saldoCorrido) ? formatCurrency(l.saldoCorrido) : '—'}
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
                  ))}
                  <tr className="border-t border-border bg-muted/30 font-semibold">
                    <td className="px-3 py-2 text-xs text-foreground" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-800">{formatCurrency(somaPorTipo.pagamento)}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-emerald-800">{formatCurrency(somaPorTipo.entrada_aberto)}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-800">{formatCurrency(somaPorTipo.saida_desconto)}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums text-rose-800">{formatCurrency(somaPorTipo.cancelamento)}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums font-bold text-foreground">
                      {saldosValidos ? formatCurrency(saldoEsperado) : '—'}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </>
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
