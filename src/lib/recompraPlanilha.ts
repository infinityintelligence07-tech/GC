// ─── Planilha de Recompra → fichas de Recompra (Fundo) ───────────────────────
// A planilha do financeiro lista os boletos antecipados que o banco debitou de
// volta (recompra): DATA DO DÉBITO, DOCUMENTO, BANCO, VALOR DEBITADO,
// VENCIMENTO, VALOR ORIGINAL, JUROS, ALUNO, ASSESSOR. Cada linha vira uma
// parcela em aberto na ficha de Recompra do aluno — ficha nova quando ele ainda
// não tem, anexada quando já tem. A ficha nasce sem `recompraTreinamento` e por
// isso cai sozinha em Conciliação > Recompras > "Aguardando vínculo".
//
// Este módulo é puro (sem React/SheetJS): recebe a matriz de células e a
// carteira, devolve as operações a gravar. Testado em recompraPlanilha.test.ts.

import type { AC, Installment, Student } from '@/types';
import { isRecompraFicha } from '@/lib/recompraConciliacao';
import { calculateStudentAutoStatus } from '@/store/useAppStore';

export const RECOMPRA_PRODUTO_PADRAO = 'Fundo - Receita (Recompra)';

export interface RecompraPlanilhaRow {
  /** Linha na planilha (1-based, como o Excel mostra). */
  rowIndex: number;
  aluno: string;
  assessor: string;
  banco: string;
  documento: string;
  /** YYYY-MM-DD */
  dataDebito: string | null;
  /** YYYY-MM-DD */
  vencimento: string | null;
  valorDebitado: number | null;
  valorOriginal: number | null;
  juros: number | null;
  /** Coluna extra depois de ASSESSOR (ex.: "LIBERTY"). Só informativa. */
  extra: string;
}

/** Qual valor vira a parcela: o debitado pelo banco (original + juros) ou só o original. */
export type RecompraValorBase = 'debitado' | 'original';

export type RecompraMatchStatus = 'ok' | 'ambiguo' | 'nao_encontrado' | 'invalido';

export interface RecompraRowMatch {
  row: RecompraPlanilhaRow;
  status: RecompraMatchStatus;
  /**
   * Contratos (não-recompra) candidatos, um por aluno distinto — o match é da
   * PESSOA; o contrato serve só para copiar nome/AC/contato para a ficha nova.
   */
  candidatos: Student[];
  /** Contrato escolhido (automático em `ok`, manual nos demais). */
  studentId?: string;
  /** Sem aluno no GC: cria a ficha com o nome da planilha e o AC da coluna ASSESSOR. */
  criarComNomePlanilha?: boolean;
  motivo?: string;
}

// ─── Normalizadores ──────────────────────────────────────────────────────────

export function normalizeNome(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Serial do Excel (dias desde 30/12/1899) → YYYY-MM-DD, em UTC para não perder um dia em Brasília. */
function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 200000) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function normalizeDataPlanilha(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  if (typeof value === 'number') return excelSerialToIso(value);
  const str = String(value).trim();
  if (!str) return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Texto no padrão brasileiro: D/M/AAAA ou D/M/AA (a planilha é preenchida no Brasil).
  const br = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    const y = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const serial = Number(str);
  if (Number.isFinite(serial)) return excelSerialToIso(serial);
  return null;
}

