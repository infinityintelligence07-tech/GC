// ─── Antecipação — Página Isolada por AC ─────────────────────────────────────
// Módulo novo e independente. Não consome nem modifica nenhum dado do fluxo
// existente (alunos, cancelamentos, renda extra). Persistência própria via
// useAntecipacaoStore.

import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useConfirm } from '@/hooks/useConfirm';
import {
  useAntecipacaoStore,
  computeAntecipacaoStatus,
  newAntecipacaoId,
} from '@/store/useAntecipacaoStore';
import {
  AntecipacaoItem,
  AntecipacaoOrigem,
  AntecipacaoStatus,
} from '@/types';
import {
  Upload,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  FileSpreadsheet,
  Calendar,
  Filter,
  Wallet,
} from 'lucide-react';

// ─── Lazy XLSX loader (CDN) ─────────────────────────────────────────────────
// Mesmo padrão adotado no ImportStudentsModal: evita dependência no
// node_modules e carrega o SheetJS apenas quando necessário.
interface XLSXUtils {
  json_to_sheet: (data: Record<string, unknown>[], opts?: { header?: string[] }) => Record<string, unknown>;
  book_new: () => Record<string, unknown>;
  book_append_sheet: (wb: Record<string, unknown>, ws: Record<string, unknown>, name: string) => void;
  sheet_to_json: <T = Record<string, unknown>>(ws: Record<string, unknown>, opts?: { defval?: string }) => T[];
}
interface XLSXModule {
  read: (data: Uint8Array, opts: { type: 'array' }) => { Sheets: Record<string, Record<string, unknown>>; SheetNames: string[] };
  utils: XLSXUtils;
  writeFile: (wb: Record<string, unknown>, filename: string) => void;
  SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null };
}

const XLSX_CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoadPromise: Promise<XLSXModule> | null = null;
function loadXLSX(): Promise<XLSXModule> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window indefinido'));
  const existing = (window as unknown as { XLSX?: XLSXModule }).XLSX;
  if (existing) return Promise.resolve(existing);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise<XLSXModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_CDN_URL;
    script.async = true;
    script.onload = () => {
      const x = (window as unknown as { XLSX?: XLSXModule }).XLSX;
      x ? resolve(x) : reject(new Error('SheetJS não disponível'));
    };
    script.onerror = () => { xlsxLoadPromise = null; reject(new Error('Falha ao carregar SheetJS do CDN')); };
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

// ─── Helpers de data / formato ──────────────────────────────────────────────

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function firstDayOfMonth(): string {
  const now = new Date();
  return toISO(new Date(now.getFullYear(), now.getMonth(), 1));
}
function lastDayOfMonth(): string {
  const now = new Date();
  return toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function formatBRDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

function normalizeOrigem(v: unknown): AntecipacaoOrigem | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'banco') return 'Banco';
  if (s === 'sicoob') return 'Sicoob';
  if (s === 'fundo') return 'Fundo';
  return null;
}

