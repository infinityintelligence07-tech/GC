// Extrato do card "A Vencer / Vencido" (Carteira Total do Dashboard).
// Leituras diárias do card + lançamentos manuais de conferência.

import { supabase } from '@/integrations/supabase/client';

export interface CarteiraCardSnapshot {
  id: string;
  companyId: string;
  snapshotDate: string;      // YYYY-MM-DD
  aVencer: number;           // última leitura do dia (fechamento)
  aberturaAVencer?: number;  // primeira leitura do dia
  pago: number;
  qtdAlunos: number;
  updatedAt: string;
}

/** Um aluno dentro do payload da leitura diária (valor em aberto no card). */
export interface CardSnapshotAluno {
  id: string;
  name: string;
  open: number;
}

/**
 * Categorias no modelo da planilha de conferência:
 * - pagamento:      Pagamento / Juros pagos (diminui o card)
 * - entrada_aberto: Entrada valor em aberto (aumenta o card — ex.: reversão de
 *                   cancelamento, contrato novo aprovado)
 * - saida_desconto: Saída / Desconto (diminui o card)
 * - cancelamento:   Cancelamento concluído (diminui o card)
 */
export type ExtratoLancamentoTipo = 'pagamento' | 'entrada_aberto' | 'saida_desconto' | 'cancelamento';

export const LANCAMENTO_TIPOS: Array<{ value: ExtratoLancamentoTipo; label: string; sign: 1 | -1 }> = [
  { value: 'pagamento', label: 'Pagamento / Juros pagos (−)', sign: -1 },
  { value: 'entrada_aberto', label: 'Entrada valor em aberto (+)', sign: 1 },
  { value: 'saida_desconto', label: 'Saída / Desconto (−)', sign: -1 },
  { value: 'cancelamento', label: 'Cancelamento (−)', sign: -1 },
];

export function lancamentoSign(tipo: ExtratoLancamentoTipo): 1 | -1 {
  return tipo === 'entrada_aberto' ? 1 : -1;
}

export interface CarteiraExtratoLancamento {
  id: string;
  companyId: string;
  data: string;              // YYYY-MM-DD
  descricao: string;
  tipo: ExtratoLancamentoTipo;
  valor: number;
  autorNome?: string;
  createdAt: string;
}

function mapSnapshot(r: Record<string, unknown>): CarteiraCardSnapshot {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    snapshotDate: String(r.snapshot_date),
    aVencer: Number(r.a_vencer ?? 0),
    aberturaAVencer: r.abertura_a_vencer != null ? Number(r.abertura_a_vencer) : undefined,
    pago: Number(r.pago ?? 0),
    qtdAlunos: Number(r.qtd_alunos ?? 0),
    updatedAt: String(r.updated_at ?? ''),
  };
}

const TIPOS_VALIDOS = new Set<string>(['pagamento', 'entrada_aberto', 'saida_desconto', 'cancelamento']);

function mapLancamento(r: Record<string, unknown>): CarteiraExtratoLancamento {
  const tipoRaw = String(r.tipo ?? '');
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    data: String(r.data),
    descricao: String(r.descricao ?? ''),
    tipo: (TIPOS_VALIDOS.has(tipoRaw) ? tipoRaw : 'saida_desconto') as ExtratoLancamentoTipo,
    valor: Number(r.valor ?? 0),
    autorNome: r.autor_nome != null ? String(r.autor_nome) : undefined,
    createdAt: String(r.created_at ?? ''),
  };
}

/**
 * Grava a leitura do dia (upsert). A primeira leitura do dia vira "abertura";
 * as seguintes atualizam o fechamento (a_vencer/pago).
 */
export async function upsertCarteiraCardSnapshot(input: {
  companyId: string;
  snapshotDate: string;
  aVencer: number;
  pago: number;
  qtdAlunos: number;
  payload?: CardSnapshotAluno[];
}): Promise<void> {
  const { data: existing, error: selError } = await supabase
    .from('carteira_card_snapshots')
    .select('id, abertura_a_vencer')
    .eq('company_id', input.companyId)
    .eq('snapshot_date', input.snapshotDate)
    .maybeSingle();
  if (selError) throw selError;

  if (existing) {
    const { error } = await supabase
      .from('carteira_card_snapshots')
      .update({
        a_vencer: input.aVencer,
        pago: input.pago,
        qtd_alunos: input.qtdAlunos,
        ...(input.payload ? { payload: input.payload } : {}),
        ...(existing.abertura_a_vencer == null ? { abertura_a_vencer: input.aVencer } : {}),
      })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('carteira_card_snapshots').insert({
      company_id: input.companyId,
      snapshot_date: input.snapshotDate,
      a_vencer: input.aVencer,
      abertura_a_vencer: input.aVencer,
      pago: input.pago,
      qtd_alunos: input.qtdAlunos,
      payload: input.payload ?? null,
    });
    if (error) throw error;
  }
}

// payload fica de fora da listagem (pode ter centenas de alunos por dia);
// é buscado separadamente só para as datas comparadas.
const SNAPSHOT_LIST_COLS = 'id, company_id, snapshot_date, a_vencer, abertura_a_vencer, pago, qtd_alunos, updated_at';