export function normalizeValorPlanilha(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : null;
  const str = String(value).replace(/\s/g, '').replace(/R\$/gi, '');
  if (!str) return null;
  // "2.828,48" (BR) vs "2,828.48" (US): a vírgula depois do ponto indica BR.
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastComma > lastDot) normalized = str.replace(/\./g, '').replace(',', '.');
  else normalized = str.replace(/,/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? round2(num) : null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function formatDataBR(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ─── Parsing da matriz ───────────────────────────────────────────────────────

const HEADER_KEYS = {
  dataDebito: /data.*debito/,
  documento: /documento|doc\b|titulo|nosso numero/,
  banco: /banco/,
  valorDebitado: /valor.*debitado/,
  vencimento: /vencimento|venc\b/,
  valorOriginal: /valor.*original/,
  juros: /juros/,
  aluno: /^aluno|cliente|pagador|nome/,
  assessor: /assessor|\bac\b|consultor/,
} as const;

type HeaderKey = keyof typeof HEADER_KEYS;

function findHeaderRow(matrix: unknown[][]): number {
  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const cells = (matrix[r] ?? []).map(normalizeNome);
    const temAluno = cells.some((c) => HEADER_KEYS.aluno.test(c));
    const temValor = cells.some((c) => HEADER_KEYS.valorDebitado.test(c) || HEADER_KEYS.valorOriginal.test(c));
    if (temAluno && temValor) return r;
  }
  return -1;
}

/**
 * Lê a matriz de células (SheetJS `sheet_to_json(ws, { header: 1 })`) e devolve
 * as linhas de recompra. Ignora título, cabeçalho, linhas vazias e a linha
 * "TOTAL" do rodapé. Lança erro se o cabeçalho esperado não for encontrado.
 */
export function parsePlanilhaRecompra(matrix: unknown[][]): RecompraPlanilhaRow[] {
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) {
    throw new Error(
      'Cabeçalho não encontrado. A planilha precisa das colunas ALUNO, VENCIMENTO, VALOR DEBITADO (ou VALOR ORIGINAL).',
    );
  }
  const header = (matrix[headerIdx] ?? []).map(normalizeNome);
  const col: Partial<Record<HeaderKey, number>> = {};
  for (const key of Object.keys(HEADER_KEYS) as HeaderKey[]) {
    const idx = header.findIndex((h) => h && HEADER_KEYS[key].test(h));
    if (idx >= 0) col[key] = idx;
  }
  if (col.aluno == null || col.vencimento == null || (col.valorDebitado == null && col.valorOriginal == null)) {
    throw new Error('Cabeçalho incompleto: são obrigatórias as colunas ALUNO, VENCIMENTO e VALOR DEBITADO/ORIGINAL.');
  }
  const lastKnownCol = Math.max(...Object.values(col).filter((v): v is number => v != null));
  const cell = (row: unknown[], key: HeaderKey): unknown => (col[key] == null ? '' : row[col[key] as number]);
  const text = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

  const rows: RecompraPlanilhaRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const raw = matrix[r] ?? [];
    const aluno = text(cell(raw, 'aluno'));
    const primeira = text(raw[0]);
    if (!aluno) {
      // Linha vazia ou rodapé ("TOTAL DEBITADO") — sem aluno não há parcela.
      continue;
    }
    if (/^total/i.test(aluno) || /^total/i.test(primeira)) continue;
    rows.push({
      rowIndex: r + 1,
      aluno,
      assessor: text(cell(raw, 'assessor')),
      banco: text(cell(raw, 'banco')),
      documento: text(cell(raw, 'documento')),
      dataDebito: normalizeDataPlanilha(cell(raw, 'dataDebito')),
      vencimento: normalizeDataPlanilha(cell(raw, 'vencimento')),
      valorDebitado: normalizeValorPlanilha(cell(raw, 'valorDebitado')),
      valorOriginal: normalizeValorPlanilha(cell(raw, 'valorOriginal')),
      juros: normalizeValorPlanilha(cell(raw, 'juros')),
      extra: text(raw[lastKnownCol + 1]),
    });
  }
  return rows;
}

// ─── Match aluno da planilha → aluno do GC ───────────────────────────────────

function primeiroNome(s: string): string {
  return normalizeNome(s).split(' ')[0] ?? '';
}

/** AC do catálogo cujo primeiro nome bate com a coluna ASSESSOR ("ELAINE" → "Elaine ..."). */
export function resolveAcPlanilha(assessor: string, acs: AC[]): AC | undefined {
  const alvo = primeiroNome(assessor);
  if (!alvo) return undefined;
  const exato = acs.find((a) => normalizeNome(a.name) === normalizeNome(assessor));
  if (exato) return exato;
  const porPrimeiro = acs.filter((a) => primeiroNome(a.name) === alvo);
  if (porPrimeiro.length === 1) return porPrimeiro[0];
  const ativos = porPrimeiro.filter((a) => a.active);
  return ativos.length === 1 ? ativos[0] : undefined;
}

function saldoAberto(s: Student): number {
  return s.installments.filter((i) => !i.paid).reduce((a, i) => a + (Number(i.value) || 0), 0);
}