function normalizeWhatsapp(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

// Parser de datas permissivo: aceita ISO, dd/mm/aaaa e números de série Excel
function parseDateCell(raw: unknown, xlsx: XLSXModule | null): string | null {
  if (raw == null || raw === '') return null;

  // Número serial Excel
  if (typeof raw === 'number' && xlsx) {
    const parsed = xlsx.SSF.parse_date_code(raw);
    if (parsed) {
      const iso = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      return iso;
    }
  }

  const s = String(raw).trim();
  // dd/mm/aaaa
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let y = m[3];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo}-${d}`;
  }
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // fallback via Date
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toISO(d);
  return null;
}

// ─── Componente ─────────────────────────────────────────────────────────────

const ORIGENS: AntecipacaoOrigem[] = ['Banco', 'Sicoob', 'Fundo'];
const STATUS_LIST: AntecipacaoStatus[] = ['Vencido 1', 'Vencido 2'];

export default function AntecipacaoPage() {
  const { selectedACId, acs } = useAppStore();
  const { items, addMany, deleteItem } = useAntecipacaoStore();
  const confirm = useConfirm();

  const ac = acs.find((a) => a.id === selectedACId);

  // Filtros
  const [inclusaoStart, setInclusaoStart] = useState(firstDayOfMonth());
  const [inclusaoEnd, setInclusaoEnd] = useState(lastDayOfMonth());
  const [vencStart, setVencStart] = useState('');
  const [vencEnd, setVencEnd] = useState('');
  const [statusFilter, setStatusFilter] = useState<AntecipacaoStatus | 'todos'>('todos');
  const [origemFilter, setOrigemFilter] = useState<AntecipacaoOrigem | 'todas'>('todas');

  // Importação
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [importing, setImporting] = useState(false);

  // Lista filtrada (escopo: apenas AC selecionado)
  const filtered = useMemo<AntecipacaoItem[]>(() => {
    if (!ac) return [];
    return items
      .filter((it) => it.acId === ac.id)
      .filter((it) => {
        // Período de inclusão
        if (inclusaoStart && it.createdAt < inclusaoStart) return false;
        if (inclusaoEnd && it.createdAt > inclusaoEnd) return false;
        // Período de vencimento
        if (vencStart && it.dataVencimento < vencStart) return false;
        if (vencEnd && it.dataVencimento > vencEnd) return false;
        // Origem
        if (origemFilter !== 'todas' && it.origem !== origemFilter) return false;
        // Status (calculado)
        const status = computeAntecipacaoStatus(it.dataVencimento);
        if (statusFilter !== 'todos' && status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => (a.dataVencimento < b.dataVencimento ? -1 : 1));
  }, [items, ac, inclusaoStart, inclusaoEnd, vencStart, vencEnd, statusFilter, origemFilter]);

  const countsVenc1 = filtered.filter((it) => computeAntecipacaoStatus(it.dataVencimento) === 'Vencido 1').length;
  const countsVenc2 = filtered.filter((it) => computeAntecipacaoStatus(it.dataVencimento) === 'Vencido 2').length;

  // ── Ação: Importar planilha ───────────────────────────────────────────────
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !ac) return;
    setImporting(true);
    setImportStatus({ type: 'info', message: 'Processando planilha…' });
    try {
      const buf = await file.arrayBuffer();
      let rows: Record<string, unknown>[] = [];
      let xlsx: XLSXModule | null = null;
      const isCsv = /\.csv$/i.test(file.name);
      if (isCsv) {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        rows = parseCSV(text);
      } else {
        xlsx = await loadXLSX();
        const wb = xlsx.read(new Uint8Array(buf), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
      }

      const errors: string[] = [];
      const today = toISO(new Date());
      const newItems: AntecipacaoItem[] = [];

      rows.forEach((row, idx) => {
        const lineNo = idx + 2; // linha no arquivo (considerando cabeçalho)
        const nome = String(row['Nome Completo'] ?? row['nome completo'] ?? row['Nome'] ?? '').trim();
        const whatsapp = normalizeWhatsapp(row['WhatsApp'] ?? row['whatsapp'] ?? row['Whatsapp']);
        const venc = parseDateCell(row['Data de Vencimento'] ?? row['data de vencimento'] ?? row['Vencimento'], xlsx);
        const origem = normalizeOrigem(row['Origem'] ?? row['origem']);

        if (!nome) { errors.push(`Linha ${lineNo}: Nome Completo vazio.`); return; }
        if (!whatsapp) { errors.push(`Linha ${lineNo}: WhatsApp vazio.`); return; }
        if (!venc) { errors.push(`Linha ${lineNo}: Data de Vencimento inválida.`); return; }
        if (!origem) { errors.push(`Linha ${lineNo}: Origem inválida (use Banco, Sicoob ou Fundo).`); return; }

        newItems.push({
          id: newAntecipacaoId(),
          acId: ac.id,
          nome,
          whatsapp,
          dataVencimento: venc,
          origem,
          createdAt: today,
        });
      });

      if (newItems.length === 0) {
        setImportStatus({
          type: 'error',
          message: `Nenhum registro válido. ${errors.slice(0, 3).join(' ')}${errors.length > 3 ? ` (+${errors.length - 3} outros)` : ''}`,
        });
      } else {
        addMany(newItems);
        setImportStatus({
          type: 'success',
          message: `${newItems.length} registro(s) importado(s) com sucesso.${errors.length ? ` ${errors.length} linha(s) ignorada(s).` : ''}`,
        });
      }
    } catch (err) {
      setImportStatus({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao importar planilha.' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Ação: Exportar lista (respeita filtros) ────────────────────────────────
  async function handleExport() {
    if (!ac) return;
    if (filtered.length === 0) {
      setImportStatus({ type: 'info', message: 'Nenhum registro para exportar com os filtros atuais.' });
      return;
    }
    try {
      const xlsx = await loadXLSX();
      const rows = filtered.map((it) => ({
        'Nome Completo': it.nome,
        'WhatsApp': it.whatsapp,
        'Data de Vencimento': formatBRDate(it.dataVencimento),
        'Origem': it.origem,
        'Status': computeAntecipacaoStatus(it.dataVencimento),
        'Data de Inclusão': formatBRDate(it.createdAt),
      }));
      const ws = xlsx.utils.json_to_sheet(rows, {
        header: ['Nome Completo', 'WhatsApp', 'Data de Vencimento', 'Origem', 'Status', 'Data de Inclusão'],
      });
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Antecipação');
      const safeName = ac.name.replace(/[^a-zA-Z0-9-_]/g, '_');
      xlsx.writeFile(wb, `antecipacao_${safeName}_${toISO(new Date())}.xlsx`);
      setImportStatus({ type: 'success', message: `${filtered.length} registro(s) exportado(s).` });
    } catch (err) {
      setImportStatus({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao exportar.' });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!ac) {
    return (
      <div className="max-w-3xl mx-auto mt-12 bg-card border border-border rounded-2xl p-8 text-center">
        <Wallet className="mx-auto mb-3 text-muted-foreground/50" size={36} />
        <p className="text-sm text-muted-foreground">Selecione um Assessor de Conta no menu lateral para visualizar a Antecipação.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {ac.photo ? (
            <img src={ac.photo} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-border/40" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {ac.name.charAt(0)}
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-foreground tracking-tight">Antecipação</h3>
            <p className="text-[11px] text-muted-foreground/70 font-medium">{ac.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors shadow-sm"
          >
            <Upload size={13} strokeWidth={2} />
            {importing ? 'Importando…' : 'Importar Planilha'}
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-border bg-background hover:bg-muted/60 text-foreground transition-colors"
          >
            <Download size={13} strokeWidth={2} />
            Exportar Lista
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>
      </div>

      {/* ── Feedback de importação/exportação ────────────────────────────── */}
      {importStatus && (
        <div
          className={`flex items-start gap-2.5 p-3 rounded-xl border text-[12px] ${
            importStatus.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : importStatus.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {importStatus.type === 'success' ? <CheckCircle2 size={15} /> : importStatus.type === 'error' ? <AlertTriangle size={15} /> : <FileSpreadsheet size={15} />}
          <span className="flex-1">{importStatus.message}</span>
          <button onClick={() => setImportStatus(null)} className="opacity-60 hover:opacity-100">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={13} className="text-muted-foreground" />
          <h4 className="text-[11px] font-bold text-foreground uppercase tracking-wider">Filtros</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Período de inclusão */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Período de inclusão</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={inclusaoStart} onChange={(e) => setInclusaoStart(e.target.value)} className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background" />
              <span className="text-muted-foreground text-xs">—</span>
              <input type="date" value={inclusaoEnd} onChange={(e) => setInclusaoEnd(e.target.value)} className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background" />
            </div>
          </div>
          {/* Período de vencimento */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Período de vencimento</label>
            <div className="flex items-center gap-1.5">
              <input type="date" value={vencStart} onChange={(e) => setVencStart(e.target.value)} className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background" />
              <span className="text-muted-foreground text-xs">—</span>
              <input type="date" value={vencEnd} onChange={(e) => setVencEnd(e.target.value)} className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background" />
            </div>
          </div>
          {/* Status */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AntecipacaoStatus | 'todos')}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background"
            >
              <option value="todos">Todos</option>
              {STATUS_LIST.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {/* Origem */}
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Origem financeira</label>
            <select
              value={origemFilter}
              onChange={(e) => setOrigemFilter(e.target.value as AntecipacaoOrigem | 'todas')}
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg bg-background"
            >
              <option value="todas">Todas</option>
              {ORIGENS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Indicadores ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Vencido 1</p>
            <p className="text-3xl font-bold text-foreground mt-1.5">{countsVenc1}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">aluno(s) até 30 dias de atraso</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Calendar size={18} />
          </div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Vencido 2</p>
            <p className="text-3xl font-bold text-foreground mt-1.5">{countsVenc2}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">aluno(s) acima de 30 dias de atraso</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-red-100 text-red-700 flex items-center justify-center">
            <AlertTriangle size={18} />
          </div>
        </div>
      </div>

      {/* ── Tabela ──────────────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {['Nome Completo', 'WhatsApp', 'Data de Vencimento', 'Origem', 'Status', 'Ação'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-muted-foreground">
                    Nenhum registro encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filtered.map((it) => {
                  const status = computeAntecipacaoStatus(it.dataVencimento);
                  const statusClass =
                    status === 'Vencido 1'
                      ? 'bg-amber-100 text-amber-700 border border-amber-200'
                      : 'bg-red-100 text-red-700 border border-red-200';
                  return (
                    <tr key={it.id} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-foreground">{it.nome}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{it.whatsapp}</td>
                      <td className="px-4 py-3 text-xs text-foreground">{formatBRDate(it.dataVencimento)}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                          {it.origem}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${statusClass}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Excluir antecipação',
                              description: `Excluir "${it.nome}" da lista de antecipação?`,
                              variant: 'destructive',
                              confirmText: 'Excluir',
                            });
                            if (ok) deleteItem(it.id);
                          }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Excluir"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
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

// ─── CSV parser mínimo (simples, tolerante a aspas) ─────────────────────────
function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === ',' || ch === ';') && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const headers = splitLine(lines[0]);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}
