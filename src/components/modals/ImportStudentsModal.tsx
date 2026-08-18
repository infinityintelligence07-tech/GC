import { useState, useRef, useMemo, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { X, Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Save, Plus, Trash2, Loader2 } from 'lucide-react';
import { useAppStore, generateInstallments, calculateInstallmentValue, calculateAutoStatus } from '@/store/useAppStore';
import { useCompanyStore } from '@/store/useCompanyStore';
import { Student, StudentStatus, Installment, CancellationCase, AC, Product } from '@/types';
import { createProduct, createAC, createStudentTag } from '@/lib/supabaseMutations';
import { useConfirm } from '@/hooks/useConfirm';
import { withSyncSuspended } from '@/hooks/useSupabaseSync';
import { toast } from 'sonner';

// ─── Lazy XLSX loader via CDN ─────────────────────────────────────────────────
interface XLSXUtils {
  aoa_to_sheet: (data: unknown[][]) => Record<string, unknown>;
  json_to_sheet: (data: Record<string, unknown>[], opts?: { header?: string[] }) => Record<string, unknown>;
  book_new: () => Record<string, unknown>;
  book_append_sheet: (wb: Record<string, unknown>, ws: Record<string, unknown>, name: string) => void;
  sheet_to_json: <T = Record<string, unknown>>(ws: Record<string, unknown>, opts?: { defval?: string }) => T[];
  decode_range?: (range: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
  encode_range?: (range: { s: { r: number; c: number }; e: { r: number; c: number } }) => string;
  encode_cell?: (cell: { r: number; c: number }) => string;
}
interface XLSXModule {
  read: (data: Uint8Array, opts: { type: 'array' }) => { Sheets: Record<string, Record<string, unknown>>; SheetNames: string[] };
  utils: XLSXUtils;
  write: (wb: Record<string, unknown>, opts: { bookType: 'xlsx'; type: 'array'; compression?: boolean }) => ArrayBuffer;
  writeFile: (wb: Record<string, unknown>, filename: string) => void;
  SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null };
}

declare global {
  interface Window {
    XLSX?: XLSXModule;
  }
}

const XLSX_CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

let xlsxLoadPromise: Promise<XLSXModule> | null = null;
function loadXLSX(): Promise<XLSXModule> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is undefined'));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  // Prefer the locally bundled npm package (reliable, offline-friendly).
  xlsxLoadPromise = import('xlsx')
    .then((mod) => {
      const xlsx = (mod as unknown as { default?: XLSXModule }).default ?? (mod as unknown as XLSXModule);
      window.XLSX = xlsx;
      return xlsx;
    })
    .catch(() => {
      // Fallback: load from CDN if bundled import fails.
      return new Promise<XLSXModule>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = XLSX_CDN_URL;
        script.async = true;
        script.onload = () => {
          if (window.XLSX) resolve(window.XLSX);
          else reject(new Error('SheetJS carregado mas window.XLSX indefinido'));
        };
        script.onerror = () => {
          xlsxLoadPromise = null;
          reject(new Error('Falha ao carregar SheetJS. Verifique sua conexão.'));
        };
        document.head.appendChild(script);
      });
    });
  return xlsxLoadPromise;
}

function downloadXlsx(XLSX: XLSXModule, wb: Record<string, unknown>, filename: string) {
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ImportStudentsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportMode = 'padrao' | 'kamino';
type ClassDecision = 'treinamento' | 'treinamento-existente' | 'tag' | 'tag-existente';

// ─── Template column definition (Padrão) ──────────────────────────────────────
const TEMPLATE_COLUMNS = [
  'Nome', 'WhatsApp', 'E-mail', 'CPF', 'Endereço', 'Número', 'Cidade', 'Estado', 'CEP',
  'AC', 'Produto', 'Ciclo', 'Data de Inscrição', 'Data de Competência', 'Dia de Vencimento',
  'Primeiro Vencimento',
  'Valor Contrato', 'Entrada', 'Nº Parcelas', 'Valor Parcela', 'Qtd Parcelas Pagas', 'Status',
  'Tags',
] as const;

// Kamino expected columns (novo formato — sem coluna Assessor; assessor vem dentro do Centro de Custo)
const KAMINO_COLUMNS = [
  'Pessoa', 'Telefone', 'E-mail', 'Classificação', 'Centro de Custo',
  'Conta de Recebimento', 'Forma de Recebimento', 'Detalhe',
  'Valor a Receber (R$)', 'Valor Recebido (R$)', 'Vencimento', 'Recebimento', 'Competência',
] as const;

const STATUS_VALIDOS: StudentStatus[] = [
  'Aluno Novo', 'Em Dia', 'Vencido 1', 'Vencido 2', 'À Negativar', 'Negativado', 'Em Negociação', 'Excluído', 'Pendente',
];

const KAMINO_TAG_ONLY_PRODUCT = 'Sem Treinamento';

// Palavras-chave reconhecidas no Centro de Custo (case-insensitive). Outras palavras são ignoradas.
const CENTRO_CUSTO_KEYWORDS = ['antecipação', 'antecipacao', 'cancelamento', 'negativação', 'negativacao', 'tmf'] as const;
// Palavras na Forma de Recebimento (coluna I) que NUNCA viram tag.
const FORMA_RECEBIMENTO_IGNORE = ['legado', 'manual'] as const;
// Marcadores estruturais dentro do Centro de Custo que não são nomes de assessor.
const CC_NON_ASSESSOR_KEYWORDS = [
  'gestão de contas', 'gestao de contas', 'antecipação', 'antecipacao',
  'cancelamento', 'negativação', 'negativacao', 'tmf', 'academy',
] as const;

interface KaminoExtras {
  installments?: Installment[];
  mirrorCancellation?: boolean;
  kaminoTagNames?: string[];
  // AC candidato extraído do Centro de Custo quando não bate com nenhum AC cadastrado.
  // Resolvido pelo usuário no modal pré-importação (atribuir / criar / ignorar).
  acCandidate?: string;
  // Tags informadas no modelo Padrão (coluna "Tags", separadas por vírgula).
  // Resolvidas em IDs no momento da importação (criadas automaticamente se não existirem).
  pendingTagNames?: string[];
  // Data da primeira parcela informada no Padrão (coluna "Primeiro Vencimento").
  // Quando presente, sobrescreve o cálculo padrão (mês de inscrição + 1).
  firstDueDate?: string;
  // ID de aluno existente ao qual estas parcelas (apenas Recompra) devem ser anexadas
  // em vez de criar uma nova ficha. Usado quando uma planilha Kamino traz só linhas
  // de Recompra de um aluno cujo contrato principal já existe no banco.
  attachToStudentId?: string;
}

interface ParsedRow {
  rowIndex: number;
  raw: Record<string, unknown>;
  data: (Omit<Student, 'id' | 'installments' | 'history'> & KaminoExtras) | null;
  errors: string[];
}

function normalizeDate(value: unknown, xlsx?: XLSXModule): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!xlsx) return null;
    const date = xlsx.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const str = String(value).trim().replace(/\s/g, '').replace(/R\$/g, '');
  const normalized = str.includes(',') ? str.replace(/\./g, '').replace(',', '.') : str;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function normalizeString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

// Apenas campos de IDENTIDADE do aluno são herdados da linha anterior quando vazios.
// Campos transacionais por parcela (Conta de Recebimento, Forma de Recebimento,
// Centro de Custo) NUNCA herdam — caso contrário, uma parcela sem valor nesses
// campos receberia indevidamente a tag/conta da parcela anterior (ex.: aluno
// recebendo tag "Stone - Iam" só porque a linha acima tinha esse valor).
const KAMINO_FILL_DOWN_COLUMNS = ['Pessoa', 'Telefone', 'E-mail', 'Classificação'] as const;

function fillDownKaminoRows(rows: Record<string, unknown>[]) {
  const lastSeenValues: Partial<Record<(typeof KAMINO_FILL_DOWN_COLUMNS)[number], unknown>> = {};

  return rows.map((row) => {
    const nextRow = { ...row };

    // Linha "órfã": tem dados financeiros (Vencimento/Valor) mas TODOS os
    // campos de identidade do aluno estão vazios. Não herda nada do anterior —
    // assim o parser agrupa como ficha "Sem Nome".
    const allIdentityEmpty = KAMINO_FILL_DOWN_COLUMNS.every(
      (col) => !normalizeString(nextRow[col])
    );
    if (allIdentityEmpty) {
      return nextRow;
    }

    KAMINO_FILL_DOWN_COLUMNS.forEach((column) => {
      const currentValue = normalizeString(nextRow[column]);
      if (currentValue) {
        lastSeenValues[column] = nextRow[column];
        return;
      }

      if (lastSeenValues[column] != null) {
        nextRow[column] = lastSeenValues[column]!;
      }
    });

    return nextRow;
  });
}

function buildImportIdentity(input: {
  name: string;
  whatsapp?: string;
  product?: string;
  enrollmentDate?: string;
  saleValue?: number;
  totalInstallments?: number;
}) {
  const phoneDigits = normalizeString(input.whatsapp).replace(/\D/g, '');

  return [
    normalizeString(input.name).toLowerCase(),
    phoneDigits,
    normalizeString(input.product).toLowerCase(),
    normalizeString(input.enrollmentDate),
    String(input.saleValue ?? ''),
    String(input.totalInstallments ?? ''),
  ].join('||');
}