/** Entre contratos do mesmo aluno, o que melhor representa a pessoa (AC da planilha, depois saldo). */
function escolheRepresentante(contratos: Student[], assessor: string): Student {
  const ac = primeiroNome(assessor);
  const doAc = ac ? contratos.filter((s) => primeiroNome(s.ac) === ac) : [];
  const base = doAc.length > 0 ? doAc : contratos;
  return [...base].sort((a, b) => saldoAberto(b) - saldoAberto(a))[0];
}

/**
 * Nomes da planilha vêm truncados ("JOAO VITOR DOS SANTOS DA", "ELISANDRA
 * APARECIDA DE"): além do igual, aceita o nome do GC que começa com o da planilha
 * (ou vice-versa), desde que o trecho comum seja razoavelmente longo.
 */
function nomeCompativel(planilha: string, gc: string): boolean {
  if (planilha === gc) return true;
  const menor = planilha.length <= gc.length ? planilha : gc;
  const maior = menor === planilha ? gc : planilha;
  if (menor.length < 8) return false;
  return maior.startsWith(menor + ' ') || maior === menor;
}

export function matchAlunosRecompra(rows: RecompraPlanilhaRow[], students: Student[]): RecompraRowMatch[] {
  // Uma pessoa = um nome normalizado; guarda todos os contratos (não-recompra) dela.
  const porNome = new Map<string, Student[]>();
  for (const s of students) {
    if (isRecompraFicha(s)) continue;
    const k = normalizeNome(s.name);
    if (!k) continue;
    const arr = porNome.get(k) ?? [];
    arr.push(s);
    porNome.set(k, arr);
  }
  const nomes = Array.from(porNome.keys());

  return rows.map((row): RecompraRowMatch => {
    const valor = row.valorDebitado ?? row.valorOriginal;
    if (!row.vencimento) {
      return { row, status: 'invalido', candidatos: [], motivo: 'Vencimento ausente ou inválido.' };
    }
    if (valor == null || valor <= 0) {
      return { row, status: 'invalido', candidatos: [], motivo: 'Valor ausente ou inválido.' };
    }

    const alvo = normalizeNome(row.aluno);
    let pessoas = porNome.has(alvo) ? [alvo] : nomes.filter((n) => nomeCompativel(alvo, n));
    if (pessoas.length > 1) {
      // Desempata pelo assessor: fica só quem tem contrato com aquele AC.
      const ac = primeiroNome(row.assessor);
      if (ac) {
        const doAc = pessoas.filter((n) => (porNome.get(n) ?? []).some((s) => primeiroNome(s.ac) === ac));
        if (doAc.length >= 1) pessoas = doAc;
      }
    }

    const candidatos = pessoas.map((n) => escolheRepresentante(porNome.get(n) ?? [], row.assessor));
    if (candidatos.length === 1) return { row, status: 'ok', candidatos, studentId: candidatos[0].id };
    if (candidatos.length > 1) return { row, status: 'ambiguo', candidatos, motivo: 'Mais de um aluno com esse nome.' };
    return { row, status: 'nao_encontrado', candidatos: [], motivo: 'Aluno não encontrado no GC.' };
  });
}

// ─── Montagem das operações ──────────────────────────────────────────────────

export interface RecompraImportOpts {
  valorBase: RecompraValorBase;
  /** IDs de tags a marcar em cada parcela (ex.: tag "Recompra"). */
  tagIds?: string[];
  fileName: string;
  autorNome: string;
  /** ISO datetime; padrão agora. */
  nowIso?: string;
  acs: AC[];
}

export interface RecompraAnexo {
  studentId: string;
  studentName: string;
  novasParcelas: Installment[];
  patch: Partial<Student>;
}

export interface RecompraIgnorada {
  row: RecompraPlanilhaRow;
  motivo: string;
}

export interface RecompraImportPlan {
  /** Fichas novas (id vazio — o banco gera). */
  novas: Student[];
  /** Parcelas anexadas a fichas de recompra já existentes. */
  anexos: RecompraAnexo[];
  ignoradas: RecompraIgnorada[];
  totalParcelas: number;
  totalValor: number;
}

export function valorParcelaRecompra(row: RecompraPlanilhaRow, base: RecompraValorBase): number {
  const v = base === 'original' ? row.valorOriginal ?? row.valorDebitado : row.valorDebitado ?? row.valorOriginal;
  return round2(Number(v) || 0);
}

