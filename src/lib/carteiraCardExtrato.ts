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

export type ExtratoLancamentoTipo = 'credito' | 'debito';

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

function mapLancamento(r: Record<string, unknown>): CarteiraExtratoLancamento {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    data: String(r.data),
    descricao: String(r.descricao ?? ''),
    tipo: (r.tipo === 'credito' ? 'credito' : 'debito'),
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
    });
    if (error) throw error;
  }
}

export async function fetchCarteiraCardSnapshots(
  companyId: string,
  from: string,
  to: string,
): Promise<CarteiraCardSnapshot[]> {
  const { data, error } = await supabase
    .from('carteira_card_snapshots')
    .select('*')
    .eq('company_id', companyId)
    .gte('snapshot_date', from)
    .lte('snapshot_date', to)
    .order('snapshot_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapSnapshot);
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
