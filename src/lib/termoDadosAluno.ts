/** Dados do aluno que aparecem no cabeçalho dos termos e identificam o signatário na ZapSign. */
export interface TermoDadosAluno {
  name: string;
  cpf: string;
  email: string;
  whatsapp: string;
}

export const TERMO_DADOS_LABELS: Record<keyof TermoDadosAluno, string> = {
  name: 'Nome completo',
  cpf: 'CPF',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
};

/** Campos vazios/inválidos — usados para abrir o preenchimento manual automaticamente. */
export function termoDadosFaltantes(d: Partial<TermoDadosAluno> | null | undefined): Array<keyof TermoDadosAluno> {
  const faltam: Array<keyof TermoDadosAluno> = [];
  if (!d?.name?.trim()) faltam.push('name');
  if ((d?.cpf ?? '').replace(/\D/g, '').length < 11) faltam.push('cpf');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((d?.email ?? '').trim())) faltam.push('email');
  if ((d?.whatsapp ?? '').replace(/\D/g, '').length < 10) faltam.push('whatsapp');
  return faltam;
}

export function formatCpfCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function formatWhatsappBR(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