export function observacaoRecompra(row: RecompraPlanilhaRow): string {
  const partes: string[] = [`Recompra${row.banco ? ` ${row.banco}` : ''}`];
  if (row.documento) partes.push(`Doc. ${row.documento}`);
  if (row.dataDebito) partes.push(`debitado em ${formatDataBR(row.dataDebito)}`);
  if (row.valorOriginal != null) {
    const juros = row.juros ?? (row.valorDebitado != null ? round2(row.valorDebitado - row.valorOriginal) : null);
    partes.push(
      juros != null && Math.abs(juros) >= 0.005
        ? `original ${formatBRL(row.valorOriginal)} + juros ${formatBRL(juros)}`
        : `original ${formatBRL(row.valorOriginal)}`,
    );
  }
  return partes.join(' · ');
}

function jaExiste(row: RecompraPlanilhaRow, valor: number, existentes: Installment[]): boolean {
  const doc = row.documento ? `Doc. ${row.documento}` : null;
  return existentes.some((i) => {
    if (doc && (i.observacao ?? '').includes(doc)) return true;
    return i.dueDate === row.vencimento && Math.abs((Number(i.value) || 0) - valor) < 0.01;
  });
}

interface Grupo {
  chave: string;
  nome: string;
  origem?: Student;
  acPlanilha: string;
  rows: RecompraPlanilhaRow[];
}

/**
 * Agrupa as linhas resolvidas por pessoa e monta o que gravar. Linhas sem
 * decisão (ambíguas/não encontradas sem escolha, inválidas) vão para `ignoradas`.
 */
