// ─── Aba Conciliação ─────────────────────────────────────────────────────────
// Espelho de SAÍDA do sistema (Pendentes / Histórico) +
// Importação de pagamentos do Kamino (Erros para revisar).

import { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Search, FileSpreadsheet, ScrollText, User as UserIcon, Calendar, ArrowRight, ArrowLeft, Upload, AlertTriangle, XCircle, Trash2, Loader2, Wallet, History as HistoryIcon, Ban, ThumbsUp, Pencil, Check, X as XIcon, Settings2, FileText, Eye, DollarSign, Cloud } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useConciliacaoStore, notifyConciliacaoGrupo } from '@/store/useConciliacaoStore';

import { toast } from 'sonner';
import { isDoubleCheckItem } from '@/lib/doubleCheckRejection';
import { useAppStore } from '@/store/useAppStore';
import type { ConciliacaoItem, ConciliacaoTipo, ConciliacaoImportError, ConciliacaoImportErrorMotivo, Student, Installment, FunnelStage } from '@/types';
import { canEditTab } from '@/types';
import ImportConciliacaoModal from '@/components/modals/ImportConciliacaoModal';
import FinancialModal from '@/components/modals/FinancialModal';
import HistoryModal from '@/components/modals/HistoryModal';
import { updateStudentDb, createConciliacaoItemDb } from '@/lib/supabaseMutations';
import CurrencyInput from '@/components/ui/CurrencyInput';
import { useConfirm } from '@/hooks/useConfirm';
import { openCancellationPdf, downloadCancellationPdf, isViewableInBrowser } from '@/lib/openCancellationPdf';
import type { CaseNoteAttachment } from '@/types';
import { isDraftAlreadyApplied, isDraftItem } from '@/lib/conciliacaoApply';
import { isConciliacaoReversaoItem } from '@/lib/conciliacaoTipo';
import { isCancelamentoEspelhoItem, groupBlocksEspelhoConciliacao } from '@/lib/cancelamentoGcConciliacao';
/** Tipos cuja efetivação financeira ainda ocorre no clique Conciliar (sem `_after` upfront). */
const TIPOS_EFETIVAM_NO_CONCILIAR = new Set<ConciliacaoTipo>([
  'pagamento_parcela',
  'quitacao',
  'renegociacao',
  'iam_pendente',
]);

/** Grupo em que as alterações de rascunho já estão no aluno — só falta confirmar. */
function groupJaAplicadoNoSistema(items: ConciliacaoItem[]): boolean {
  if (!items.length) return false;
  return items.every((it) => {
    if (TIPOS_EFETIVAM_NO_CONCILIAR.has(it.tipo)) return false;
    if (it.tipo === 'cancelamento' || it.tipo === 'renda_extra_exclusao') return false;
    if (isDraftItem(it)) return isDraftAlreadyApplied(it);
    // Sem draft e sem efetivação no conciliar → só auditoria / observação
    return true;
  });
}

function groupTemObservacao(items: ConciliacaoItem[]): boolean {
  return items.some((i) => !!i.autorObservacao?.trim());
}
function formatAttachBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function openConcAttachment(a: CaseNoteAttachment) {
  try {
    if ((a.mime ?? '').toLowerCase() === 'application/pdf' || (a.mime ?? '').toLowerCase().startsWith('image/') || isViewableInBrowser(a.name) || isViewableInBrowser(a.url)) {
      await openCancellationPdf(a.url, a.name);
    } else {
      await downloadCancellationPdf(a.url, a.name);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.';
    toast.error(msg);
  }
}

const TIPO_LABEL: Record<ConciliacaoTipo, string> = {
  parcela_quantidade: 'Quantidade de parcelas',
  parcela_valor: 'Valor de parcela',
  parcela_vencimento: 'Vencimento de parcela',
  pagamento_parcela: 'Pagamento de parcela',
  quitacao: 'Quitação de contrato',
  renegociacao: 'Renegociação (rascunho)',
  cancelamento: 'Cancelamento concluído',
  reversao: 'Cancelamento revertido',
  renda_extra_exclusao: 'Exclusão Renda Extra',
  renda_extra_acordo: 'Acordo Renda Extra',
  baixa_kamino: 'Baixa Kamino',
  encargo_aplicado: 'Encargo aplicado',
  correcao_contrato: 'Correção de contrato',
  iam_pendente: 'IAM Control → GC',
};

const TIPO_COLOR: Record<ConciliacaoTipo, string> = {
  parcela_quantidade: 'bg-blue-100 text-blue-700',
  parcela_valor: 'bg-violet-100 text-violet-700',
  parcela_vencimento: 'bg-amber-100 text-amber-700',
  pagamento_parcela: 'bg-emerald-100 text-emerald-700',
  quitacao: 'bg-emerald-100 text-emerald-700',
  renegociacao: 'bg-blue-100 text-blue-700',
  cancelamento: 'bg-rose-100 text-rose-700',
  reversao: 'bg-teal-100 text-teal-700',
  renda_extra_exclusao: 'bg-purple-100 text-purple-700',
  renda_extra_acordo: 'bg-blue-100 text-blue-700',
  baixa_kamino: 'bg-emerald-100 text-emerald-700',
  encargo_aplicado: 'bg-amber-100 text-amber-800',
  correcao_contrato: 'bg-orange-100 text-orange-800',
  iam_pendente: 'bg-fuchsia-100 text-fuchsia-800',
};

/** Filtro simplificado da Conciliação por grupo de aba. */
type ConciliacaoGrupoFilter = 'todos' | 'cancelamentos' | 'ajuste_financeiro' | 'renda_extra';

const CANCEL_TIPOS: ConciliacaoTipo[] = ['cancelamento', 'reversao'];
const isCancelTipo = (t: ConciliacaoTipo) => CANCEL_TIPOS.includes(t);
const isRendaExtraTipo = (t: ConciliacaoTipo) => t === 'renda_extra_exclusao' || t === 'renda_extra_acordo';

/** Parcelas, quitação, encargos etc. — sem cancelamento/reversão, renda extra nem IAM. */
const isAjusteFinanceiroTipo = (t: ConciliacaoTipo) =>
  t !== 'iam_pendente' && !isCancelTipo(t) && !isRendaExtraTipo(t);

function matchesGrupoFilter(tipo: ConciliacaoTipo, grupo: ConciliacaoGrupoFilter): boolean {
  if (grupo === 'todos') return true;
  if (grupo === 'cancelamentos') return isCancelTipo(tipo);
  if (grupo === 'renda_extra') return isRendaExtraTipo(tipo);
  return isAjusteFinanceiroTipo(tipo);
}

const MOTIVO_LABEL: Record<ConciliacaoImportErrorMotivo, string> = {
  aluno_nao_encontrado: 'Aluno não encontrado',
  multiplos_alunos: 'Múltiplos alunos com mesmo nome',
  parcela_nao_encontrada: 'Parcela não encontrada (vencimento)',
  valor_diverge: 'Valor diverge do registrado',
  parcela_ja_paga: 'Parcela já estava paga',
  sem_pagamento: 'Linha sem pagamento',
};

function formatDateTime(iso?: string) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function formatDate(s?: string) {
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function formatCurrency(n?: number | null) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n));
}

// Mapeia chaves técnicas → labels amigáveis
const FIELD_LABELS: Record<string, string> = {
  saleValue: 'Total contratado',
  valorPendente: 'Saldo em aberto',
  valorPago: 'Total pago',
  valorParcela: 'Valor da parcela',
  installmentValue: 'Valor da parcela',
  totalParcelas: 'Número de parcelas',
  totalInstallments: 'Número de parcelas',
  paidInstallments: 'Parcelas pagas',
  novasParcelas: 'Novas parcelas',
  parcelasPagas: 'Parcelas pagas',
  entrada: 'Entrada (obrigatória)',
  downPayment: 'Entrada (obrigatória)',
  juros: 'Taxa de juros (% ao mês)',
  multa: 'Multa',
  desconto: 'Desconto',
  dueDay: 'Dia de vencimento das parcelas',
  vencimento: 'Data de vencimento',
  dueDate: 'Data de vencimento',
  dataPagamento: 'Data do pagamento',
  paidDate: 'Data do pagamento',
  paid: 'Situação do pagamento',
  status: 'Status',
  product: 'Produto',
  ac: 'Assessor de Conta',
  parcela: 'Parcela',
  numero: 'Nº da parcela',
  number: 'Nº da parcela',
  motivo: 'Motivo',
  observacao: 'Observação',
  nota: 'Nota',
  parcelas: 'Parcelas',
  multaCancelamento: 'Multa de cancelamento',
  valorCarteira: 'Valor na carteira',
  impactoCarteira: 'Impacto na carteira',
  impactoCarteiraNota: 'Observação de carteira',
  estornoAluno: 'Estorno ao aluno',
  totalPago: 'Total pago pelo aluno',
  multaComplementarPaga: 'Multa paga (complemento)',
  totalNegativar: 'Total a negativar',
  multaNegativadaPaga: 'Multa negativada paga pelo aluno',
  dataPagamentoMulta: 'Data do pagamento da multa',
  statusNegativacao: 'Status da negativação',
  prazoRetiradaNegativacao: 'Prazo para retirar a negativação',
  comprovanteMultaUrl: 'Comprovante de pagamento da multa',
  comprovanteMultaNome: 'Comprovante (arquivo)',
  multaDeduzidaDoPago: 'Multa deduzida do valor pago',
  statusCancelamento: 'Status do cancelamento',
  stage: 'Etapa',

};

// Compõe rótulo natural em pt-BR para diff de grupo
// Ex.: ctx="Parcela 3", key="valorParcela" → "Valor da Parcela 3"
function composeGroupLabel(ctx: string, key: string): string {
  const isParcela = /^Parcela\s+/i.test(ctx);
  const base = labelFor(key);
  if (!isParcela) return `${ctx} — ${base}`;
  // Mapeia chaves para frase natural usando o contexto da parcela
  switch (key) {
    case 'valorParcela':
    case 'installmentValue':
    case 'valor':
      return `Valor da ${ctx}`;
    case 'vencimento':
    case 'dueDate':
      return `Vencimento da ${ctx}`;
    case 'dueDay':
      return `Dia de vencimento da ${ctx}`;
    case 'dataPagamento':
    case 'paidDate':
      return `Data de pagamento da ${ctx}`;
    case 'paid':
      return `Situação da ${ctx}`;
    case 'status':
      return `Status da ${ctx}`;
    case 'totalParcelas':
    case 'totalInstallments':
      return 'Número de parcelas';
    default:
      return `${base} — ${ctx}`;
  }
}

// Chaves cujo valor deve ser formatado como moeda
const CURRENCY_KEYS = new Set([
  'saleValue', 'valorPendente', 'valorPago', 'valorParcela', 'installmentValue',
  'entrada', 'downPayment', 'juros', 'multa', 'desconto', 'valor', 'valorReal',
  'valorContabil', 'acordoValue',
  'multaCancelamento', 'valorCarteira', 'impactoCarteira', 'estornoAluno', 'totalPago',
  'multaComplementarPaga', 'totalNegativar', 'totalNegativarBase', 'multaNegativadaPaga',
]);

function isNegativeValue(key: string, v: unknown): boolean {
  if (!CURRENCY_KEYS.has(key) || v == null || v === '') return false;
  const n = Number(v);
  return Number.isFinite(n) && n < 0;
}

// Detecta valores monetários negativos já formatados (ex.: "-R$ 14.014,00")
function isNegativeText(s?: string): boolean {
  return typeof s === 'string' && /-\s*R\$/.test(s);
}

// Classes de destaque para números negativos na Conciliação:
// texto vermelho + fundo vermelho (padrão visual da multa em Encargos).
const NEGATIVE_BADGE = 'bg-rose-50 text-rose-700 border border-rose-200';




// Chaves cujo valor deve ser formatado como data (ISO/YYYY-MM-DD)
const DATE_KEYS = new Set([
  'dataPagamentoMulta',
  'vencimento', 'dueDate', 'dataPagamento', 'paidDate', 'enrollmentDate',
  'createdAt', 'cancelledAt',
]);

