export interface IamUpsertResumo {
  recebidos: number;
  criados: number;
  atualizados: number;
  ambiguos: number;
  ignorados: number;
  erros: number;
  ocorrencias: string[];
}

export function aplicarResumoUpsertIam(data: unknown, resumo: IamUpsertResumo): void {
  if (!data || typeof data !== 'object') {
    resumo.ignorados++;
    return;
  }

  const row = data as Record<string, unknown>;
  if (row.acao === 'multiplo') {
    resumo.criados += Number(row.criados) || 0;
    resumo.atualizados += Number(row.atualizados) || 0;
    resumo.ambiguos += Number(row.ambiguo ?? row.ambiguos) || 0;
    resumo.ignorados += Number(row.ignorados) || 0;
    return;
  }

  switch (row.acao) {
    case 'criado':
      resumo.criados++;
      break;
    case 'atualizado':
      resumo.atualizados++;
      break;
    case 'ambiguo':
      resumo.ambiguos++;
      if (resumo.ocorrencias.length < 25) {
        resumo.ocorrencias.push(
          `ambiguo aluno ${row.iam_control_aluno_id ?? '?'} (${row.produto ?? 'sem produto'}): ${row.motivo ?? ''}`,
        );
      }
      break;
    default:
      resumo.ignorados++;
  }
}