// ─── Kamino: análise do "Centro de Custo" ────────────────────────────────────
// Reconhece palavras-chave (Antecipação, Cancelamento, Negativação, Tmf),
// candidatos a tag (qualquer outra palavra) e nomes próprios candidatos a Assessor
// (texto entre parênteses que NÃO bate com palavras-chave estruturais).
function analyzeCentroCusto(cc: string): {
  hasAntecipacao: boolean;
  hasCancelamento: boolean;
  hasNegativacao: boolean;
  hasTmf: boolean;
  unknownLabel: string | null;
  assessorCandidates: string[];
} {
  const lower = cc.toLowerCase();
  const hasAntecipacao = /antecipa[cç][aã]o/.test(lower);
  const hasCancelamento = /cancelamento/.test(lower);
  const hasNegativacao = /negativa[cç][aã]o/.test(lower);
  const hasTmf = /\btmf\b/.test(lower);

  // Extrai nomes próprios candidatos a Assessor: textos entre parênteses
  // que não contenham palavras-chave estruturais (IAM - GC, Antecipação, etc.)
  // e que pareçam um nome de pessoa (≥ 2 palavras com inicial maiúscula).
  const assessorCandidates: string[] = [];
  const seen = new Set<string>();
  const parenMatches = cc.match(/\(([^()]+)\)/g) || [];
  for (const raw of parenMatches) {
    const inner = raw.slice(1, -1).trim();
    const innerLower = inner.toLowerCase();
    if (CC_NON_ASSESSOR_KEYWORDS.some((k) => innerLower.includes(k))) continue;
    // Heurística de "nome próprio": pelo menos 2 palavras alfabéticas
    const words = inner.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÖØ-öø-ÿ.'-]+$/.test(w));
    if (words.length < 2) continue;
    const norm = inner.replace(/\s+/g, ' ').trim();
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    assessorCandidates.push(norm);
  }

  // Texto restante (sem parênteses e sem palavras-chave) vira candidato a tag.
  let leftover = cc.replace(/\([^()]*\)/g, ' ').trim();
  // Remove palavras-chave conhecidas do leftover
  leftover = leftover.replace(/antecipa[cç][aã]o/gi, ' ')
    .replace(/cancelamento/gi, ' ')
    .replace(/negativa[cç][aã]o/gi, ' ')
    .replace(/\btmf\s*\d*\b/gi, ' ')
    .replace(/[\/\\|,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const unknownLabel = leftover && leftover.length > 0 ? leftover : null;

  return { hasAntecipacao, hasCancelamento, hasNegativacao, hasTmf, unknownLabel, assessorCandidates };
}

function extractTagFromContaRecebimento(cr: string): string | null {
  // Remove a redundância "- Academy" / " Academy" no final do texto.
  let v = cr.trim();
  v = v.replace(/\s*[-–—]\s*Academy\s*$/i, '').replace(/\s+Academy\s*$/i, '').trim();
  return v || null;
}

// ─── Kamino: tag a partir da Forma de Recebimento (coluna I) ─────────────────
// "Legado" e "Manual" são ignorados. Outros valores viram candidatos a tag.
function extractTagFromFormaRecebimento(fr: string): string | null {
  const v = fr.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (FORMA_RECEBIMENTO_IGNORE.some((w) => lower === w)) return null;
  return v;
}

// Detecta se a Classificação é uma "Recompra" / "Antecipação" / "Fundo"
// (parcela extra que deve ser anexada ao fluxo do aluno com tag específica,
// e NUNCA virar uma ficha isolada de 1/1 parcela).
// Ex: "Fundo - Receita (Recompra)", "Antecipação de Recebíveis",
// "Fundo Sicoob", "Curso X - Recompra", etc.
function isRecompraClassificacao(produto: string): boolean {
  return /recompra|antecipa[cç][aã]o|\bfundo\b/i.test(produto);
}

interface DiagnosticEntry {
  name: string;
  expectedName?: string;
  expectedProduct?: string;
  product: string;
  sentInstallments: number;
  returnedInstallments: number;
  match: boolean;
  studentIds?: string[];
}

// ─── Bloco reutilizável: decisão por candidato a Tag ──────────────────────────
// 3 botões (Virar Tag / Atribuir Tag / Ignorar) + campo dependente.
type TagDecisionValue = 'tag' | 'atribuir' | 'ignorar';
interface TagDecisionRowProps {
  candidate: string;
  decision: TagDecisionValue;
  setDecision: (d: TagDecisionValue) => void;
  // Para "Virar Tag"
  editedName: string;
  setEditedName: (name: string) => void;
  // Para "Atribuir Tag"
  assignedTagId: string;
  setAssignedTagId: (id: string) => void;
  // Catálogo de tags existentes
  studentTags: Array<{ id: string; name: string; color: string }>;
  willReuse: boolean;
  defaultDecision?: TagDecisionValue;
}
function TagDecisionRow({
  candidate,
  decision,
  setDecision,
  editedName,
  setEditedName,
  assignedTagId,
  setAssignedTagId,
  studentTags,
  willReuse,
}: TagDecisionRowProps) {
  return (
    <div className="border border-border rounded-xl p-3 bg-muted/20">
      <p className="text-[10px] text-muted-foreground mb-1">Original: <span className="font-mono text-foreground">{candidate}</span></p>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <button
          type="button"
          onClick={() => setDecision('tag')}
          className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
            decision === 'tag'
              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
              : 'bg-background border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          Virar Tag
        </button>
        <button
          type="button"
          onClick={() => setDecision('atribuir')}
          className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
            decision === 'atribuir'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-background border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          Atribuir Tag
        </button>
        <button
          type="button"
          onClick={() => setDecision('ignorar')}
          className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all ${
            decision === 'ignorar'
              ? 'bg-slate-600 text-white border-slate-600 shadow-sm'
              : 'bg-background border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          Ignorar
        </button>
      </div>
      {decision === 'tag' && (
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Nome da tag</label>
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500/40"
            placeholder={candidate}
          />
          {willReuse && (
            <p className="text-[10px] text-emerald-700 font-semibold mt-1">↪ Tag já existe — será reutilizada.</p>
          )}
        </div>
      )}
      {decision === 'atribuir' && (
        <div>
          <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Selecione a tag existente</label>
          {studentTags.length === 0 ? (
            <p className="text-[10px] text-amber-700 font-semibold">Nenhuma tag cadastrada — use "Virar Tag" para criar.</p>
          ) : (
            <select
              value={assignedTagId}
              onChange={(e) => setAssignedTagId(e.target.value)}
              className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">Selecione uma tag...</option>
              {studentTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImportStudentsModal({ isOpen, onClose }: ImportStudentsModalProps) {
  const { students, acs, products, addStudentsBulk, updateStudent, deleteStudent, addCancellationCase, studentTags } = useAppStore();
  const { companies, activeCompanyId } = useCompanyStore();
  const isLibertyCompany = useMemo(() => {
    const c = companies.find((x) => x.id === activeCompanyId);
    return (c?.slug ?? '').toLowerCase() === 'liberty';
  }, [companies, activeCompanyId]);
  // Acesso direto ao set do Zustand para refletir AC/Produto criados inline imediatamente.
  const setStoreState = useAppStore.setState;
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [progressDetail, setProgressDetail] = useState<string>('');
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [mode, setMode] = useState<ImportMode>('padrao');
  const [cleaning, setCleaning] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[] | null>(null);
  const [diagnosticFilter, setDiagnosticFilter] = useState<'all' | 'ok' | 'error'>('all');
  // Decisão por Classificação desconhecida: 'treinamento' = cria como Produto;
  // 'tag' = vira tag e aluno fica com Treinamento em branco. Default: 'treinamento'.
  const [classDecisions, setClassDecisions] = useState<Record<string, ClassDecision>>({});
  // Decisão por Conta de Recebimento: 'tag' = vira tag nova; 'atribuir' = usa tag existente;
  // 'ignorar' = não vira tag. Default: 'ignorar'.
  type TagDecision = 'tag' | 'atribuir' | 'ignorar';
  const [contaDecisions, setContaDecisions] = useState<Record<string, TagDecision>>({});
  // Decisão por Centro de Custo desconhecido (palavras ≠ Antecipação/Cancelamento/Negativação/Tmf).
  const [ccDecisions, setCcDecisions] = useState<Record<string, TagDecision>>({});
  // Decisão por Centro de Custo CONHECIDO (Antecipação/Cancelamento/Tmf).
  // Mesmo essas palavras agora exigem confirmação para virar tag.
  const [cckDecisions, setCckDecisions] = useState<Record<string, TagDecision>>({});
  // Decisão por Classificação de Recompra (ex: "Fundo - Receita (Recompra)").
  const [recompraDecisions, setRecompraDecisions] = useState<Record<string, TagDecision>>({});
  // Decisão por Forma de Recebimento (coluna I) — virar tag aplicada nas parcelas correspondentes.
  const [formaDecisions, setFormaDecisions] = useState<Record<string, TagDecision>>({});
  // Decisão por candidato a Assessor extraído do Centro de Custo:
  // 'criar' = cria AC novo com esse nome; 'atribuir' = usa AC existente (assignAcName); 'ignorar' = sem AC.
  const [acDecisions, setAcDecisions] = useState<Record<string, 'criar' | 'atribuir' | 'ignorar'>>({});
  const [acAssign, setAcAssign] = useState<Record<string, string>>({}); // candidate -> AC existente escolhido
  // Tag existente atribuída por candidato (id da tag em studentTags). Usado quando decision === 'atribuir'.
  const [contaTagAssign, setContaTagAssign] = useState<Record<string, string>>({});
  const [ccTagAssign, setCcTagAssign] = useState<Record<string, string>>({});
  const [cckTagAssign, setCckTagAssign] = useState<Record<string, string>>({});
  const [recompraTagAssign, setRecompraTagAssign] = useState<Record<string, string>>({});
  const [formaTagAssign, setFormaTagAssign] = useState<Record<string, string>>({});
  // Nome editado para cada candidato a tag. Chave é o valor original (como vem na planilha);
  // valor é o nome final que será usado na criação/aplicação da tag.
  // Reseta a cada importação para que o usuário sempre confirme/edite.
  const [contaTagNames, setContaTagNames] = useState<Record<string, string>>({});
  const [ccTagNames, setCcTagNames] = useState<Record<string, string>>({});
  const [cckTagNames, setCckTagNames] = useState<Record<string, string>>({});
  const [recompraTagNames, setRecompraTagNames] = useState<Record<string, string>>({});
  const [formaTagNames, setFormaTagNames] = useState<Record<string, string>>({});
  const [classTagNames, setClassTagNames] = useState<Record<string, string>>({});
  const [showClassDecisionModal, setShowClassDecisionModal] = useState(false);
  const [autoDecisionPromptKey, setAutoDecisionPromptKey] = useState<string>('');

  // ─── Edição inline de linhas com erro ─────────────────────────────────────
  // Ao clicar numa linha de erro, abre um editor com os campos da planilha.
  // Ao salvar, re-valida a linha e atualiza `rows`.
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [errorListOpen, setErrorListOpen] = useState<boolean>(true);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});
  const [savingRow, setSavingRow] = useState<boolean>(false);
  // Aplicar a edição em TODAS as linhas do mesmo aluno (ligado por padrão).
  const [applyToAllSameStudent, setApplyToAllSameStudent] = useState<boolean>(true);
  const [expandedDiagnosticKey, setExpandedDiagnosticKey] = useState<string | null>(null);
  const [editingDiagnosticStudentId, setEditingDiagnosticStudentId] = useState<string | null>(null);
  const [studentEditDraft, setStudentEditDraft] = useState<Record<string, unknown>>({});
  const [savingDiagnosticStudent, setSavingDiagnosticStudent] = useState<boolean>(false);
  // Para criação inline de AC/Produto:
  const [creatingAcName, setCreatingAcName] = useState<string>('');
  const [creatingProductName, setCreatingProductName] = useState<string>('');

  const validRows = useMemo(() => rows.filter((r) => r.data != null), [rows]);
  const invalidRows = useMemo(() => rows.filter((r) => r.data == null), [rows]);

  // ─── Agrupamento de pendências por aluno ────────────────────────────────────
  // Erros e avisos do mesmo cliente aparecem uma vez só. Editar uma linha
  // aplica a correção em TODAS as linhas do mesmo nome (ver handleSaveRowEdit).
  const groupRowsByStudent = (list: ParsedRow[]) => {
    const groups = new Map<string, { key: string; name: string; rows: ParsedRow[]; errors: string[] }>();
    for (const r of list) {
      const rawName = normalizeString(r.raw['Nome'] || r.raw['Pessoa']);
      const name = rawName || `(Sem nome — linha ${r.rowIndex})`;
      const key = (rawName || `__empty_${r.rowIndex}`).toLowerCase();
      if (!groups.has(key)) groups.set(key, { key, name, rows: [], errors: [] });
      const g = groups.get(key)!;
      g.rows.push(r);
      for (const e of (r.errors || [])) {
        if (!g.errors.includes(e)) g.errors.push(e);
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.rows[0].rowIndex - b.rows[0].rowIndex);
  };
  const invalidGroups = useMemo(() => groupRowsByStudent(invalidRows), [invalidRows]);
  const warningGroups = useMemo(
    () => groupRowsByStudent(validRows.filter((r) => r.errors.length > 0)),
    [validRows]
  );

  // ─── Kamino: Classificações que NÃO existem como Produto cadastrado ────────
  // Quando o usuário confirmar, criamos: produto vazio + tag com o nome da Classificação.
  const unknownClassificacoes = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const productNames = new Set(products.map((p) => p.name.toLowerCase()));
    const set = new Set<string>();
    for (const r of validRows) {
      const p = r.data?.product;
      if (!p) continue;
      // Recompra é tratada como tag, não como produto distinto
      if (isRecompraClassificacao(p)) continue;
      if (!productNames.has(p.toLowerCase())) set.add(p);
    }
    return Array.from(set);
  }, [mode, validRows, products]);

  // ─── Kamino: valor médio de parcela por Classificação desconhecida ─────────
  // Usado para sugerir um Produto cadastrado com valor compatível (±2%).
  const classificationAvgValues = useMemo(() => {
    const map = new Map<string, number>();
    if (mode !== 'kamino') return map;
    const sums = new Map<string, { total: number; count: number }>();
    for (const r of validRows) {
      const p = r.data?.product;
      if (!p) continue;
      const insts = (r.data as { installments?: Installment[] })?.installments ?? [];
      for (const i of insts) {
        const v = i.value || 0;
        if (v <= 0) continue;
        const s = sums.get(p) ?? { total: 0, count: 0 };
        s.total += v; s.count += 1;
        sums.set(p, s);
      }
    }
    for (const [k, s] of sums) if (s.count > 0) map.set(k, s.total / s.count);
    return map;
  }, [mode, validRows]);

  const suggestProductByValue = (avg: number | undefined) => {
    if (!avg || avg <= 0) return null;
    let best: { product: Product; diff: number } | null = null;
    for (const p of products) {
      if (!p.value || p.value <= 0) continue;
      const diff = Math.abs(p.value - avg) / p.value;
      if (diff <= 0.02 && (!best || diff < best.diff)) best = { product: p, diff };
    }
    return best?.product ?? null;
  };

  // ─── Kamino: Contas de Recebimento únicas presentes na planilha ────────────
  // Cada uma é apresentada ao usuário como "candidata a virar tag" — ele decide
  // antes do import se quer transformá-la em tag aplicada às parcelas correspondentes.
  // Contas já existentes como tag no catálogo continuam pré-marcadas como "tag".
  const contasRecebimento = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const set = new Set<string>();
    for (const r of validRows) {
      const insts = r.data?.installments ?? [];
      for (const inst of insts) {
        for (const t of inst.tags ?? []) {
          if (typeof t === 'string' && t.startsWith('__conta__:')) {
            set.add(t.slice('__conta__:'.length));
          }
        }
      }
    }
    return Array.from(set);
  }, [mode, validRows]);

  // ─── Kamino: Centros de Custo desconhecidos (≠ Antecipação/Cancelamento/Negativação/Tmf) ───
  // Mesma lógica das contas: cada palavra única é candidata a tag e o usuário decide.
  const centrosCustoDesconhecidos = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const set = new Set<string>();
    for (const r of validRows) {
      const insts = r.data?.installments ?? [];
      for (const inst of insts) {
        for (const t of inst.tags ?? []) {
          if (typeof t === 'string' && t.startsWith('__cc__:')) {
            set.add(t.slice('__cc__:'.length));
          }
        }
      }
    }
    return Array.from(set);
  }, [mode, validRows]);

  // ─── Kamino: Centros de Custo CONHECIDOS (Antecipação/Cancelamento/Tmf) ────
  // Detectados na planilha — agora também passam por confirmação para virar tag.
  const centrosCustoConhecidos = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const set = new Set<string>();
    for (const r of validRows) {
      const insts = r.data?.installments ?? [];
      for (const inst of insts) {
        for (const t of inst.tags ?? []) {
          if (typeof t === 'string' && t.startsWith('__cck__:')) {
            set.add(t.slice('__cck__:'.length));
          }
        }
      }
    }
    return Array.from(set);
  }, [mode, validRows]);

  // ─── Kamino: Classificações de Recompra detectadas ─────────────────────────
  const recompraClassificacoes = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const set = new Set<string>();
    for (const r of validRows) {
      const insts = r.data?.installments ?? [];
      for (const inst of insts) {
        for (const t of inst.tags ?? []) {
          if (typeof t === 'string' && t.startsWith('__recompra__:')) {
            set.add(t.slice('__recompra__:'.length));
          }
        }
      }
    }
    return Array.from(set);
  }, [mode, validRows]);

  // ─── Kamino: Formas de Recebimento detectadas (coluna I) ───────────────────
  const formasRecebimento = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const set = new Set<string>();
    for (const r of validRows) {
      const insts = r.data?.installments ?? [];
      for (const inst of insts) {
        for (const t of inst.tags ?? []) {
          if (typeof t === 'string' && t.startsWith('__forma__:')) {
            set.add(t.slice('__forma__:'.length));
          }
        }
      }
    }
    return Array.from(set);
  }, [mode, validRows]);

  // ─── Kamino: Candidatos a AC extraídos do Centro de Custo ──────────────────
  // Apenas candidatos que NÃO batem com nenhum AC já cadastrado entram aqui.
  const acCandidates = useMemo(() => {
    if (mode !== 'kamino') return [] as string[];
    const acSet = new Set(acs.filter((a) => a.active).map((a) => a.name.toLowerCase()));
    const set = new Set<string>();
    for (const r of validRows) {
      const cand = r.data?.acCandidate;
      if (cand && !acSet.has(cand.toLowerCase())) set.add(cand);
    }
    return Array.from(set);
  }, [mode, validRows, acs]);

  const pendingKaminoDecisionCount = useMemo(() => {
    if (mode !== 'kamino') return 0;
    return unknownClassificacoes.length + contasRecebimento.length + centrosCustoDesconhecidos.length + centrosCustoConhecidos.length + recompraClassificacoes.length + formasRecebimento.length + acCandidates.length;
  }, [mode, unknownClassificacoes, contasRecebimento, centrosCustoDesconhecidos, centrosCustoConhecidos, recompraClassificacoes, formasRecebimento, acCandidates]);

  const openKaminoDecisionModal = () => {
    if (mode !== 'kamino' || pendingKaminoDecisionCount === 0) return;
    const studentScopeTags = studentTags.filter((t) => (t.scope ?? 'student') === 'student');
    const initNames = <T extends string>(items: T[]) => Object.fromEntries(items.map((item) => [item, item])) as Record<string, string>;
    setClassTagNames((prev) => ({ ...initNames(unknownClassificacoes), ...prev }));
    setContaTagNames((prev) => ({ ...initNames(contasRecebimento), ...prev }));
    setCcTagNames((prev) => ({ ...initNames(centrosCustoDesconhecidos), ...prev }));
    setCckTagNames((prev) => ({ ...initNames(centrosCustoConhecidos), ...prev }));
    setRecompraTagNames((prev) => ({ ...initNames(recompraClassificacoes), ...prev }));
    setFormaTagNames((prev) => ({ ...initNames(formasRecebimento), ...prev }));
    setClassDecisions((prev) => {
      const next = { ...prev };
      for (const c of unknownClassificacoes) if (!next[c]) next[c] = products.length > 0 ? 'treinamento-existente' : 'treinamento';
      return next;
    });
    const ensureTagDecision = <T extends string>(items: T[], setter: Dispatch<SetStateAction<Record<string, TagDecision>>>) => {
      setter((prev) => {
        const next = { ...prev };
        for (const c of items) if (!next[c]) next[c] = studentScopeTags.some((t) => t.name.toLowerCase() === c.toLowerCase()) ? 'tag' : 'ignorar';
        return next;
      });
    };
    ensureTagDecision(contasRecebimento, setContaDecisions);
    ensureTagDecision(centrosCustoDesconhecidos, setCcDecisions);
    ensureTagDecision(centrosCustoConhecidos, setCckDecisions);
    ensureTagDecision(recompraClassificacoes, setRecompraDecisions);
    ensureTagDecision(formasRecebimento, setFormaDecisions);
    // Decisões de Assessor: default 'atribuir' (admin precisa escolher um AC existente).
    // Regra de negócio: AC só pode existir se houver usuário cadastrado primeiro.
    setAcDecisions((prev) => {
      const next = { ...prev };
      for (const c of acCandidates) if (!next[c]) next[c] = 'atribuir';
      return next;
    });

    setShowClassDecisionModal(true);
  };

  useEffect(() => {
    if (mode !== 'kamino' || rows.length === 0 || pendingKaminoDecisionCount === 0) return;
    const key = [fileName, rows.length, unknownClassificacoes.join('|'), contasRecebimento.join('|'), centrosCustoDesconhecidos.join('|'), centrosCustoConhecidos.join('|'), recompraClassificacoes.join('|'), formasRecebimento.join('|'), acCandidates.join('|')].join('::');
    if (key === autoDecisionPromptKey) return;
    setAutoDecisionPromptKey(key);
    openKaminoDecisionModal();
  }, [mode, rows.length, pendingKaminoDecisionCount, fileName, unknownClassificacoes, contasRecebimento, centrosCustoDesconhecidos, centrosCustoConhecidos, recompraClassificacoes, formasRecebimento, acCandidates, autoDecisionPromptKey]);

  const validateKaminoDecisions = () => {
    if (mode !== 'kamino') return true;
    const productNames = new Set(products.map((p) => p.name.toLowerCase()));
    const tagNames = new Set(studentTags.filter((t) => (t.scope ?? 'student') === 'student').map((t) => t.name.toLowerCase()));
    for (const c of unknownClassificacoes) {
      const decision = classDecisions[c] ?? (products.length > 0 ? 'treinamento-existente' : 'treinamento');
      const name = (classTagNames[c] ?? c).trim();
      if (!name) { toast.error(`Informe o destino da classificação "${c}"`); return false; }
      if (decision === 'treinamento-existente' && !productNames.has(name.toLowerCase())) { toast.error(`Selecione um treinamento cadastrado para "${c}"`); return false; }
      if (decision === 'tag-existente' && !tagNames.has(name.toLowerCase())) { toast.error(`Selecione uma tag cadastrada para "${c}"`); return false; }
    }
    // Valida decisões de Assessor: se "atribuir", precisa ter AC escolhido.
    const acNamesLower = new Set(acs.map((a) => a.name.toLowerCase()));
    for (const cand of acCandidates) {
      const dec = acDecisions[cand] ?? 'atribuir';

      if (dec === 'atribuir') {
        const chosen = (acAssign[cand] ?? '').trim();
        if (!chosen || !acNamesLower.has(chosen.toLowerCase())) {
          toast.error(`Selecione um AC existente para "${cand}"`);
          return false;
        }
      }
    }
    return true;
  };

  const handleCleanNamelessStudents = async () => {
    // Considera "sem nome" qualquer ficha cujo nome esteja vazio,
    // contenha apenas espaços, traços ou seja literalmente "Sem Nome".
    const isNameless = (n: string | undefined | null) => {
      const v = (n ?? '').trim();
      if (!v) return true;
      if (/^[-—_\s]+$/.test(v)) return true;
      if (/^sem\s*nome$/i.test(v)) return true;
      return false;
    };
    const nameless = students.filter((s) => isNameless(s.name));
    if (nameless.length === 0) {
      alert('Nenhum aluno sem nome encontrado.');
      return;
    }
    const totalParcelasAbertas = nameless.reduce(
      (acc, s) => acc + (s.installments || []).filter((i) => !i.paid).reduce((a, i) => a + (i.value || 0), 0),
      0
    );
    const linhas = nameless
      .slice(0, 20)
      .map((s) => `• ${s.name || '(vazio)'} — ${(s.installments || []).length} parcela(s)`)
      .join('\n');
    const extra = nameless.length > 20 ? `\n…e mais ${nameless.length - 20}` : '';
    const ok = await confirm({
      title: 'Excluir alunos sem nome',
      description: `Encontrado(s) ${nameless.length} aluno(s) sem nome (R$ ${totalParcelasAbertas.toFixed(2).replace('.', ',')} em parcelas em aberto).\n\n${linhas}${extra}\n\nExcluir todos? Esta ação não pode ser desfeita.`,
      variant: 'destructive',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    setCleaning(true);
    try {
      for (const s of nameless) deleteStudent(s.id);
      alert(`${nameless.length} aluno(s) sem nome excluído(s).`);
    } finally {
      setCleaning(false);
    }
  };

  // ─── Helpers de edição inline ────────────────────────────────────────────
  // Abre o editor inline para a linha; pré-popula o draft com a `raw` atual.
  const openRowEditor = (rowIndex: number) => {
    const row = rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return;
    setEditingRowIndex(rowIndex);
    setEditDraft({ ...row.raw });
    setCreatingAcName('');
    setCreatingProductName('');
  };

  const closeRowEditor = () => {
    setEditingRowIndex(null);
    setEditDraft({});
    setCreatingAcName('');
    setCreatingProductName('');
  };

  const openDiagnosticEditor = (student: Student) => {
    setEditingDiagnosticStudentId(student.id);
    setStudentEditDraft({
      name: student.name,
      whatsapp: student.whatsapp,
      email: student.email ?? '',
      cpf: student.cpf,
      ac: student.ac,
      product: student.product,
      enrollmentDate: student.enrollmentDate,
      dueDay: student.dueDay,
      saleValue: student.saleValue,
      downPayment: student.downPayment,
      totalInstallments: student.totalInstallments,
      paidInstallments: student.paidInstallments,
      installmentValue: student.installmentValue,
    });
    setCreatingAcName('');
    setCreatingProductName('');
  };

  const closeDiagnosticEditor = () => {
    setEditingDiagnosticStudentId(null);
    setStudentEditDraft({});
    setCreatingAcName('');
    setCreatingProductName('');
  };

  const refreshDiagnosticEntry = (entry: DiagnosticEntry, currentStudents: Student[] = useAppStore.getState().students): DiagnosticEntry => {
    const expectedName = entry.expectedName ?? entry.name.replace(/\s*⚠️.*$/, '');
    const expectedProduct = entry.expectedProduct ?? entry.product;
    const matches = currentStudents.filter(
      (s) => s.name.toLowerCase() === expectedName.toLowerCase() && s.product.toLowerCase() === expectedProduct.toLowerCase()
    );
    if (matches.length === 0) {
      return { ...entry, name: expectedName, product: expectedProduct, returnedInstallments: 0, match: false, studentIds: [] };
    }
    const returnedInstallments = matches.reduce((acc, m) => acc + (m.installments?.length ?? 0), 0);
    return {
      ...entry,
      name: matches.length > 1 ? `${expectedName} ⚠️ (${matches.length} fichas no banco!)` : expectedName,
      product: expectedProduct,
      returnedInstallments,
      match: matches.length === 1 && returnedInstallments === entry.sentInstallments,
      studentIds: matches.map((m) => m.id),
    };
  };

  // Remove uma linha da pré-visualização (não toca no banco — apenas descarta
  // antes da importação). Útil para casos sem solução: duplicados, lixo etc.
  const handleRemoveRow = async (rowIndex: number) => {
    const row = rows.find((r) => r.rowIndex === rowIndex);
    const displayName = row ? normalizeString(row.raw['Nome'] || row.raw['Pessoa']) : '';
    const ok = await confirm({
      title: 'Remover linha da importação',
      description: `Remover ${mode === 'kamino' ? 'aluno' : 'linha'} ${rowIndex}${displayName ? ` (${displayName})` : ''} da pré-visualização? Esta linha será ignorada na importação.`,
      variant: 'destructive',
      confirmText: 'Remover',
    });
    if (!ok) return;
    setRows((curr) => curr.filter((r) => r.rowIndex !== rowIndex));
    if (editingRowIndex === rowIndex) closeRowEditor();
    toast.success('Linha removida da importação');
  };

  // Remove TODAS as linhas com o mesmo nome de aluno (útil quando o mesmo
  // cliente aparece em várias linhas com o mesmo erro).
  const handleRemoveStudentGroup = async (studentName: string, rowIndexes: number[]) => {
    const ok = await confirm({
      title: 'Remover aluno da importação',
      description: `Remover ${rowIndexes.length} linha(s) do aluno "${studentName}" da pré-visualização? Todas as linhas dele serão ignoradas na importação.`,
      variant: 'destructive',
      confirmText: 'Remover tudo',
    });
    if (!ok) return;
    const idxSet = new Set(rowIndexes);
    setRows((curr) => curr.filter((r) => !idxSet.has(r.rowIndex)));
    if (editingRowIndex != null && idxSet.has(editingRowIndex)) closeRowEditor();
    toast.success(`${rowIndexes.length} linha(s) de "${studentName}" removida(s)`);
  };

  const handleRemoveDiagnosticStudent = async (student: Student, entry: DiagnosticEntry) => {
    const ok = await confirm({
      title: 'Excluir ficha do banco',
      description: `Excluir a ficha de ${student.name}${student.product ? ` — ${student.product}` : ''}?\n\nIsso remove esta ficha duplicada/problemática do banco.`,
      variant: 'destructive',
      confirmText: 'Excluir ficha',
    });
    if (!ok) return;
    deleteStudent(student.id);
    if (editingDiagnosticStudentId === student.id) closeDiagnosticEditor();
    const nextStudents = useAppStore.getState().students.filter((s) => s.id !== student.id);
    setDiagnostics((curr) => curr?.map((d) => d === entry ? refreshDiagnosticEntry(entry, nextStudents) : d) ?? null);
    toast.success('Ficha excluída do banco');
  };

  const handleDismissDiagnosticEntry = async (entry: DiagnosticEntry) => {
    const ok = await confirm({
      title: 'Remover erro do diagnóstico',
      description: `Remover este erro da lista?\n\nUse isso quando você decidiu ignorar este item e não quer mais bloqueá-lo nesta importação.`,
      variant: 'destructive',
      confirmText: 'Remover erro',
    });
    if (!ok) return;
    setDiagnostics((curr) => curr?.filter((d) => d !== entry) ?? null);
    toast.success('Erro removido da lista');
  };

  const handleSaveDiagnosticStudent = async (student: Student, entry: DiagnosticEntry) => {
    setSavingDiagnosticStudent(true);
    try {
      const name = normalizeString(studentEditDraft.name);
      const whatsapp = normalizeString(studentEditDraft.whatsapp);
      const ac = normalizeString(studentEditDraft.ac);
      const product = normalizeString(studentEditDraft.product);
      const enrollmentDate = normalizeString(studentEditDraft.enrollmentDate) || student.enrollmentDate;
      const dueDay = normalizeNumber(studentEditDraft.dueDay) ?? student.dueDay;
      const saleValue = normalizeNumber(studentEditDraft.saleValue) ?? student.saleValue;
      const downPayment = normalizeNumber(studentEditDraft.downPayment) ?? student.downPayment;
      const totalInstallments = normalizeNumber(studentEditDraft.totalInstallments) ?? student.totalInstallments;
      const paidInstallments = normalizeNumber(studentEditDraft.paidInstallments) ?? student.paidInstallments;
      const installmentValue = normalizeNumber(studentEditDraft.installmentValue) ?? student.installmentValue;

      if (!name) { toast.error('Nome obrigatório'); return; }
      if (!whatsapp) { toast.error('WhatsApp obrigatório'); return; }
      if (!ac) { toast.error('AC obrigatório'); return; }

      let installments = student.installments;
      if (
        totalInstallments !== student.totalInstallments ||
        installmentValue !== student.installmentValue ||
        dueDay !== student.dueDay ||
        enrollmentDate !== student.enrollmentDate ||
        paidInstallments !== student.paidInstallments
      ) {
        installments = generateInstallments(dueDay, totalInstallments, installmentValue, 0, enrollmentDate);
        for (let i = 0; i < Math.min(paidInstallments, installments.length); i++) {
          installments[i].paid = true;
          installments[i].paidDate = new Date().toISOString().split('T')[0];
        }
      }

      const updated: Partial<Student> = {
        name,
        whatsapp,
        email: normalizeString(studentEditDraft.email) || undefined,
        cpf: normalizeString(studentEditDraft.cpf),
        ac,
        product,
        enrollmentDate,
        data_treinamento_origem: student.data_treinamento_origem ?? enrollmentDate,
        dueDay,
        saleValue,
        downPayment,
        totalInstallments,
        paidInstallments,
        installmentValue,
        installments,
      };

      updateStudent(student.id, updated);
      const nextStudents = useAppStore.getState().students.map((s) => s.id === student.id ? { ...s, ...updated } as Student : s);
      setDiagnostics((curr) => curr?.map((d) => d === entry ? refreshDiagnosticEntry(entry, nextStudents) : d) ?? null);
      toast.success('Ficha atualizada');
      closeDiagnosticEditor();
    } finally {
      setSavingDiagnosticStudent(false);
    }
  };

  // Bloqueado por regra de negócio: AC só é criado a partir de um usuário cadastrado
  // em Configurações → Controle de Acesso. Mantemos a função para compatibilidade,
  // mas ela apenas exibe uma instrução clara.
  const handleCreateAcInline = async (): Promise<string | null> => {
    toast.error('Para criar um novo AC, cadastre primeiro o usuário em Configurações → Controle de Acesso. O AC é vinculado automaticamente.');
    return null;
  };


  // Cria Produto novo direto do editor — atualiza store local imediatamente.
  const handleCreateProductInline = async (): Promise<string | null> => {
    const name = creatingProductName.trim();
    if (!name) { toast.error('Digite o nome do Produto'); return null; }
    if (products.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`Produto "${name}" já existe`);
      return null;
    }
    try {
      const row = await createProduct({ name, value: undefined });
      const created: Product = { id: row.id, name: row.name, value: row.value ?? undefined };
      setStoreState((s) => ({ products: [...s.products, created] }));
      toast.success(`Produto "${name}" criado`);
      setCreatingProductName('');
      return name;
    } catch (e: any) {
      toast.error(`Falha ao criar produto: ${e?.message || e}`);
      return null;
    }
  };

  // Re-valida UMA linha específica usando o parser correspondente ao modo.
  // Padrão: roda parsePadrao em `[draft]` e mantém o rowIndex original.
  // Kamino: re-valida apenas os campos editáveis na própria `data`/`raw`.
  /**
   * Aplica patch (subset de campos) à linha-âncora e, opcionalmente, a todas
   * as linhas do mesmo aluno. Reusada pelo editor completo e pela quick-fix.
   */
  const applyPatchToRows = async (
    anchorRowIndex: number,
    patch: Record<string, unknown>,
    propagateToSameStudent: boolean
  ): Promise<number> => {
    const XLSX = await loadXLSX();
    let appliedCount = 0;
    setRows((curr) => {
      const idx = curr.findIndex((r) => r.rowIndex === anchorRowIndex);
      if (idx === -1) return curr;
      const original = curr[idx];

      // Merge patch sobre o raw original para obter o "draft efetivo"
      const effectiveDraft = { ...original.raw, ...patch };

      const editedName = (
        mode === 'padrao'
          ? normalizeString(effectiveDraft['Nome'])
          : normalizeString(effectiveDraft['Pessoa'])
      ).toLowerCase();
      const targetIndexes = new Set<number>([idx]);
      if (propagateToSameStudent && editedName) {
        curr.forEach((r, i) => {
          if (i === idx) return;
          const otherName = normalizeString(
            mode === 'padrao' ? r.raw['Nome'] : r.raw['Pessoa']
          ).toLowerCase();
          if (otherName && otherName === editedName) targetIndexes.add(i);
        });
      }

      const next = [...curr];

      if (mode === 'padrao') {
        const reparsed = parsePadrao([effectiveDraft], XLSX);
        const newMain: ParsedRow = { ...reparsed[0], rowIndex: original.rowIndex, raw: effectiveDraft };
        next[idx] = newMain;
        appliedCount = 1;
        if (targetIndexes.size > 1) {
          const identityKeys = ['Nome', 'WhatsApp', 'E-mail', 'CPF', 'Endereço', 'Número', 'Cidade', 'Estado', 'CEP', 'AC', 'Produto'];
          for (const i of targetIndexes) {
            if (i === idx) continue;
            const otherRaw = { ...next[i].raw };
            for (const k of identityKeys) {
              if (effectiveDraft[k] !== undefined) otherRaw[k] = effectiveDraft[k];
            }
            const reparsedOther = parsePadrao([otherRaw], XLSX);
            next[i] = { ...reparsedOther[0], rowIndex: next[i].rowIndex, raw: otherRaw };
            appliedCount++;
          }
        }
        return next;
      }

      // Kamino
      const acNamesSet = new Set(acs.filter((g) => g.active).map((g) => g.name.toLowerCase()));
      const identityKeysKamino = ['Pessoa', 'Telefone', 'E-mail', 'Assessor', 'Classificação'];

      const applyToRow = (rowIdx: number, sourceRaw: Record<string, unknown>) => {
        const target = next[rowIdx];
        const newRaw = { ...target.raw };
        for (const k of identityKeysKamino) {
          if (sourceRaw[k] !== undefined) newRaw[k] = sourceRaw[k];
        }
        const nome = normalizeString(newRaw['Pessoa']) || 'Sem Nome';
        const whatsapp = normalizeString(newRaw['Telefone']);
        const email = normalizeString(newRaw['E-mail']);
        const acName = normalizeString(newRaw['Assessor']);
        const produto = normalizeString(newRaw['Classificação']) || 'Sem Treinamento';

        const newErrors: string[] = [];
        if (!acName) newErrors.push('Assessor vazio');
        else if (!acNamesSet.has(acName.toLowerCase())) newErrors.push(`AC "${acName}" não cadastrado (será importado assim mesmo)`);

        const structuralErrors = (target.errors || []).filter((e) =>
          /vencimento|duplicado|cadastrado anteriormente/i.test(e)
        );

        const baseData = target.data ?? null;
        let newData: ParsedRow['data'] = baseData;
        if (baseData) {
          newData = { ...baseData, name: nome, whatsapp, email: email || undefined, ac: acName, product: produto };
        } else if (structuralErrors.length === 0) {
          newErrors.push('Não é possível recuperar parcelas; reimporte o arquivo.');
        }

        const finalErrors = [...structuralErrors, ...newErrors];
        next[rowIdx] = {
          rowIndex: target.rowIndex,
          raw: newRaw,
          data: structuralErrors.length === 0 ? newData : null,
          errors: finalErrors,
        };
        appliedCount++;
      };

      applyToRow(idx, effectiveDraft);
      if (targetIndexes.size > 1) {
        for (const i of targetIndexes) {
          if (i !== idx) applyToRow(i, effectiveDraft);
        }
      }
      return next;
    });
    return appliedCount;
  };

  const handleSaveRowEdit = async () => {
    if (editingRowIndex == null) return;
    setSavingRow(true);
    try {
      const appliedCount = await applyPatchToRows(editingRowIndex, editDraft, applyToAllSameStudent);
      toast.success(
        appliedCount > 1
          ? `Correção aplicada a ${appliedCount} linha(s) do mesmo aluno`
          : 'Linha atualizada'
      );
      closeRowEditor();
    } catch (err: any) {
      toast.error(`Erro ao salvar: ${err?.message || err}`);
    } finally {
      setSavingRow(false);
    }
  };

  /**
   * Quick-fix: aplica correção de um único campo (AC ou Produto) a todas as
   * linhas do grupo de aluno, sem precisar abrir o editor completo.
   */
  const handleQuickFix = async (
    anchorRowIndex: number,
    field: string,
    value: string
  ) => {
    try {
      const count = await applyPatchToRows(anchorRowIndex, { [field]: value }, true);
      toast.success(
        count > 1
          ? `${field} atualizado em ${count} linha(s)`
          : `${field} atualizado`
      );
    } catch (err: any) {
      toast.error(`Erro: ${err?.message || err}`);
    }
  };

  const handleDownloadTemplate = async () => {
    let XLSX: XLSXModule;
    try { XLSX = await loadXLSX(); } catch (err) { alert((err as Error).message); return; }

    if (mode === 'kamino') {
      const acExample = acs[0]?.name ?? 'Bruno Pretto';
      const kaminoExample: Record<string, string | number> = {
        'Pessoa': 'João da Silva',
        'Telefone': '(11) 99999-9999',
        'E-mail': 'joao@exemplo.com',
        'Classificação': products[0]?.name ?? 'Treinamento Exemplo',
        'Centro de Custo': `Antecipação/Tmf 2 (${acExample}) (IAM - GC 2 (${acExample}))`,
        'Conta de Recebimento': 'Conta Caixa - Academy',
        'Forma de Recebimento': 'Legado',
        'Detalhe': '',
        'Valor a Receber (R$)': 375,
        'Valor Recebido (R$)': 0,
        'Vencimento': '10/01/2026',
        'Recebimento': '',
        'Competência': '01/01/2026',
      };
      const ws = XLSX.utils.aoa_to_sheet([
        [...KAMINO_COLUMNS],
        KAMINO_COLUMNS.map((column) => kaminoExample[column] ?? ''),
      ]);
      (ws as Record<string, unknown>)['!cols'] = KAMINO_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Kamino');
      downloadXlsx(XLSX, wb, 'modelo-importacao-kamino.xlsx');
      return;
    }

    const acExample = acs[0]?.name ?? 'AC Exemplo';
    const productExample = products[0]?.name ?? 'Produto Exemplo';
    const example: Record<string, string | number> = {
      'Nome': 'João da Silva', 'WhatsApp': '(11) 99999-9999', 'E-mail': 'joao@exemplo.com', 'CPF': '000.000.000-00',
      'Endereço': 'Rua Exemplo', 'Número': '123', 'Cidade': 'São Paulo', 'Estado': 'SP', 'CEP': '01000-000',
      'AC': acExample, 'Produto': productExample, 'Ciclo': '2026',
      'Data de Inscrição': '01/01/2026', 'Data de Competência': '01/01/2026',
      'Dia de Vencimento': 10, 'Primeiro Vencimento': '10/03/2026',
      'Valor Contrato': 5000, 'Entrada': 500,
      'Nº Parcelas': 12, 'Valor Parcela': 375, 'Qtd Parcelas Pagas': 0, 'Status': 'Aluno Novo',
      'Tags': 'Renovação, Antecipação',
    };
    const ws = XLSX.utils.aoa_to_sheet([
      [...TEMPLATE_COLUMNS],
      TEMPLATE_COLUMNS.map((column) => example[column] ?? ''),
    ]);
    (ws as Record<string, unknown>)['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
    downloadXlsx(XLSX, wb, 'modelo-importacao-alunos.xlsx');
  };

  // ─── Parse Padrão ───────────────────────────────────────────────────────────
  const parsePadrao = (json: Record<string, unknown>[], XLSX: XLSXModule) => {
    // Chave de duplicidade: CPF + Ciclo (normalizado). Permite o mesmo CPF
    // em múltiplos ciclos (ex.: renovação anual Liberty 2026, 2027...).
    const cpfCicloKey = (cpf: string, ciclo: string) =>
      `${cpf.replace(/\D/g, '')}||${ciclo.trim().toLowerCase()}`;
    const existingCpfCiclo = new Set(
      students
        .filter((s) => s.cpf)
        .map((s) => cpfCicloKey(s.cpf, s.ciclo ?? ''))
    );
    const seenInSheet = new Set<string>();
    const acNames = new Set(acs.filter((g) => g.active).map((g) => g.name.toLowerCase()));
    const productNames = new Set(products.map((p) => p.name.toLowerCase()));

    return json.map((row, idx): ParsedRow => {
      const blocking: string[] = [];
      const warnings: string[] = [];
      const nome = normalizeString(row['Nome']);
      const whatsapp = normalizeString(row['WhatsApp']);
      const cpf = normalizeString(row['CPF']);
      const endereco = normalizeString(row['Endereço']);
      const numero = normalizeString(row['Número']);
      const cidade = normalizeString(row['Cidade']);
      const estado = normalizeString(row['Estado']);
      const cep = normalizeString(row['CEP']);
      const ac = normalizeString(row['AC']);
      const produto = normalizeString(row['Produto']);
      // Ciclo só é considerado na empresa Liberty (renovação anual). Em outras
      // empresas (ex.: IAM) a coluna é ignorada para não criar ficha duplicada.
      const ciclo = isLibertyCompany ? normalizeString(row['Ciclo']) : '';
      const dataMatricula = normalizeDate(row['Data de Inscrição'], XLSX);
      const dataTreinamentoOrigem = normalizeDate(row['Data de Competência'], XLSX);
      const diaVenc = normalizeNumber(row['Dia de Vencimento']);
      const firstDueDate = normalizeDate(row['Primeiro Vencimento'], XLSX) ?? undefined;
      const valorVenda = normalizeNumber(row['Valor Contrato']);
      const entrada = normalizeNumber(row['Entrada']);
      const nParc = normalizeNumber(row['Nº Parcelas']);
      const valorParc = normalizeNumber(row['Valor Parcela']);
      const parcelasPagas = normalizeNumber(row['Qtd Parcelas Pagas']);
      const statusRaw = normalizeString(row['Status']);
      const emailRaw = normalizeString(row['E-mail'] ?? row['Email']);

      if (!nome) blocking.push('Nome vazio');
      if (!whatsapp) blocking.push('WhatsApp vazio');
      if (!cpf) warnings.push('CPF vazio (opcional)');
      else {
        const key = cpfCicloKey(cpf, ciclo);
        const cicloLabel = ciclo ? ` (Ciclo "${ciclo}")` : '';
        if (existingCpfCiclo.has(key)) blocking.push(`CPF já cadastrado${cicloLabel}`);
        else if (seenInSheet.has(key)) blocking.push(`Linha duplicada na planilha${cicloLabel}`);
        else seenInSheet.add(key);
      }
      if (!ac) blocking.push('AC vazio');
      else if (!acNames.has(ac.toLowerCase())) blocking.push(`AC "${ac}" não cadastrado`);
      if (!produto) blocking.push('Produto vazio');
      else if (productNames.size > 0 && !productNames.has(produto.toLowerCase())) blocking.push(`Produto "${produto}" não cadastrado`);
      if (!dataMatricula) blocking.push('Data de Inscrição inválida');
      if (diaVenc == null || diaVenc < 1 || diaVenc > 31) blocking.push('Dia de Vencimento inválido');
      if (valorVenda == null || valorVenda < 0) blocking.push('Valor Contrato inválido');
      if (entrada == null || entrada < 0) blocking.push('Entrada inválida');
      if (nParc == null || nParc < 1) blocking.push('Nº Parcelas inválido');
      if (valorParc == null || valorParc < 0) blocking.push('Valor Parcela inválido');

      // Campos opcionais de cadastro — geram apenas aviso, importação pode prosseguir.
      if (!endereco) warnings.push('Endereço vazio (opcional)');
      if (!cidade) warnings.push('Cidade vazia (opcional)');
      if (!estado) warnings.push('Estado vazio (opcional)');
      if (!cep) warnings.push('CEP vazio (opcional)');
      if (!emailRaw) warnings.push('E-mail vazio (opcional)');

      let statusFinal: StudentStatus = 'Aluno Novo';
      if (statusRaw) {
        const match = STATUS_VALIDOS.find((s) => s.toLowerCase() === statusRaw.toLowerCase());
        if (!match) blocking.push(`Status "${statusRaw}" inválido`);
        else statusFinal = match;
      }

      if (blocking.length > 0) return { rowIndex: idx + 2, raw: row, data: null, errors: [...blocking, ...warnings] };

      const email = emailRaw;
      const tagsRaw = normalizeString(row['Tags']);
      const pendingTagNames = tagsRaw
        ? Array.from(new Set(tagsRaw.split(/[,;]/).map((t) => t.trim()).filter(Boolean)))
        : undefined;
      const data: Omit<Student, 'id' | 'installments' | 'history'> & KaminoExtras = {
        name: nome, whatsapp, email: email || undefined, cpf, address: endereco, numero, cidade, estado, cep,
        status: statusFinal, statusMode: 'Automático', ac, product: produto,
        ciclo: ciclo || undefined,
        enrollmentDate: dataMatricula!, data_treinamento_origem: dataTreinamentoOrigem || dataMatricula!,
        dueDay: diaVenc!, saleValue: valorVenda!, downPayment: entrada!,
        totalInstallments: nParc!, paidInstallments: parcelasPagas ?? 0, installmentValue: valorParc!,
        pendingTagNames,
        firstDueDate,
      };
      return { rowIndex: idx + 2, raw: row, data, errors: warnings };
    });
  };

  // ─── Parse Kamino (novo formato) ───────────────────────────────────────────
  const parseKamino = (json: Record<string, unknown>[], XLSX: XLSXModule) => {
    // Cada linha = 1 parcela. Agrupa por Pessoa + Classificação (Treinamento).
    // EXCEÇÃO: linhas com Classificação contendo "Recompra" são mescladas no
    // fluxo principal do mesmo aluno (não duplicam ficha). Se não houver fluxo
    // principal, a Recompra vira a ficha base.
    type Group = { nome: string; produto: string; rows: Record<string, unknown>[]; recompraRows: Record<string, unknown>[] };
    const groups = new Map<string, Group>();
    const recompraPending = new Map<string, Record<string, unknown>[]>(); // por nome
    for (const row of json) {
      // Linhas sem Pessoa viram a ficha "Sem Nome" (agrupadas por Classificação).
      const nome = normalizeString(row['Pessoa']) || 'Sem Nome';
      const produto = normalizeString(row['Classificação']) || KAMINO_TAG_ONLY_PRODUCT;
      if (isRecompraClassificacao(produto)) {
        const k = nome.toLowerCase();
        if (!recompraPending.has(k)) recompraPending.set(k, []);
        recompraPending.get(k)!.push(row);
        continue;
      }
      const key = `${nome.toLowerCase()}||${produto.toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { nome, produto, rows: [], recompraRows: [] });
      groups.get(key)!.rows.push(row);
    }
    // Anexa as Recompras ao contrato CORRETO do aluno.
    // Quando o aluno tem 2+ contratos, o vínculo é decidido POR PARCELA usando
    // valor da parcela + dia de vencimento (antes era só pelo nome, o que jogava
    // parcelas de um contrato no outro).
    const attachToExistingByGroupKey = new Map<string, string>(); // groupKey → existing studentId
    const rowValor = (r: Record<string, unknown>) =>
      normalizeNumber(r['Valor a Receber (R$)']) ?? normalizeNumber(r['Valor Recebido (R$)']) ?? null;
    const rowDia = (r: Record<string, unknown>) => {
      const d = normalizeDate(r['Vencimento'], XLSX);
      return d ? Number(d.slice(8, 10)) : null;
    };
    /** Pontua o quanto uma parcela de Recompra combina com um conjunto de parcelas. */
    const scoreMatch = (
      valor: number | null,
      dia: number | null,
      valores: number[],
      dias: number[],
    ) => {
      let score = 0;
      if (valor != null && valores.some((v) => Math.abs(v - valor) < 0.01)) score += 2;
      if (dia != null && dias.includes(dia)) score += 1;
      return score;
    };

    for (const [nameKey, recompraRows] of recompraPending) {
      // Candidatos vindos da própria planilha
      const sheetCandidates = Array.from(groups.values())
        .filter((g) => g.nome.toLowerCase() === nameKey)
        .map((g) => ({
          group: g,
          valores: g.rows.map((r) => rowValor(r)).filter((v): v is number => v != null),
          dias: g.rows.map((r) => rowDia(r)).filter((d): d is number => d != null),
        }));
      // Candidatos já existentes no banco (não-Recompra)
      const dbCandidates = students
        .filter((s) => s.name.trim().toLowerCase() === nameKey && !isRecompraClassificacao(s.product || ''))
        .map((s) => ({
          student: s,
          valores: (s.installments ?? []).map((i) => i.value),
          dias: (s.installments ?? []).map((i) => Number((i.dueDate ?? '').slice(8, 10))).filter((d) => !Number.isNaN(d)),
        }));

      for (const row of recompraRows) {
        const cleanRow = { ...row, Classificação: normalizeString(row['Classificação']) };
        const valor = rowValor(row);
        const dia = rowDia(row);

        let bestSheet: (typeof sheetCandidates)[number] | undefined;
        let bestSheetScore = -1;
        for (const c of sheetCandidates) {
          const sc = scoreMatch(valor, dia, c.valores, c.dias);
          if (sc > bestSheetScore) { bestSheetScore = sc; bestSheet = c; }
        }
        let bestDb: (typeof dbCandidates)[number] | undefined;
        let bestDbScore = -1;
        for (const c of dbCandidates) {
          const sc = scoreMatch(valor, dia, c.valores, c.dias);
          if (sc > bestDbScore) { bestDbScore = sc; bestDb = c; }
        }

        // Prefere o contrato presente na planilha, salvo quando um contrato do
        // banco casa melhor (valor + dia) do que qualquer grupo da planilha.
        if (bestSheet && bestSheetScore >= bestDbScore) {
          bestSheet.group.recompraRows.push(cleanRow);
          continue;
        }
        if (bestDb) {
          const produto = bestDb.student.product || 'Sem Treinamento';
          const key = `${nameKey}||${produto.toLowerCase()}`;
          if (!groups.has(key)) {
            groups.set(key, { nome: bestDb.student.name, produto, rows: [], recompraRows: [] });
            attachToExistingByGroupKey.set(key, bestDb.student.id);
          }
          groups.get(key)!.recompraRows.push(cleanRow);
          continue;
        }
        // Sem contrato principal: a própria Recompra vira ficha base.
        const produto = normalizeString(row['Classificação']) || 'Sem Treinamento';
        const nome = normalizeString(row['Pessoa']);
        const key = `${nameKey}||${produto.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { nome, produto, rows: [], recompraRows: [] });
        groups.get(key)!.rows.push(cleanRow);
      }
    }



    const acNames = new Set(acs.filter((g) => g.active).map((g) => g.name.toLowerCase()));
    const existingImportKeys = new Set(
      students.map((student) => buildImportIdentity({
        name: student.name,
        whatsapp: student.whatsapp,
        product: student.product,
        enrollmentDate: student.enrollmentDate,
        saleValue: student.saleValue,
        totalInstallments: student.totalInstallments,
      }))
    );
    const seenImportKeys = new Set<string>();
    const parsed: ParsedRow[] = [];
    let virtualIdx = 0;

    for (const [groupKey, group] of groups) {
      virtualIdx++;
      const { nome, produto } = group;
      const attachToStudentId = attachToExistingByGroupKey.get(groupKey);
      // Linhas de Recompra anexadas ao fluxo principal são marcadas com tag "Recompra".
      const recompraRowSet = new WeakSet<Record<string, unknown>>();
      group.recompraRows.forEach((r) => recompraRowSet.add(r));
      // Também marca linhas cuja própria classificação é Recompra (caso a ficha
      // base seja a Recompra por não haver fluxo principal).
      const rowGroup: Record<string, unknown>[] = [...group.rows, ...group.recompraRows];
      for (const r of rowGroup) {
        const cls = normalizeString(r['Classificação']);
        if (isRecompraClassificacao(cls)) recompraRowSet.add(r);
      }
      const errors: string[] = [];
      const warnings: string[] = [];
      const first = rowGroup[0];

      const whatsapp = normalizeString(first['Telefone']);
      const email = normalizeString(first['E-mail']);

      // ─── AC: extraído do Centro de Custo (coluna F) ─────────────────────────
      // Procura nomes próprios entre parênteses (ex: "(Bruno Pretto)") nas linhas do grupo.
      // Se algum bater com um AC já cadastrado, usa diretamente; caso contrário,
      // o nome vira um candidato (__assessor__:Nome) que o usuário decide no modal pré-importação
      // (atribuir a AC existente / criar novo / ignorar).
      let acName = '';
      const acCandidatesInGroup = new Map<string, number>();
      let hasNegativacao = false;
      let hasCancelamento = false;
      for (const r of rowGroup) {
        const cc = normalizeString(r['Centro de Custo']);
        if (!cc) continue;
        const a = analyzeCentroCusto(cc);
        if (a.hasNegativacao) hasNegativacao = true;
        if (a.hasCancelamento) hasCancelamento = true;
        for (const cand of a.assessorCandidates) {
          acCandidatesInGroup.set(cand, (acCandidatesInGroup.get(cand) ?? 0) + 1);
        }
      }
      // Tenta primeiro um candidato que já bata com AC cadastrado.
      for (const cand of acCandidatesInGroup.keys()) {
        if (acNames.has(cand.toLowerCase())) { acName = cand; break; }
      }
      // Se nenhum candidato bate com AC cadastrado, mantém acName vazio e deixa
      // o candidato mais frequente para o usuário decidir no modal.
      const topAcCandidate = acName
        ? null
        : Array.from(acCandidatesInGroup.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!acName && topAcCandidate) {
        warnings.push(`Possível AC: "${topAcCandidate}" (decida na pré-importação)`);
      } else if (!acName && acCandidatesInGroup.size === 0) {
        warnings.push('Nenhum AC identificado no Centro de Custo');
      }

      // Constrói parcelas reais (1 por linha) preservando datas. Tags vão NA PARCELA.
      const detalhes: string[] = [];
      let earliestVencimento: string | null = null;
      let earliestCompetencia: string | null = null;

      const sortedRows = [...rowGroup].sort((a, b) => {
        const va = normalizeDate(a['Vencimento'], XLSX) ?? '9999-12-31';
        const vb = normalizeDate(b['Vencimento'], XLSX) ?? '9999-12-31';
        return va.localeCompare(vb);
      });


      const installments: Installment[] = [];
      const allTagNames = new Set<string>(); // catálogo de tags geradas (para criar no banco)
      let valorContrato = 0;
      sortedRows.forEach((r, idx) => {
        const venc = normalizeDate(r['Vencimento'], XLSX);
        const recebimento = normalizeDate(r['Recebimento'], XLSX);
        const situacao = normalizeString(r['Situação']).toUpperCase();
        const valorReceber = normalizeNumber(r['Valor a Receber (R$)']) ?? 0;
        const valorRecebido = normalizeNumber(r['Valor Recebido (R$)']);
        const det = normalizeString(r['Detalhe']);
        const comp = normalizeDate(r['Competência'], XLSX);

        if (det && !detalhes.includes(det)) detalhes.push(det);
        if (venc && (!earliestVencimento || venc < earliestVencimento)) earliestVencimento = venc;
        if (comp && (!earliestCompetencia || comp < earliestCompetencia)) earliestCompetencia = comp;

        // Parcela paga se: Situação=PAGO OU Recebimento preenchido OU Valor Recebido > 0
        const paid = situacao === 'PAGO' || !!recebimento || (valorRecebido != null && valorRecebido > 0);

        // ─── Tags POR PARCELA (TODAS são CANDIDATAS) ────────────────────────
        // Nada vira tag automaticamente. Cada palavra/nome é marcada com prefixo
        // interno e só vira tag de fato após confirmação no modal pré-importação.
        //   __cck__:  Centro de Custo conhecido (Antecipação/Cancelamento/Tmf)
        //   __cc__:   Centro de Custo desconhecido (qualquer outra palavra)
        //   __conta__:Conta de Recebimento
        //   __recompra__: Classificação de linhas de Recompra
        const parcelaTags: string[] = [];
        const cc = normalizeString(r['Centro de Custo']);
        if (cc) {
          const a = analyzeCentroCusto(cc);
          if (a.hasAntecipacao) parcelaTags.push('__cck__:Antecipação');
          if (a.hasCancelamento) parcelaTags.push('__cck__:Cancelamento');
          if (a.hasTmf) parcelaTags.push('__cck__:Tmf');
          if (a.unknownLabel) {
            const candidate = `__cc__:${a.unknownLabel}`;
            if (!parcelaTags.includes(candidate)) parcelaTags.push(candidate);
          }
        }
        const cr = normalizeString(r['Conta de Recebimento']);
        const tagFromConta = cr ? extractTagFromContaRecebimento(cr) : null;
        if (tagFromConta) {
          const candidate = `__conta__:${tagFromConta}`;
          if (!parcelaTags.includes(candidate)) parcelaTags.push(candidate);
        }
        const fr = normalizeString(r['Forma de Recebimento']);
        const tagFromForma = fr ? extractTagFromFormaRecebimento(fr) : null;
        if (tagFromForma) {
          const candidate = `__forma__:${tagFromForma}`;
          if (!parcelaTags.includes(candidate)) parcelaTags.push(candidate);
        }
        if (recompraRowSet.has(r)) {
          const clsOriginal = normalizeString(r['Classificação']) || 'Recompra';
          const candidate = `__recompra__:${clsOriginal}`;
          if (!parcelaTags.includes(candidate)) parcelaTags.push(candidate);
        }
        // NÃO populamos `allTagNames` com nada agora — todas as tags passam por
        // confirmação. O catálogo é montado em runImport a partir das decisões.

        valorContrato += valorReceber;
        installments.push({
          number: idx + 1,
          dueDate: venc ?? '',
          value: valorReceber,
          paid,
          paidDate: paid ? (recebimento ?? venc ?? undefined) : undefined,
          tags: parcelaTags.length > 0 ? parcelaTags : undefined,
        });
      });

      const totalInstallments = installments.length;
      const paidCount = installments.filter((i) => i.paid).length;
      const installmentValue = totalInstallments > 0 ? valorContrato / totalInstallments : 0;

      let dueDay = 10;
      if (earliestVencimento) {
        const d = new Date(earliestVencimento + 'T00:00:00');
        if (!isNaN(d.getTime())) dueDay = d.getDate();
      }

      // Nome vazio agora vira ficha "Sem Nome" (já tratado no agrupamento).
      if (!earliestVencimento) errors.push('Nenhuma data de vencimento encontrada');

      const enrollmentDate = earliestCompetencia || earliestVencimento || '';
      const importKey = buildImportIdentity({
        name: nome,
        whatsapp,
        product: produto,
        enrollmentDate,
        saleValue: valorContrato,
        totalInstallments,
      });

      // Quando vamos ANEXAR a uma ficha existente, não aplica os checks de duplicidade
      // de "aluno completo" — vamos só acrescentar parcelas novas.
      if (!attachToStudentId) {
        if (existingImportKeys.has(importKey)) {
          errors.push('Aluno já cadastrado anteriormente');
        } else if (seenImportKeys.has(importKey)) {
          errors.push('Aluno duplicado na planilha');
        }
      }

      if (errors.length > 0) {
        parsed.push({ rowIndex: virtualIdx, raw: first, data: null, errors: [...errors, ...warnings] });
        continue;
      }

      if (!attachToStudentId) seenImportKeys.add(importKey);
      if (attachToStudentId) {
        warnings.push(`Recompra anexada à ficha existente (${produto})`);
      }

      // Status: nunca importar como "Negativado" (transição é manual).
      // Se a planilha indicar Negativação, força "À Negativar"; caso contrário, calcula automático.
      const autoStatus = calculateAutoStatus(installments);
      const status: StudentStatus = hasNegativacao ? 'À Negativar' : autoStatus;

      const data: Omit<Student, 'id' | 'installments' | 'history'> & KaminoExtras = {
        name: nome,
        whatsapp,
        email: email || undefined,
        cpf: '',
        address: '',
        numero: '',
        cidade: '',
        estado: '',
        cep: '',
        status,
        statusMode: 'Automático',
        ac: acName || '',
        product: produto,
        enrollmentDate,
        data_treinamento_origem: enrollmentDate,
        dueDay,
        saleValue: valorContrato,
        downPayment: 0,
        totalInstallments,
        paidInstallments: paidCount,
        installmentValue,
        detalhes: detalhes.join(' | '),
        // extras consumidos no handleConfirmImport
        installments,
        mirrorCancellation: hasCancelamento,
        kaminoTagNames: Array.from(allTagNames),
        acCandidate: !acName && topAcCandidate ? topAcCandidate : undefined,
        attachToStudentId,
      };
      parsed.push({ rowIndex: virtualIdx, raw: first, data, errors: warnings });
    }

    return parsed;
  };


  const parseWorkbook = async (file: File) => {
    setParsing(true);
    setProgressMessage('Lendo planilha...');
    setProgressDetail(file.name);
    let XLSX: XLSXModule;
    try {
      XLSX = await loadXLSX();
    } catch (err) {
      setParsing(false);
      setProgressMessage('');
      setProgressDetail('');
      alert((err as Error).message);
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        setProgressMessage('Processando linhas...');
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (mode === 'kamino' && ws['!ref'] && XLSX.utils.decode_range && XLSX.utils.encode_cell && XLSX.utils.encode_range) {
          const range = XLSX.utils.decode_range(ws['!ref'] as string);
          const meaningfulCols: number[] = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const header = normalizeString((ws[XLSX.utils.encode_cell({ r: range.s.r, c })] as any)?.v);
            if (header) meaningfulCols.push(c);
          }
          for (let r = range.e.r; r > range.s.r; r--) {
            if (meaningfulCols.some((c) => normalizeString((ws[XLSX.utils.encode_cell!({ r, c })] as any)?.v) !== '')) {
              range.e.r = r;
              ws['!ref'] = XLSX.utils.encode_range(range);
              break;
            }
          }
        }
        const rawJson: Record<string, unknown>[] = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

        // Trim header keys to avoid whitespace mismatches
        const trimmedJson = rawJson.map((row) => {
          const trimmed: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            trimmed[key.trim()] = value;
          }
          return trimmed;
        }).filter((row) => {
          if (mode !== 'kamino') return Object.values(row).some((value) => normalizeString(value) !== '');
          // Algumas exportações Kamino trazem a coluna Assessor preenchida até o
          // fim da planilha (1M+ linhas). Assessor sozinho não é linha financeira.
          const meaningfulColumns = [
            'Pessoa', 'Vencimento', 'Competência', 'Valor a Receber (R$)', 'Valor Recebido (R$)',
            'Recebimento', 'Situação', 'Classificação', 'Centro de Custo', 'Conta de Recebimento',
            'Detalhe', 'Telefone', 'E-mail',
          ];
          return meaningfulColumns.some((col) => normalizeString(row[col]) !== '');
        });

        setProgressDetail(`${trimmedJson.length} linha(s) encontrada(s)`);
        const json = mode === 'kamino' ? fillDownKaminoRows(trimmedJson) : trimmedJson;

        const parsed = mode === 'kamino' ? parseKamino(json, XLSX) : parsePadrao(json, XLSX);
        setRows(parsed);
        setImportedCount(null);
      } catch (err) {
        alert('Erro ao ler a planilha. Verifique se o arquivo é um .xlsx válido.');
        console.error(err);
      } finally {
        setParsing(false);
        setProgressMessage('');
        setProgressDetail('');
      }
    };
    reader.onerror = () => {
      setParsing(false);
      setProgressMessage('');
      setProgressDetail('');
      alert('Falha ao ler o arquivo.');
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    // Reseta decisões/nomes anteriores: novo arquivo = nova rodada de perguntas.
    setClassDecisions({}); setContaDecisions({}); setCcDecisions({});
    setCckDecisions({}); setRecompraDecisions({});
    setClassTagNames({}); setContaTagNames({}); setCcTagNames({});
    setCckTagNames({}); setRecompraTagNames({});
    setContaTagAssign({}); setCcTagAssign({}); setCckTagAssign({});
    setRecompraTagAssign({}); setFormaTagAssign({});
    setAutoDecisionPromptKey('');
    parseWorkbook(file);
  };

  const handleConfirmImport = async () => {
    // ─── Gate de pré-validação ─────────────────────────────────────────────
    // Antes de importar QUALQUER linha, exige que a planilha esteja 100% limpa:
    // sem linhas com erro (invalidRows) e sem linhas com avisos (validRows com errors).
    // Assim o usuário corrige/exclui tudo ANTES de inserir no banco — evita o cenário
    // de ter alguns alunos importados e outros não, sem saber qual é qual.
    const errorRowsCount = invalidRows.length;
    const warningRowsCount = validRows.filter((r) => r.errors.length > 0).length;
    if (errorRowsCount > 0) {
      toast.error('Corrija a planilha antes de importar', {
        description: `${errorRowsCount} linha(s) com erro bloqueante. Clique em cada uma para editar ou no 🗑 para excluir. Nenhum aluno será importado enquanto houver erro.`,
      });
      setErrorListOpen(true);
      return;
    }
    if (mode === 'kamino' && pendingKaminoDecisionCount > 0) {
      openKaminoDecisionModal();
      return;
    }
    if (warningRowsCount > 0) {
      const ok = await confirm({
        title: 'Importar com dados incompletos?',
        description: `${warningRowsCount} aluno(s) estão com campos opcionais vazios (ex.: CPF, endereço, e-mail). Deseja importar mesmo assim? Os campos faltantes ficarão em branco e poderão ser preenchidos depois na ficha do aluno.`,
        confirmText: 'Importar mesmo assim',
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: 'Importar alunos',
        description: `Tem certeza que deseja importar ${validRows.length} aluno(s)? Esta ação adicionará os registros no sistema.`,
        confirmText: 'Importar',
      });
      if (!ok) return;
    }
    await runImport();
  };

  const runImport = async () => {
    setShowClassDecisionModal(false);
    setImporting(true);
    setProgressMessage('Preparando importação...');
    setProgressDetail('');
    setDiagnostics(null);
    if (!validateKaminoDecisions()) {
      setShowClassDecisionModal(true);
      setImporting(false);
      setProgressMessage('');
      return;
    }
    // Mantém referência aos extras para criar espelhos de cancelamento depois
    const mirrorIndexByKey = new Map<string, boolean>();
    // Helpers locais p/ resolver o NOME FINAL de cada candidato.
    // Quando a decisão é 'atribuir', usamos o NOME da tag existente selecionada;
    // quando é 'tag', usamos o nome editado (ou o original).
    const tagById = new Map(studentTags.map((t) => [t.id, t]));
    const resolveAssignedName = (tagId: string | undefined, fallback: string) =>
      (tagId && tagById.get(tagId)?.name) || fallback;
    const resolveContaName = (raw: string) => {
      if ((contaDecisions[raw] ?? 'ignorar') === 'atribuir') return resolveAssignedName(contaTagAssign[raw], raw);
      return (contaTagNames[raw] ?? raw).trim() || raw.trim();
    };
    const resolveCcName = (raw: string) => {
      if ((ccDecisions[raw] ?? 'ignorar') === 'atribuir') return resolveAssignedName(ccTagAssign[raw], raw);
      return (ccTagNames[raw] ?? raw).trim() || raw.trim();
    };
    const resolveCckName = (raw: string) => {
      if ((cckDecisions[raw] ?? 'ignorar') === 'atribuir') return resolveAssignedName(cckTagAssign[raw], raw);
      return (cckTagNames[raw] ?? raw).trim() || raw.trim();
    };
    const resolveRecompraName = (raw: string) => {
      if ((recompraDecisions[raw] ?? 'ignorar') === 'atribuir') return resolveAssignedName(recompraTagAssign[raw], raw);
      return (recompraTagNames[raw] ?? raw).trim() || raw.trim();
    };
    const resolveFormaName = (raw: string) => {
      if ((formaDecisions[raw] ?? 'ignorar') === 'atribuir') return resolveAssignedName(formaTagAssign[raw], raw);
      return (formaTagNames[raw] ?? raw).trim() || raw.trim();
    };
    const resolveClassName = (raw: string) => (classTagNames[raw] ?? raw).trim() || raw.trim();

    // ─── Candidatos a Assessor: aplica decisão (criar AC / atribuir / ignorar) ──
    // Mapa: nome candidato (lowercase do que veio na planilha) → nome final do AC.
    const acCandidateToFinal = new Map<string, string>();
    if (mode === 'kamino' && acCandidates.length > 0) {
      setProgressMessage('Configurando assessores...');
      const existingAcsLower = new Map(acs.map((a) => [a.name.toLowerCase(), a.name]));
      for (const cand of acCandidates) {
        const dec = acDecisions[cand] ?? 'criar';
        if (dec === 'ignorar') continue;
        if (dec === 'atribuir') {
          const chosen = (acAssign[cand] ?? '').trim();
          const final = existingAcsLower.get(chosen.toLowerCase()) ?? chosen;
          if (final) acCandidateToFinal.set(cand.toLowerCase(), final);
          continue;
        }
        // 'criar' não é mais permitido por regra de negócio: AC só existe a partir de
        // um usuário cadastrado. Se ainda chegar como 'criar', tratamos como ignorar
        // e avisamos o admin para cadastrar o usuário primeiro.
        if (existingAcsLower.has(cand.toLowerCase())) {
          acCandidateToFinal.set(cand.toLowerCase(), existingAcsLower.get(cand.toLowerCase())!);
          continue;
        }
        toast.error(`AC "${cand}" não está cadastrado. Cadastre primeiro o usuário em Configurações → Controle de Acesso.`);

      }
    }

    // ─── Classificações desconhecidas: aplica decisão do usuário ─────────────
    // 'treinamento' → cria Produto agora (await direto, não pode falhar em silêncio)
    // 'tag' → vira tag e treinamento fica em branco
    const classToTag = new Set<string>(); // lowercase
    const classToProduct = new Map<string, string>(); // lowercase original -> produto final
    if (mode === 'kamino' && unknownClassificacoes.length > 0) {
      setProgressMessage('Criando treinamentos novos...');
      const existingProductNames = new Set(products.map((p) => p.name.toLowerCase()));
      const createdProductNames: string[] = [];
      const failedProducts: { name: string; error: string }[] = [];
      let createdCount = 0;
      for (const c of unknownClassificacoes) {
        const decision = classDecisions[c] ?? (products.length > 0 ? 'treinamento-existente' : 'treinamento');
        const finalName = resolveClassName(c);
        if (decision === 'treinamento') {
          classToProduct.set(c.toLowerCase(), finalName);
          if (existingProductNames.has(finalName.toLowerCase())) continue;
          try {
            setProgressDetail(`Criando: ${finalName}`);
            const row = await createProduct({ name: finalName });
            setStoreState((s) => ({ products: [...s.products, { id: row.id, name: row.name, value: row.value ?? undefined }] }));
            existingProductNames.add(finalName.toLowerCase());
            createdProductNames.push(finalName);
            createdCount++;
          } catch (e: any) {
            console.error('Falha ao criar treinamento:', finalName, e);
            failedProducts.push({ name: finalName, error: e?.message || String(e) });
          }
        } else if (decision === 'treinamento-existente') {
          classToProduct.set(c.toLowerCase(), finalName);
        } else {
          // 'tag' (cria nova) ou 'tag-existente' (reutiliza). Em ambos os casos,
          // o aluno entra na ficha consolidada "Sem Treinamento" e a tag é aplicada às parcelas.
          classToTag.add(c.toLowerCase());
        }
      }
      if (failedProducts.length > 0) {
        const lista = failedProducts.map((f) => `• ${f.name} — ${f.error}`).join('\n');
        alert(`Falha ao criar ${failedProducts.length} treinamento(s):\n\n${lista}\n\nA importação será cancelada para você revisar.`);
        setImporting(false);
        setProgressMessage('');
        setProgressDetail('');
        return;
      }
      if (createdProductNames.length > 0) {
        // Espera o realtime devolver os produtos no store antes de seguir
        setProgressMessage('Sincronizando treinamentos com o banco...');
        setProgressDetail(`${createdProductNames.length} novo(s)`);
        const start = Date.now();
        while (Date.now() - start < 8000) {
          const current = useAppStore.getState().products.map((p) => p.name.toLowerCase());
          const allThere = createdProductNames.every((n) => current.includes(n.toLowerCase()));
          if (allThere) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    }

    // ─── Garante que tags geradas no Kamino existam no catálogo ─────────────
    if (mode === 'kamino') {
      const allNeededTags = new Set<string>();
      // Classificações que viraram tag — usa nome editado
      unknownClassificacoes.forEach((c) => {
        if (classToTag.has(c.toLowerCase())) allNeededTags.add(resolveClassName(c));
      });
      const isApply = (d: TagDecision | undefined) => d === 'tag' || d === 'atribuir';
      // Contas de Recebimento aprovadas — usa nome editado (ou nome da tag atribuída)
      contasRecebimento.forEach((c) => {
        if (isApply(contaDecisions[c])) allNeededTags.add(resolveContaName(c));
      });
      // Centros de Custo desconhecidos aprovados
      centrosCustoDesconhecidos.forEach((c) => {
        if (isApply(ccDecisions[c])) allNeededTags.add(resolveCcName(c));
      });
      // Centros de Custo conhecidos aprovados (Antecipação/Cancelamento/Tmf)
      centrosCustoConhecidos.forEach((c) => {
        if (isApply(cckDecisions[c])) allNeededTags.add(resolveCckName(c));
      });
      // Classificações de Recompra aprovadas
      recompraClassificacoes.forEach((c) => {
        if (isApply(recompraDecisions[c])) allNeededTags.add(resolveRecompraName(c));
      });
      // Formas de Recebimento aprovadas (coluna I)
      formasRecebimento.forEach((c) => {
        if (isApply(formaDecisions[c])) allNeededTags.add(resolveFormaName(c));
      });
      const existingTagNames = new Set(studentTags.map((t) => t.name.toLowerCase()));
      const palette = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'yellow', 'slate'];
      let colorIdx = studentTags.length;
      for (const tagName of allNeededTags) {
        if (!existingTagNames.has(tagName.toLowerCase())) {
          const row = await createStudentTag({ name: tagName, color: palette[colorIdx % palette.length], scope: 'student' });
          setStoreState((s) => ({
            studentTags: s.studentTags.some((t) => t.id === row.id)
              ? s.studentTags
              : [...s.studentTags, { id: row.id, name: row.name, color: row.color, scope: row.scope ?? 'student' }],
          }));
          existingTagNames.add(tagName.toLowerCase());
          colorIdx++;
        }
      }
      if (allNeededTags.size > 0) {
        setProgressMessage('Sincronizando tags...');
        setProgressDetail(`${allNeededTags.size} tag(s)`);
      }
    }

    // ─── Padrão: auto-criar tags informadas na coluna "Tags" ───────────────
    if (mode === 'padrao') {
      const padraoTagNames = new Set<string>();
      validRows.forEach((r) => {
        r.data?.pendingTagNames?.forEach((n) => padraoTagNames.add(n));
      });
      if (padraoTagNames.size > 0) {
        const existingTagNames = new Set(useAppStore.getState().studentTags.map((t) => t.name.toLowerCase()));
        const palette = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'yellow', 'slate'];
        let colorIdx = useAppStore.getState().studentTags.length;
        for (const tagName of padraoTagNames) {
          if (!existingTagNames.has(tagName.toLowerCase())) {
            const created = await createStudentTag({ name: tagName, color: palette[colorIdx % palette.length], scope: 'student' });
            setStoreState((s) => ({
              studentTags: s.studentTags.some((t) => t.id === created.id)
                ? s.studentTags
                : [...s.studentTags, { id: created.id, name: created.name, color: created.color, scope: created.scope ?? 'student' }],
            }));
            existingTagNames.add(tagName.toLowerCase());
            colorIdx++;
          }
        }
        setProgressMessage('Sincronizando tags...');
        setProgressDetail(`${padraoTagNames.size} tag(s)`);
      }
    }

    // Mapa nome→id das tags (já carregado após o sync acima)
    const tagNameToId = new Map<string, string>();
    useAppStore.getState().studentTags.forEach((t) => tagNameToId.set(t.name.toLowerCase(), t.id));

    // Set lowercase para classificações que viraram tag (treinamento em branco)
    const unknownClassSet = classToTag;

    const rawStudentsToImport: Student[] = validRows
      .filter((row) => row.data != null)
      .map((row) => {
        const data = row.data!;
        // Se a Classificação (product) não é um Treinamento cadastrado,
        // vira tag aplicada a todas as parcelas e o produto fica consolidado em "Sem Treinamento".
        const productIsUnknown = mode === 'kamino' && !!data.product && unknownClassSet.has(data.product.toLowerCase());
        const mappedProduct = mode === 'kamino' && data.product ? classToProduct.get(data.product.toLowerCase()) : undefined;
        const finalProduct = productIsUnknown ? KAMINO_TAG_ONLY_PRODUCT : (mappedProduct ?? data.product);
        // Usa o nome final (editado) caso o usuário tenha renomeado.
        const extraTagFromClass = productIsUnknown ? resolveClassName(data.product) : null;

        // Kamino: já temos parcelas reais (com datas). Padrão: gera por dueDay.
        let installments: Installment[];
        if (mode === 'kamino' && data.installments && data.installments.length > 0) {
          // Converte tag NAMES por parcela em tag IDs.
          // Trata candidatos "__conta__:Nome" e "__cc__:Nome" conforme decisão do usuário,
          // aplicando o nome editado (se houver).
          installments = data.installments.map((inst) => {
            const rawNames = [...(inst.tags || [])];
            const names: string[] = [];
            for (const n of rawNames) {
              if (n.startsWith('__conta__:')) {
                const conta = n.slice('__conta__:'.length);
                const d = contaDecisions[conta] ?? 'ignorar';
                if (d === 'tag' || d === 'atribuir') names.push(resolveContaName(conta));
              } else if (n.startsWith('__cck__:')) {
                const cck = n.slice('__cck__:'.length);
                const d = cckDecisions[cck] ?? 'ignorar';
                if (d === 'tag' || d === 'atribuir') names.push(resolveCckName(cck));
              } else if (n.startsWith('__cc__:')) {
                const cc = n.slice('__cc__:'.length);
                const d = ccDecisions[cc] ?? 'ignorar';
                if (d === 'tag' || d === 'atribuir') names.push(resolveCcName(cc));
              } else if (n.startsWith('__recompra__:')) {
                const re = n.slice('__recompra__:'.length);
                const d = recompraDecisions[re] ?? 'ignorar';
                if (d === 'tag' || d === 'atribuir') names.push(resolveRecompraName(re));
              } else if (n.startsWith('__forma__:')) {
                const fr = n.slice('__forma__:'.length);
                const d = formaDecisions[fr] ?? 'ignorar';
                if (d === 'tag' || d === 'atribuir') names.push(resolveFormaName(fr));
              } else {
                names.push(n);
              }
            }
            if (extraTagFromClass && !names.some((n) => n.toLowerCase() === extraTagFromClass.toLowerCase())) {
              names.push(extraTagFromClass);
            }
            const tagIds = names
              .map((name) => tagNameToId.get(name.toLowerCase()))
              .filter((x): x is string => !!x);
            return { ...inst, tags: tagIds.length > 0 ? tagIds : undefined };
          });
        } else {
          const installmentValue = data.installmentValue || calculateInstallmentValue(data.saleValue, data.downPayment, data.totalInstallments);
          installments = generateInstallments(data.dueDay, data.totalInstallments, installmentValue, 0, data.enrollmentDate, data.firstDueDate);
          if (data.paidInstallments > 0) {
            for (let i = 0; i < Math.min(data.paidInstallments, installments.length); i++) {
              installments[i].paid = true;
              installments[i].paidDate = new Date().toISOString().split('T')[0];
            }
          }
        }

        if (data.mirrorCancellation) {
          const k = `${data.name.toLowerCase()}||${finalProduct.toLowerCase()}`;
          mirrorIndexByKey.set(k, true);
        }

        // Remove campos extras antes de enviar ao banco
        const { installments: _omit1, mirrorCancellation: _omit2, kaminoTagNames: _omit3, acCandidate: _omit4, pendingTagNames: _omit5, firstDueDate: _omit6, attachToStudentId: _omit7, ...studentData } = data;
        // Resolve AC final: se o aluno foi importado sem AC (acCandidate), aplica decisão.
        const finalAc = (data.ac && data.ac.trim())
          ? data.ac
          : (data.acCandidate ? (acCandidateToFinal.get(data.acCandidate.toLowerCase()) ?? '') : '');
        // Resolve tags informadas no Padrão (nome → id), mesclando com tags pré-existentes
        const padraoTagIds = (data.pendingTagNames ?? [])
          .map((n) => tagNameToId.get(n.toLowerCase()))
          .filter((x): x is string => !!x);
        const mergedTags = padraoTagIds.length > 0
          ? Array.from(new Set([...(studentData.tags ?? []), ...padraoTagIds]))
          : studentData.tags;
        return {
          ...studentData,
          ac: finalAc,
          tags: mergedTags,
          // Ficha consolidada quando a Classificação foi classificada como tag
          product: finalProduct,
          id: '',
          installments,
          history: [{
            date: new Date().toISOString(),
            type: 'Sistema' as const,
            text: mode === 'kamino'
              ? (productIsUnknown
                  ? `Importado via planilha Kamino (Classificação "${data.product}" convertida em tag em "${KAMINO_TAG_ONLY_PRODUCT}")`
                  : 'Importado via planilha Kamino')
              : 'Importado via planilha Excel',
          }],
          attachToStudentId: data.attachToStudentId,
        } as Student & { attachToStudentId?: string };
      });

    // Separa as linhas de "Recompra anexada a aluno existente". Elas não viram
    // novos cadastros: vamos só ACRESCENTAR as parcelas à ficha existente.
    const appendOps = rawStudentsToImport.filter((s) => (s as any).attachToStudentId);
    const rawStudentsForInsert = rawStudentsToImport.filter((s) => !(s as any).attachToStudentId);

    const studentsToImport: Student[] = mode === 'kamino'
      ? Array.from(rawStudentsForInsert.reduce((map, student) => {
          const key = `${student.name.toLowerCase()}||${student.whatsapp.replace(/\D/g, '')}||${student.product.toLowerCase()}`;
          const existing = map.get(key);
          if (!existing) {
            map.set(key, student);
            return map;
          }
          const mergedInstallments = [...(existing.installments ?? []), ...(student.installments ?? [])]
            .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
            .map((inst, idx) => ({ ...inst, number: idx + 1 }));
          const saleValue = mergedInstallments.reduce((sum, inst) => sum + (inst.value || 0), 0);
          const paidInstallments = mergedInstallments.filter((inst) => inst.paid).length;
          const enrollmentDate = [existing.enrollmentDate, student.enrollmentDate].filter(Boolean).sort()[0] ?? existing.enrollmentDate;
          map.set(key, {
            ...existing,
            enrollmentDate,
            data_treinamento_origem: existing.data_treinamento_origem ?? enrollmentDate,
            saleValue,
            totalInstallments: mergedInstallments.length,
            paidInstallments,
            installmentValue: mergedInstallments.length > 0 ? saleValue / mergedInstallments.length : 0,
            dueDay: mergedInstallments[0]?.dueDate ? new Date(`${mergedInstallments[0].dueDate}T00:00:00`).getDate() : existing.dueDay,
            installments: mergedInstallments,
            history: [...(existing.history ?? []), ...(student.history ?? [])],
            status: calculateAutoStatus(mergedInstallments),
          });
          return map;
        }, new Map<string, Student>()).values())
      : rawStudentsForInsert;

    // Snapshot do que estamos enviando (antes do insert)
    const expectedMap = new Map<string, { name: string; product: string; installments: number }>();
    for (const s of studentsToImport) {
      const key = `${s.name.toLowerCase()}||${s.product.toLowerCase()}`;
      expectedMap.set(key, {
        name: s.name,
        product: s.product,
        installments: s.installments?.length ?? 0,
      });
    }

    try {
      setProgressMessage('Importando alunos no banco...');
      setProgressDetail(`${studentsToImport.length} aluno(s) — isso pode levar alguns segundos`);
      // Suspende reloads do realtime durante o INSERT em massa: cada linha
      // emitiria um evento e dispararia um fetchAll de 10 tabelas, congelando
      // a UI. Fazemos 1 reload final ao terminar.
      const result = await withSyncSuspended(() => addStudentsBulk(studentsToImport));
      setImportedCount(result.inserted);
      setProgressDetail(`${result.inserted} aluno(s) inserido(s)`);

      // ─── Anexa parcelas de Recompra a fichas existentes ───────────────────
      // Cada appendOp = grupo de parcelas Recompra que pertence a um aluno já cadastrado.
      // Em vez de duplicar a ficha, ACRESCENTA as parcelas (de-dup por dueDate+value)
      // à ficha existente. Mantém valores originais do contrato + soma só as novas parcelas.
      let appended = 0;
      let appendedRows = 0;
      if (appendOps.length > 0) {
        setProgressMessage('Anexando Recompras às fichas existentes...');
        const { supabase } = await import('@/integrations/supabase/client');
        for (const op of appendOps) {
          const sid = (op as any).attachToStudentId as string;
          if (!sid) continue;
          try {
            const { data: row, error: fetchErr } = await supabase
              .from('students')
              .select('id,installments,sale_value,total_installments,paid_installments,history')
              .eq('id', sid)
              .maybeSingle();
            if (fetchErr || !row) { console.error('[appendRecompra] fetch falhou', sid, fetchErr); continue; }
            const current: Installment[] = (typeof row.installments === 'string'
              ? JSON.parse(row.installments)
              : row.installments) ?? [];
            // ── Regra Recompra ─────────────────────────────────────────────
            // Recompra = parcela ANTIGA já paga que voltou p/ cobrança direta.
            // Em vez de criar parcela nova (inflando o valor do contrato),
            // REABRE a parcela original correspondente e anexa a tag "Recompra".
            //   1) Match exato por dueDate + value em parcela PAGA → reabre
            //   2) Fallback: mesma value, parcela paga com dueDate mais próximo
            //   3) Se não existir match → adiciona como parcela nova (fallback)
            const reopenedInsts: Installment[] = current.map((i) => ({ ...i, tags: [...(i.tags ?? [])] }));
            const usedIdx = new Set<number>();
            let reopenedCount = 0;
            const trulyNew: Installment[] = [];
            for (const inc of (op.installments ?? [])) {
              const incVal = Math.round((inc.value ?? 0) * 100);
              const incTags = inc.tags ?? [];
              let matchIdx = reopenedInsts.findIndex((i, idx) =>
                !usedIdx.has(idx) &&
                i.paid &&
                i.dueDate === inc.dueDate &&
                Math.round((i.value ?? 0) * 100) === incVal
              );
              if (matchIdx < 0) {
                const incTime = inc.dueDate ? new Date(inc.dueDate + 'T00:00:00').getTime() : 0;
                let best = -1; let bestDiff = Infinity;
                reopenedInsts.forEach((i, idx) => {
                  if (usedIdx.has(idx)) return;
                  if (!i.paid) return;
                  if (Math.round((i.value ?? 0) * 100) !== incVal) return;
                  const t = i.dueDate ? new Date(i.dueDate + 'T00:00:00').getTime() : 0;
                  const diff = Math.abs(t - incTime);
                  if (diff < bestDiff) { bestDiff = diff; best = idx; }
                });
                matchIdx = best;
              }
              if (matchIdx >= 0) {
                usedIdx.add(matchIdx);
                const orig = reopenedInsts[matchIdx];
                const mergedTags = Array.from(new Set([...(orig.tags ?? []), ...incTags]));
                reopenedInsts[matchIdx] = {
                  ...orig,
                  paid: false,
                  paidDate: undefined,
                  paidValue: undefined,
                  tags: mergedTags,
                };
                reopenedCount++;
              } else {
                trulyNew.push(inc);
              }
            }
            if (reopenedCount === 0 && trulyNew.length === 0) continue;
            const merged = [...reopenedInsts, ...trulyNew]
              .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
              .map((inst, idx) => ({ ...inst, number: idx + 1 }));
            // Valor do contrato: só cresce por parcelas TRULY NEW.
            // Recompras reabertas NÃO inflam o contrato — já estavam contabilizadas.
            const sale = (row.sale_value ?? 0) + trulyNew.reduce((acc, i) => acc + (i.value || 0), 0);
            const paid = merged.filter((i) => i.paid).length;
            const histArr = Array.isArray(row.history) ? (row.history as any[]) : [];
            const parts: string[] = [];
            if (reopenedCount > 0) parts.push(`${reopenedCount} parcela(s) reaberta(s) como Recompra`);
            if (trulyNew.length > 0) parts.push(`${trulyNew.length} parcela(s) nova(s) de Recompra anexada(s)`);
            const newHist = [...histArr, {
              date: new Date().toISOString(),
              type: 'Sistema',
              text: `Importação Kamino: ${parts.join(' · ')}.`,
            }];
            const { error: updErr } = await supabase
              .from('students')
              .update({
                installments: merged,
                sale_value: sale,
                total_installments: merged.length,
                paid_installments: paid,
                history: newHist,
              })
              .eq('id', sid);
            if (updErr) { console.error('[appendRecompra] update falhou', sid, updErr); continue; }
            appended++;
            appendedRows += reopenedCount + trulyNew.length;
          } catch (e) {
            console.error('[appendRecompra] erro', e);
          }
        }
        if (appended > 0) {
          toast.success(`${appendedRows} parcela(s) de Recompra processada(s) em ${appended} aluno(s).`);
        }
      }

      // Espelhar alunos com tag Cancelamento na coluna "Entrada" do funil de cancelamentos
      if (mode === 'kamino' && mirrorIndexByKey.size > 0) {
        setProgressMessage('Criando espelhos de cancelamento...');
        setProgressDetail(`${mirrorIndexByKey.size} caso(s)`);
        await new Promise((r) => setTimeout(r, 800));
        const freshStudents = useAppStore.getState().students;
        const existingMirrorIds = new Set(
          useAppStore.getState().cancellationCases
            .filter((c) => c.isMirror)
            .map((c) => c.studentId)
        );
        for (const [key] of mirrorIndexByKey) {
          const matches = freshStudents.filter(
            (s) => `${s.name.toLowerCase()}||${s.product.toLowerCase()}` === key
          );
          for (const stud of matches) {
            if (existingMirrorIds.has(stud.id)) continue;
            const now = new Date().toISOString();
            const valorAberto = stud.installments
              .filter((i) => !i.paid)
              .reduce((acc, i) => acc + (i.value || 0), 0);
            const mirrorCase: CancellationCase = {
              id: '',
              studentName: stud.name,
              studentId: stud.id,
              studentWhatsapp: stud.whatsapp,
              ac: stud.ac,
              stage: 'Aguardando Contato',
              operationalStatus: 'Sem contato',
              value: valorAberto,
              createdAt: now,
              movedToCurrentStageAt: now,
              notes: 'Espelho criado automaticamente via importação Kamino (tag Cancelamento).',
              history: [],
              funnelStage: 'Entrada',
              isMirror: true,
            };
            addCancellationCase(mirrorCase);
          }
        }
      }

      // Diagnóstico Kamino: re-busca direto no banco e compara
      if (mode === 'kamino') {
        setProgressMessage('Conferindo dados no banco...');
        setProgressDetail('Comparando enviado × salvo');
        // pequena espera para garantir que o INSERT já está commitado
        await new Promise((r) => setTimeout(r, 800));
        // ── Busca DIRETO no banco (não usa estado local) ──────────────────
        // O estado local do Zustand pode estar momentaneamente desatualizado
        // se o realtime ainda não disparou o reload (debounce de 400ms +
        // fetchAll). Para o diagnóstico precisamos da verdade do banco.
        const expectedNames = Array.from(new Set(Array.from(expectedMap.values()).map((e) => e.name)));
        const { supabase } = await import('@/integrations/supabase/client');
        // Busca em chunks de 150 nomes para não estourar o limite de URL do PostgREST
        // (com ~1300+ nomes, .in() em uma única chamada trunca a resposta e gera
        // falsos positivos de "aluno não encontrado").
        const CHUNK = 150;
        const collected: any[] = [];
        let chunkFailed = false;
        for (let i = 0; i < expectedNames.length; i += CHUNK) {
          const slice = expectedNames.slice(i, i + CHUNK);
          const { data: chunkRows, error: chunkErr } = await supabase
            .from('students')
            .select('id,name,product,installments')
            .in('name', slice);
          if (chunkErr) {
            chunkFailed = true;
            console.error('[Diagnóstico] chunk falhou', { offset: i, error: chunkErr });
            continue;
          }
          if (chunkRows) collected.push(...chunkRows);
        }
        if (chunkFailed) {
          toast.error('Diagnóstico parcial: alguns lotes falharam ao carregar do banco. Recarregue (F5) e confira a aba Alunos.');
        }
        const freshStudents = collected.map((r: any) => ({
          id: r.id as string,
          name: r.name as string,
          product: (r.product as string) ?? '',
          installments: (typeof r.installments === 'string' ? JSON.parse(r.installments) : r.installments) ?? [],
        }));
        const diag: DiagnosticEntry[] = [];
        for (const [key, expected] of expectedMap) {
          const matches = freshStudents.filter(
            (s) => `${s.name.toLowerCase()}||${s.product.toLowerCase()}` === key
          );

          if (matches.length === 0) {
            diag.push({
              name: expected.name,
              expectedName: expected.name,
              expectedProduct: expected.product,
              product: expected.product,
              sentInstallments: expected.installments,
              returnedInstallments: 0,
              match: false,
              studentIds: [],
            });
          } else if (matches.length === 1) {
            const got = matches[0].installments?.length ?? 0;
            diag.push({
              name: expected.name,
              expectedName: expected.name,
              expectedProduct: expected.product,
              product: expected.product,
              sentInstallments: expected.installments,
              returnedInstallments: got,
              match: got === expected.installments,
              studentIds: matches.map((m) => m.id),
            });
          } else {
            // Mais de uma ficha pro mesmo (nome+produto) = problema de duplicação no banco
            diag.push({
              name: `${expected.name} ⚠️ (${matches.length} fichas no banco!)`,
              expectedName: expected.name,
              expectedProduct: expected.product,
              product: expected.product,
              sentInstallments: expected.installments,
              returnedInstallments: matches.reduce((acc, m) => acc + (m.installments?.length ?? 0), 0),
              match: false,
              studentIds: matches.map((m) => m.id),
            });
          }
        }
        setDiagnostics(diag);
      }

      if (result.failed > 0) {
        alert(`${result.inserted} aluno(s) importado(s) com sucesso. ${result.failed} falharam.`);
        // Mantém apenas linhas problemáticas (inválidas ou com avisos) para o usuário corrigir/reimportar
        setRows((curr) => curr.filter((r) => !r.data || r.errors.length > 0));
      } else {
        // Import 100% limpo — limpa tudo para que apareça só "importado com sucesso" + Fechar
        setRows([]);
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (e) {
      console.error('Erro no import em lote:', e);
      alert('Erro ao importar alunos. Verifique o console para detalhes.');
    } finally {
      setImporting(false);
      setProgressMessage('');
      setProgressDetail('');
    }
  };

  const resetTagDecisions = () => {
    setClassDecisions({}); setContaDecisions({}); setCcDecisions({});
    setCckDecisions({}); setRecompraDecisions({});
    setClassTagNames({}); setContaTagNames({}); setCcTagNames({});
    setCckTagNames({}); setRecompraTagNames({});
    setContaTagAssign({}); setCcTagAssign({}); setCckTagAssign({});
    setRecompraTagAssign({}); setFormaTagAssign({});
  };

  const handleClose = () => {
    // Permite fechar a janela mesmo com pendências — apenas avisa o usuário.
    // A importação em si continua bloqueada até tudo estar limpo (handleConfirmImport).
    const pending = rows.filter((r) => r.errors && r.errors.length > 0).length;
    const pendingDiagnostics = diagnostics?.filter((d) => !d.match).length ?? 0;
    if (pending > 0 || pendingDiagnostics > 0) {
      const partes: string[] = [];
      if (pending > 0) partes.push(`${pending} linha(s) com pendência`);
      if (pendingDiagnostics > 0) partes.push(`${pendingDiagnostics} erro(s) no diagnóstico`);
      toast.warning('Fechando importação com pendências', {
        description: `${partes.join(' e ')}. Os dados da pré-visualização serão descartados.`,
      });
    }
    setRows([]); setFileName(''); setImportedCount(null);
    setDiagnostics(null);
    setDiagnosticFilter('all');
    resetTagDecisions();
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const handleModeChange = (newMode: ImportMode) => {
    if (newMode === mode) return;
    const pending = rows.filter((r) => r.errors && r.errors.length > 0).length;
    if (pending > 0) {
      toast.error(`${pending} linha(s) com erro pendente`, {
        description: 'Corrija ou exclua cada linha com erro antes de trocar de modo.',
      });
      return;
    }
    const pendingDiagnostics = diagnostics?.filter((d) => !d.match).length ?? 0;
    if (pendingDiagnostics > 0) {
      toast.error(`${pendingDiagnostics} erro(s) no diagnóstico pendente(s)`, {
        description: 'Edite, exclua ou remova cada erro antes de trocar de modo.',
      });
      return;
    }
    setMode(newMode);
    setRows([]); setFileName(''); setImportedCount(null);
    setDiagnostics(null);
    setDiagnosticFilter('all');
    resetTagDecisions();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Editor inline da linha (padrão e Kamino) ─────────────────────────────
  // Renderiza inputs para cada coluna esperada da planilha. AC e Produto/Classificação
  // viram dropdowns com opção de criar novo direto. Ao salvar, re-valida via parser.
  const setDraftField = (key: string, value: unknown) => {
    setEditDraft((d) => ({ ...d, [key]: value }));
  };

  const renderEditableField = (label: string, key: string, type: 'text' | 'number' = 'text') => (
    <div key={key}>
      <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">{label}</label>
      <input
        type={type}
        value={String(editDraft[key] ?? '')}
        onChange={(e) => setDraftField(key, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        className="w-full px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );

  const renderAcSelect = (key: string) => {
    const currentValue = String(editDraft[key] ?? '');
    return (
      <div key={key}>
        <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">
          {key === 'Assessor' ? 'Assessor (AC)' : 'AC'}
        </label>
        <div className="flex gap-1">
          <select
            value={currentValue}
            onChange={(e) => setDraftField(key, e.target.value)}
            className="flex-1 px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">— Selecionar AC —</option>
            {acs.filter((a) => a.active).map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
            {currentValue && !acs.some((a) => a.name === currentValue) && (
              <option value={currentValue}>{currentValue} (não cadastrado)</option>
            )}
          </select>
        </div>
        <p className="text-[9px] text-muted-foreground/80 mt-1 leading-snug">
          Para criar um novo AC, cadastre primeiro o usuário em <strong>Configurações → Controle de Acesso</strong>.
        </p>

      </div>
    );
  };

  const renderProductSelect = (key: string) => {
    const currentValue = String(editDraft[key] ?? '');
    const label = key === 'Classificação' ? 'Classificação (Treinamento)' : 'Produto';
    return (
      <div key={key}>
        <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">{label}</label>
        <div className="flex gap-1">
          <select
            value={currentValue}
            onChange={(e) => setDraftField(key, e.target.value)}
            className="flex-1 px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">— Selecionar —</option>
            {products.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
            {currentValue && !products.some((p) => p.name === currentValue) && (
              <option value={currentValue}>{currentValue} (não cadastrado)</option>
            )}
          </select>
        </div>
        <div className="flex gap-1 mt-1">
          <input
            type="text"
            placeholder="Novo produto..."
            value={creatingProductName}
            onChange={(e) => setCreatingProductName(e.target.value)}
            className="flex-1 px-2 py-1 text-[10px] border border-border rounded-md bg-background"
          />
          <button
            type="button"
            onClick={async () => {
              const name = await handleCreateProductInline();
              if (name) setDraftField(key, name);
            }}
            className="px-2 py-1 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30 rounded-md hover:bg-primary/20 flex items-center gap-1"
          >
            <Plus size={10} /> Criar
          </button>
        </div>
      </div>
    );
  };

  const renderStatusSelect = (key: string) => (
    <div key={key}>
      <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">Status</label>
      <select
        value={String(editDraft[key] ?? '')}
        onChange={(e) => setDraftField(key, e.target.value)}
        className="w-full px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <option value="">— Auto —</option>
        {STATUS_VALIDOS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );

  /**
   * QuickFixBar: detecta nos erros do grupo quais campos faltam (AC, Produto)
   * e mostra apenas seletores rápidos com os dados já cadastrados, sem precisar
   * abrir o editor completo. Aplica em todas as linhas do mesmo aluno.
   */
  const QuickFixBar = ({ group }: { group: { name: string; rows: ParsedRow[]; errors: string[] } }) => {
    const errorsText = group.errors.join(' • ').toLowerCase();
    const needsAc = /ac vazio|ac ".*?" não cadastrado|assessor vazio/i.test(errorsText);
    const needsProduct = /produto vazio|produto ".*?" não cadastrado/i.test(errorsText);

    if (!needsAc && !needsProduct) return null;

    const anchor = group.rows[0];
    const acKey = mode === 'padrao' ? 'AC' : 'Assessor';
    const productKey = mode === 'padrao' ? 'Produto' : 'Classificação';
    const currentAc = String(anchor.raw[acKey] ?? '');
    const currentProduct = String(anchor.raw[productKey] ?? '');

    return (
      <div className="px-3 py-2 bg-blue-50/60 border-t border-blue-200 flex flex-wrap items-end gap-2">
        <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide w-full mb-0.5">
          ⚡ Correção rápida
        </span>
        {needsAc && (
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold text-blue-900/70 uppercase">Vincular AC</label>
            <select
              defaultValue={currentAc && acs.some((a) => a.name === currentAc) ? currentAc : ''}
              onChange={(e) => {
                if (e.target.value) handleQuickFix(anchor.rowIndex, acKey, e.target.value);
              }}
              className="px-2 py-1.5 text-[11px] border border-blue-300 rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px]"
            >
              <option value="">— Selecione um AC cadastrado —</option>
              {acs.filter((a) => a.active).map((a) => (
                <option key={a.id} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
        {needsProduct && (
          <div className="flex flex-col gap-0.5">
            <label className="text-[9px] font-semibold text-blue-900/70 uppercase">Vincular Produto</label>
            <select
              defaultValue={currentProduct && products.some((p) => p.name === currentProduct) ? currentProduct : ''}
              onChange={(e) => {
                if (e.target.value) handleQuickFix(anchor.rowIndex, productKey, e.target.value);
              }}
              className="px-2 py-1.5 text-[11px] border border-blue-300 rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[180px]"
            >
              <option value="">— Selecione um produto cadastrado —</option>
              {products.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <span className="text-[9px] text-blue-700/70 ml-auto self-center">
          Será aplicado em {group.rows.length > 1 ? `todas as ${group.rows.length} linhas` : 'esta linha'} de <strong>{group.name}</strong>
        </span>
      </div>
    );
  };

  const renderRowEditor = (row: ParsedRow) => (
    <div className="px-3 py-3 bg-muted/40 border-t border-border">
      {mode === 'padrao' ? (
        <div className="grid grid-cols-2 gap-2 mb-3">
          {renderEditableField('Nome', 'Nome')}
          {renderEditableField('WhatsApp', 'WhatsApp')}
          {renderEditableField('E-mail', 'E-mail')}
          {renderEditableField('CPF', 'CPF')}
          {renderEditableField('Endereço', 'Endereço')}
          {renderEditableField('Número', 'Número')}
          {renderEditableField('Cidade', 'Cidade')}
          {renderEditableField('Estado', 'Estado')}
          {renderEditableField('CEP', 'CEP')}
          {renderAcSelect('AC')}
          {renderProductSelect('Produto')}
          {renderEditableField('Data de Inscrição (DD/MM/AAAA)', 'Data de Inscrição')}
          {renderEditableField('Data de Competência (DD/MM/AAAA)', 'Data de Competência')}
          {renderEditableField('Dia de Vencimento', 'Dia de Vencimento', 'number')}
          {renderEditableField('Valor Contrato', 'Valor Contrato', 'number')}
          {renderEditableField('Entrada', 'Entrada', 'number')}
          {renderEditableField('Nº Parcelas', 'Nº Parcelas', 'number')}
          {renderEditableField('Valor Parcela', 'Valor Parcela', 'number')}
          {renderEditableField('Qtd Parcelas Pagas', 'Qtd Parcelas Pagas', 'number')}
          {renderStatusSelect('Status')}
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground mb-2">
            Editando dados de identidade do aluno. Datas e valores das parcelas vêm da planilha.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {renderEditableField('Pessoa (Nome)', 'Pessoa')}
            {renderEditableField('Telefone', 'Telefone')}
            {renderEditableField('E-mail', 'E-mail')}
            {renderAcSelect('Assessor')}
            {renderProductSelect('Classificação')}
          </div>
        </>
      )}
      {(() => {
        const editedName = (
          mode === 'padrao'
            ? normalizeString(editDraft['Nome'])
            : normalizeString(editDraft['Pessoa'])
        ).toLowerCase();
        const sameStudentCount = editedName
          ? rows.filter((r) => {
              if (r.rowIndex === editingRowIndex) return false;
              const n = normalizeString(mode === 'padrao' ? r.raw['Nome'] : r.raw['Pessoa']).toLowerCase();
              return n && n === editedName;
            }).length
          : 0;
        if (sameStudentCount === 0) return null;
        return (
          <div className="mb-3 flex items-center gap-2 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-md">
            <input
              type="checkbox"
              id="apply-all-same-student"
              checked={applyToAllSameStudent}
              onChange={(e) => setApplyToAllSameStudent(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="apply-all-same-student" className="text-[11px] text-blue-800 cursor-pointer flex-1">
              Aplicar correção também nas <strong>{sameStudentCount}</strong> outra(s) linha(s) deste mesmo aluno
            </label>
          </div>
        );
      })()}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={closeRowEditor}
          className="px-3 py-1.5 text-[11px] font-semibold border border-border rounded-md hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSaveRowEdit}
          disabled={savingRow}
          className="px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
        >
          <Save size={11} />
          {savingRow ? 'Salvando...' : 'Salvar e revalidar'}
        </button>
      </div>
    </div>
  );

  const setStudentDraftField = (key: string, value: unknown) => {
    setStudentEditDraft((d) => ({ ...d, [key]: value }));
  };

  const renderDiagnosticStudentEditor = (student: Student, entry: DiagnosticEntry) => (
    <div className="px-3 py-3 bg-muted/30 border-t border-border">
      <div className="grid grid-cols-2 gap-2 mb-3">
        {[
          ['Nome', 'name'], ['WhatsApp', 'whatsapp'], ['E-mail', 'email'], ['CPF', 'cpf'],
          ['Data matrícula', 'enrollmentDate'], ['Dia venc.', 'dueDay'], ['Contrato', 'saleValue'], ['Entrada', 'downPayment'],
          ['Parcelas', 'totalInstallments'], ['Pagas', 'paidInstallments'], ['Valor parcela', 'installmentValue'],
        ].map(([label, key]) => (
          <div key={key}>
            <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">{label}</label>
            <input
              type={['dueDay', 'saleValue', 'downPayment', 'totalInstallments', 'paidInstallments', 'installmentValue'].includes(key) ? 'number' : 'text'}
              value={String(studentEditDraft[key] ?? '')}
              onChange={(e) => setStudentDraftField(key, e.target.value)}
              className="w-full px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        ))}
        <div>
          <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">AC</label>
          <select
            value={String(studentEditDraft.ac ?? '')}
            onChange={(e) => setStudentDraftField('ac', e.target.value)}
            className="w-full px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">— Selecionar AC —</option>
            {acs.filter((a) => a.active).map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <p className="text-[9px] text-muted-foreground/80 mt-1 leading-snug">
            Para criar um novo AC, cadastre primeiro o usuário em <strong>Configurações → Controle de Acesso</strong>.
          </p>

        </div>
        <div>
          <label className="block text-[9px] font-bold text-muted-foreground uppercase mb-1">Produto</label>
          <select
            value={String(studentEditDraft.product ?? '')}
            onChange={(e) => setStudentDraftField('product', e.target.value)}
            className="w-full px-2 py-1.5 text-[11px] border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">— Selecionar —</option>
            {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <div className="flex gap-1 mt-1">
            <input value={creatingProductName} onChange={(e) => setCreatingProductName(e.target.value)} placeholder="Novo produto..." className="flex-1 px-2 py-1 text-[10px] border border-border rounded-md bg-background" />
            <button type="button" onClick={async () => { const name = await handleCreateProductInline(); if (name) setStudentDraftField('product', name); }} className="px-2 py-1 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30 rounded-md hover:bg-primary/20 flex items-center gap-1"><Plus size={10} /> Criar</button>
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={closeDiagnosticEditor} className="px-3 py-1.5 text-[11px] font-semibold border border-border rounded-md hover:bg-muted">Cancelar</button>
        <button type="button" onClick={() => handleSaveDiagnosticStudent(student, entry)} disabled={savingDiagnosticStudent} className="px-3 py-1.5 text-[11px] font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
          <Save size={11} /> {savingDiagnosticStudent ? 'Salvando...' : 'Salvar ficha'}
        </button>
      </div>
    </div>
  );

  if (!isOpen) return null;


  const columns = mode === 'padrao' ? TEMPLATE_COLUMNS : KAMINO_COLUMNS;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col saas-shadow-lg">
        {/* Overlay de progresso (parsing ou importação) */}
        {(parsing || importing) && (
          <div className="absolute inset-0 z-50 bg-card/85 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Loader2 className="animate-spin text-primary" size={42} />
            <div className="space-y-1">
              <p className="text-sm font-bold text-foreground">
                {progressMessage || (parsing ? 'Lendo planilha...' : 'Importando alunos...')}
              </p>
              {progressDetail && (
                <p className="text-[11px] text-muted-foreground">{progressDetail}</p>
              )}
              <p className="text-[10px] text-muted-foreground/80 mt-2">
                Não feche esta janela. Estamos processando — isso pode levar alguns segundos.
              </p>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl iam-gradient flex items-center justify-center">
              <FileSpreadsheet size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Importar Alunos</h2>
              <p className="text-[11px] text-muted-foreground">Importe alunos a partir de uma planilha Excel</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Mode selector */}
          <div className="flex gap-2">
            <button
              onClick={() => handleModeChange('padrao')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${mode === 'padrao' ? 'iam-gradient text-primary-foreground border-transparent shadow-md' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              Modelo Padrão
            </button>
            <button
              onClick={() => handleModeChange('kamino')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${mode === 'kamino' ? 'iam-gradient text-primary-foreground border-transparent shadow-md' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              Modelo Kamino
            </button>
          </div>

          {/* Modelo Padrão: layout limpo — apenas Baixar Modelo + Selecionar Arquivo */}
          {mode === 'padrao' && (
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-foreground mb-1">Importar planilha</h3>
                  <p className="text-[11px] text-muted-foreground">Baixe o modelo, preencha e envie.</p>
                  {fileName && <p className="text-[11px] text-foreground font-medium mt-1"><span className="text-muted-foreground">Arquivo:</span> {fileName}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap">
                    <Download size={13} /> Baixar Modelo
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold iam-gradient text-primary-foreground shadow-sm hover:shadow transition-all whitespace-nowrap">
                    <Upload size={13} /> Selecionar Arquivo
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modelo Kamino: layout limpo — Baixar Modelo + Selecionar Arquivo + botão pequeno de limpeza */}
          {mode === 'kamino' && (
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold text-foreground mb-1">Importar planilha Kamino</h3>
                  <p className="text-[11px] text-muted-foreground">Baixe o modelo, preencha e envie.</p>
                  {fileName && <p className="text-[11px] text-foreground font-medium mt-1"><span className="text-muted-foreground">Arquivo:</span> {fileName}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap">
                    <Download size={13} /> Baixar Modelo
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold iam-gradient text-primary-foreground shadow-sm hover:shadow transition-all whitespace-nowrap">
                    <Upload size={13} /> Selecionar Arquivo
                  </button>
                </div>
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />

          {/* Step 3: Preview */}
          {rows.length > 0 && (
            <div className="bg-muted/30 border border-border rounded-xl p-4">
              <h3 className="text-xs font-bold text-foreground mb-3">{mode === 'padrao' ? '3' : '2'}. Pré-visualização e validação</h3>

              {/* Status geral da validação — explica claramente se a planilha está pronta ou não */}
              {(() => {
                const errosCount = invalidRows.length;
                const avisosCount = validRows.filter((r) => r.errors.length > 0).length;
                const pendentes = errosCount + avisosCount;
                if (pendentes === 0) {
                  return (
                    <div className="mb-3 flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <span className="text-emerald-700 text-base leading-none mt-0.5">✅</span>
                      <div className="flex-1">
                        <p className="text-[11px] font-bold text-emerald-800">Planilha validada — pronta para importar</p>
                        <p className="text-[10px] text-emerald-700">Nenhum erro encontrado. Você pode clicar em <strong>Importar</strong> com segurança.</p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="mb-3 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-300 rounded-lg">
                    <AlertTriangle size={14} className="text-amber-700 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-amber-800">
                        Planilha precisa de ajustes antes da importação ({pendentes} pendência{pendentes > 1 ? 's' : ''})
                      </p>
                      <p className="text-[10px] text-amber-700">
                        Nenhum aluno será importado enquanto houver erros ou avisos. Clique em cada item abaixo para <strong>editar</strong> ou no 🗑 para <strong>excluir</strong> a linha.
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-background border border-border rounded-lg p-2.5">
                  <p className="text-[9px] font-semibold text-muted-foreground uppercase">{mode === 'kamino' ? 'Alunos encontrados' : 'Total lido'}</p>
                  <p className="text-sm font-bold text-foreground">{rows.length}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <p className="text-[9px] font-semibold text-emerald-700 uppercase">Válidos</p>
                  <p className="text-sm font-bold text-emerald-700">{validRows.length}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <p className="text-[9px] font-semibold text-red-700 uppercase">Com erros</p>
                  <p className="text-sm font-bold text-red-700">{invalidRows.length}</p>
                </div>
              </div>

              {invalidGroups.length > 0 && (
                <div className="mb-3 border border-red-200 rounded-lg bg-red-50/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setErrorListOpen((v) => !v)}
                    className="w-full px-3 py-2 text-[11px] font-bold text-red-700 bg-red-100 hover:bg-red-200 sticky top-0 flex items-center justify-between transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      {errorListOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {invalidGroups.length} aluno(s) com erro ({invalidRows.length} linha(s)) — clique para {errorListOpen ? 'recolher' : 'expandir'}
                    </span>
                    <span className="text-[9px] font-normal text-red-600/80">
                      Corrija um aluno por vez (vale para todas as linhas dele)
                    </span>
                  </button>
                  {errorListOpen && (
                    <ul className="divide-y divide-red-200 max-h-72 overflow-y-auto">
                      {invalidGroups.slice(0, 100).map((g) => {
                        // Edita pela primeira linha do grupo; correção será propagada
                        // via toggle "aplicar a todas as linhas do mesmo aluno".
                        const primary = g.rows[0];
                        const isEditing = g.rows.some((r) => r.rowIndex === editingRowIndex);
                        const rowIndexes = g.rows.map((r) => r.rowIndex);
                        return (
                          <li key={g.key} className="bg-white">
                            <div className="flex items-stretch">
                              <button
                                type="button"
                                onClick={() => isEditing ? closeRowEditor() : openRowEditor(primary.rowIndex)}
                                className="flex-1 px-3 py-2 text-[10px] text-red-700 flex items-start gap-2 hover:bg-red-50 transition-colors text-left"
                              >
                                {isEditing ? <ChevronDown size={10} className="mt-0.5 shrink-0" /> : <ChevronRight size={10} className="mt-0.5 shrink-0" />}
                                <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-semibold">{g.name}</span>
                                  {g.rows.length > 1 && (
                                    <span className="ml-1.5 text-[9px] font-bold text-red-700 bg-red-200 px-1.5 py-0.5 rounded">
                                      {g.rows.length} linhas
                                    </span>
                                  )}
                                  <span className="block text-red-600/80 truncate">{g.errors.join(' • ')}</span>
                                </div>
                                <span className="text-[9px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded shrink-0">
                                  {isEditing ? 'Fechar' : 'Corrigir'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (g.rows.length > 1) handleRemoveStudentGroup(g.name, rowIndexes);
                                  else handleRemoveRow(primary.rowIndex);
                                }}
                                className="px-2 hover:bg-red-100 text-red-600 transition-colors border-l border-red-200 flex items-center justify-center"
                                title={g.rows.length > 1 ? `Remover todas as ${g.rows.length} linhas deste aluno` : 'Remover esta linha'}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            {!isEditing && <QuickFixBar group={g} />}
                            {isEditing && renderRowEditor(g.rows.find((r) => r.rowIndex === editingRowIndex) || primary)}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* Kamino: Classificações sem Treinamento cadastrado */}
              {mode === 'kamino' && pendingKaminoDecisionCount > 0 && (
                <div className="mb-3 border border-orange-300 rounded-lg bg-orange-50/60 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-orange-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-orange-800 mb-1">
                        {pendingKaminoDecisionCount} classificação/tag para revisar antes de importar
                      </p>
                      <p className="text-[10px] text-orange-700 mb-2">
                        A tela de correção abre automaticamente. Confirme Classificação como treinamento cadastrado/novo, criação de tag ou tag existente antes de importar.
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        {unknownClassificacoes.slice(0, 20).map((c) => (
                          <span key={c} className="text-[10px] px-2 py-0.5 bg-orange-100 border border-orange-300 rounded font-semibold text-orange-800">
                            {c}
                          </span>
                        ))}
                        <button type="button" onClick={openKaminoDecisionModal} className="text-[10px] px-2 py-0.5 bg-primary text-primary-foreground border border-primary rounded font-bold">
                          Revisar agora
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {warningGroups.length > 0 && (
                <div className="mb-3 border border-amber-200 rounded-lg bg-amber-50/50 overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 sticky top-0">
                    {warningGroups.length} aluno(s) com aviso ({validRows.filter((r) => r.errors.length > 0).length} linha(s)) — campos opcionais vazios. Você pode corrigir ou importar mesmo assim.
                  </div>
                  <ul className="divide-y divide-amber-200 max-h-48 overflow-y-auto">
                    {warningGroups.map((g) => {
                      const primary = g.rows[0];
                      const isEditing = g.rows.some((r) => r.rowIndex === editingRowIndex);
                      const rowIndexes = g.rows.map((r) => r.rowIndex);
                      return (
                        <li key={g.key} className="bg-white">
                          <div className="flex items-stretch">
                            <button
                              type="button"
                              onClick={() => isEditing ? closeRowEditor() : openRowEditor(primary.rowIndex)}
                              className="flex-1 px-3 py-1.5 text-[10px] text-amber-700 flex items-start gap-2 hover:bg-amber-50 transition-colors text-left"
                            >
                              {isEditing ? <ChevronDown size={10} className="mt-0.5 shrink-0" /> : <ChevronRight size={10} className="mt-0.5 shrink-0" />}
                              <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold">{g.name}</span>
                                {g.rows.length > 1 && (
                                  <span className="ml-1.5 text-[9px] font-bold text-amber-800 bg-amber-200 px-1.5 py-0.5 rounded">
                                    {g.rows.length} linhas
                                  </span>
                                )}
                                <span className="block text-amber-600/80 truncate">{g.errors.join(' • ')}</span>
                              </div>
                              <span className="text-[9px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                                {isEditing ? 'Fechar' : 'Corrigir'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (g.rows.length > 1) handleRemoveStudentGroup(g.name, rowIndexes);
                                else handleRemoveRow(primary.rowIndex);
                              }}
                              className="px-2 hover:bg-amber-100 text-amber-700 transition-colors border-l border-amber-200 flex items-center justify-center"
                              title={g.rows.length > 1 ? `Remover todas as ${g.rows.length} linhas deste aluno` : 'Remover esta linha'}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {!isEditing && <QuickFixBar group={g} />}
                          {isEditing && renderRowEditor(g.rows.find((r) => r.rowIndex === editingRowIndex) || primary)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}


              {validRows.length > 0 && (
                <div className="max-h-40 overflow-y-auto border border-border rounded-lg bg-background">
                  <table className="w-full text-[10px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left font-semibold text-muted-foreground">#</th>
                        <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Nome</th>
                        <th className="px-2 py-1 text-left font-semibold text-muted-foreground">AC</th>
                        <th className="px-2 py-1 text-left font-semibold text-muted-foreground">Produto</th>
                        <th className="px-2 py-1 text-right font-semibold text-muted-foreground">Contrato</th>
                        <th className="px-2 py-1 text-right font-semibold text-muted-foreground">Parcelas</th>
                        {mode === 'kamino' && <th className="px-2 py-1 text-right font-semibold text-muted-foreground">Pagas</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {validRows.slice(0, 50).map((r) => (
                        <tr key={r.rowIndex}>
                          <td className="px-2 py-1 text-muted-foreground">{r.rowIndex}</td>
                          <td className="px-2 py-1 text-foreground truncate max-w-[140px]">{r.data!.name}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.data!.ac}</td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[120px]">{r.data!.product}</td>
                          <td className="px-2 py-1 text-right text-foreground">R$ {r.data!.saleValue.toFixed(0)}</td>
                          <td className="px-2 py-1 text-right text-muted-foreground">{r.data!.totalInstallments}x</td>
                          {mode === 'kamino' && <td className="px-2 py-1 text-right text-emerald-600">{r.data!.paidInstallments}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {importedCount !== null && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <p className="text-xs font-semibold text-emerald-700">
                {importedCount} aluno{importedCount === 1 ? '' : 's'} importado{importedCount === 1 ? '' : 's'} com sucesso.
              </p>
            </div>
          )}

          {/* Diagnóstico visual pós-import (Kamino) */}
          {/* Diagnóstico só aparece se houver alguma divergência (Kamino) */}
          {diagnostics && diagnostics.some((d) => !d.match) && (
            <div className="border-2 border-blue-300 rounded-xl bg-blue-50/40 overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-100/60 border-b border-blue-200">
                <h3 className="text-xs font-bold text-blue-900">🔍 Diagnóstico do Import (verificação no banco)</h3>
                <p className="text-[10px] text-blue-700 mt-0.5">
                  Compara o que foi enviado x o que ficou salvo no banco. Se algo aparecer em vermelho, o problema é confirmado.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 p-3 bg-white">
                <button
                  type="button"
                  onClick={() => setDiagnosticFilter((f) => (f === 'ok' ? 'all' : 'ok'))}
                  className={`bg-emerald-50 border rounded-lg p-2 text-center transition-all ${
                    diagnosticFilter === 'ok' ? 'border-emerald-500 ring-2 ring-emerald-300' : 'border-emerald-200 hover:border-emerald-400'
                  }`}
                >
                  <p className="text-[9px] font-semibold text-emerald-700 uppercase">✅ OK</p>
                  <p className="text-base font-bold text-emerald-700">{diagnostics.filter((d) => d.match).length}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setDiagnosticFilter((f) => (f === 'error' ? 'all' : 'error'))}
                  className={`bg-red-50 border rounded-lg p-2 text-center transition-all ${
                    diagnosticFilter === 'error' ? 'border-red-500 ring-2 ring-red-300' : 'border-red-200 hover:border-red-400'
                  }`}
                >
                  <p className="text-[9px] font-semibold text-red-700 uppercase">❌ Problema</p>
                  <p className="text-base font-bold text-red-700">{diagnostics.filter((d) => !d.match).length}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setDiagnosticFilter('all')}
                  className={`bg-muted border rounded-lg p-2 text-center transition-all ${
                    diagnosticFilter === 'all' ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                  }`}
                >
                  <p className="text-[9px] font-semibold text-muted-foreground uppercase">Total</p>
                  <p className="text-base font-bold text-foreground">{diagnostics.length}</p>
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-border">
                {diagnostics
                  .filter((d) => diagnosticFilter === 'all' || (diagnosticFilter === 'ok' ? d.match : !d.match))
                  .map((d, i) => {
                    const diagnosticKey = `${d.expectedName ?? d.name}|${d.expectedProduct ?? d.product}|${i}`;
                    const isExpanded = expandedDiagnosticKey === diagnosticKey;
                    const diagnosticStudents = (d.studentIds ?? [])
                      .map((id) => students.find((s) => s.id === id))
                      .filter((s): s is Student => !!s);
                    return (
                      <div key={diagnosticKey} className={d.match ? 'bg-emerald-50/30' : 'bg-red-50/40'}>
                        <div className="flex items-stretch">
                          <button
                            type="button"
                            onClick={() => setExpandedDiagnosticKey(isExpanded ? null : diagnosticKey)}
                            className="flex-1 px-3 py-2 text-left hover:bg-background/60 transition-colors"
                          >
                            <div className="grid grid-cols-[24px_1fr_110px_70px_70px] gap-2 items-center text-[10px]">
                              <span className={d.match ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'}>{d.match ? '✅' : '❌'}</span>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate">{d.name}</p>
                                <p className="text-muted-foreground truncate">{d.match ? 'OK' : 'Clique para editar ou excluir'}</p>
                              </div>
                              <span className="text-muted-foreground truncate">{d.product || 'Sem produto'}</span>
                              <span className="text-right text-foreground font-semibold">{d.sentInstallments}</span>
                              <span className={`text-right font-bold ${d.match ? 'text-emerald-700' : 'text-red-700'}`}>{d.returnedInstallments}</span>
                            </div>
                          </button>
                          {!d.match && (
                            <button
                              type="button"
                              onClick={() => handleDismissDiagnosticEntry(d)}
                              className="px-2 hover:bg-red-100 text-red-700 transition-colors border-l border-red-200 flex items-center justify-center"
                              title="Remover este erro do diagnóstico"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        {isExpanded && !d.match && (
                          <div className="border-t border-border bg-background/70">
                            {diagnosticStudents.length === 0 ? (
                              <div className="px-3 py-3 flex items-center justify-between gap-3">
                                <p className="text-[10px] text-muted-foreground">Nenhuma ficha encontrada no banco para editar. Você pode remover este erro da lista.</p>
                                <button type="button" onClick={() => handleDismissDiagnosticEntry(d)} className="px-3 py-1.5 text-[11px] font-semibold border border-red-200 text-red-700 rounded-md hover:bg-red-50">Remover erro</button>
                              </div>
                            ) : (
                              <div className="divide-y divide-border">
                                {diagnosticStudents.map((student) => {
                                  const isEditingStudent = editingDiagnosticStudentId === student.id;
                                  return (
                                    <div key={student.id}>
                                      <div className="px-3 py-2 flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[10px] font-semibold text-foreground truncate">{student.name}</p>
                                          <p className="text-[10px] text-muted-foreground truncate">{student.product || 'Sem produto'} • {student.installments?.length ?? 0} parcela(s)</p>
                                        </div>
                                        <button type="button" onClick={() => isEditingStudent ? closeDiagnosticEditor() : openDiagnosticEditor(student)} className="px-2 py-1 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30 rounded-md hover:bg-primary/20">{isEditingStudent ? 'Fechar' : 'Editar'}</button>
                                        <button type="button" onClick={() => handleRemoveDiagnosticStudent(student, d)} className="px-2 py-1 text-[10px] font-semibold border border-red-200 text-red-700 rounded-md hover:bg-red-50 flex items-center gap-1"><Trash2 size={10} /> Excluir</button>
                                      </div>
                                      {isEditingStudent && renderDiagnosticStudentEditor(student, d)}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
              <div className="px-4 py-2.5 bg-blue-50 border-t border-blue-200">
                <p className="text-[10px] text-blue-800 font-medium">
                  💡 <strong>Como interpretar:</strong> Se "Enviadas" = "No banco" para todos, o salvamento está correto. Se forem diferentes, o problema é no banco. Agora <strong>recarregue a página (F5)</strong> e abra o modal novamente — se o número mudar, é problema de leitura.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 rounded-lg text-xs font-semibold border border-border hover:bg-muted transition-colors">Fechar</button>
          {/* Esconde "Importar" quando o import já terminou sem nada pendente */}
          {!(importedCount !== null && validRows.length === 0 && invalidRows.length === 0) && (() => {
            const errosCount = invalidRows.length;
            const avisosCount = validRows.filter((r) => r.errors.length > 0).length;
            const hasBlocking = errosCount > 0;
            const label = importing
              ? 'Importando...'
              : hasBlocking
                ? `Corrija ${errosCount} erro${errosCount > 1 ? 's' : ''} para importar`
                : avisosCount > 0
                  ? `Importar mesmo com ${avisosCount} aviso${avisosCount > 1 ? 's' : ''} (${validRows.length})`
                  : `Importar${validRows.length > 0 ? ` (${validRows.length})` : ''}`;
            return (
              <button
                onClick={handleConfirmImport}
                disabled={validRows.length === 0 || importing || parsing || hasBlocking}
                title={hasBlocking ? 'Edite ou exclua todas as linhas com erro antes de importar' : avisosCount > 0 ? 'Avisos não bloqueiam — será pedida confirmação' : ''}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold iam-gradient text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {label}
              </button>
            );
          })()}
        </div>
      </div>

      {/* Modal de decisão por Classificação desconhecida */}
      {showClassDecisionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col saas-shadow-lg">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center">
                  <AlertTriangle size={16} className="text-orange-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Confirmações pré-importação</h2>
                  <p className="text-[11px] text-muted-foreground">Revise Classificações e Contas de Recebimento antes de importar</p>
                </div>
              </div>
              <button
                onClick={() => setShowClassDecisionModal(false)}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {unknownClassificacoes.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Classificações sem Treinamento</h3>
                    <p className="text-[11px] text-muted-foreground">
                      A Classificação define o Produto/Treinamento do aluno. Para cada item escolha:
                      {' '}<strong className="text-foreground">Atribuir Treinamento existente</strong> ou
                      {' '}<strong className="text-foreground">Criar novo Treinamento</strong>.
                      {' '}Quando o valor de parcela for compatível com um treinamento já cadastrado, uma sugestão aparecerá em destaque.
                    </p>
                  </div>
                  {unknownClassificacoes.map((c) => {
                    const decision = classDecisions[c] ?? (products.length > 0 ? 'treinamento-existente' : 'treinamento');
                    const editedName = classTagNames[c] ?? c;
                    const avg = classificationAvgValues.get(c);
                    const suggested = suggestProductByValue(avg);
                    return (
                      <div key={c} className="border border-border rounded-xl p-3 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground mb-1.5">
                          Original: <span className="font-mono text-foreground">{c}</span>
                          {avg ? (
                            <span className="ml-2 text-muted-foreground">· valor médio parcela: <span className="font-semibold text-foreground">R$ {avg.toFixed(2).replace('.', ',')}</span></span>
                          ) : null}
                        </p>

                        {suggested && (
                          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                            <div className="text-[10px] text-emerald-800">
                              <span className="font-semibold">Sugestão por valor compatível:</span>{' '}
                              <span className="font-bold">{suggested.name}</span>
                              {suggested.value ? (
                                <span className="text-emerald-700"> (R$ {suggested.value.toFixed(2).replace('.', ',')})</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setClassDecisions((prev) => ({ ...prev, [c]: 'treinamento-existente' }));
                                setClassTagNames((prev) => ({ ...prev, [c]: suggested.name }));
                              }}
                              className="px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              Atribuir
                            </button>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          <button
                            onClick={() => {
                              setClassDecisions((prev) => ({ ...prev, [c]: 'treinamento-existente' }));
                              if (products.length > 0 && !products.some((p) => p.name.toLowerCase() === (classTagNames[c] ?? '').trim().toLowerCase())) {
                                setClassTagNames((prev) => ({ ...prev, [c]: suggested?.name ?? products[0].name }));
                              }
                            }}
                            disabled={products.length === 0}
                            className={`px-2 py-1.5 rounded-md text-[10px] font-semibold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                              decision === 'treinamento-existente'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-background border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            Atribuir Treinamento
                          </button>
                          <button
                            onClick={() => setClassDecisions((prev) => ({ ...prev, [c]: 'treinamento' }))}
                            className={`px-2 py-1.5 rounded-md text-[10px] font-semibold border transition-all ${
                              decision === 'treinamento'
                                ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                : 'bg-background border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            Criar Treinamento
                          </button>
                        </div>
                        {decision === 'treinamento-existente' && (
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Selecione o treinamento cadastrado</label>
                            <select
                              value={products.some((p) => p.name === editedName) ? editedName : ''}
                              onChange={(e) => setClassTagNames((prev) => ({ ...prev, [c]: e.target.value }))}
                              className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            >
                              <option value="">— Selecione —</option>
                              {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                            </select>
                          </div>
                        )}
                        {decision === 'treinamento' && (
                          <div>
                            <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Nome do novo treinamento</label>
                            <input
                              type="text"
                              value={editedName}
                              onChange={(e) => setClassTagNames((prev) => ({ ...prev, [c]: e.target.value }))}
                              className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                              placeholder={c}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {contasRecebimento.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Contas de Recebimento</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Cada Conta de Recebimento da planilha pode <strong className="text-foreground">virar uma Tag</strong> nova,
                      ser <strong className="text-foreground">atribuída a uma tag existente</strong> ou ser <strong className="text-foreground">Ignorada</strong>.
                    </p>
                  </div>
                  {contasRecebimento.map((c) => {
                    const decision = contaDecisions[c] ?? 'ignorar';
                    const editedName = contaTagNames[c] ?? c;
                    const willReuse = decision === 'tag' && studentTags.some((t) => t.name.toLowerCase() === editedName.trim().toLowerCase());
                    return (
                      <TagDecisionRow
                        key={c}
                        candidate={c}
                        decision={decision}
                        setDecision={(d) => setContaDecisions((prev) => ({ ...prev, [c]: d }))}
                        editedName={editedName}
                        setEditedName={(name) => setContaTagNames((prev) => ({ ...prev, [c]: name }))}
                        assignedTagId={contaTagAssign[c] ?? ''}
                        setAssignedTagId={(id) => setContaTagAssign((prev) => ({ ...prev, [c]: id }))}
                        studentTags={studentTags}
                        willReuse={willReuse}
                      />
                    );
                  })}
                </div>
              )}

              {centrosCustoDesconhecidos.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Centro de Custo (palavras desconhecidas)</h3>
                    <p className="text-[11px] text-muted-foreground">
                      As palavras-chave reconhecidas (<em>Antecipação</em>, <em>Cancelamento</em>, <em>Negativação</em>, <em>Tmf</em>) são tratadas automaticamente.
                      Para qualquer outra palavra encontrada no <strong>Centro de Custo</strong>, decida: <strong className="text-foreground">Virar Tag</strong> (aplicada às parcelas correspondentes) ou <strong className="text-foreground">Ignorar</strong>.
                    </p>
                  </div>
                  {centrosCustoDesconhecidos.map((c) => {
                    const decision = ccDecisions[c] ?? 'ignorar';
                    const editedName = ccTagNames[c] ?? c;
                    const willReuse = decision === 'tag' && studentTags.some((t) => t.name.toLowerCase() === editedName.trim().toLowerCase());
                    return (
                      <TagDecisionRow
                        key={c}
                        candidate={c}
                        decision={decision}
                        setDecision={(d) => setCcDecisions((prev) => ({ ...prev, [c]: d }))}
                        editedName={editedName}
                        setEditedName={(name) => setCcTagNames((prev) => ({ ...prev, [c]: name }))}
                        assignedTagId={ccTagAssign[c] ?? ''}
                        setAssignedTagId={(id) => setCcTagAssign((prev) => ({ ...prev, [c]: id }))}
                        studentTags={studentTags}
                        willReuse={willReuse}
                      />
                    );
                  })}
                </div>
              )}

              {centrosCustoConhecidos.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Centro de Custo (palavras-chave)</h3>
                    <p className="text-[11px] text-muted-foreground">
                      As palavras <em>Antecipação</em>, <em>Cancelamento</em> e <em>Tmf</em> foram detectadas no Centro de Custo.
                      Decida se cada uma vira <strong className="text-foreground">Tag</strong> aplicada às parcelas correspondentes ou se deve ser <strong className="text-foreground">Ignorada</strong>.
                      <br /><span className="text-[10px]">⚠ A regra de espelho de cancelamento e o status de Negativação continuam funcionando, independente da decisão sobre a tag.</span>
                    </p>
                  </div>
                  {centrosCustoConhecidos.map((c) => {
                    const decision = cckDecisions[c] ?? 'ignorar';
                    const editedName = cckTagNames[c] ?? c;
                    const willReuse = decision === 'tag' && studentTags.some((t) => t.name.toLowerCase() === editedName.trim().toLowerCase());
                    return (
                      <TagDecisionRow
                        key={c}
                        candidate={c}
                        decision={decision}
                        setDecision={(d) => setCckDecisions((prev) => ({ ...prev, [c]: d }))}
                        editedName={editedName}
                        setEditedName={(name) => setCckTagNames((prev) => ({ ...prev, [c]: name }))}
                        assignedTagId={cckTagAssign[c] ?? ''}
                        setAssignedTagId={(id) => setCckTagAssign((prev) => ({ ...prev, [c]: id }))}
                        studentTags={studentTags}
                        willReuse={willReuse}
                      />
                    );
                  })}
                </div>
              )}

              {recompraClassificacoes.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Classificação de Recompra</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Linhas com Classificação contendo "Recompra" foram detectadas. Decida se cada nome vira uma <strong className="text-foreground">Tag</strong> aplicada às parcelas dessa recompra ou se é <strong className="text-foreground">Ignorada</strong>.
                    </p>
                  </div>
                  {recompraClassificacoes.map((c) => {
                    const decision = recompraDecisions[c] ?? 'ignorar';
                    const editedName = recompraTagNames[c] ?? c;
                    const willReuse = decision === 'tag' && studentTags.some((t) => t.name.toLowerCase() === editedName.trim().toLowerCase());
                    return (
                      <TagDecisionRow
                        key={c}
                        candidate={c}
                        decision={decision}
                        setDecision={(d) => setRecompraDecisions((prev) => ({ ...prev, [c]: d }))}
                        editedName={editedName}
                        setEditedName={(name) => setRecompraTagNames((prev) => ({ ...prev, [c]: name }))}
                        assignedTagId={recompraTagAssign[c] ?? ''}
                        setAssignedTagId={(id) => setRecompraTagAssign((prev) => ({ ...prev, [c]: id }))}
                        studentTags={studentTags}
                        willReuse={willReuse}
                      />
                    );
                  })}
                </div>
              )}

              {formasRecebimento.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Forma de Recebimento (coluna I)</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Os valores "Legado" e "Manual" são ignorados automaticamente. Para os demais, decida virar <strong className="text-foreground">Tag</strong> (aplicada às parcelas) ou <strong className="text-foreground">Ignorar</strong>.
                    </p>
                  </div>
                  {formasRecebimento.map((c) => {
                    const decision = formaDecisions[c] ?? 'ignorar';
                    const editedName = formaTagNames[c] ?? c;
                    const willReuse = decision === 'tag' && studentTags.some((t) => t.name.toLowerCase() === editedName.trim().toLowerCase());
                    return (
                      <TagDecisionRow
                        key={c}
                        candidate={c}
                        decision={decision}
                        setDecision={(d) => setFormaDecisions((prev) => ({ ...prev, [c]: d }))}
                        editedName={editedName}
                        setEditedName={(name) => setFormaTagNames((prev) => ({ ...prev, [c]: name }))}
                        assignedTagId={formaTagAssign[c] ?? ''}
                        setAssignedTagId={(id) => setFormaTagAssign((prev) => ({ ...prev, [c]: id }))}
                        studentTags={studentTags}
                        willReuse={willReuse}
                      />
                    );
                  })}
                </div>
              )}

              {acCandidates.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Assessores identificados (Centro de Custo)</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Foram detectados nomes próprios entre parênteses na coluna F que não batem com nenhum AC cadastrado. Escolha: <strong className="text-foreground">Atribuir a um AC existente</strong> ou <strong className="text-foreground">Ignorar</strong>. A criação de um novo AC exige cadastro prévio do usuário em <strong className="text-foreground">Controle de Acesso</strong>.
                    </p>

                  </div>
                  {acCandidates.map((c) => {
                    const decision = acDecisions[c] ?? 'atribuir';
                    const chosen = acAssign[c] ?? '';
                    return (
                      <div key={c} className="border border-border rounded-xl p-3 bg-muted/20">
                        <p className="text-[10px] text-muted-foreground mb-2">Nome detectado: <span className="font-semibold text-foreground">{c}</span></p>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <button
                            onClick={() => setAcDecisions((prev) => ({ ...prev, [c]: 'atribuir' }))}
                            className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all ${decision === 'atribuir' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                          >Atribuir AC existente</button>
                          <button
                            onClick={() => setAcDecisions((prev) => ({ ...prev, [c]: 'ignorar' }))}
                            className={`px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all ${decision === 'ignorar' ? 'bg-slate-600 text-white border-slate-600 shadow-sm' : 'bg-background border-border text-muted-foreground hover:bg-muted'}`}
                          >Ignorar</button>
                        </div>
                        {decision === 'atribuir' && (
                          <select
                            value={chosen}
                            onChange={(e) => setAcAssign((prev) => ({ ...prev, [c]: e.target.value }))}
                            className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                          >
                            <option value="">Selecione um AC...</option>
                            {acs.filter((a) => a.active).map((a) => (
                              <option key={a.id} value={a.name}>{a.name}</option>
                            ))}
                          </select>
                        )}
                        <p className="text-[10px] text-muted-foreground/80 mt-2 leading-snug">
                          Para criar um novo AC, cadastre primeiro o usuário em <strong>Configurações → Controle de Acesso</strong>. O AC é vinculado automaticamente.
                        </p>
                      </div>
                    );
                  })}

                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                onClick={() => setShowClassDecisionModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold border border-border hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (importing) return;
                  const ok = await confirm({
                    title: 'Confirmar importação',
                    description: `Confirmar importação de ${validRows.length} aluno(s) com as decisões selecionadas?`,
                    confirmText: 'Importar',
                  });
                  if (!ok) return;
                  void runImport();
                }}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold iam-gradient text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Upload size={13} />
                {importing ? 'Importando...' : 'Continuar Importação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