export async function fetchCarteiraCardSnapshots(
  companyId: string,
  from: string,
  to: string,
): Promise<CarteiraCardSnapshot[]> {
  const { data, error } = await supabase
    .from('carteira_card_snapshots')
    .select(SNAPSHOT_LIST_COLS)
    .eq('company_id', companyId)
    .gte('snapshot_date', from)
    .lte('snapshot_date', to)
    .order('snapshot_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSnapshot);
}

/** Payload (alunos + valores em aberto) da leitura de uma data específica. */
export async function fetchCarteiraCardSnapshotPayload(
  companyId: string,
  snapshotDate: string,
): Promise<CardSnapshotAluno[] | null> {
  const { data, error } = await supabase
    .from('carteira_card_snapshots')
    .select('payload')
    .eq('company_id', companyId)
    .eq('snapshot_date', snapshotDate)
    .maybeSingle();
  if (error) throw error;
  const raw = data?.payload;
  if (!Array.isArray(raw)) return null;
  return raw.map((a: Record<string, unknown>) => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    open: Number(a.open ?? 0),
  }));
}

/** Uma linha do comparativo aluno a aluno entre duas leituras do card. */
export interface CardDiffLinha {
  id: string;
  name: string;
  openIni: number;
  openFim: number;
  delta: number;
  situacao: 'saiu' | 'entrou' | 'alterado';
}

/**
 * Compara os payloads de duas leituras e devolve só quem mudou,
 * ordenado do maior impacto negativo para o positivo.
 */
export function diffCardPayloads(
  ini: CardSnapshotAluno[],
  fim: CardSnapshotAluno[],
): CardDiffLinha[] {
  const fimById = new Map(fim.map((a) => [a.id, a]));
  const linhas: CardDiffLinha[] = [];
  const vistos = new Set<string>();

  for (const a of ini) {
    vistos.add(a.id);
    const depois = fimById.get(a.id);
    if (!depois) {
      if (a.open > 0.005) {
        linhas.push({ id: a.id, name: a.name, openIni: a.open, openFim: 0, delta: -a.open, situacao: 'saiu' });
      }
      continue;
    }
    const delta = depois.open - a.open;
    if (Math.abs(delta) > 0.005) {
      linhas.push({ id: a.id, name: a.name, openIni: a.open, openFim: depois.open, delta, situacao: 'alterado' });
    }
  }
  for (const b of fim) {
    if (vistos.has(b.id) || b.open <= 0.005) continue;
    linhas.push({ id: b.id, name: b.name, openIni: 0, openFim: b.open, delta: b.open, situacao: 'entrou' });
  }
  return linhas.sort((a, b) => a.delta - b.delta);
}

/** Registro da Conciliação exibido como histórico de apoio no extrato. */
export interface ConciliacaoRegistro {
  id: string;
  conciliadoAt: string;
  tipo: string;
  studentName: string;
  resumo: string;
}

/** Registros conciliados no período (contexto para o comparativo do card). */
export async function fetchConciliacaoRegistrosPeriodo(
  companyId: string,
  fromDate: string, // YYYY-MM-DD (inclusive, horário de Brasília)
  toDate: string,   // YYYY-MM-DD (inclusive)
): Promise<ConciliacaoRegistro[]> {
  // Converte os limites do período (dias em Brasília) para UTC.
  const fromIso = `${fromDate}T03:00:00Z`;
  const toIso = new Date(new Date(`${toDate}T03:00:00Z`).getTime() + 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('conciliacao_items')
    .select('id, conciliado_at, tipo, student_name, resumo')
    .eq('company_id', companyId)
    .eq('status', 'conciliado')
    .gte('conciliado_at', fromIso)
    .lt('conciliado_at', toIso)
    .order('conciliado_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    conciliadoAt: String(r.conciliado_at ?? ''),
    tipo: String(r.tipo ?? ''),
    studentName: String(r.student_name ?? ''),
    resumo: String(r.resumo ?? ''),
  }));
}

export async function fetchCarteiraExtratoLancamentos(
  companyId: string,
  from: string,
  to: string,
): Promise<CarteiraExtratoLancamento[]> {
  const { data, error } = await supabase
    .from('carteira_extrato_lancamentos')
    .select('*')
    .eq('company_id', companyId)
    .gte('data', from)
    .lte('data', to)
    .order('data', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapLancamento);
}

export async function createCarteiraExtratoLancamento(input: {
  companyId: string;
  data: string;
  descricao: string;
  tipo: ExtratoLancamentoTipo;
  valor: number;
  autorId?: string;
  autorNome?: string;
}): Promise<CarteiraExtratoLancamento> {
  const { data, error } = await supabase
    .from('carteira_extrato_lancamentos')
    .insert({
      company_id: input.companyId,
      data: input.data,
      descricao: input.descricao,
      tipo: input.tipo,
      valor: input.valor,
      autor_id: input.autorId ?? null,
      autor_nome: input.autorNome ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapLancamento(data);
}

export async function deleteCarteiraExtratoLancamento(id: string): Promise<void> {
  const { error } = await supabase.from('carteira_extrato_lancamentos').delete().eq('id', id);
  if (error) throw error;
}
