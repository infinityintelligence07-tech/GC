// Integração IAM Control
//
// IAM Control → GC: pull de clientes + webhook iam-control-receive-aluno
// GC → IAM Control: push de cadastro e status (iam-control-push-status)

import { supabase } from '@/integrations/supabase/client';

export interface IamPullResumo {
  recebidos?: number;
  criados?: number;
  atualizados?: number;
  ambiguos?: number;
  erros?: number;
  ocorrencias?: unknown[];
}

export interface IamPullResult {
  ok?: boolean;
  continuar?: boolean;
  page_proxima?: number | null;
  page_atual?: number;
  total_paginas?: number;
  modo?: string;
  resumo?: IamPullResumo;
  error?: string;
}

const STATUS_FIELDS = ['status', 'status_mode', 'paid_installments', 'installments', 'status_cancelamento'];
const CADASTRO_FIELDS = ['name', 'email', 'whatsapp', 'cpf', 'address', 'numero', 'cidade', 'estado', 'cep'];

export function rowAffectsStatus(row: Record<string, unknown>): boolean {
  return STATUS_FIELDS.some((f) => f in row);
}

export function rowAffectsIamSync(row: Record<string, unknown>): boolean {
  return STATUS_FIELDS.some((f) => f in row) || CADASTRO_FIELDS.some((f) => f in row);
}

export function pushStudentStatus(studentIds: string | string[]): void {
  const ids = (Array.isArray(studentIds) ? studentIds : [studentIds]).filter(Boolean);
  if (ids.length === 0) return;
  void supabase.functions
    .invoke('iam-control-push-status', { body: { student_ids: ids } })
    .then(({ error }) => {
      if (error) console.warn('[IAM Control] push-status falhou:', error);
    })
    .catch((err) => console.warn('[IAM Control] push-status falhou:', err));
}

export async function pushAllStatuses(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('iam-control-push-status');
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

export interface IamDiagnosticoResult {
  ok?: boolean;
  api_atualizada?: boolean;
  aviso?: string | null;
  treinamentos_pendentes?: number;
  error?: string;
}

export async function diagnosticarIamControlApi(): Promise<IamDiagnosticoResult> {
  const { data, error } = await supabase.functions.invoke<IamDiagnosticoResult>('iam-control-diagnostico');
  if (error) throw error;
  return data ?? { ok: false, error: 'Resposta vazia' };
}

export async function pullClientes(body?: Record<string, unknown>): Promise<IamPullResult> {
  const { data, error } = await supabase.functions.invoke('iam-control-pull-clientes', {
    body: body ?? {},
  });
  if (error) throw error;
  return (data ?? {}) as IamPullResult;
}

function somarResumo(acc: IamPullResumo, parte?: IamPullResumo): IamPullResumo {
  const ocorrencias = [...(acc.ocorrencias ?? []), ...(parte?.ocorrencias ?? [])].slice(0, 40);
  return {
    recebidos: (acc.recebidos ?? 0) + (parte?.recebidos ?? 0),
    criados: (acc.criados ?? 0) + (parte?.criados ?? 0),
    atualizados: (acc.atualizados ?? 0) + (parte?.atualizados ?? 0),
    ambiguos: (acc.ambiguos ?? 0) + (parte?.ambiguos ?? 0),
    erros: (acc.erros ?? 0) + (parte?.erros ?? 0),
    ocorrencias,
  };
}

/** Continua o pull até acabar as páginas do IAM Control (ou atingir o limite de rodadas). */
export async function pullClientesCompleto(
  onProgress?: (info: { page: number; total: number; resumo: IamPullResumo }) => void,
): Promise<{ resumo: IamPullResumo; total_paginas: number }> {
  let resumo: IamPullResumo = {};
  let pageInicio: number | undefined;
  let totalPaginas = 1;

  for (let rodada = 0; rodada < 40; rodada++) {
    const data = await pullClientes({
      completo: true,
      max_paginas: 5,
      ...(pageInicio ? { page_inicio: pageInicio } : {}),
    });
    if (data.ok === false && data.error) throw new Error(data.error);
    resumo = somarResumo(resumo, data.resumo);
    totalPaginas = data.total_paginas ?? totalPaginas;
    onProgress?.({
      page: data.page_atual ?? pageInicio ?? 1,
      total: totalPaginas,
      resumo,
    });
    if (!data.continuar) break;
    pageInicio = data.page_proxima ?? ((data.page_atual ?? 0) + 1);
  }

  return { resumo, total_paginas: totalPaginas };
}