export function planejarImportRecompra(
  matches: RecompraRowMatch[],
  students: Student[],
  opts: RecompraImportOpts,
): RecompraImportPlan {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const hoje = nowIso.slice(0, 10);
  const byId = new Map(students.map((s) => [s.id, s]));
  const ignoradas: RecompraIgnorada[] = [];
  const grupos = new Map<string, Grupo>();

  for (const m of matches) {
    if (m.status === 'invalido') {
      ignoradas.push({ row: m.row, motivo: m.motivo ?? 'Linha inválida.' });
      continue;
    }
    if (m.studentId) {
      const origem = byId.get(m.studentId);
      if (!origem) {
        ignoradas.push({ row: m.row, motivo: 'Aluno escolhido não está mais na carteira.' });
        continue;
      }
      const chave = normalizeNome(origem.name);
      const g = grupos.get(chave) ?? { chave, nome: origem.name, origem, acPlanilha: m.row.assessor, rows: [] };
      g.rows.push(m.row);
      grupos.set(chave, g);
      continue;
    }
    if (m.criarComNomePlanilha) {
      const chave = normalizeNome(m.row.aluno);
      const g = grupos.get(chave) ?? { chave, nome: m.row.aluno, acPlanilha: m.row.assessor, rows: [] };
      g.rows.push(m.row);
      grupos.set(chave, g);
      continue;
    }
    ignoradas.push({ row: m.row, motivo: m.motivo ?? 'Sem aluno definido.' });
  }

  const recomprasPorNome = new Map<string, Student>();
  for (const s of students) {
    if (!isRecompraFicha(s)) continue;
    const k = normalizeNome(s.name);
    const atual = recomprasPorNome.get(k);
    // Com mais de uma ficha de recompra do mesmo aluno, anexa na que tem saldo.
    if (!atual || saldoAberto(s) > saldoAberto(atual)) recomprasPorNome.set(k, s);
  }

  const novas: Student[] = [];
  const anexos: RecompraAnexo[] = [];
  let totalParcelas = 0;
  let totalValor = 0;
  const tags = opts.tagIds && opts.tagIds.length > 0 ? opts.tagIds : undefined;

  const montaParcela = (row: RecompraPlanilhaRow, number: number): Installment => ({
    number,
    dueDate: row.vencimento as string,
    value: valorParcelaRecompra(row, opts.valorBase),
    paid: false,
    observacao: observacaoRecompra(row),
    ...(tags ? { tags: [...tags] } : {}),
  });

  const ordena = (rows: RecompraPlanilhaRow[]) =>
    [...rows].sort((a, b) => (a.vencimento ?? '').localeCompare(b.vencimento ?? '') || a.rowIndex - b.rowIndex);

  for (const g of grupos.values()) {
    const existente = recomprasPorNome.get(g.chave);
    const rows = ordena(g.rows);

    if (existente) {
      const novasParcelas: Installment[] = [];
      let n = existente.installments.length;
      for (const row of rows) {
        const valor = valorParcelaRecompra(row, opts.valorBase);
        if (jaExiste(row, valor, [...existente.installments, ...novasParcelas])) {
          ignoradas.push({ row, motivo: 'Parcela já existe na ficha de recompra do aluno.' });
          continue;
        }
        n += 1;
        novasParcelas.push(montaParcela(row, n));
      }
      if (novasParcelas.length === 0) continue;
      const installments = [...existente.installments, ...novasParcelas];
      const saleValue = round2(installments.reduce((a, i) => a + (Number(i.value) || 0), 0));
      const somaNovas = round2(novasParcelas.reduce((a, i) => a + i.value, 0));
      totalParcelas += novasParcelas.length;
      totalValor += somaNovas;
      anexos.push({
        studentId: existente.id,
        studentName: existente.name,
        novasParcelas,
        patch: {
          installments,
          saleValue,
          totalInstallments: installments.length,
          paidInstallments: installments.filter((i) => i.paid).length,
          installmentValue: round2(saleValue / installments.length),
          status: calculateStudentAutoStatus({ installments, product: existente.product }),
          history: [
            ...(existente.history ?? []),
            {
              date: nowIso,
              type: 'Sistema' as const,
              text:
                `${novasParcelas.length} parcela${novasParcelas.length !== 1 ? 's' : ''} de recompra ` +
                `(${formatBRL(somaNovas)}) anexada${novasParcelas.length !== 1 ? 's' : ''} via planilha "${opts.fileName}" por ${opts.autorNome}.`,
            },
          ],
        },
      });
      continue;
    }

    const installments = rows.map((row, idx) => montaParcela(row, idx + 1));
    const saleValue = round2(installments.reduce((a, i) => a + i.value, 0));
    const debitos = rows.map((r) => r.dataDebito).filter((d): d is string => !!d).sort();
    const enrollmentDate = debitos[0] ?? installments[0]?.dueDate ?? hoje;
    const dueDay = Number((installments[0]?.dueDate ?? hoje).slice(8, 10)) || 10;
    const origem = g.origem;
    const acPlanilha = resolveAcPlanilha(g.acPlanilha, opts.acs);
    const ac = origem?.ac || acPlanilha?.name || g.acPlanilha || '';
    totalParcelas += installments.length;
    totalValor += saleValue;

    novas.push({
      id: '',
      name: g.nome,
      whatsapp: origem?.whatsapp ?? '',
      email: origem?.email,
      cpf: origem?.cpf ?? '',
      address: origem?.address ?? '',
      numero: origem?.numero ?? '',
      cidade: origem?.cidade ?? '',
      estado: origem?.estado ?? '',
      cep: origem?.cep ?? '',
      status: calculateStudentAutoStatus({ installments, product: RECOMPRA_PRODUTO_PADRAO }),
      statusMode: 'Automático',
      ac,
      product: RECOMPRA_PRODUTO_PADRAO,
      enrollmentDate,
      data_treinamento_origem: enrollmentDate,
      dueDay,
      saleValue,
      downPayment: 0,
      totalInstallments: installments.length,
      paidInstallments: 0,
      installmentValue: round2(saleValue / installments.length),
      installments,
      detalhes: `Recompra importada da planilha "${opts.fileName}"${rows[0]?.banco ? ` (${rows[0].banco})` : ''}.`,
      history: [
        {
          date: nowIso,
          type: 'Sistema',
          text:
            `Ficha de recompra criada via planilha "${opts.fileName}" por ${opts.autorNome}: ` +
            `${installments.length} parcela${installments.length !== 1 ? 's' : ''} (${formatBRL(saleValue)})` +
            (origem ? ` — aluno identificado pelo contrato "${origem.product}".` : ' — aluno sem contrato no GC.'),
        },
      ],
    });
  }

  return { novas, anexos, ignoradas, totalParcelas, totalValor: round2(totalValor) };
}
