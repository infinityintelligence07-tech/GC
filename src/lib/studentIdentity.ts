// Identidade / dedupe de alunos (ficha = contrato).
// Regra: mesmo CPF + mesmo treinamento (+ ciclo) = duplicata.
// Mesmo CPF em treinamentos diferentes = OK (contratos distintos).
// Sem CPF: telefone / e-mail / endereço ajudam a detectar ficha duplicada
// no mesmo treinamento.

import type { Student } from '@/types';
import { normalizeCpfDigits, normalizeCiclo, normalizeProductName } from '@/lib/acEsteira';

export function normalizePhoneDigits(phone?: string | null): string {
  return (phone ?? '').replace(/\D/g, '');
}

export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

export function normalizeAddressKey(input: {
  address?: string | null;
  numero?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}): string {
  const cep = (input.cep ?? '').replace(/\D/g, '');
  const parts = [
    (input.address ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    (input.numero ?? '').trim().toLowerCase(),
    (input.cidade ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    (input.estado ?? '').trim().toLowerCase(),
    cep,
  ];
  return parts.join('|');
}

/** Chave contratual: CPF + produto + ciclo (ciclo vazio = ''). */
export function contractIdentityKey(input: {
  cpf?: string | null;
  product?: string | null;
  ciclo?: string | null;
}): string | null {
  const cpf = normalizeCpfDigits(input.cpf);
  if (cpf.length < 11) return null;
  return `${cpf}|${normalizeProductName(input.product)}|${normalizeCiclo(input.ciclo)}`;
}

export type DuplicateMatchReason = 'cpf_produto' | 'contato_produto';

export interface DuplicateMatch {
  student: Student;
  reason: DuplicateMatchReason;
  detail: string;
}

/**
 * Procura ficha duplicada no mesmo treinamento.
 * 1) CPF+produto(+ciclo) — regra principal
 * 2) Sem CPF forte: telefone + e-mail, ou telefone + endereço, no mesmo produto
 */
export function findDuplicateStudent(
  students: Student[],
  candidate: {
    cpf?: string | null;
    product?: string | null;
    ciclo?: string | null;
    whatsapp?: string | null;
    email?: string | null;
    address?: string | null;
    numero?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
  },
  excludeId?: string,
): DuplicateMatch | null {
  const productKey = normalizeProductName(candidate.product);
  if (!productKey) return null;

  const cpfKey = contractIdentityKey(candidate);
  if (cpfKey) {
    const hit = students.find((s) => {
      if (excludeId && s.id === excludeId) return false;
      return contractIdentityKey(s) === cpfKey;
    });
    if (hit) {
      return {
        student: hit,
        reason: 'cpf_produto',
        detail: `CPF já cadastrado neste treinamento (${hit.product || 'sem nome'})`,
      };
    }
  }

  const phone = normalizePhoneDigits(candidate.whatsapp);
  const email = normalizeEmail(candidate.email);
  const addr = normalizeAddressKey(candidate);
  const phoneOk = phone.length >= 10;
  const emailOk = email.includes('@');
  const addrOk = addr.replace(/\|/g, '').length >= 8;

  if (!phoneOk && !emailOk) return null;

  const hit = students.find((s) => {
    if (excludeId && s.id === excludeId) return false;
    if (normalizeProductName(s.product) !== productKey) return false;
    // Se ambos têm CPF e são diferentes, não é a mesma pessoa neste contrato
    const cpfS = normalizeCpfDigits(s.cpf);
    const cpfC = normalizeCpfDigits(candidate.cpf);
    if (cpfS.length >= 11 && cpfC.length >= 11 && cpfS !== cpfC) return false;

    const phoneS = normalizePhoneDigits(s.whatsapp);
    const emailS = normalizeEmail(s.email);
    const addrS = normalizeAddressKey(s);

    const samePhone = phoneOk && phoneS.length >= 10 && phoneS === phone;
    const sameEmail = emailOk && emailS.includes('@') && emailS === email;
    const sameAddr = addrOk && addrS.replace(/\|/g, '').length >= 8 && addrS === addr;

    return (samePhone && sameEmail) || (samePhone && sameAddr) || (sameEmail && sameAddr);
  });

  if (!hit) return null;
  return {
    student: hit,
    reason: 'contato_produto',
    detail: `Já existe ficha neste treinamento com os mesmos dados de contato (${hit.name})`,
  };
}
