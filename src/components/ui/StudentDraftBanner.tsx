// ─── Banner de Rascunho ──────────────────────────────────────────────────────
// Mostrado no card do aluno (Ficha e Gestão Financeira) quando existem
// alterações enviadas à Conciliação como RASCUNHO (`depois._after` presente,
// ou renegociação) que ainda não foram efetivadas.
// Pendentes em amarelo, Aprovados em azul.

import { useMemo } from 'react';
import { Clock, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { useConciliacaoStore } from '@/store/useConciliacaoStore';
import type { ConciliacaoItem } from '@/types';

interface Props {
  studentId: string;
}

const FIELD_LABELS: Record<string, string> = {
  saleValue: 'Total contratado',
  installmentValue: 'Valor da parcela',
  valorParcela: 'Valor da parcela',
  totalInstallments: 'Número de parcelas',
  totalParcelas: 'Número de parcelas',
  paidInstallments: 'Parcelas pagas',
  downPayment: 'Entrada',
  dueDay: 'Dia de vencimento',
  vencimento: 'Vencimento',
  dueDate: 'Vencimento',
  dataPagamento: 'Data do pagamento',
  paidDate: 'Data do pagamento',
  paidMarkedAt: 'Registrado no sistema',
  paid: 'Situação',
  value: 'Valor',
  juros: 'Juros',
  multa: 'Multa',
  desconto: 'Desconto',
  encargo: 'Encargo',
};

const CURRENCY_KEYS = new Set([
  'saleValue', 'installmentValue', 'valorParcela', 'downPayment',
  'value', 'valor', 'juros', 'multa', 'desconto', 'encargo', 'paidValue', 'acordoValue',
]);
const DATE_KEYS = new Set(['vencimento', 'dueDate', 'dataPagamento', 'paidDate']);
const SKIP_KEYS = new Set(['_snapshot', '_after', '_before', '_appliedUpfront', 'parcela', 'parcelaExcluida']);

function labelFor(k: string): string {
  if (FIELD_LABELS[k]) return FIELD_LABELS[k];
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function fmtDateISO(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function fmt(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Pago' : 'Pendente';
  if (CURRENCY_KEYS.has(k) && (typeof v === 'number' || !Number.isNaN(Number(v)))) {
    return fmtCurrency(Number(v));
  }
  if (k === 'paidMarkedAt' && typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
  }
  if (DATE_KEYS.has(k) && typeof v === 'string') return fmtDateISO(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  if (Array.isArray(v)) return `${v.length} item(ns)`;
  if (typeof v === 'object') return '—';
  return String(v);
}

function extractChanges(item: ConciliacaoItem): Array<{ key: string; label: string; from: string; to: string }> {
  const antes = (item.antes ?? {}) as Record<string, unknown>;
  const depois = (item.depois ?? {}) as Record<string, unknown>;
  const parcelaCtx = antes.parcela ?? depois.parcela;
  const ctx = parcelaCtx != null ? `Parcela ${parcelaCtx}` : '';
  const keys = new Set<string>();
  Object.keys(antes).forEach((k) => !SKIP_KEYS.has(k) && keys.add(k));
  Object.keys(depois).forEach((k) => !SKIP_KEYS.has(k) && keys.add(k));
  const out: Array<{ key: string; label: string; from: string; to: string }> = [];
  for (const k of keys) {
    const from = fmt(k, antes[k]);
    const to = fmt(k, depois[k]);
    if (from === to) continue;
    const base = labelFor(k);
    const label = ctx
      ? (k === 'valorParcela' || k === 'value' || k === 'installmentValue' ? `Valor da ${ctx}`
        : k === 'vencimento' || k === 'dueDate' ? `Vencimento da ${ctx}`
        : `${base} — ${ctx}`)
      : base;
    out.push({ key: k, label, from, to });
  }
  return out;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function StudentDraftBanner({ studentId }: Props) {
  const items = useConciliacaoStore((s) => s.items);
  const drafts = useMemo(() => {
    return items.filter((it) => {
      if (it.studentId !== studentId) return false;
      if (it.status !== 'pendente' && it.status !== 'aprovado') return false;
      const after = (it.depois as Record<string, unknown>)?._after;
      const isReneg = it.tipo === 'renegociacao';
      return (!!after && typeof after === 'object') || isReneg;
    });
  }, [items, studentId]);

  if (drafts.length === 0) return null;
  const pendentes = drafts.filter((d) => d.status === 'pendente');
  const aprovados = drafts.filter((d) => d.status === 'aprovado');
  const hasPend = pendentes.length > 0;
  const hasApr = aprovados.length > 0;

  const tone = hasPend
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-blue-50 border-blue-200 text-blue-900';
  const Icon = hasPend ? Clock : CheckCircle2;
  const statusLabel = hasPend && hasApr
    ? `${pendentes.length} pendente(s) · ${aprovados.length} aprovada(s)`
    : hasPend ? `${pendentes.length} pendente(s)` : `${aprovados.length} aprovada(s)`;

  const oldest = drafts.reduce((acc, d) => (!acc || d.createdAt < acc ? d.createdAt : acc), '' as string);

  return (
    <div className={`rounded-xl border ${tone} p-3 text-xs space-y-3`}>
      <div className="flex items-center gap-2 font-semibold">
        <Icon size={14} />
        <span>RASCUNHO — aguardando conciliação</span>
        <span className="ml-auto text-[10px] font-normal opacity-70">{statusLabel}</span>
      </div>
      {oldest && (
        <div className="text-[10px] opacity-70">
          Solicitado em {fmtDateTime(oldest)}
        </div>
      )}
      <div className="space-y-2">
        {drafts.map((d) => {
          const changes = extractChanges(d);
          return (
            <div key={d.id} className="rounded-lg bg-white/60 border border-current/15 p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold leading-snug">{d.resumo}</span>
                <span className="text-[9px] uppercase tracking-wider opacity-70 shrink-0">
                  {d.status === 'aprovado' ? 'Aprovado' : 'Pendente'}
                </span>
              </div>
              {changes.length > 0 ? (
                <ul className="space-y-0.5">
                  {changes.slice(0, 6).map((c) => (
                    <li key={c.key} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="text-foreground/70">{c.label}:</span>
                      <span className="line-through decoration-rose-300 text-rose-600/80 tabular-nums">{c.from}</span>
                      <ArrowRight size={10} className="opacity-50" />
                      <span className="font-semibold text-emerald-700 tabular-nums">{c.to}</span>
                    </li>
                  ))}
                  {changes.length > 6 && (
                    <li className="text-[10px] opacity-70">+ {changes.length - 6} alteração(ões)…</li>
                  )}
                </ul>
              ) : (
                <p className="text-[10px] opacity-70">Detalhes na aba Conciliação.</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-1.5 text-[10px] opacity-80 pt-1 border-t border-current/10">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span>
          Os valores reais só serão atualizados após a Conciliação. Se reprovada, o rascunho é descartado.
        </span>
      </div>
    </div>
  );
}