function labelFor(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // camelCase → "Camel Case"
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatValue(key: string, v: unknown, parent?: Record<string, unknown>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') {
    if (key === 'paid') {
      if (!v) return 'Pendente';
      const raw = parent?.paidValue ?? parent?.valorPago ?? parent?.valor ?? parent?.value;
      const num = raw == null || raw === '' ? NaN : Number(raw);
      return Number.isFinite(num) ? `Pago — ${formatCurrency(num)}` : 'Pago';
    }
    return v ? 'Sim' : 'Não';
  }
  if (CURRENCY_KEYS.has(key) && (typeof v === 'number' || (!Number.isNaN(Number(v)) && typeof v !== 'object'))) {
    const base = formatCurrency(Number(v));
    if (key === 'estornoAluno' && Number(v) > 0) {
      const det = parent?.estornoAlunoDetalhe;
      if (typeof det === 'string' && det.trim()) return `${base} — ${det.trim()}`;
    }
    return base;
  }
  if (DATE_KEYS.has(key) && typeof v === 'string') {
    return formatDate(v);
  }
  if (typeof v === 'number') {
    // arredonda valores numéricos genéricos para no máx 2 casas
    return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '—';
    // Resumo legível para arrays de objetos (evita "[object Object]")
    if (typeof v[0] === 'object' && v[0] !== null) {
      return `${v.length} item(ns)`;
    }
    return v.join(', ');
  }
  if (typeof v === 'object' && v !== null) {
    // Troca de turma: exibe de forma legível em vez de JSON cru
    if (key === 'trocaTurma') {
      const t = v as Record<string, unknown>;
      const turma = String(t.novaTurma ?? '').trim();
      const taxa = typeof t.taxaValor === 'number' ? formatCurrency(t.taxaValor) : null;
      const pct = typeof t.taxaPercent === 'number' ? `${t.taxaPercent}%` : null;
      const parts = [
        turma ? `Turma ${turma}` : null,
        taxa ? `taxa ${taxa}${pct ? ` (${pct})` : ''}` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(' — ') : '—';
    }
    try { return JSON.stringify(v); } catch { return '—'; }
  }
  return String(v);
}

// Extrai TODAS as alterações entre antes/depois para resumo compacto no topo
function getAllChanges(antes: Record<string, unknown>, depois: Record<string, unknown>):
  Array<{ key: string; label: string; antes: string; depois: string }> {
  const SKIP = (k: string) => k === '_snapshot' || k === '_after' || k === '_before' || k === '_caseSnapshot' || k === '_attachments' || k === '_appliedUpfront';
  const keys: string[] = [];
  Object.keys(antes ?? {}).forEach((k) => { if (!SKIP(k) && !keys.includes(k)) keys.push(k); });
  Object.keys(depois ?? {}).forEach((k) => { if (!SKIP(k) && !keys.includes(k)) keys.push(k); });
  const changes: Array<{ key: string; label: string; antes: string; depois: string }> = [];
  for (const k of keys) {
    const aStr = formatValue(k, antes?.[k], antes);
    const dStr = formatValue(k, depois?.[k], depois);
    if (aStr !== dStr) {
      changes.push({ key: k, label: labelFor(k), antes: aStr, depois: dStr });
    }
  }
  return changes;
}

function ContractValueRow({ changed, antes, depois, explanation }: { changed: boolean; antes?: string; depois?: string; explanation?: string }) {
  const depoisNegative = isNegativeText(depois);
  return (
    <div className="grid grid-cols-[1fr_1.4fr] items-start gap-2 px-3 py-2 text-xs bg-muted/20">
      <div className="text-foreground/80 font-medium pt-0.5">Valor do Contrato</div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          {changed ? (
            <>
              <span className="text-rose-500/80 line-through decoration-rose-300/70 text-xs tabular-nums">{antes}</span>
              <ArrowRight size={12} className="text-muted-foreground/60 shrink-0" />
              <span className={`px-2 py-0.5 rounded-md font-semibold text-xs tabular-nums ${depoisNegative ? NEGATIVE_BADGE : 'bg-emerald-50 text-emerald-700'}`}>{depois}</span>
            </>
          ) : (
            <span className="text-muted-foreground italic text-xs">Sem Alterações</span>
          )}
        </div>
        {changed && explanation && (
          <p className="text-[11px] text-muted-foreground leading-snug">{explanation}</p>
        )}
      </div>
    </div>
  );
}


function renderDiff(antes: Record<string, unknown>, depois: Record<string, unknown>, student?: Student | null) {
  // Une as chaves preservando ordem (antes primeiro, depois extras)
  const SKIP = (k: string) => k === '_snapshot' || k === '_after' || k === '_before' || k === '_caseSnapshot' || k === '_attachments' || k === '_appliedUpfront';
  const keys: string[] = [];
  Object.keys(antes ?? {}).forEach((k) => { if (!SKIP(k) && !keys.includes(k)) keys.push(k); });
  Object.keys(depois ?? {}).forEach((k) => { if (!SKIP(k) && !keys.includes(k)) keys.push(k); });

  // Detecta alteração no Valor do Contrato (saleValue)
  const hasSaleChange = 'saleValue' in (antes ?? {}) || 'saleValue' in (depois ?? {});
  const saleAntes = hasSaleChange ? formatValue('saleValue', antes?.saleValue, antes) : undefined;
  const saleDepois = hasSaleChange ? formatValue('saleValue', depois?.saleValue, depois) : undefined;
  const saleChanged = hasSaleChange && saleAntes !== saleDepois;

  if (keys.length === 0 && !student) {
    return <span className="text-xs text-muted-foreground">Sem alterações registradas</span>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[1fr_1.4fr] text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/40 px-3 py-2">
        <div>Alteração</div>
        <div>De → Para</div>
      </div>
      <div className="divide-y divide-border">
        <ContractValueRow changed={saleChanged} antes={saleAntes} depois={saleDepois} />
        {keys.filter((k) => k !== 'saleValue').map((k) => {
          const a = antes?.[k];
          const d = depois?.[k];
          const aStr = formatValue(k, a, antes);
          const dStr = formatValue(k, d, depois);
          const changed = aStr !== dStr;
          const aNegative = isNegativeValue(k, a) || isNegativeText(aStr);
          const dNegative = isNegativeValue(k, d) || isNegativeText(dStr);
          return (
            <div key={k} className="grid grid-cols-[1fr_1.4fr] items-center gap-2 px-3 py-2 text-xs">
              <div className="text-foreground/80 font-medium">{labelFor(k)}</div>
              <div className="flex items-center gap-2 flex-wrap">
                {changed ? (
                  <>
                    <span className={`text-xs tabular-nums ${aNegative ? 'text-rose-600 line-through decoration-rose-300/70' : 'text-rose-500/80 line-through decoration-rose-300/70'}`}>{aStr}</span>
                    <ArrowRight size={12} className="text-muted-foreground/60 shrink-0" />
                    <span className={`px-2 py-0.5 rounded-md font-semibold text-xs tabular-nums ${dNegative ? NEGATIVE_BADGE : 'bg-emerald-50 text-emerald-700'}`}>{dStr}</span>
                  </>
                ) : (
                  <span className={`font-medium tabular-nums ${dNegative ? `px-2 py-0.5 rounded-md font-semibold ${NEGATIVE_BADGE}` : 'text-foreground/70'}`}>{dStr}</span>
                )}
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}

// ─── Diff CONSOLIDADO de um grupo (otimização de espaço) ─────────────────────
// Em vez de 1 tabela por item (com cabeçalho CAMPO/ANTES/DEPOIS repetido),
// renderiza UMA única tabela com todas as alterações do grupo. Cada linha
// recebe um prefixo curto identificando a parcela (ex.: "Parcela 5 — Valor").
function renderGroupDiff(items: ConciliacaoItem[], student?: Student, cases?: Array<{ id: string; quantidadeInscricoes?: number; inscricoesRevertidas?: number; multaPercent?: number; multaValue?: number; cancellationFineValue?: number; dentro7Dias?: boolean }>) {
  type Row = { id: string; label: string; antes: string; depois: string; changed: boolean; sortKey: string; parcelaNum: number | null; antesNegative: boolean; depoisNegative: boolean };
  const rows: Row[] = [];


  for (const item of items) {
    // Identificador curto da alteração (parcela X / renegociação / etc.)
    const parcelaNumRaw = (item.antes as Record<string, unknown>)?.parcela
      ?? (item.depois as Record<string, unknown>)?.parcela
      ?? (item.depois as Record<string, unknown>)?.novaParcela
      ?? (item.antes as Record<string, unknown>)?.parcelaExcluida;
    const parcelaNum = parcelaNumRaw != null && Number.isFinite(Number(parcelaNumRaw)) ? Number(parcelaNumRaw) : null;
    const ctx = parcelaNumRaw != null ? `Parcela ${parcelaNumRaw}` : TIPO_LABEL[item.tipo];

    // Data de vencimento da parcela referenciada (para ordenação).
    // Prioridade: 'vencimento' explícito no antes/depois → lookup pela parcela no aluno.
    const vencDepois = (item.depois as Record<string, unknown>)?.vencimento as string | undefined;
    const vencAntes = (item.antes as Record<string, unknown>)?.vencimento as string | undefined;
    let dueDate: string | undefined = (typeof vencAntes === 'string' ? vencAntes : undefined)
      ?? (typeof vencDepois === 'string' ? vencDepois : undefined);
    if (!dueDate && parcelaNum != null && student) {
      const inst = student.installments?.find((i) => i.number === parcelaNum);
      dueDate = inst?.dueDate;
    }
    // sortKey: data de vencimento (YYYY-MM-DD) — ascendente coloca mais cedo no topo.
    // Sem data conhecida → empurra para o fim ('9999...').
    const sortKey = dueDate ?? '9999-12-31';

    const SKIP_KEYS = new Set(['_snapshot', '_after', '_before', '_caseSnapshot', '_attachments', '_appliedUpfront', 'multaPercent', 'dentro7DiasCDC', 'totalNegativar', 'totalNegativarBase', 'estornoAlunoDetalhe', 'totalPagoEfetivo', 'abatimentoValor', 'abatimentoContratoDestino', 'abatimentoSaldoAntes', 'abatimentoSaldoDepois', 'abatimentoSaldoOrigem', 'abatimentoEstornoRestante', 'abatimentoResumo']);
    // No fluxo de cancelamento o "Valor na carteira" não é exibido — o que
    // interessa ao revisor é o "Impacto na carteira".
    if (item.tipo === 'cancelamento') SKIP_KEYS.add('valorCarteira');
    const keys: string[] = [];
    Object.keys(item.antes ?? {}).forEach((k) => { if (!SKIP_KEYS.has(k) && !keys.includes(k)) keys.push(k); });
    Object.keys(item.depois ?? {}).forEach((k) => { if (!SKIP_KEYS.has(k) && !keys.includes(k)) keys.push(k); });

    for (const k of keys) {
      // Pula chaves técnicas que servem só de contexto (não são "alteração")
      if (k === 'parcela' || k === 'parcelaExcluida' || SKIP_KEYS.has(k)) continue;
      const rawA = (item.antes as Record<string, unknown>)?.[k];
      const rawD = (item.depois as Record<string, unknown>)?.[k];
      const aStr = formatValue(k, rawA, item.antes as Record<string, unknown>);
      const dStr = formatValue(k, rawD, item.depois as Record<string, unknown>);
      const changed = aStr !== dStr;
      if (!changed) continue; // só mostra o que mudou
      rows.push({
        id: `${item.id}-${k}`,
        label: composeGroupLabel(ctx, k),
        antes: aStr,
        depois: dStr,
        changed,
        sortKey,
        parcelaNum,
        antesNegative: isNegativeValue(k, rawA) || isNegativeText(aStr),
        depoisNegative: isNegativeValue(k, rawD) || isNegativeText(dStr),
      });
    }

  }

  // Ordena por data de vencimento da parcela (mais recente em cima → mais
  // distante no fim). Mantém a ordem original (estável) entre linhas da
  // mesma parcela.
  rows.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey.localeCompare(b.sortKey);
    if (a.parcelaNum != null && b.parcelaNum != null && a.parcelaNum !== b.parcelaNum) {
      return a.parcelaNum - b.parcelaNum;
    }
    return 0;
  });

  // Detecta alteração no Valor do Contrato (saleValue) entre todos os itens
  let saleAntes: string | undefined;
  let saleDepois: string | undefined;
  let saleChanged = false;
  for (const it of items) {
    const a = (it.antes as Record<string, unknown>)?.saleValue;
    const d = (it.depois as Record<string, unknown>)?.saleValue;
    if (a !== undefined || d !== undefined) {
      const aStr = formatValue('saleValue', a, it.antes as Record<string, unknown>);
      const dStr = formatValue('saleValue', d, it.depois as Record<string, unknown>);
      if (aStr !== dStr) {
        saleAntes = aStr;
        saleDepois = dStr;
        saleChanged = true;
        break;
      }
    }
  }

  // Explicação didática do novo Valor do Contrato quando houve cancelamento
  // parcial: (valor mantido/revertido) + (multa % sobre o valor total original
  // do contrato). Ex.: 15% sobre R$ 20.000,00 = R$ 3.000,00.
  let saleExplanation: string | undefined;
  if (saleChanged) {
    const caseIds = Array.from(new Set(items.map((i) => i.relatedCaseId).filter((x): x is string => !!x)));
    const relCases = (cases ?? []).filter((c) => caseIds.includes(c.id));
    const qtd = relCases.map((c) => Number(c.quantidadeInscricoes)).find((n) => Number.isFinite(n) && n > 0) ?? 0;
    const revertidas = relCases.map((c) => Number(c.inscricoesRevertidas)).find((n) => Number.isFinite(n) && n >= 0) ?? 0;
    const canceladas = Math.max(0, qtd - revertidas);
    const multaPct = relCases.map((c) => Number(c.multaPercent)).find((n) => Number.isFinite(n) && n >= 0) ?? 0;
    const oldVal = Number((items.find((it) => (it.antes as Record<string, unknown>)?.saleValue != null)?.antes as Record<string, unknown>)?.saleValue) || 0;
    const newVal = Number((items.find((it) => (it.depois as Record<string, unknown>)?.saleValue != null)?.depois as Record<string, unknown>)?.saleValue) || 0;
    if (qtd > 1 && revertidas > 0 && canceladas > 0 && oldVal > 0) {
      const perInsc = oldVal / qtd;
      const mantido = perInsc * revertidas;
      const persistedFine = relCases
        .map((c) => Number(c.multaValue ?? c.cancellationFineValue))
        .find((n) => Number.isFinite(n) && n >= 0);
      const multaValor = persistedFine ?? (oldVal * (multaPct / 100));
      saleExplanation =
        `Composição: ${formatCurrency(mantido)} (${revertidas} inscriç${revertidas === 1 ? 'ão revertida/mantida' : 'ões revertidas/mantidas'})` +
        (multaPct > 0
          ? ` + ${formatCurrency(multaValor)} (multa ${multaPct}% sobre ${formatCurrency(oldVal)} — valor total original do contrato, aplicada pela${canceladas === 1 ? '' : 's'} ${canceladas} inscriç${canceladas === 1 ? 'ão cancelada' : 'ões canceladas'})`
          : ` — sem multa aplicada sobre a${canceladas === 1 ? '' : 's'} ${canceladas} inscriç${canceladas === 1 ? 'ão cancelada' : 'ões canceladas'}`) +
        ` = ${formatCurrency(newVal)}.`;
    }
  }

  // Soma encargos (multa / juros) aplicados em qualquer item do grupo.
  // Aceita as duas convenções de chaves usadas pelo FinancialModal.
  let totalMulta = 0;
  let totalJuros = 0;
  for (const it of items) {
    const d = (it.depois as Record<string, unknown>) ?? {};
    const m = Number(d.multa ?? d.multaAplicada ?? (it.tipo === 'cancelamento' ? d.multaCancelamento : 0) ?? 0);
    const j = Number(d.juros ?? d.jurosAplicados ?? 0);
    if (Number.isFinite(m)) totalMulta += m;
    if (Number.isFinite(j)) totalJuros += j;
    // Pagamento de parcela: juros embutido quando paidValue > value
    if (it.tipo === 'pagamento_parcela') {
      const pv = Number(d.paidValue);
      const v = Number(d.value ?? (it.antes as Record<string, unknown>)?.value);
      if (Number.isFinite(pv) && Number.isFinite(v) && pv > v) totalJuros += (pv - v);
    }
    // Encargo declarado pelo AC ao alterar parcelas (novo tipo)
    if (it.tipo === 'encargo_aplicado') {
      const enc = Number(d.encargo ?? 0);
      if (Number.isFinite(enc) && enc > 0) totalJuros += enc;
    }
  }
  // Extrai info de multa % / 7 dias CDC do cancelamento (mostrado na EncargosRow)
  let maxMultaPercent = 0;
  let hasCDC7 = false;
  for (const it of items) {
    const d = (it.depois as Record<string, unknown>) ?? {};
    let p = Number(d.multaPercent);
    // Fallback: quando a % não foi persistida, deriva de multaCancelamento / saleValue
    if ((!Number.isFinite(p) || p <= 0) && it.tipo === 'cancelamento') {
      const fine = Number(d.multaCancelamento ?? 0);
      const sale = Number(d.saleValue ?? (it.antes as Record<string, unknown>)?.saleValue ?? 0);
      if (Number.isFinite(fine) && fine > 0 && Number.isFinite(sale) && sale > 0) {
        p = Math.round((fine / sale) * 10000) / 100;
      }
    }
    if (Number.isFinite(p) && p > maxMultaPercent) maxMultaPercent = p;
    if (d.dentro7DiasCDC === true) hasCDC7 = true;
  }
  // Valor a negativar (multa − pago) quando o Jurídico marcou "Negativar Multa"
  let totalNegativar = 0;
  let totalNegativarBase = 0;
  let totalNegativarMulta = 0;
  for (const it of items) {
    const d = (it.depois as Record<string, unknown>) ?? {};
    const n = Number(d.totalNegativar);
    if (Number.isFinite(n) && n > totalNegativar) {
      totalNegativar = n;
      const base = Number(d.totalNegativarBase);
      if (Number.isFinite(base)) totalNegativarBase = base;
      const m = Number(d.multaCancelamento);
      if (Number.isFinite(m)) totalNegativarMulta = m;
    }
  }
  const hasNegativar = totalNegativar > 0.0049;

  // Pagamento da multa negativada (com comprovante anexado pelo AC)
  let multaPaga: {
    valor: number; data?: string; comprovanteUrl?: string; comprovanteNome?: string; observacao?: string;
  } | null = null;
  for (const it of items) {
    const d = (it.depois as Record<string, unknown>) ?? {};
    const v = Number(d.multaNegativadaPaga);
    if (Number.isFinite(v) && v > 0.0049) {
      multaPaga = {
        valor: v,
        data: d.dataPagamentoMulta ? String(d.dataPagamentoMulta) : undefined,
        comprovanteUrl: d.comprovanteMultaUrl ? String(d.comprovanteMultaUrl) : undefined,
        comprovanteNome: d.comprovanteMultaNome ? String(d.comprovanteMultaNome) : undefined,
        observacao: d.observacao ? String(d.observacao) : undefined,
      };
    }
  }

  // Abatimento do saldo a devolver aplicado em outro contrato
  let abat: {
    valor: number; destino: string; saldoAntes: number; saldoDepois: number;
    origem: number; restante: number; resumo: string;
  } | null = null;
  for (const it of items) {
    const d = (it.depois as Record<string, unknown>) ?? {};
    const v = Number(d.abatimentoValor);
    if (Number.isFinite(v) && v > 0.0049) {
      abat = {
        valor: v,
        destino: String(d.abatimentoContratoDestino ?? '—'),
        saldoAntes: Number(d.abatimentoSaldoAntes) || 0,
        saldoDepois: Number(d.abatimentoSaldoDepois) || 0,
        origem: Number(d.abatimentoSaldoOrigem) || 0,
        restante: Number(d.abatimentoEstornoRestante) || 0,
        resumo: String(d.abatimentoResumo ?? ''),
      };
    }
  }

  // Se o grupo veio de um cancelamento, sempre exibimos encargos:
  // percentual da multa (mesmo 0%) ou "7 dias CDC" quando aplicável.
  const isCancelamento = items.some((it) => it.tipo === 'cancelamento');
  const hasEncargos = totalMulta > 0.0049 || totalJuros > 0.0049;

  // Fluxo específico de "Aluno pagou a multa": esconde linhas de comprovante
  // (já exibidas no bloco MultaPagaRow) e a seção de encargos.
  const isMultaPagamentoFlow = !!multaPaga;

  // Filtra as linhas redundantes que serão exibidas na seção de Encargos
  const visibleRows = rows.filter(
    (r) => !r.label.toLowerCase().includes('total contratado')
      && !/^(multa|juros|taxa de juros)/i.test(r.label.trim())
      && !/^Comprovante/i.test(r.label.trim())
      && !(isMultaPagamentoFlow && /comprovante/i.test(r.label)),
  );


  if (visibleRows.length === 0 && !saleChanged && !hasEncargos && !hasCDC7 && maxMultaPercent <= 0 && !abat) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1.2fr_1.4fr] text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/40 px-3 py-2">
          <div>Alteração</div>
          <div>De → Para</div>
        </div>
        <ContractValueRow changed={false} />
        <EncargosRow multa={0} juros={0} multaPercent={maxMultaPercent} cdc7={hasCDC7} forceShow={isCancelamento} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[1.2fr_1.4fr] text-[10px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted/40 px-3 py-2">
        <div>Alteração</div>
        <div>De → Para</div>
      </div>
      <div className="divide-y divide-border">
        <ContractValueRow changed={saleChanged} antes={saleAntes} depois={saleDepois} explanation={saleExplanation} />
        {visibleRows.map((r) => (
          <div key={r.id} className="grid grid-cols-[1.2fr_1.4fr] items-center gap-2 px-3 py-2 text-xs">
            <div className="text-foreground/80 font-medium">{r.label}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-rose-500/80 line-through decoration-rose-300/70 text-xs tabular-nums">{r.antes}</span>
              <ArrowRight size={12} className="text-muted-foreground/60 shrink-0" />
              <span className={`px-2 py-0.5 rounded-md font-semibold text-xs tabular-nums ${r.depoisNegative ? NEGATIVE_BADGE : 'bg-emerald-50 text-emerald-700'}`}>{r.depois}</span>
            </div>
          </div>
        ))}
        {!isMultaPagamentoFlow && (
          <EncargosRow multa={totalMulta} juros={totalJuros} multaPercent={maxMultaPercent} cdc7={hasCDC7} forceShow={isCancelamento} />
        )}

        {abat && <AbatimentoRow {...abat} />}
        {multaPaga && <MultaPagaRow {...multaPaga} />}
        {hasNegativar && (
          <NegativarRow
            valor={totalNegativar}
            multa={totalNegativarMulta || totalMulta}
            pago={totalNegativarBase}
          />
        )}
      </div>
    </div>
  );
}

// ─── Linha "Encargos (Multa / Juros)" no rodapé do diff ───────────────────────
// Mostra a multa contratual aplicada (valor + %) ou, quando o cancelamento foi
// dentro dos 7 dias do CDC (Art. 49), um badge informando "SEM MULTA — 7 dias
// CDC". Também exibe juros aplicados por parcela quando existirem.
function EncargosRow({
  multa,
  juros,
  multaPercent = 0,
  cdc7 = false,
  forceShow = false,
}: {
  multa: number;
  juros: number;
  multaPercent?: number;
  cdc7?: boolean;
  /** Cancelamentos sempre mostram % (mesmo 0%) ou "7 dias CDC" */
  forceShow?: boolean;
}) {
  const hasMulta = multa > 0.0049;
  const hasJuros = juros > 0.0049;
  const hasPercent = multaPercent > 0.0049;
  const has = hasMulta || hasJuros || hasPercent || cdc7;
  const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}%`;
  return (
    <div className="grid grid-cols-[1.2fr_1.4fr] items-center gap-2 px-3 py-2 text-xs bg-muted/20">
      <div className="text-foreground/80 font-medium">Encargos (Multa / Juros)</div>
      <div className="flex items-center gap-2 flex-wrap">
        {!has && !forceShow && <span className="text-muted-foreground italic text-xs">Sem encargos</span>}
        {cdc7 && (
          <span
            className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md font-semibold text-[11px] border border-emerald-200"
            title="Direito de arrependimento — Art. 49 do CDC"
          >
            SEM MULTA — 7 dias CDC (Art. 49)
          </span>
        )}
        {!cdc7 && hasMulta && (
          <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-md font-semibold text-xs tabular-nums">
            Multa: {formatCurrency(multa)}{hasPercent ? ` (${fmtPct(multaPercent)})` : ''}
          </span>
        )}
        {!cdc7 && !hasMulta && hasPercent && (
          <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-md font-semibold text-xs tabular-nums">
            Multa contratual: {fmtPct(multaPercent)}
          </span>
        )}
        {/* Cancelamento sem multa e sem 7d CDC → mostra explicitamente 0% */}
        {!cdc7 && !hasMulta && !hasPercent && forceShow && (
          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md font-semibold text-xs tabular-nums">
            Multa contratual: 0%
          </span>
        )}
        {hasJuros && (
          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md font-semibold text-xs tabular-nums">
            Juros: {formatCurrency(juros)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Linha "Multa negativada paga" com comprovante ───────────────────────────
function MultaPagaRow({
  valor, data, comprovanteUrl, comprovanteNome, observacao,
}: {
  valor: number; data?: string; comprovanteUrl?: string; comprovanteNome?: string; observacao?: string;
}) {
  const dataFmt = data && /^\d{4}-\d{2}-\d{2}$/.test(data)
    ? data.split('-').reverse().join('/')
    : data;
  return (
    <div className="grid grid-cols-[1.2fr_1.4fr] items-start gap-2 px-3 py-2.5 text-xs bg-emerald-50/70 border-t border-emerald-200/70">
      <div className="text-emerald-900 font-semibold flex flex-col gap-0.5">
        <span>Aluno pagou a multa</span>
        <span className="text-[10px] font-normal text-emerald-800/80 leading-snug">
          A negativação precisa ser retirada em no máximo 5 dias.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md font-semibold text-xs tabular-nums w-fit">
          {formatCurrency(valor)}{dataFmt ? ` — pago em ${dataFmt}` : ''}
        </span>
        {observacao && (
          <span className="text-[11px] text-emerald-900/80">Obs.: {observacao}</span>
        )}
        {comprovanteUrl ? (
          <button
            type="button"
            onClick={async () => {
              try {
                await openCancellationPdf(comprovanteUrl, comprovanteNome);
              } catch (err: any) {
                toast.error(err?.message ?? 'Não foi possível abrir o comprovante');
              }
            }}
            className="inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-card border border-emerald-200 hover:bg-emerald-50 transition-colors w-full text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <FileText size={13} className="text-emerald-700 shrink-0" />
              <span className="text-[11px] font-medium text-foreground truncate">
                {comprovanteNome || 'Comprovante de pagamento'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0">
              <Eye size={12} /> Visualizar
            </span>
          </button>
        ) : (
          <span className="text-[11px] text-emerald-900/60 italic">Sem comprovante anexado</span>
        )}
      </div>
    </div>
  );
}

// ─── Linha "Abatimento em outro contrato" ────────────────────────────────────
// Destaca, para o revisor da Conciliação, que parte (ou todo) o saldo a
// devolver ao aluno foi utilizado para abater o saldo devedor de outro
// contrato — informando destino, valores antes/depois e o que resta estornar.
function AbatimentoRow({
  valor, destino, saldoAntes, saldoDepois, origem, restante,
}: {
  valor: number; destino: string; saldoAntes: number; saldoDepois: number;
  origem: number; restante: number; resumo?: string;
}) {
  return (
    <div className="grid grid-cols-[1.2fr_1.4fr] items-start gap-2 px-3 py-2.5 text-xs bg-indigo-50/60 border-t border-indigo-200/60">
      <div className="text-indigo-900 font-semibold flex flex-col gap-0.5">
        <span>Abatimento em outro contrato</span>
        <span className="text-[10px] font-normal text-indigo-800/80 leading-snug">
          Saldo a devolver ao aluno utilizado para abater parcelas de outro contrato.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="px-2 py-1 bg-indigo-100 text-indigo-900 rounded-md font-bold text-sm tabular-nums self-start">
          {formatCurrency(valor)}
        </span>
        <div className="text-[11px] text-indigo-900/90 leading-snug space-y-0.5">
          <p><span className="font-semibold">Contrato de destino:</span> {destino}</p>
          <p className="tabular-nums">
            <span className="font-semibold">Saldo devedor do destino:</span>{' '}
            {formatCurrency(saldoAntes)} → {formatCurrency(saldoDepois)}
          </p>
          <p className="tabular-nums">
            <span className="font-semibold">Saldo a devolver:</span>{' '}
            {formatCurrency(origem)} − abatido {formatCurrency(valor)} ={' '}
            <strong>{formatCurrency(restante)}</strong>
          </p>
          <p className={restante > 0.0049 ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>
            {restante > 0.0049
              ? `Restam ${formatCurrency(restante)} a estornar ao aluno via PIX.`
              : 'Nada a estornar ao aluno — saldo totalmente abatido.'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Linha "Total a Negativar" ───────────────────────────────────────────────
// Mostra o valor residual que precisa ir para negativação após o Jurídico
// optar por "Negativar Multa" no fluxo de cancelamento. A informação é
// SEGMENTADA da multa total: aqui o revisor da Conciliação vê exatamente
// quanto precisa ser enviado para negativação (multa − pago até o momento).
function NegativarRow({ valor, multa, pago }: { valor: number; multa: number; pago: number }) {
  return (
    <div className="grid grid-cols-[1.2fr_1.4fr] items-start gap-2 px-3 py-2.5 text-xs bg-amber-50/60 border-t border-amber-200/60">
      <div className="text-amber-900 font-semibold flex flex-col gap-0.5">
        <span>Total a negativar</span>
        <span className="text-[10px] font-normal text-amber-800/80 leading-snug">
          Valor da multa descontado o valor pago até o momento — enviar para negativação.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="px-2 py-1 bg-amber-100 text-amber-900 rounded-md font-bold text-sm tabular-nums self-start">
          {formatCurrency(valor)}
        </span>
        {multa > 0 && (
          <span className="text-[10px] text-amber-800/80 tabular-nums">
            Multa {formatCurrency(multa)} − Pago {formatCurrency(pago)} = {formatCurrency(valor)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Painel "Resumo do Contrato" ──────────────────────────────────────────────
// Bloco didático colocado no topo do card de conciliação, com as informações
// que o revisor precisa SEMPRE ver antes de decidir: total contratado, total
// já pago, saldo em aberto, número de parcelas em aberto e descrição curta
// do contrato (produto + data de assinatura).
function ContractSummaryPanel({ student, conciliacaoItems = [] }: { student: Student; conciliacaoItems?: ConciliacaoItem[] }) {
  // Fluxo "Aluno pagou a multa": oculta os indicadores financeiros do topo.
  const isMultaPagamentoFlow = conciliacaoItems.some((it) => {
    const v = Number((it.depois as Record<string, unknown>)?.multaNegativadaPaga);
    return Number.isFinite(v) && v > 0.0049;
  });

  const cancellationCases = useAppStore((s) => s.cancellationCases);
  const totalContratado = Number(student.saleValue) || 0;
  const entrada = Number(student.downPayment) || 0;
  const totalPagoEfetivoCancelamento = conciliacaoItems
    .map((item) => item.depois as Record<string, unknown>)
    .map((depois) => {
      if (depois?.multaDeduzidaDoPago !== true) return undefined;
      // `totalPagoEfetivo` inclui o complemento de multa; `totalPago` é só
      // entrada + parcelas pagas (usado na linha do diff).
      const efetivo = Number(depois?.totalPagoEfetivo);
      if (Number.isFinite(efetivo)) return efetivo;
      const pago = Number(depois?.totalPago);
      return Number.isFinite(pago) ? pago : undefined;
    })
    .find((v) => v !== undefined);
  const isFineInst = (i: { tags?: string[] }) => (i.tags ?? []).includes('multa-cancelamento');
  const pagasInst = (student.installments ?? []).filter((i) => i.paid && !isFineInst(i));
  const abertasInst = (student.installments ?? []).filter((i) => !i.paid && !isFineInst(i));
  const pagoParcelas = pagasInst.reduce(
    (acc, i) => acc + (typeof i.paidValue === 'number' ? i.paidValue : Number(i.value) || 0),
    0,
  );
  const totalPago = totalPagoEfetivoCancelamento != null
    ? Number(totalPagoEfetivoCancelamento)
    : entrada + pagoParcelas;

  const saldoAberto = Math.max(totalContratado - totalPago, 0);
  const parcelasAbertas = abertasInst.length;

  // Quantidade de inscrições: usar o valor preenchido no caso de cancelamento
  // (informado pelo AC ao iniciar o fluxo). Fallback para 1 quando ausente.
  const caseIds = Array.from(new Set(
    conciliacaoItems.map((i) => i.relatedCaseId).filter((x): x is string => !!x),
  ));
  const relatedCases = caseIds
    .map((cid) => cancellationCases.find((c) => c.id === cid))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const qtdInscricoes = relatedCases
    .map((c) => Number(c.quantidadeInscricoes))
    .find((n) => Number.isFinite(n) && n > 0) ?? 1;
  const inscTxt = `${qtdInscricoes} inscriç${qtdInscricoes === 1 ? 'ão' : 'ões'}`;
  const revertidasCount = relatedCases
    .map((c) => Number(c.inscricoesRevertidas))
    .find((n) => Number.isFinite(n) && n > 0) ?? 0;
  const canceladasCount = Math.max(0, qtdInscricoes - revertidasCount);
  const breakdownTxt = (qtdInscricoes > 1 && revertidasCount > 0 && canceladasCount > 0)
    ? ` ${revertidasCount} inscriç${revertidasCount === 1 ? 'ão foi revertida' : 'ões foram revertidas'} e ${canceladasCount} inscriç${canceladasCount === 1 ? 'ão será cancelada' : 'ões serão canceladas'}.`
    : '';
  const desc = `${inscTxt} no treinamento ${student.product || '—'}${
    student.enrollmentDate ? ` — contrato assinado em ${formatDate(student.enrollmentDate)}` : ''
  }.${breakdownTxt}`;


  return (
    <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ScrollText size={11} className="text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Resumo do contrato
        </span>
      </div>
      <p className="text-[12px] text-foreground/80 leading-relaxed">{desc}</p>
      {!isMultaPagamentoFlow && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total contratado</p>
          <p className="text-sm font-bold text-foreground tabular-nums">{formatCurrency(totalContratado)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total pago</p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(totalPago)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Saldo em aberto</p>
          <p className="text-sm font-bold text-rose-700 tabular-nums">{formatCurrency(saldoAberto)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Parcelas em aberto</p>
          <p className="text-sm font-bold text-foreground tabular-nums">{parcelasAbertas}</p>
        </div>
      </div>
      )}

    </div>
  );
}

// Sessões de alterações agrupadas (mesmo aluno + mesmo autor + janela de tempo)
type Group = {
  key: string;
  studentId?: string;
  studentName: string;
  ac?: string;
  autorNome?: string;
  createdAt: string;
  items: ConciliacaoItem[];
};


// ─── Helper: resolver erro de importação rapidamente (inline / bulk) ────────
// Reaproveita a lógica do ResolveErrorModal mas aceita overrides de valor e
// data de pagamento. Escolhe automaticamente o melhor aluno/parcela.
// Bloqueia motivos que exigem decisão manual (aluno não encontrado / múltiplos
// alunos / sem pagamento / parcela já paga).
const QUICK_RESOLVE_BLOCKED: ConciliacaoImportErrorMotivo[] = [
  'aluno_nao_encontrado',
  'multiplos_alunos',
  'sem_pagamento',
  'parcela_ja_paga',
];

async function quickResolveImportError(
  err: ConciliacaoImportError,
  opts: { valor?: number; dataPagamento?: string } = {},
): Promise<{ ok: boolean; nota?: string; error?: string }> {
  if (QUICK_RESOLVE_BLOCKED.includes(err.motivo)) {
    return { ok: false, error: 'Este motivo exige resolução manual (use "Resolver").' };
  }
  const state = useAppStore.getState();
  const students = state.students;
  const currentUser = state.currentUser;

  const norm = (s: string) =>
    (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  let candidates: Student[] = [];
  if (err.studentId) {
    const byId = students.find((s) => s.id === err.studentId);
    if (byId) candidates.push(byId);
  }
  const byName = students.filter((s) => norm(s.name) === norm(err.studentName));
  for (const s of byName) if (!candidates.some((c) => c.id === s.id)) candidates.push(s);
  if (candidates.length === 0) return { ok: false, error: 'Aluno não encontrado.' };

  candidates = candidates.sort((a, b) => {
    const aHasVenc = err.vencimento ? a.installments.some((i) => !i.paid && i.dueDate === err.vencimento) : false;
    const bHasVenc = err.vencimento ? b.installments.some((i) => !i.paid && i.dueDate === err.vencimento) : false;
    if (aHasVenc !== bHasVenc) return aHasVenc ? -1 : 1;
    const aOpen = a.installments.some((i) => !i.paid);
    const bOpen = b.installments.some((i) => !i.paid);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (!!a.isRendaExtra !== !!b.isRendaExtra) return a.isRendaExtra ? 1 : -1;
    return (b.saleValue ?? 0) - (a.saleValue ?? 0);
  });
  const student = candidates[0];

  let installment: Installment | undefined;
  if (err.vencimento) {
    installment = student.installments.find((i) => !i.paid && i.dueDate === err.vencimento);
  }
  if (!installment && err.valor != null) {
    installment = student.installments.find(
      (i) => !i.paid && Math.abs((i.value ?? 0) - (err.valor ?? 0)) < 0.01,
    );
  }
  if (!installment) {
    installment = [...student.installments]
      .filter((i) => !i.paid)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number)[0];
  }
  if (!installment) return { ok: false, error: 'Aluno sem parcela em aberto.' };

  const valor = opts.valor != null && opts.valor > 0 ? opts.valor : (err.valor ?? installment.value);
  const dataPag = opts.dataPagamento || err.dataPagamento || new Date().toISOString().split('T')[0];
  const valorOriginal = installment.value;

  const updatedInstallments: Installment[] = student.installments.map((i) =>
    i.number === installment!.number
      ? { ...i, value: valor, paid: true, paidDate: dataPag }
      : i,
  );
  const totalPagas = updatedInstallments.filter((i) => i.paid).length;
  const restantes = updatedInstallments.length - totalPagas;
  const fmtBRL = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  const fmtDate = (s: string) => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };
  const divergencia = Math.abs(valor - valorOriginal) > 0.001;
  const historyEntry = {
    date: new Date().toISOString(),
    type: 'Sistema' as const,
    text:
      `Baixa via Conciliação (resolução rápida de erro Kamino) — Parcela ${installment.number}: ` +
      `${fmtBRL(valor)} pago em ${fmtDate(dataPag)}` +
      (divergencia ? ` (valor da parcela ajustado de ${fmtBRL(valorOriginal)} para ${fmtBRL(valor)})` : '') +
      `. ${totalPagas}/${updatedInstallments.length} pagas (faltam ${restantes}).`,
  };

  useAppStore.setState((s) => ({
    students: s.students.map((st) =>
      st.id === student.id
        ? { ...st, installments: updatedInstallments, paidInstallments: totalPagas, history: [...(st.history ?? []), historyEntry] }
        : st,
    ),
  }));

  try {
    await updateStudentDb(student.id, {
      installments: updatedInstallments,
      paidInstallments: totalPagas,
      history: [...(student.history ?? []), historyEntry],
    });
  } catch (e) {
    console.error('Falha ao persistir baixa:', e);
    return { ok: false, error: 'Falha ao salvar no banco.' };
  }

  const nowIso = new Date().toISOString();
  try {
    const created = await createConciliacaoItemDb({
      tipo: 'baixa_kamino',
      studentId: student.id,
      studentName: student.name,
      ac: student.ac,
      resumo:
        `Parcela ${installment.number} (venc. ${fmtDate(installment.dueDate)} • ${fmtBRL(valor)}) ` +
        `baixada via resolução de erro Kamino em ${fmtDate(dataPag)}.`,
      antes: { paid: false, paidDate: null, numero: installment.number, valor: valorOriginal, vencimento: installment.dueDate },
      depois: { paid: true, paidDate: dataPag, numero: installment.number, valor, vencimento: installment.dueDate },
      autorId: currentUser?.id,
      autorNome: currentUser?.name,
      status: 'conciliado',
      conciliadoAt: nowIso,
      conciliadoPorId: currentUser?.id,
      conciliadoPorNome: currentUser?.name,
      conciliadoNota: `Resolução de erro de importação${err.fileName ? ` (${err.fileName})` : ''}`,
    });
    useConciliacaoStore.setState((s) => ({ items: [created, ...s.items] }));
  } catch (e) {
    console.error('Falha ao registrar baixa no histórico:', e);
  }

  const nota = divergencia
    ? `Baixada parcela ${installment.number} com valor pago ${fmtBRL(valor)} em ${fmtDate(dataPag)} (orig. ${fmtBRL(valorOriginal)}).`
    : `Baixada parcela ${installment.number} (${fmtBRL(valor)}) em ${fmtDate(dataPag)}.`;
  return { ok: true, nota };
}

export default function ConciliacaoPage() {
  const items = useConciliacaoStore((s) => s.items);
  const conciliar = useConciliacaoStore((s) => s.conciliar);
  const reprovar = useConciliacaoStore((s) => s.reprovar);
  const remove = useConciliacaoStore((s) => s.remove);
  const aprovar = useConciliacaoStore((s) => s.aprovar);
  const importErrors = useConciliacaoStore((s) => s.importErrors);
  const resolverImportError = useConciliacaoStore((s) => s.resolverImportError);
  const ignorarImportError = useConciliacaoStore((s) => s.ignorarImportError);
  const removeImportError = useConciliacaoStore((s) => s.removeImportError);
  const currentUser = useAppStore((s) => s.currentUser);
  const setRendaExtraStatus = useAppStore((s) => s.setRendaExtraStatus);
  const concluirConciliacaoCancelamento = useAppStore((s) => s.concluirConciliacaoCancelamento);
  const cancellationCases = useAppStore((s) => s.cancellationCases);
  const updateCancellationCase = useAppStore((s) => s.updateCancellationCase);
  const students = useAppStore((s) => s.students);
  const isAdmin = currentUser?.role === 'admin';
  const canConciliarEdit = canEditTab(currentUser, 'conciliacao');
  const confirm = useConfirm();

  const [flow, setFlow] = useState<'menu' | 'gc-kamino' | 'kamino-gc' | 'iam-control-gc' | 'cancelamentos-gc'>('menu');
  const [tab, setTab] = useState<'ajuste_financeiro' | 'cancelamentos' | 'renda_extra' | 'historico' | 'erros' | 'iam_pendentes'>('ajuste_financeiro');
  const [search, setSearch] = useState('');
  const [tipoFilter, setTipoFilter] = useState<ConciliacaoGrupoFilter>('todos');
  const [erroStatusFilter, setErroStatusFilter] = useState<'pendente' | 'resolvido' | 'ignorado' | 'todos'>('pendente');
  const [showImport, setShowImport] = useState(false);
  const [resolveError, setResolveError] = useState<ConciliacaoImportError | null>(null);
  const [financialStudent, setFinancialStudent] = useState<Student | null>(null);
  const [reprovarGroup, setReprovarGroup] = useState<Group | null>(null);
  const [reprovarMotivo, setReprovarMotivo] = useState('');
  const [reprovarLoading, setReprovarLoading] = useState(false);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  // Edição inline + loading por linha de erro
  const [rowEdits, setRowEdits] = useState<Record<string, { valor: number; dataPagamento: string }>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    return items
      .filter((i) => {
        if (tab === 'iam_pendentes') {
          return (
            (i.status === 'pendente' || i.status === 'aprovado') &&
            i.tipo === 'iam_pendente'
          );
        }
        if (tab === 'ajuste_financeiro') {
          // Parcelas, quitação, renegociação, renda extra, encargos, etc.
          return (
            (i.status === 'pendente' || i.status === 'aprovado') &&
            i.tipo !== 'baixa_kamino' &&
            isAjusteFinanceiroTipo(i.tipo)
          );
        }
        if (tab === 'cancelamentos') {
          return (i.status === 'pendente' || i.status === 'aprovado') && isCancelTipo(i.tipo);
        }
        if (tab === 'renda_extra') {
          return (i.status === 'pendente' || i.status === 'aprovado') && isRendaExtraTipo(i.tipo);
        }
        if (tab === 'historico') {
          if (i.status !== 'conciliado' && i.status !== 'reprovado') return false;
          if (flow === 'kamino-gc') return i.tipo === 'baixa_kamino';
          if (flow === 'iam-control-gc') return i.tipo === 'iam_pendente';
          if (flow === 'cancelamentos-gc') return isCancelTipo(i.tipo);
          return i.tipo !== 'baixa_kamino' && i.tipo !== 'iam_pendente' && !isCancelTipo(i.tipo);
        }
        return false;
      })
      .filter((i) => matchesGrupoFilter(i.tipo, tipoFilter))
      .filter((i) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          i.studentName.toLowerCase().includes(q) ||
          i.resumo.toLowerCase().includes(q) ||
          (i.ac ?? '').toLowerCase().includes(q)
        );
      });
  }, [items, tab, tipoFilter, search, flow]);

  const filteredErrors = useMemo(() => {
    return importErrors
      .filter((e) => (erroStatusFilter === 'todos' ? true : e.status === erroStatusFilter))
      .filter((e) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return e.studentName.toLowerCase().includes(q) || (e.fileName ?? '').toLowerCase().includes(q);
      });
  }, [importErrors, erroStatusFilter, search]);

  // Conta por aluno distinto (não por item), para refletir as pendências
  // agrupadas exibidas como cards — alinhado com o badge da sidebar.
  const iamControlGcCount = new Set(
    items
      .filter(
        (i) =>
          (i.status === 'pendente' || i.status === 'aprovado') &&
          i.tipo === 'iam_pendente',
      )
      .map((i) => i.studentId ?? i.studentName),
  ).size;
  const ajusteFinanceiroCount = new Set(
    items
      .filter(
        (i) =>
          (i.status === 'pendente' || i.status === 'aprovado') &&
          i.tipo !== 'baixa_kamino' &&
          isAjusteFinanceiroTipo(i.tipo),
      )
      .map((i) => i.studentId ?? i.studentName),
  ).size;
  const cancelamentosCount = new Set(
    items
      .filter((i) => (i.status === 'pendente' || i.status === 'aprovado') && isCancelTipo(i.tipo))
      .map((i) => i.studentId ?? i.studentName),
  ).size;
  const rendaExtraCount = new Set(
    items
      .filter((i) => (i.status === 'pendente' || i.status === 'aprovado') && isRendaExtraTipo(i.tipo))
      .map((i) => i.studentId ?? i.studentName),
  ).size;
  const historicoCount = flow === 'kamino-gc'
    ? items.filter((i) => i.status === 'conciliado' && i.tipo === 'baixa_kamino').length
    : flow === 'iam-control-gc'
      ? items.filter((i) => (i.status === 'conciliado' || i.status === 'reprovado') && i.tipo === 'iam_pendente').length
      : flow === 'cancelamentos-gc'
        ? items.filter((i) => (i.status === 'conciliado' || i.status === 'reprovado') && isCancelTipo(i.tipo)).length
        : items.filter((i) => (i.status === 'conciliado' || i.status === 'reprovado') && i.tipo !== 'baixa_kamino' && i.tipo !== 'iam_pendente' && !isCancelTipo(i.tipo)).length;
  const errosPendentesCount = importErrors.filter((e) => e.status === 'pendente').length;

  // (handleConciliar individual removido — agora todo conciliamento de pendências
  // passa por handleConciliarGrupo, que trata 1 ou N itens da mesma sessão.)

  // ─── Agrupa pendências por aluno + sessão (até 30min entre itens) ─────────
  // Permite que múltiplas alterações feitas no mesmo FinancialModal apareçam
  // num único card, com botão "Conciliar" que concilia todos de uma vez.
  const SESSION_WINDOW_MS = 30 * 60 * 1000;
  const groupedPending = useMemo<Group[]>(() => {
    if (tab !== 'ajuste_financeiro' && tab !== 'cancelamentos' && tab !== 'renda_extra' && tab !== 'iam_pendentes') return [];
    // Ordena por aluno → autor → tempo crescente para agrupar sessões corretamente
    const sorted = [...filtered].sort((a, b) => {
      const k1 = (a.studentId ?? a.studentName) + '|' + (a.autorId ?? '');
      const k2 = (b.studentId ?? b.studentName) + '|' + (b.autorId ?? '');
      if (k1 !== k2) return k1 < k2 ? -1 : 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const groups: Group[] = [];
    for (const item of sorted) {
      const last = groups[groups.length - 1];
      const sameStudent = last && (last.studentId ?? last.studentName) === (item.studentId ?? item.studentName);
      const sameAuthor = last && last.items[0].autorId === item.autorId;
      const sameStatus = last && last.items[0].status === item.status;
      const within = last && (new Date(item.createdAt).getTime() - new Date(last.items[last.items.length - 1].createdAt).getTime()) <= SESSION_WINDOW_MS;
      if (sameStudent && sameAuthor && sameStatus && within) {
        last.items.push(item);
        last.createdAt = item.createdAt;
      } else {
        groups.push({
          key: item.id,
          studentId: item.studentId,
          studentName: item.studentName,
          ac: item.ac,
          autorNome: item.autorNome,
          createdAt: item.createdAt,
          items: [item],
        });
      }
    }
    // Re-ordena por createdAt do grupo desc (mais recente primeiro)
    return groups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [filtered, tab]);

  // Modal de confirmação para cancelamento (mostra checklist + pergunta boletos)
  const [cancelConfirm, setCancelConfirm] = useState<{ group: Group; caseRef: import('@/types').CancellationCase } | null>(null);
  const [cancelConfirmBoletos, setCancelConfirmBoletos] = useState<boolean | null>(null);

  const handleConciliarGrupo = async (group: Group) => {
    if (!canConciliarEdit) {
      toast.error('Somente Admin ou usuários com permissão de Conciliação podem conciliar.');
      return;
    }
    if (group.items.some(isCancelamentoEspelhoItem) && groupBlocksEspelhoConciliacao(group.items, group.studentId ? useAppStore.getState().students.find((s) => s.id === group.studentId) : undefined, useConciliacaoStore.getState().items)) {
      toast.error('Este aluno está em cancelamento em andamento. Finalize na aba Cancelamentos antes de conciliar no GC.');
      return;
    }
    // Se há um item de cancelamento no grupo, abrir gate de confirmação
    const cancItem = group.items.find((i) => i.tipo === 'cancelamento' && i.relatedCaseId);
    if (cancItem) {
      const caseRef = cancellationCases.find((c) => c.id === cancItem.relatedCaseId);
      if (caseRef) {
        setCancelConfirmBoletos(null);
        setCancelConfirm({ group, caseRef });
        return;
      }
    }
    const jaSistema = groupJaAplicadoNoSistema(group.items);
    const soObs = jaSistema && groupTemObservacao(group.items);
    const ok = await confirm({
      title: soObs
        ? 'Aprovar observação'
        : jaSistema
          ? 'Confirmar conciliação'
          : group.items.length > 1
            ? `Conciliar ${group.items.length} alterações`
            : 'Marcar como conciliado',
      description: soObs
        ? `${group.studentName}\n\nAs alterações já estão no sistema. Isto só aprova a observação — nada será reaplicado nem desfeito.\n\n${group.items.map((i) => `• ${i.resumo}`).join('\n')}`
        : jaSistema
          ? `${group.studentName}\n\nAs alterações já estão aplicadas. Confirmar move para o histórico sem reaplicar.\n\n${group.items.map((i) => `• ${i.resumo}`).join('\n')}`
          : `${group.studentName}\n${group.items.map((i) => `• ${i.resumo}`).join('\n')}`,
      confirmText: soObs ? 'Aprovar observação' : jaSistema ? 'Confirmar' : 'Conciliar',
    });
    if (!ok) return;
    await executeConciliarGrupo(group);
    if (soObs) {
      toast.success('Observação aprovada. Nada foi desconciliado.');
    } else if (jaSistema) {
      toast.success('Conciliação confirmada. Alterações já estavam no sistema.');
    }
  };

  // Executa efetivamente a conciliação (extraído para permitir chamada após confirmação do cancelamento)
  const executeConciliarGrupo = async (group: Group) => {
    const updateStudent = useAppStore.getState().updateStudent;
    const todayIso = new Date().toISOString().split('T')[0];
    // Aprova comissões pendentes vinculadas a itens de reversão deste grupo.
    try {
      const { ensureReversalCommission } = await import('@/lib/ensureReversalCommission');
      for (const it of group.items) {
        if (isConciliacaoReversaoItem(it) && it.relatedCaseId) ensureReversalCommission(it.relatedCaseId);
      }
    } catch (e) {
      console.error('[conciliar] aprovar comissão falhou:', e);
    }
    for (const it of group.items) {
      conciliar(it.id, undefined, { silent: true });

      if (it.tipo === 'renda_extra_exclusao' && it.studentId) {
        setRendaExtraStatus(it.studentId, 'Disponível Negociação');
      }
      if (it.tipo === 'cancelamento' && it.relatedCaseId && !isConciliacaoReversaoItem(it) && !isCancelamentoEspelhoItem(it)) {
        concluirConciliacaoCancelamento(it.relatedCaseId);
      }
      // ─── Quitação: baixa ocorre APENAS na aprovação da conciliação ─────
      if (it.tipo === 'quitacao' && it.studentId) {
        const st = useAppStore.getState().students.find((s) => s.id === it.studentId);
        if (st) {
          const updatedInst = st.installments.map((i) =>
            !i.paid ? { ...i, paid: true, paidDate: todayIso } : i
          );
          const valorPago = (it.depois as Record<string, unknown>)?.valorPago;
          const desconto = (it.depois as Record<string, unknown>)?.desconto;
          updateStudent(st.id, {
            installments: updatedInst,
            paidInstallments: updatedInst.length,
            history: [
              ...st.history,
              {
                date: new Date().toISOString(),
                type: 'Sistema' as const,
                text: `Quitação aprovada na Conciliação. Valor pago: ${typeof valorPago === 'number' ? formatCurrency(valorPago) : '—'}${typeof desconto === 'number' ? ` (desconto ${formatCurrency(desconto)})` : ''}.`,
              },
            ],
          });
        }
      }
      // ─── Pagamento manual de parcela: baixa só ao aprovar ──────────────
      if (it.tipo === 'pagamento_parcela' && it.studentId) {
        const st = useAppStore.getState().students.find((s) => s.id === it.studentId);
        if (st) {
          const depois = it.depois as Record<string, unknown>;
          const parcelaNum = Number(depois?.parcela);
          const valorPago = Number(depois?.valor);
          if (Number.isFinite(parcelaNum)) {
            const updatedInst = st.installments.map((i) => {
              if (i.number !== parcelaNum) return i;
              const paidValueField =
                Number.isFinite(valorPago) && Math.abs(valorPago - i.value) > 0.01
                  ? { paidValue: valorPago }
                  : {};
              return { ...i, paid: true, paidDate: todayIso, ...paidValueField };
            });
            const paidCount = updatedInst.filter((i) => i.paid).length;
            updateStudent(st.id, {
              installments: updatedInst,
              paidInstallments: paidCount,
              history: [
                ...st.history,
                {
                  date: new Date().toISOString(),
                  type: 'Sistema' as const,
                  text: `Pagamento da parcela ${parcelaNum} aprovado na Conciliação${Number.isFinite(valorPago) ? ` (${formatCurrency(valorPago)})` : ''}.`,
                },
              ],
            });
          }
        }
      }
      // ─── Renegociação (rascunho): só efetiva o novo plano ao conciliar ──
      if (it.tipo === 'renegociacao' && it.studentId) {
        const st = useAppStore.getState().students.find((s) => s.id === it.studentId);
        const depois = it.depois as Record<string, unknown>;
        const novasParcelas = depois?.novasParcelas as Array<{ number: number; dueDate: string; value: number; paid?: boolean; paidDate?: string }> | undefined;
        const novoSaleValue = Number(depois?.saleValue);
        const novoTotal = Number(depois?.totalParcelas);
        const novoValor = Number(depois?.valorParcela);
        const novaEntrada = Number(depois?.entrada) || 0;
        if (st && Array.isArray(novasParcelas)) {
          const allInst = novasParcelas.map((i, idx) => ({ ...i, number: idx + 1, paid: !!i.paid }));
          const downPayAtual = Number(st.downPayment) || 0;
          const novoDownPayment = downPayAtual + novaEntrada;
          updateStudent(st.id, {
            installments: allInst,
            totalInstallments: Number.isFinite(novoTotal) ? novoTotal : allInst.length,
            installmentValue: Number.isFinite(novoValor) ? novoValor : (allInst.find((i) => !i.paid)?.value ?? 0),
            paidInstallments: allInst.filter((i) => i.paid).length,
            ...(Number.isFinite(novoSaleValue) ? { saleValue: novoSaleValue } : {}),
            ...(novaEntrada > 0 ? { downPayment: novoDownPayment } : {}),
            history: [
              ...st.history,
              {
                date: new Date().toISOString(),
                type: 'Sistema' as const,
                text:
                  `Renegociação aprovada e conciliada — novo plano efetivado: ${allInst.length} parcelas.` +
                  (novaEntrada > 0
                    ? ` Entrada de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(novaEntrada)} registrada (Total pago de entrada: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(novoDownPayment)}).`
                    : ''),
              },
            ],
          });
        }
      }
      // ─── Import IAM (PENDENTE / PARA_CONCILIAR): só conta nos totais após conciliar
      if (it.tipo === 'iam_pendente' && it.studentId) {
        const st = useAppStore.getState().students.find((s) => s.id === it.studentId);
        if (st) {
          const { calculateAutoStatus } = await import('@/store/useAppStore');
          const autoStatus = calculateAutoStatus(st.installments);
          const nowIso = new Date().toISOString();
          const revisor = currentUser?.name ?? 'Conciliação';
          const statusAnterior = String(st.iamControlContratoStatus ?? 'PENDENTE')
            .replace(/_/g, ' ');
          updateStudent(st.id, {
            iamControlContratoStatus: 'CONCILIADO',
            iamGcConciliadoAt: nowIso,
            statusMode: 'Automático',
            status: autoStatus,
            history: [
              ...st.history,
              {
                date: nowIso,
                type: 'Sistema' as const,
                text: `Contrato IAM (${statusAnterior}) aprovado na Conciliação por ${revisor}. Passa a contar nos totais financeiros.`,
              },
            ],
          });
        }
      }
    }
    notifyConciliacaoGrupo(group.items, 'aprovada');
  };

  // ─── Aprovar grupo: marca como aprovado SEM executar alterações ───────────
  // O card sai de "Pendentes" e entra em "Aprovados". A execução real só
  // acontece quando alguém clicar em "Conciliar" na aba Aprovados.
  const handleAprovarGrupo = async (group: Group) => {
    if (!canConciliarEdit) {
      toast.error('Somente Admin ou usuários com permissão de Conciliação podem aprovar.');
      return;
    }
    const ok = await confirm({
      title: group.items.length > 1 ? `Aprovar ${group.items.length} alterações` : 'Aprovar alteração',
      description: `${group.studentName}\n\nAs alterações ainda NÃO serão executadas. Vão para a aba "Aprovados" e aguardam conciliação.\n\n${group.items.map((i) => `• ${i.resumo}`).join('\n')}`,
      confirmText: 'Aprovar',
    });
    if (!ok) return;
    // Aprova comissões pendentes vinculadas a itens de reversão deste grupo.
    try {
      const { ensureReversalCommission } = await import('@/lib/ensureReversalCommission');
      for (const it of group.items) {
        if (isConciliacaoReversaoItem(it) && it.relatedCaseId) ensureReversalCommission(it.relatedCaseId);
      }
    } catch (e) {
      console.error('[aprovar] aprovar comissão falhou:', e);
    }
    for (const it of group.items) {
      aprovar(it.id, undefined, { silent: true });
    }
    notifyConciliacaoGrupo(group.items, 'pre_aprovada');

    toast.success(
      group.items.length > 1
        ? `${group.items.length} alterações aprovadas. Aguardando conciliação.`
        : 'Alteração aprovada. Aguardando conciliação.',
    );
  };



  // ─── Reprovar grupo: reverte cada item + notifica autor (vermelho) ─────────
  const openReprovar = (group: Group) => {
    setReprovarGroup(group);
    setReprovarMotivo('');
  };

  const confirmReprovar = async () => {
    if (!reprovarGroup) return;
    const motivo = reprovarMotivo.trim();
    if (!motivo) {
      toast.error('Informe o motivo da reprovação.');
      return;
    }
    setReprovarLoading(true);
    try {
      // Regra: a Conciliação é um DOUBLE-CHECK. Na reprovação os valores
      // permanecem como estão (não há rollback) — o caso volta para
      // "Em Tratativas" com a ação "Corrigir por Erro" e o motivo visível.
      const affectedCaseIds = new Set<string>();
      for (const it of reprovarGroup.items) {
        reprovar(it.id, motivo, { silent: true });
        if (it.relatedCaseId) {
          affectedCaseIds.add(it.relatedCaseId);
        } else if (isDoubleCheckItem(it) && it.studentId) {
          // Ajuste pré-cancelamento: o item nasce ANTES do caso existir, então
          // não tem relatedCaseId. Localizamos o caso aberto do aluno para
          // devolvê-lo a "Em Tratativas" com pedido de correção.
          const openCase = cancellationCases.find(
            (x) => x.studentId === it.studentId && x.funnelStage !== 'Finalizado',
          );
          if (openCase) affectedCaseIds.add(openCase.id);
        }
      }

      const nowIso = new Date().toISOString();
      const revisor = currentUser?.name ?? 'Conciliação';
      for (const caseId of affectedCaseIds) {
        const c = cancellationCases.find((x) => x.id === caseId);
        if (!c) continue;
        const targetFunnel: FunnelStage = 'Em Execução';
        const entry = {
          date: nowIso,
          from: c.stage,
          to: c.stage,
          operationalStatus: c.operationalStatus,
          note: `Conciliação REPROVADA por ${revisor}. Valores mantidos. Card retornou para "Em Tratativas" com a ação "Corrigir por Erro". Motivo: ${motivo}`,
        };
        updateCancellationCase(caseId, {
          funnelStage: targetFunnel,
          acao: 'Corrigir por Erro',
          movedToCurrentStageAt: nowIso,
          conciliacaoReprovadaMotivo: motivo,
          conciliacaoReprovadaAt: nowIso,
          conciliacaoReprovadaPorNome: revisor,
          history: [...c.history, entry],
        });

        // Comissões geradas pela reversão deste caso ficam marcadas como
        // REPROVADAS (linha riscada em vermelho + "Ver motivo" na aba Comissões).
        try {
          const { useCommissionsStore } = await import('@/store/useCommissionsStore');
          useCommissionsStore.getState().rejectByCaseId(caseId, motivo);
        } catch (e) {
          console.error('[reprovar] marcar comissão reprovada falhou:', e);
        }


      }
      // Notificação consolidada VERMELHA para o autor
      notifyConciliacaoGrupo(reprovarGroup.items, 'reprovada', motivo);
      toast.success(
        reprovarGroup.items.length > 1
          ? `${reprovarGroup.items.length} alterações reprovadas.`
          : 'Alteração reprovada.',
        {
          description:
            'Assessor notificado para resolver. Valores mantidos. Caso retornou para "Em Tratativas" com a ação "Corrigir por Erro".',
        },
      );
      setReprovarGroup(null);
      setReprovarMotivo('');
    } finally {
      setReprovarLoading(false);
    }
  };

  // ─── Tela inicial: seleção de fluxo ──────────────────────────────────────
  if (flow === 'menu') {
    return (
      <div className="space-y-6">
        <div className="text-center max-w-2xl mx-auto pt-4">
          <h2 className="text-2xl font-bold text-foreground mb-2">Conciliação</h2>
          <p className="text-sm text-muted-foreground">
            Escolha o sentido do fluxo que deseja conciliar.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-6xl mx-auto">
          {/* GC → Kamino */}
          <button
            onClick={() => { setFlow('gc-kamino'); setTab('ajuste_financeiro'); }}
            className="group relative bg-card border-2 border-border hover:border-primary rounded-2xl p-6 text-left transition-all hover:shadow-lg"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold text-lg">GC</span>
              <ArrowRight size={24} className="text-primary" />
              <span className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-bold text-lg">Kamino</span>
            </div>
            <h3 className="font-semibold text-foreground mb-1">IAM - GC → Kamino</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Alterações feitas neste sistema (vencimento, parcelas, juros, etc.) que precisam ser refletidas no Kamino.
            </p>
            {(ajusteFinanceiroCount + rendaExtraCount) > 0 && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-red-600 text-[11px] font-bold border border-amber-300">
                {ajusteFinanceiroCount + rendaExtraCount} pendente{(ajusteFinanceiroCount + rendaExtraCount) !== 1 ? 's' : ''}
              </span>
            )}
          </button>

          {/* Kamino → GC */}
          <button
            onClick={() => { setFlow('kamino-gc'); setTab('erros'); }}
            className="group relative bg-card border-2 border-border hover:border-primary rounded-2xl p-6 text-left transition-all hover:shadow-lg"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-bold text-lg">Kamino</span>
              <ArrowRight size={24} className="text-primary" />
              <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold text-lg">GC</span>
            </div>
            <h3 className="font-semibold text-foreground mb-1">Kamino → IAM - GC</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Importar planilha do Kamino, conferir dados e resolver erros de importação.
            </p>
            {errosPendentesCount > 0 && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold border border-rose-300">
                {errosPendentesCount} erro{errosPendentesCount !== 1 ? 's' : ''}
              </span>
            )}
          </button>

          {/* IAM Control → GC */}
          <button
            onClick={() => { setFlow('iam-control-gc'); setTab('iam_pendentes'); }}
            className="group relative bg-card border-2 border-border hover:border-primary rounded-2xl p-6 text-left transition-all hover:shadow-lg"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="px-3 py-1.5 rounded-lg bg-fuchsia-100 text-fuchsia-800 font-bold text-lg">IAM</span>
              <ArrowRight size={24} className="text-primary" />
              <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold text-lg">GC</span>
            </div>
            <h3 className="font-semibold text-foreground mb-1">IAM Control → GC</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Contratos do IAM Control (conciliado, pendente link/pix, para conciliar). Aprovação obrigatória antes de entrar na dashboard.
            </p>
            {iamControlGcCount > 0 && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 text-[11px] font-bold border border-fuchsia-300">
                {iamControlGcCount} pendente{iamControlGcCount !== 1 ? 's' : ''}
              </span>
            )}
          </button>

          {/* Cancelamentos → GC */}
          <button
            onClick={() => { setFlow('cancelamentos-gc'); setTab('cancelamentos'); }}
            className="group relative bg-card border-2 border-border hover:border-primary rounded-2xl p-6 text-left transition-all hover:shadow-lg"
          >
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 font-bold text-lg">Cancelamentos</span>
              <ArrowRight size={24} className="text-primary" />
              <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold text-lg">GC</span>
            </div>
            <h3 className="font-semibold text-foreground mb-1">Cancelamentos → GC</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Cancelamentos finalizados e espelhos em andamento (inclui alunos fora da Kamino). Conciliação antes de atualizar a carteira.
            </p>
            {cancelamentosCount > 0 && (
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold border border-rose-300">
                {cancelamentosCount} pendente{cancelamentosCount !== 1 ? 's' : ''}
              </span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com voltar + indicador de fluxo */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFlow('menu')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted text-muted-foreground"
          >
            <ArrowLeft size={14} /> Voltar
          </button>
          <div className="flex items-center gap-2">
            {flow === 'gc-kamino' ? (
              <>
                <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-sm">GC</span>
                <ArrowRight size={16} className="text-muted-foreground" />
                <span className="px-2.5 py-1 rounded-md bg-muted text-foreground font-bold text-sm">Kamino</span>
              </>
            ) : flow === 'iam-control-gc' ? (
              <>
                <span className="px-2.5 py-1 rounded-md bg-fuchsia-100 text-fuchsia-800 font-bold text-sm">IAM Control</span>
                <ArrowRight size={16} className="text-muted-foreground" />
                <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-sm">GC</span>
              </>
            ) : flow === 'cancelamentos-gc' ? (
              <>
                <span className="px-2.5 py-1 rounded-md bg-rose-100 text-rose-700 font-bold text-sm">Cancelamentos</span>
                <ArrowRight size={16} className="text-muted-foreground" />
                <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-sm">GC</span>
              </>
            ) : (
              <>
                <span className="px-2.5 py-1 rounded-md bg-muted text-foreground font-bold text-sm">Kamino</span>
                <ArrowRight size={16} className="text-muted-foreground" />
                <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary font-bold text-sm">GC</span>
              </>
            )}
          </div>
        </div>
        {flow === 'kamino-gc' && (
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 shadow-sm"
          >
            <Upload size={14} />
            Importar planilha
          </button>
        )}
      </div>

      {/* Sub-tabs (contextuais ao fluxo) */}
      <div className="flex items-center gap-2 flex-wrap">
        {flow === 'iam-control-gc' ? (
          <>
            <button
              onClick={() => { setTab('iam_pendentes'); setTipoFilter('todos'); }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === 'iam_pendentes'
                  ? 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 shadow-sm'
                  : 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-100'
              }`}
            >
              <Cloud size={14} />
              Aguardando aprovação ({iamControlGcCount})
            </button>
            <button
              onClick={() => setTab('historico')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
                tab === 'historico'
                  ? 'bg-card text-foreground border-border shadow-sm'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <ScrollText size={14} />
              Histórico ({historicoCount})
            </button>
          </>
        ) : flow === 'cancelamentos-gc' ? (
          <>
            <button
              onClick={() => { setTab('cancelamentos'); setTipoFilter('todos'); }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === 'cancelamentos'
                  ? 'bg-rose-100 text-rose-700 border-rose-300 shadow-sm'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <Ban size={14} />
              Cancelamentos ({cancelamentosCount})
            </button>
            <button
              onClick={() => setTab('historico')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
                tab === 'historico'
                  ? 'bg-card text-foreground border-border shadow-sm'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <ScrollText size={14} />
              Histórico ({historicoCount})
            </button>
          </>
        ) : flow === 'gc-kamino' ? (
          <>
            <button
              onClick={() => { setTab('ajuste_financeiro'); setTipoFilter('todos'); }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === 'ajuste_financeiro'
                  ? 'bg-violet-100 text-violet-800 border-violet-300 shadow-sm'
                  : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
              }`}
            >
              <Wallet size={14} />
              Ajuste financeiro ({ajusteFinanceiroCount})
            </button>
            <button
              onClick={() => { setTab('renda_extra'); setTipoFilter('todos'); }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === 'renda_extra'
                  ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-sm'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <DollarSign size={14} />
              Renda Extra ({rendaExtraCount})
            </button>
            <button
              onClick={() => setTab('historico')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
                tab === 'historico'
                  ? 'bg-card text-foreground border-border shadow-sm'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <ScrollText size={14} />
              Histórico ({historicoCount})
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setTab('erros')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap ${
                tab === 'erros'
                  ? 'bg-rose-100 text-rose-700 border-rose-300 shadow-sm'
                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
              }`}
            >
              <AlertTriangle size={14} />
              Erros de Importação ({errosPendentesCount})
            </button>
            <button
              onClick={() => setTab('historico')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
                tab === 'historico'
                  ? 'bg-card text-foreground border-border shadow-sm'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70 hover:text-foreground'
              }`}
            >
              <ScrollText size={14} />
              Histórico ({historicoCount})
            </button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={tab === 'erros' ? 'Buscar aluno ou arquivo...' : 'Buscar aluno, AC ou resumo...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field w-full pl-9 text-xs py-2"
          />
        </div>
        {tab !== 'erros' && tab === 'historico' && (
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value as ConciliacaoGrupoFilter)}
            className="input-field text-xs py-2"
          >
            <option value="todos">Todos os tipos</option>
            <option value="cancelamentos">Cancelamentos</option>
            <option value="renda_extra">Renda Extra</option>
            <option value="ajuste_financeiro">Ajuste financeiro</option>
          </select>
        )}
        {tab === 'erros' && (
          <select
            value={erroStatusFilter}
            onChange={(e) => setErroStatusFilter(e.target.value as any)}
            className="input-field text-xs py-2"
          >
            <option value="pendente">Pendentes</option>
            <option value="resolvido">Resolvidos</option>
            <option value="ignorado">Ignorados</option>
            <option value="todos">Todos</option>
          </select>
        )}
      </div>

      {/* Listas */}
      {tab !== 'erros' ? (
        <div className="space-y-3">
          {((tab === 'ajuste_financeiro' || tab === 'cancelamentos' || tab === 'renda_extra' || tab === 'iam_pendentes') ? groupedPending.length === 0 : filtered.length === 0) ? (
            <div className="text-center py-12 border border-dashed border-border rounded-2xl">
              <FileSpreadsheet size={28} className="mx-auto text-muted-foreground mb-2 opacity-50" />
              <p className="text-sm text-muted-foreground">
                {tab === 'ajuste_financeiro' ? 'Nenhum ajuste financeiro pendente.'
                  : tab === 'cancelamentos' ? 'Nenhuma pendência de cancelamento ou reversão.'
                  : tab === 'renda_extra' ? 'Nenhuma pendência de Renda Extra.'
                  : tab === 'iam_pendentes' ? 'Nenhum contrato IAM aguardando aprovação.'
                  : 'Nenhum item conciliado ainda.'}
              </p>
            </div>
          ) : (tab === 'ajuste_financeiro' || tab === 'cancelamentos' || tab === 'renda_extra' || tab === 'iam_pendentes') ? (
            groupedPending.map((group) => {
              // Subtipos consolidados de TODAS as alterações do grupo
              const allChangedKeys = new Set<string>();
              for (const it of group.items) {
                for (const c of getAllChanges(it.antes, it.depois)) allChangedKeys.add(c.key);
              }
              const subTipos: string[] = [];
              if (allChangedKeys.has('totalParcelas') || allChangedKeys.has('totalInstallments') || allChangedKeys.has('novasParcelas')) subTipos.push('Quantidade de Parcelas');
              if (allChangedKeys.has('saleValue')) subTipos.push('Valor Total');
              if (allChangedKeys.has('valorParcela') || allChangedKeys.has('installmentValue') || allChangedKeys.has('valor')) subTipos.push('Valor da Parcela');
              if (allChangedKeys.has('vencimento') || allChangedKeys.has('dueDate') || allChangedKeys.has('dueDay')) subTipos.push('Vencimento');
              if (allChangedKeys.has('juros')) subTipos.push('Juros');
              if (allChangedKeys.has('multa')) subTipos.push('Multa');
              if (allChangedKeys.has('desconto')) subTipos.push('Desconto');
              if (allChangedKeys.has('downPayment') || allChangedKeys.has('entrada')) subTipos.push('Entrada');
              const tituloAlteracao = subTipos.length > 0 ? subTipos.join(' + ') : TIPO_LABEL[group.items[0].tipo];
              const st = group.studentId ? students.find((s) => s.id === group.studentId) : null;
              const jaConciliadoSistema = groupJaAplicadoNoSistema(group.items);
              const temObservacao = groupTemObservacao(group.items);
              const aprovarSoObs = jaConciliadoSistema && temObservacao;
              const isEspelhoCancel = groupBlocksEspelhoConciliacao(group.items, st ?? undefined, items);
              return (
                <div key={group.key} className="bg-card border border-border rounded-2xl p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Cabeçalho do aluno */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <UserIcon size={16} className="text-primary shrink-0" />
                        <h3 className="text-base font-bold text-foreground">{group.studentName}</h3>
                        {group.ac && <span className="text-[11px] text-muted-foreground">• AC: {group.ac}</span>}
                        {group.items.length > 1 && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {group.items.length} alterações
                          </span>
                        )}
                        {jaConciliadoSistema && (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200"
                            title="As alterações já estão aplicadas no aluno. Conciliar só confirma o double-check (não reaplica nem desfaz nada)."
                          >
                            Já conciliado
                          </span>
                        )}
                        {isEspelhoCancel && (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200"
                            title="Cancelamento ainda em andamento no funil — finalize na aba Cancelamentos antes de conciliar no GC"
                          >
                            Em andamento
                          </span>
                        )}
                      </div>

                      {/* Badge consolidada das alterações da sessão */}
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                          {tituloAlteracao}
                        </span>
                        {temObservacao && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            Com observação
                          </span>
                        )}
                      </div>

                      {/* Resumo do contrato (Total Contratado / Pago / Saldo / Parcelas em aberto) */}
                      {st && <ContractSummaryPanel student={st} conciliacaoItems={group.items} />}

                      {/* Diff CONSOLIDADO de todas as alterações do grupo */}
                      {renderGroupDiff(group.items, st, cancellationCases)}

                      {/* Termos assinados anexados ao caso de cancelamento */}
                      {(() => {
                        const caseIds = Array.from(new Set(
                          group.items
                            .filter((i) => i.tipo === 'cancelamento' && i.relatedCaseId)
                            .map((i) => i.relatedCaseId as string)
                        ));
                        if (!caseIds.length) return null;
                        const termos: { url: string; name: string }[] = [];
                        for (const cid of caseIds) {
                          const c = cancellationCases.find((x) => x.id === cid);
                          if (!c?.termAttachments) continue;
                          for (const t of c.termAttachments) {
                            if (t.type === 'termo_assinado' && !termos.some((x) => x.url === t.url)) {
                              termos.push({ url: t.url, name: t.name });
                            }
                          }
                        }
                        if (!termos.length) return null;
                        return (
                          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <FileText size={11} className="text-sky-700" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-800">
                                Termo{termos.length > 1 ? 's' : ''} de cancelamento anexado{termos.length > 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {termos.map((t, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await openCancellationPdf(t.url, t.name);
                                    } catch (err) {
                                      const msg = err instanceof Error ? err.message : 'Não foi possível abrir o termo';
                                      toast.error(msg);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-sky-200 hover:bg-sky-100 transition-colors text-[11px] font-medium text-sky-800"
                                  title="Abrir PDF do termo assinado"
                                >
                                  <FileText size={11} />
                                  <span className="max-w-[220px] truncate">{t.name}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Observações deixadas pelo autor (uma por item, deduplica) */}
                      {(() => {
                        const obs = Array.from(new Set(
                          group.items.map((i) => i.autorObservacao?.trim()).filter((s): s is string => !!s)
                        ));
                        if (!obs.length) return null;
                        return (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <ScrollText size={11} className="text-amber-700" />
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                                Observação do autor
                              </span>
                            </div>
                            {obs.map((o, idx) => (
                              <p key={idx} className="text-[12px] leading-relaxed text-amber-900 whitespace-pre-wrap">
                                {o}
                              </p>
                            ))}
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><UserIcon size={11} />Por {group.autorNome ?? '—'}</span>
                        <span className="inline-flex items-center gap-1"><Calendar size={11} />{formatDateTime(group.createdAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col gap-2 w-[150px]">
                      {(() => {
                        const isAprovado = group.items[0].status === 'aprovado';
                        return (
                          <>
                            {canConciliarEdit && !isEspelhoCancel ? (
                            <button
                              onClick={() => handleConciliarGrupo(group)}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
                              title={
                                aprovarSoObs
                                  ? 'Aprovar a observação sem reaplicar ou desfazer alterações (já estão no sistema)'
                                  : jaConciliadoSistema
                                    ? 'Confirmar conciliação — alterações já estão no sistema; nada será reaplicado'
                                    : isAprovado
                                      ? 'Executar as alterações no sistema e mover para o histórico'
                                      : 'Executar e mover para o histórico'
                              }
                            >
                              <CheckCircle2 size={14} />
                              {aprovarSoObs
                                ? 'Aprovar observação'
                                : jaConciliadoSistema
                                  ? `Confirmar${group.items.length > 1 ? ` (${group.items.length})` : ''}`
                                  : `Conciliar${group.items.length > 1 ? ` (${group.items.length})` : ''}`}
                            </button>
                            ) : isEspelhoCancel ? (
                              <p className="text-[10px] text-center text-rose-700 px-1 leading-tight">
                                Finalize o cancelamento na aba Cancelamentos
                              </p>
                            ) : (
                              <p className="text-[10px] text-center text-muted-foreground px-1 leading-tight">
                                Somente Admin ou Conciliação pode aprovar
                              </p>
                            )}
                            {!isAprovado && !aprovarSoObs && canConciliarEdit && !isEspelhoCancel && (
                              <button
                                onClick={() => handleAprovarGrupo(group)}
                                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-sky-200 text-sky-700 text-xs font-semibold hover:bg-sky-50 transition-colors"
                                title="Aprovar sem executar — vai para a aba Aprovados aguardando conciliação"
                              >
                                <ThumbsUp size={14} /> Aprovar{group.items.length > 1 ? ` (${group.items.length})` : ''}
                              </button>
                            )}
                            {aprovarSoObs && !isAprovado && (
                              <p className="text-[10px] text-emerald-800/90 text-center leading-tight px-0.5">
                                Só confirma a obs. — não desfaz nada
                              </p>
                            )}
                            <button
                              onClick={() => openReprovar(group)}
                              disabled={!canConciliarEdit}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-card border border-rose-200 text-rose-600 text-xs font-semibold hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Reprovar e reverter as alterações"
                            >
                              <Ban size={14} /> Reprovar{group.items.length > 1 ? ` (${group.items.length})` : ''}
                            </button>
                            {isAprovado && group.items[0].aprovadoPorNome && (
                              <div className="text-[10px] text-sky-700 text-center px-1 leading-tight">
                                <div>Aprovado por {group.items[0].aprovadoPorNome}</div>
                                {group.items[0].aprovadoAt && (
                                  <div className="text-[10px] text-sky-600/80 mt-0.5">
                                    {formatDateTime(group.items[0].aprovadoAt)}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {(st || isAdmin) && <div className="h-px bg-border my-1" />}
                      {st && (
                        <>
                          <button
                            onClick={() => setFinancialStudent(st)}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-[11px] font-medium transition-colors"
                            title="Ver fluxo de pagamento"
                          >
                            <Wallet size={13} className="text-muted-foreground" /> Fluxo Pgto
                          </button>
                          <button
                            onClick={() => setHistoryStudent(st)}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-[11px] font-medium transition-colors"
                            title="Ver histórico do aluno"
                          >
                            <HistoryIcon size={13} className="text-muted-foreground" /> Histórico
                          </button>
                        </>
                      )}
                      {isAdmin && (
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: group.items.length > 1 ? `Excluir ${group.items.length} registros` : 'Excluir registro de conciliação',
                              description: `${group.studentName}\n${group.items.map((i) => `• ${i.resumo}`).join('\n')}`,
                              variant: 'destructive',
                              confirmText: 'Excluir',
                            });
                            if (!ok) return;
                            for (const it of group.items) remove(it.id);
                          }}
                          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 text-[11px] font-medium transition-colors"
                          title="Excluir registros (admin)"
                        >
                          <Trash2 size={13} /> Excluir
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            filtered.map((item) => {
              const changes = getAllChanges(item.antes, item.depois);
              // Deriva sub-tipos a partir das chaves alteradas para badge composto
              const changedKeys = new Set(changes.map((c) => c.key));
              const subTipos: string[] = [];
              if (changedKeys.has('totalParcelas') || changedKeys.has('totalInstallments') || changedKeys.has('novasParcelas')) {
                subTipos.push('Quantidade de Parcelas');
              }
              if (changedKeys.has('saleValue')) subTipos.push('Valor Total');
              if (changedKeys.has('valorParcela') || changedKeys.has('installmentValue')) subTipos.push('Valor da Parcela');
              if (changedKeys.has('vencimento') || changedKeys.has('dueDate') || changedKeys.has('dueDay')) {
                subTipos.push('Vencimento');
              }
              if (changedKeys.has('juros')) subTipos.push('Juros');
              if (changedKeys.has('multa')) subTipos.push('Multa');
              if (changedKeys.has('desconto')) subTipos.push('Desconto');
              if (changedKeys.has('downPayment') || changedKeys.has('entrada')) subTipos.push('Entrada');
              const tituloAlteracao = subTipos.length > 0 ? subTipos.join(' + ') : TIPO_LABEL[item.tipo];
              return (
              <div key={item.id} className="bg-card border border-border rounded-2xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Nome do aluno em destaque no topo */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <UserIcon size={16} className="text-primary shrink-0" />
                      <h3 className="text-base font-bold text-foreground">{item.studentName}</h3>
                      {item.ac && <span className="text-[11px] text-muted-foreground">• AC: {item.ac}</span>}
                    </div>

                    {/* Badge da alteração principal (composta) + resumo */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${TIPO_COLOR[item.tipo]}`}>
                        {tituloAlteracao}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 mb-3">{item.resumo}</p>

                    {/* Resumo do contrato (Total Contratado / Pago / Saldo / Parcelas em aberto) */}
                    {(() => {
                      const st = item.studentId ? students.find((s) => s.id === item.studentId) : null;
                      return st ? <ContractSummaryPanel student={st} conciliacaoItems={[item]} /> : null;
                    })()}

                    {/* Tabela detalhada Campo | Antes | Depois */}
                    {renderDiff(item.antes, item.depois)}

                    {/* Observação do autor (se houver) */}
                    {item.autorObservacao?.trim() && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ScrollText size={11} className="text-amber-700" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                            Observação do autor
                          </span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-amber-900 whitespace-pre-wrap">
                          {item.autorObservacao}
                        </p>
                      </div>
                    )}

                    {/* Comprovantes anexados (ex.: enviados pelo AC via Histórico do aluno) */}
                    {(() => {
                      const atts = (item.depois as Record<string, unknown>)?._attachments as CaseNoteAttachment[] | undefined;
                      if (!Array.isArray(atts) || atts.length === 0) return null;
                      return (
                        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <FileText size={11} className="text-blue-700" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-800">
                              Comprovantes anexados
                            </span>
                          </div>
                          <ul className="flex flex-wrap gap-1.5">
                            {atts.map((a) => (
                              <li key={a.url}>
                                <button
                                  type="button"
                                  onClick={() => openConcAttachment(a)}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-blue-300 bg-card hover:bg-blue-100 transition-colors"
                                  title={`${a.name} (${formatAttachBytes(a.size)})`}
                                >
                                  <Eye size={10} />
                                  <span className="max-w-[180px] truncate">{a.name}</span>
                                  <span className="text-muted-foreground">· {formatAttachBytes(a.size)}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}


                    <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><UserIcon size={11} />Por {item.autorNome ?? '—'}</span>
                      <span className="inline-flex items-center gap-1"><Calendar size={11} />{formatDateTime(item.createdAt)}</span>
                      {item.status === 'conciliado' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 size={11} />
                          Conciliado por {item.conciliadoPorNome ?? '—'} em {formatDateTime(item.conciliadoAt)}
                        </span>
                      )}
                      {item.status === 'reprovado' && (
                        <span className="inline-flex items-center gap-1 text-rose-700">
                          <Ban size={11} />
                          Reprovado por {item.reprovadoPorNome ?? '—'} em {formatDateTime(item.reprovadoAt)}
                          {item.reprovadoMotivo ? ` — ${item.reprovadoMotivo}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1 w-[140px]">
                    {item.studentId && (() => {
                      const st = students.find((s) => s.id === item.studentId);
                      if (!st) return null;
                      return (
                        <>
                          <button
                            onClick={() => setFinancialStudent(st)}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-[11px] font-medium transition-colors"
                            title="Ver fluxo de pagamento"
                          >
                            <Wallet size={13} /> Fluxo Pgto
                          </button>
                          <button
                            onClick={() => setHistoryStudent(st)}
                            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-[11px] font-medium transition-colors"
                            title="Ver histórico do aluno"
                          >
                            <HistoryIcon size={13} /> Histórico
                          </button>
                        </>
                      );
                    })()}
                    {isAdmin && (
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Excluir registro de conciliação',
                            description: `${item.studentName}\n${item.resumo}`,
                            variant: 'destructive',
                            confirmText: 'Excluir',
                          });
                          if (!ok) return;
                          remove(item.id);
                        }}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 text-[11px] font-medium transition-colors"
                        title="Excluir registro (admin)"
                      >
                        <Trash2 size={13} /> Excluir
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Barra de ações em lote */}
          {filteredErrors.length > 0 && erroStatusFilter === 'pendente' && (() => {
            const conciliaveis = filteredErrors.filter((e) => !QUICK_RESOLVE_BLOCKED.includes(e.motivo));
            const ignoraveis = filteredErrors;
            return (
              <div className="flex items-center justify-between gap-3 bg-muted/30 border border-border rounded-2xl px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{filteredErrors.length}</strong> erro{filteredErrors.length !== 1 ? 's' : ''} pendente{filteredErrors.length !== 1 ? 's' : ''}
                  {conciliaveis.length !== filteredErrors.length && (
                    <> · <strong className="text-foreground">{conciliaveis.length}</strong> auto-conciliáveis</>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={bulkBusy || conciliaveis.length === 0}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Conciliar ${conciliaveis.length} erro${conciliaveis.length !== 1 ? 's' : ''}`,
                        description: 'Cada linha será baixada usando o valor pago da planilha (ou o valor editado, se houver). Esta ação não pode ser desfeita em lote.',
                        confirmText: 'Conciliar tudo',
                      });
                      if (!ok) return;
                      setBulkBusy(true);
                      let sucesso = 0;
                      let falha = 0;
                      for (const e of conciliaveis) {
                        const override = rowEdits[e.id];
                        setRowBusy((s) => ({ ...s, [e.id]: true }));
                        const res = await quickResolveImportError(e, override ?? {});
                        setRowBusy((s) => { const n = { ...s }; delete n[e.id]; return n; });
                        if (res.ok) {
                          resolverImportError(e.id, res.nota);
                          sucesso++;
                        } else {
                          falha++;
                          console.warn('Falha ao conciliar erro', e.id, res.error);
                        }
                      }
                      setBulkBusy(false);
                      setRowEdits({});
                      if (sucesso > 0) toast.success(`${sucesso} erro${sucesso !== 1 ? 's' : ''} conciliado${sucesso !== 1 ? 's' : ''}.`);
                      if (falha > 0) toast.error(`${falha} erro${falha !== 1 ? 's' : ''} não pôde ser conciliado automaticamente. Use "Resolver".`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                  >
                    {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Conciliar tudo ({conciliaveis.length})
                  </button>
                  <button
                    disabled={bulkBusy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Ignorar ${ignoraveis.length} erro${ignoraveis.length !== 1 ? 's' : ''}`,
                        description: 'Os erros ficarão marcados como ignorados sem qualquer baixa.',
                        confirmText: 'Ignorar tudo',
                      });
                      if (!ok) return;
                      ignoraveis.forEach((e) => ignorarImportError(e.id));
                      toast.message(`${ignoraveis.length} erro${ignoraveis.length !== 1 ? 's' : ''} ignorado${ignoraveis.length !== 1 ? 's' : ''}.`);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <XCircle size={13} /> Ignorar tudo
                  </button>
                </div>
              </div>
            );
          })()}

          {filteredErrors.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-2xl">
              <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2 opacity-70" />
              <p className="text-sm text-muted-foreground">Nenhum erro de importação {erroStatusFilter !== 'todos' ? `(${erroStatusFilter})` : ''}.</p>
            </div>
          ) : (
            filteredErrors.map((err) => {
              const norm = (s: string) =>
                (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
              const matchedStudent =
                (err.studentId ? students.find((s) => s.id === err.studentId) : undefined) ??
                students.find((s) => norm(s.name) === norm(err.studentName));
              const acName = matchedStudent?.ac?.trim();
              const isEditing = !!rowEdits[err.id];
              const edit = rowEdits[err.id];
              const busy = !!rowBusy[err.id];
              const blocked = QUICK_RESOLVE_BLOCKED.includes(err.motivo);
              const startEdit = () => setRowEdits((s) => ({
                ...s,
                [err.id]: {
                  valor: edit?.valor ?? err.valor ?? 0,
                  dataPagamento: edit?.dataPagamento ?? err.dataPagamento ?? new Date().toISOString().split('T')[0],
                },
              }));
              const cancelEdit = () => setRowEdits((s) => { const n = { ...s }; delete n[err.id]; return n; });
              const conciliar = async (override?: { valor: number; dataPagamento: string }) => {
                setRowBusy((s) => ({ ...s, [err.id]: true }));
                const res = await quickResolveImportError(err, override ?? {});
                setRowBusy((s) => { const n = { ...s }; delete n[err.id]; return n; });
                if (res.ok) {
                  resolverImportError(err.id, res.nota);
                  cancelEdit();
                  toast.success(res.nota ?? 'Erro conciliado.');
                } else {
                  toast.error(res.error ?? 'Falha ao conciliar.');
                }
              };
              return (
              <div key={err.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        {MOTIVO_LABEL[err.motivo]}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{err.studentName}</span>
                      {acName && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          <UserIcon size={10} /> AC: {acName}
                        </span>
                      )}
                      {err.status !== 'pendente' && (
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          err.status === 'resolvido' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {err.status}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-muted/30 rounded-xl p-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vencimento</p>
                        <p className="font-medium">{formatDate(err.vencimento)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor pago</p>
                        {isEditing ? (
                          <CurrencyInput
                            value={edit.valor}
                            onChange={(v) => setRowEdits((s) => ({ ...s, [err.id]: { ...s[err.id], valor: v } }))}
                            className="input-field text-xs py-1 px-2 h-7 mt-0.5"
                          />
                        ) : (
                          <p className="font-medium">{formatCurrency(err.valor)}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pagamento</p>
                        {isEditing ? (
                          <input
                            type="date"
                            value={edit.dataPagamento}
                            onChange={(e) => setRowEdits((s) => ({ ...s, [err.id]: { ...s[err.id], dataPagamento: e.target.value } }))}
                            className="input-field text-xs py-1 px-2 h-7 mt-0.5"
                          />
                        ) : (
                          <p className="font-medium">{formatDate(err.dataPagamento)}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Linha</p>
                        <p className="font-medium">#{err.rowIndex ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><FileSpreadsheet size={11} />{err.fileName ?? '—'}</span>
                      <span className="inline-flex items-center gap-1"><Calendar size={11} />{formatDateTime(err.createdAt)}</span>
                      {err.resolvidoAt && (
                        <span className="inline-flex items-center gap-1">
                          <UserIcon size={11} />
                          {err.status === 'resolvido' ? 'Resolvido' : 'Ignorado'} por {err.resolvidoPorNome ?? '—'} em {formatDateTime(err.resolvidoAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1.5 min-w-[150px]">
                    {(() => {
                      let st = err.studentId ? students.find((s) => s.id === err.studentId) : undefined;
                      if (!st) {
                        const matches = students.filter((s) => norm(s.name) === norm(err.studentName));
                        const sorted = matches.slice().sort((a, b) => {
                          const aHasVenc = err.vencimento ? a.installments.some((i) => i.dueDate === err.vencimento) : false;
                          const bHasVenc = err.vencimento ? b.installments.some((i) => i.dueDate === err.vencimento) : false;
                          if (aHasVenc !== bHasVenc) return aHasVenc ? -1 : 1;
                          if (!!a.isRendaExtra !== !!b.isRendaExtra) return a.isRendaExtra ? 1 : -1;
                          const ai = a.installments?.length ?? 0;
                          const bi = b.installments?.length ?? 0;
                          if (ai !== bi) return bi - ai;
                          return (b.saleValue ?? 0) - (a.saleValue ?? 0);
                        });
                        st = sorted[0];
                      }
                      if (!st) return null;
                      return (
                        <button
                          onClick={() => setFinancialStudent(st)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-[11px] font-medium hover:bg-muted transition-colors"
                          title="Ver fluxo de pagamento"
                        >
                          <Wallet size={12} className="text-primary" /> Fluxo Pgto
                        </button>
                      );
                    })()}
                    {err.status === 'pendente' && (
                      <>
                        {isEditing ? (
                          <div className="flex gap-1.5">
                            <button
                              disabled={busy || !edit.valor || edit.valor <= 0 || !edit.dataPagamento}
                              onClick={() => conciliar({ valor: edit.valor, dataPagamento: edit.dataPagamento })}
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                              title="Confirmar edição e conciliar"
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                            </button>
                            <button
                              disabled={busy}
                              onClick={cancelEdit}
                              className="inline-flex items-center justify-center px-2 py-1.5 rounded-lg border border-border text-[11px] hover:bg-muted disabled:opacity-50"
                              title="Cancelar edição"
                            >
                              <XIcon size={12} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              disabled={busy || blocked}
                              onClick={() => conciliar()}
                              title={blocked ? 'Este motivo exige resolução manual — use "Resolver".' : 'Conciliar usando o valor pago da planilha'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Conciliar
                            </button>
                            <button
                              disabled={busy || blocked}
                              onClick={startEdit}
                              title={blocked ? 'Não editável — use "Resolver".' : 'Editar valor / data antes de conciliar'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Pencil size={12} /> Editar
                            </button>
                            <button
                              onClick={() => setResolveError(err)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium hover:bg-muted text-muted-foreground"
                              title="Abrir resolução avançada (escolher aluno/parcela)"
                            >
                              <Settings2 size={12} /> Resolver
                            </button>
                          </>
                        )}
                        <button
                          disabled={busy}
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Ignorar erro',
                              description: 'Deseja ignorar este erro de importação?',
                              confirmText: 'Ignorar',
                            });
                            if (!ok) return;
                            ignorarImportError(err.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[11px] font-medium hover:bg-muted text-muted-foreground disabled:opacity-50"
                        >
                          <XCircle size={12} /> Ignorar
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <button
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Excluir erro de importação',
                            description: err.studentName,
                            variant: 'destructive',
                            confirmText: 'Excluir',
                          });
                          if (!ok) return;
                          removeImportError(err.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-[11px] font-medium hover:bg-rose-50"
                        title="Excluir registro (admin)"
                      >
                        <Trash2 size={12} /> Excluir
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })

          )}
        </div>
      )}


      {/* Modais */}
      <ImportConciliacaoModal isOpen={showImport} onClose={() => setShowImport(false)} />

      {resolveError && (
        <ResolveErrorModal
          err={resolveError}
          onClose={() => setResolveError(null)}
          onResolved={(nota) => {
            // Marca o erro como resolvido (no banco e store)
            resolverImportError(resolveError.id, nota);
            setResolveError(null);
          }}
        />
      )}

      {financialStudent && (
        <FinancialModal student={financialStudent} onClose={() => setFinancialStudent(null)} />
      )}

      {historyStudent && (
        <HistoryModal student={historyStudent} onClose={() => setHistoryStudent(null)} />
      )}

      {/* ─── Modal: Reprovar Conciliação ──────────────────────────────────── */}
      {reprovarGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !reprovarLoading && setReprovarGroup(null)}
        >
          <div
            className="bg-card border border-rose-200 rounded-2xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center">
                <Ban size={18} className="text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Reprovar conciliação</h3>
                <p className="text-[11px] text-muted-foreground">
                  {reprovarGroup.studentName} • {reprovarGroup.items.length} alteração{reprovarGroup.items.length > 1 ? 'ões' : ''}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-3 mb-3 max-h-32 overflow-auto">
              <ul className="text-[11px] text-foreground/80 space-y-1">
                {reprovarGroup.items.map((i) => (
                  <li key={i.id}>• {i.resumo}</li>
                ))}
              </ul>
            </div>

            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-3">
              ⚠ Os ajustes serão revertidos ao estado anterior e o autor será notificado.
              Em alguns casos a reversão é parcial — confira o histórico do aluno após.
            </p>

            <label className="block text-xs font-semibold text-foreground mb-1">
              Motivo da reprovação <span className="text-rose-600">*</span>
            </label>
            <textarea
              autoFocus
              value={reprovarMotivo}
              onChange={(e) => setReprovarMotivo(e.target.value)}
              placeholder="Ex.: Valor não bate com o extrato bancário."
              className="w-full min-h-[80px] rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
            />

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setReprovarGroup(null)}
                disabled={reprovarLoading}
                className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmReprovar}
                disabled={reprovarLoading || !reprovarMotivo.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
              >
                {reprovarLoading ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                Reprovar e devolver ao cancelamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de Conciliação para casos de Cancelamento */}
      {cancelConfirm && (() => {
        const ck = cancelConfirm.caseRef.finalChecklist ?? {};
        const termos = (cancelConfirm.caseRef.termAttachments ?? []).filter((t) => t.type === 'termo_assinado');
        const openStorage = async (path: string, fileName?: string) => {
          if (!path) return;
          try {
            await openCancellationPdf(path, fileName);
          } catch (err: any) {
            toast.error(err?.message ?? 'Não foi possível abrir o termo');
          }
        };
        const yn = (v?: boolean) => v === true ? 'Sim' : v === false ? 'Não' : '—';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg saas-shadow-md max-h-[92vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <CheckCircle2 size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Confirmar Conciliação — Cancelamento</h2>
                  <p className="text-[11px] text-muted-foreground">{cancelConfirm.caseRef.studentName}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-1.5 mb-4">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Checklist preenchido pelo Jurídico</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-muted-foreground">Cancelamento de boleto:</div><div className="font-semibold text-foreground">{yn(ck.cancelamentoBoleto)}</div>
                  <div className="text-muted-foreground">Cancelamento de bônus:</div><div className="font-semibold text-foreground">{yn(ck.cancelamentoBonus)}</div>
                  <div className="text-muted-foreground">Retirou aluno da turma:</div><div className="font-semibold text-foreground">{yn(ck.retirarAlunoTurma)}</div>
                  <div className="text-muted-foreground">Multa recebida:</div><div className="font-semibold text-foreground">{yn(ck.multaRecebida)}</div>
                  <div className="text-muted-foreground">Estorno:</div><div className="font-semibold text-foreground">{yn(ck.fazerEstorno)}</div>
                  <div className="text-muted-foreground">Negativar aluno:</div><div className="font-semibold text-foreground">{yn(ck.negativarAluno)}{ck.negativarAluno && ck.negativarValor ? ` — ${formatCurrency(ck.negativarValor)}` : ''}</div>
                  <div className="text-muted-foreground">Liberar treinamento online:</div><div className="font-semibold text-foreground">{yn(ck.liberarTreinamentoOnline)}</div>
                  <div className="text-muted-foreground">Termo anexado:</div>
                  <div className="font-semibold text-foreground">{(ck.termoUrl || termos.length > 0) ? 'Sim' : '—'}</div>
                </div>
                {ck.preenchidoPorNome && (
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/60 mt-2">
                    Preenchido por {ck.preenchidoPorNome}{ck.preenchidoAt ? ` — ${new Date(ck.preenchidoAt).toLocaleString('pt-BR')}` : ''}
                  </p>
                )}
              </div>

              {/* Termo de cancelamento — visualização */}
              {(termos.length > 0 || ck.termoUrl) && (
                <div className="rounded-xl border border-border bg-primary/5 p-4 mb-4">
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <FileText size={12} /> Termo de cancelamento
                  </h3>
                  <div className="space-y-1.5">
                    {termos.map((t, i) => (
                      <button
                        key={`ta-${i}`}
                        type="button"
                        onClick={() => openStorage(t.url, t.name)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:bg-muted transition-colors text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-primary shrink-0" />
                          <span className="text-xs font-medium text-foreground truncate">{t.name}</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary shrink-0">
                          <Eye size={12} /> Visualizar
                        </span>
                      </button>
                    ))}
                    {ck.termoUrl && !termos.some((t) => t.url === ck.termoUrl) && (
                      <button
                        type="button"
                        onClick={() => openStorage(ck.termoUrl!, 'termo-assinado.pdf')}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:bg-muted transition-colors text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={14} className="text-primary shrink-0" />
                          <span className="text-xs font-medium text-foreground truncate">Termo assinado</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary shrink-0">
                          <Eye size={12} /> Visualizar
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="mb-5">
                <label className="block text-xs font-semibold text-foreground mb-2">
                  Você cancelou os boletos? <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  {[
                    { v: true, label: 'Sim', cls: 'bg-emerald-500 border-emerald-500' },
                    { v: false, label: 'Não', cls: 'bg-rose-500 border-rose-500' },
                  ].map((o) => (
                    <button
                      key={String(o.v)}
                      type="button"
                      onClick={() => setCancelConfirmBoletos(o.v)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                        cancelConfirmBoletos === o.v ? `${o.cls} text-white` : 'bg-card text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (cancelConfirmBoletos === null) return;
                    const now = new Date().toISOString();
                    updateCancellationCase(cancelConfirm.caseRef.id, {
                      finalChecklist: {
                        ...(cancelConfirm.caseRef.finalChecklist ?? {}),
                        conciliadoBoletos: cancelConfirmBoletos,
                        conciliadoPorId: currentUser?.id,
                        conciliadoPorNome: currentUser?.name,
                        conciliadoAt: now,
                      },
                    });
                    const group = cancelConfirm.group;
                    setCancelConfirm(null);
                    setCancelConfirmBoletos(null);
                    await executeConciliarGrupo(group);
                  }}
                  disabled={cancelConfirmBoletos === null}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white shadow-md hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  Confirmar Conciliação
                </button>
                <button
                  onClick={() => { setCancelConfirm(null); setCancelConfirmBoletos(null); }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Modal: Resolver Erro de Importação ─────────────────────────────────────
// Permite escolher entre baixar com o valor da parcela registrada ou com o
// valor pago da planilha. Ambos são editáveis. Após confirmar, atualiza a
// parcela do aluno (paid + paidDate), grava entrada no histórico do aluno e
// registra a baixa no histórico de Conciliação (baixa_kamino).
function ResolveErrorModal({
  err,
  onClose,
  onResolved,
}: {
  err: ConciliacaoImportError;
  onClose: () => void;
  onResolved: (nota: string) => void;
}) {
  const students = useAppStore((s) => s.students);
  const currentUser = useAppStore((s) => s.currentUser);

  // Resolve o aluno (por id ou por nome, igual ao matching da importação).
  const norm = (s: string) =>
    (s ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const candidatos: Student[] = useMemo(() => {
    // Sempre considera TODOS os homônimos pelo nome — assim o operador pode
    // trocar o aluno caso o vínculo automático tenha apontado para a pessoa
    // errada (ex: aluno antigo já totalmente baixado).
    const byName = students.filter((s) => norm(s.name) === norm(err.studentName));
    const all = byName.slice();
    // Se o erro veio com studentId, garante que ele apareça primeiro.
    const byId = err.studentId ? students.find((s) => s.id === err.studentId) : undefined;
    if (byId && !all.some((s) => s.id === byId.id)) all.unshift(byId);
    // Prioriza: (1) tem parcela com o vencimento da planilha, (2) tem ALGUMA
    // parcela em aberto, (3) NÃO Renda Extra, (4) maior nº de parcelas,
    // (5) maior valor de contrato.
    return all.sort((a, b) => {
      if (byId) {
        if (a.id === byId.id) return -1;
        if (b.id === byId.id) return 1;
      }
      const aHasVenc = err.vencimento ? a.installments.some((i) => i.dueDate === err.vencimento) : false;
      const bHasVenc = err.vencimento ? b.installments.some((i) => i.dueDate === err.vencimento) : false;
      if (aHasVenc !== bHasVenc) return aHasVenc ? -1 : 1;
      const aOpen = a.installments.some((i) => !i.paid);
      const bOpen = b.installments.some((i) => !i.paid);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      if (!!a.isRendaExtra !== !!b.isRendaExtra) return a.isRendaExtra ? 1 : -1;
      const ai = a.installments?.length ?? 0;
      const bi = b.installments?.length ?? 0;
      if (ai !== bi) return bi - ai;
      return (b.saleValue ?? 0) - (a.saleValue ?? 0);
    });
  }, [students, err]);

  const [studentId, setStudentId] = useState<string>(candidatos[0]?.id ?? '');
  // Se o studentId atual não está mais na lista de candidatos (caso o store
  // ainda estivesse carregando no primeiro render), corrige para o primeiro
  // candidato válido. Sem isso o modal renderiza o form mas sem aluno válido.
  useEffect(() => {
    if (candidatos.length === 0) return;
    if (!candidatos.some((c) => c.id === studentId)) {
      setStudentId(candidatos[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidatos]);
  const student = students.find((s) => s.id === studentId);

  // Tenta achar a parcela pelo vencimento (não paga). Se não achar, deixa o
  // operador escolher.
  const matchByVenc = student?.installments.find(
    (i) => !i.paid && err.vencimento && i.dueDate === err.vencimento,
  );
  const [installmentNumber, setInstallmentNumber] = useState<number | null>(
    matchByVenc?.number ?? student?.installments.find((i) => !i.paid)?.number ?? null,
  );
  const installment = student?.installments.find((i) => i.number === installmentNumber);
  const pendingInstallments = useMemo(
    () => [...(student?.installments ?? [])]
      .filter((i) => !i.paid)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number),
    [student?.installments],
  );
  // Fallback: se o aluno não tem nenhuma parcela em aberto, mostramos TODAS
  // (paid + pending) para o operador poder sobrescrever uma já baixada caso
  // tenha sido baixada errada. O footer já avisa "irá sobrescrever".
  const installmentOptions = useMemo(
    () => (pendingInstallments.length > 0
      ? pendingInstallments
      : [...(student?.installments ?? [])].sort(
          (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number,
        )),
    [pendingInstallments, student?.installments],
  );

  // Edição da PARCELA em si (valor + vencimento). Permite ajustar a parcela
  // antes de baixar — ex: corrigir um valor errado no cadastro ou um
  // vencimento que ficou diferente do que foi cobrado.
  const [parcelaValorEditado, setParcelaValorEditado] = useState<number>(installment?.value ?? 0);
  const [parcelaVencimentoEditado, setParcelaVencimentoEditado] = useState<string>(installment?.dueDate ?? '');

  // Modo de baixa: 'parcela' (valor da parcela editado) ou 'pago' (valor da planilha).
  const valorParcelaPadrao = parcelaValorEditado;
  const valorPagoPadrao = err.valor ?? (installment?.value ?? 0);
  const [modo, setModo] = useState<'parcela' | 'pago'>('parcela');
  const [valorEditado, setValorEditado] = useState<number>(installment?.value ?? 0);
  const [dataPagamento, setDataPagamento] = useState<string>(
    err.dataPagamento ?? new Date().toISOString().split('T')[0],
  );
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  // Sincroniza valor padrão quando muda parcela ou modo.
  const onModoChange = (m: 'parcela' | 'pago') => {
    setModo(m);
    setValorEditado(m === 'parcela' ? parcelaValorEditado : valorPagoPadrao);
  };

  // Garante que estados reflitam a parcela escolhida assim que o
  // aluno/parcela for carregado.
  useEffect(() => {
    if (!installment) return;
    setParcelaValorEditado(installment.value);
    setParcelaVencimentoEditado(installment.dueDate);
    setValorEditado(modo === 'parcela' ? installment.value : (err.valor ?? installment.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installment?.number, student?.id]);

  // Se o usuário editar o valor da parcela e o modo for 'parcela',
  // sincroniza o valor da baixa.
  useEffect(() => {
    if (modo === 'parcela') setValorEditado(parcelaValorEditado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelaValorEditado]);

  // Auto-seleciona uma parcela quando o aluno carrega (caso o match inicial falhe).
  useEffect(() => {
    if (!student) return;
    if (installmentNumber != null && installmentOptions.some((i) => i.number === installmentNumber)) return;
    const byVenc = err.vencimento
      ? installmentOptions.find((i) => i.dueDate === err.vencimento)
      : undefined;
    const fallback = byVenc ?? installmentOptions[0] ?? null;
    setInstallmentNumber(fallback?.number ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, installmentOptions]);

  const fmtBRL = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  const fmtDate = (s: string) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };

  const podeConfirmar =
    !!student && !!installment && valorEditado > 0 && !!dataPagamento;

  const handleConfirm = async () => {
    if (!podeConfirmar || !student || !installment) return;

    setSaving(true);
    try {
      // 1. Atualiza a parcela (valor + paid + paidDate)
      const updatedInstallments: Installment[] = student.installments.map((i) =>
        i.number === installment.number
          ? { ...i, value: valorEditado, dueDate: parcelaVencimentoEditado || i.dueDate, paid: true, paidDate: dataPagamento }
          : i,
      );
      const totalPagas = updatedInstallments.filter((i) => i.paid).length;
      const restantes = updatedInstallments.length - totalPagas;
      const historyEntry = {
        date: new Date().toISOString(),
        type: 'Sistema' as const,
        text:
          `Baixa via Conciliação (resolução de erro Kamino) — Parcela ${installment.number}: ` +
          `${fmtBRL(valorEditado)} pago em ${fmtDate(dataPagamento)}` +
          `${modo === 'pago' && Math.abs(valorEditado - valorParcelaPadrao) > 0.001
            ? ` (valor da parcela ajustado de ${fmtBRL(valorParcelaPadrao)} para ${fmtBRL(valorEditado)})`
            : ''}. ` +
          `${totalPagas}/${updatedInstallments.length} pagas (faltam ${restantes}).`,
      };

      // Optimistic update no store
      useAppStore.setState((s) => ({
        students: s.students.map((st) =>
          st.id === student.id
            ? {
                ...st,
                installments: updatedInstallments,
                paidInstallments: totalPagas,
                history: [...(st.history ?? []), historyEntry],
              }
            : st,
        ),
      }));

      // Persiste no banco
      await updateStudentDb(student.id, {
        installments: updatedInstallments,
        paidInstallments: totalPagas,
        history: [...(student.history ?? []), historyEntry],
      });

      // 2. Registra a baixa no histórico de Conciliação (baixa_kamino)
      const nowIso = new Date().toISOString();
      try {
        const created = await createConciliacaoItemDb({
          tipo: 'baixa_kamino',
          studentId: student.id,
          studentName: student.name,
          ac: student.ac,
          resumo:
            `Parcela ${installment.number} (venc. ${fmtDate(installment.dueDate)} • ${fmtBRL(valorEditado)}) ` +
            `baixada via resolução de erro Kamino em ${fmtDate(dataPagamento)}.`,
          antes: {
            paid: false,
            paidDate: null,
            numero: installment.number,
            valor: valorParcelaPadrao,
            vencimento: installment.dueDate,
          },
          depois: {
            paid: true,
            paidDate: dataPagamento,
            numero: installment.number,
            valor: valorEditado,
            vencimento: parcelaVencimentoEditado || installment.dueDate,
          },
          autorId: currentUser?.id,
          autorNome: currentUser?.name,
          status: 'conciliado',
          conciliadoAt: nowIso,
          conciliadoPorId: currentUser?.id,
          conciliadoPorNome: currentUser?.name,
          conciliadoNota: `Resolução de erro de importação${err.fileName ? ` (${err.fileName})` : ''}`,
        });
        useConciliacaoStore.setState((s) => ({ items: [created, ...s.items] }));
      } catch (e) {
        console.error('Falha ao registrar baixa no histórico:', e);
      }

      // 3. Marca o erro como resolvido
      const nota =
        modo === 'pago' && Math.abs(valorEditado - valorParcelaPadrao) > 0.001
          ? `Baixada parcela ${installment.number} com valor pago ${fmtBRL(valorEditado)} em ${fmtDate(dataPagamento)}.`
          : `Baixada parcela ${installment.number} (${fmtBRL(valorEditado)}) em ${fmtDate(dataPagamento)}.`;
      onResolved(nota);
    } catch (e) {
      alert(`Erro ao resolver: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold">Resolver erro de importação</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{err.studentName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <XCircle size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Resumo da linha da planilha */}
          <div className="rounded-xl bg-muted/40 border border-border p-3 grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vencimento</p>
              <p className="font-medium">{err.vencimento ? fmtDate(err.vencimento) : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor pago</p>
              <p className="font-medium">{err.valor != null ? fmtBRL(err.valor) : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pagamento</p>
              <p className="font-medium">{err.dataPagamento ? fmtDate(err.dataPagamento) : '—'}</p>
            </div>
          </div>

          {!student ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Aluno não encontrado pelo nome. Cadastre o aluno antes de resolver, ou use Ignorar.
            </div>
          ) : (
            <>
              {/* Seletor de aluno (mostrado quando há homônimos) */}
              {candidatos.length > 1 && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Aluno ({candidatos.length} encontrados pelo nome)
                  </label>
                  <select
                    className="input-field w-full mt-1"
                    value={studentId}
                    onChange={(e) => {
                      setStudentId(e.target.value);
                      setInstallmentNumber(null);
                    }}
                  >
                    {candidatos.map((c) => {
                      const abertas = c.installments.filter((i) => !i.paid).length;
                      return (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.installments.length} parc. ({abertas} em aberto){c.isRendaExtra ? ' • Renda Extra' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Parcela alvo */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Parcela a baixar
                  {pendingInstallments.length === 0 && installmentOptions.length > 0 && (
                    <span className="ml-1 normal-case tracking-normal text-amber-700 font-normal">
                      (sem parcelas em aberto — exibindo todas)
                    </span>
                  )}
                </label>
                <select
                  className="input-field w-full mt-1"
                  value={installmentNumber ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setInstallmentNumber(n);
                    const inst = student.installments.find((i) => i.number === n);
                    if (inst) setValorEditado(modo === 'parcela' ? inst.value : valorPagoPadrao);
                  }}
                >
                  <option value="" disabled>Selecione uma parcela…</option>
                  {installmentOptions.map((i) => {
                    const today = new Date().toISOString().slice(0, 10);
                    const status = i.paid
                      ? `paga em ${i.paidDate ? fmtDate(i.paidDate) : '—'}`
                      : (i.dueDate < today ? 'vencida' : 'a vencer');
                    return (
                      <option key={i.number} value={i.number}>
                        Parcela {i.number} — venc. {fmtDate(i.dueDate)} — {fmtBRL(i.value)} ({status})
                      </option>
                    );
                  })}
                  {installmentOptions.length === 0 && (
                    <option value="" disabled>Este aluno não tem parcelas cadastradas</option>
                  )}
                </select>
              </div>

              {/* Modo: valor da parcela vs valor pago */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Qual valor usar para a baixa?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => onModoChange('parcela')}
                    className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                      modo === 'parcela'
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Valor da parcela (editável)</p>
                    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                      <CurrencyInput
                        value={parcelaValorEditado}
                        onChange={(v) => setParcelaValorEditado(v)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onModoChange('pago')}
                    className={`text-left rounded-xl border p-3 transition-all ${
                      modo === 'pago'
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Valor pago (planilha)</p>
                    <p className="text-base font-bold mt-1">{fmtBRL(valorPagoPadrao)}</p>
                  </button>
                </div>
              </div>

              {/* Editar valor + data */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor da baixa</label>
                  <div className="mt-1">
                    <CurrencyInput value={valorEditado} onChange={(v) => setValorEditado(v)} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Data do pagamento</label>
                  <input
                    type="date"
                    className="input-field w-full mt-1"
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                  />
                </div>
              </div>

              {(() => {
                const baseParc = installment?.value ?? 0;
                if (!installment || baseParc <= 0 || valorEditado <= 0) return null;
                const diff = valorEditado - baseParc;
                const pct = (diff / baseParc) * 100;
                // Tolerância: -10% a +15% (mesma regra da importação Kamino)
                const foraTolerancia = pct > 15 || pct < -10;
                if (foraTolerancia) {
                  return (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                      Valor fora da tolerância (-10% a +15%): {pct > 0 ? '+' : ''}{pct.toFixed(1)}% em relação à parcela ({fmtBRL(baseParc)}). Revise antes de confirmar.
                    </div>
                  );
                }
                if (Math.abs(diff) > 0.001) {
                  return (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      O valor da parcela será <strong>ajustado</strong> de {fmtBRL(baseParc)} para {fmtBRL(valorEditado)} ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%) ao confirmar.
                    </div>
                  );
                }
                return null;
              })()}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            {!student && 'Selecione um aluno para continuar.'}
            {student && !installment && 'Selecione uma parcela para continuar.'}
            {student && installment?.paid && 'Atenção: esta parcela já está paga — a baixa irá sobrescrever.'}
            {student && installment && !installment.paid && valorEditado <= 0 && 'Informe o valor da baixa.'}
            {student && installment && !installment.paid && valorEditado > 0 && !dataPagamento && 'Informe a data do pagamento.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!podeConfirmar || saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
              {saving ? 'Baixando...' : 'Confirmar baixa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
