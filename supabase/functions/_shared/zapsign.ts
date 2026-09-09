// Cliente mínimo da API ZapSign (https://docs.zapsign.com.br) compartilhado pelas
// edge functions `zapsign-termo` (criar/consultar) e `zapsign-webhook` (eventos).
//
// Secrets:
//   ZAPSIGN_API_TOKEN     token estático da API (Configurações > Integrações > ZapSign API)
//   ZAPSIGN_API_URL       opcional — default produção; sandbox: https://sandbox.api.zapsign.com.br/api/v1
//   ZAPSIGN_WEBHOOK_TOKEN valor do header `x-webhook-token` configurado no webhook da ZapSign

export const ZAPSIGN_API_URL_DEFAULT = 'https://api.zapsign.com.br/api/v1';
const TIMEOUT_MS = 60_000;

export type ZapSignStatus = 'pending' | 'signed' | 'refused' | 'deleted' | 'expired';

export interface ZapSignSigner {
  token: string;
  sign_url?: string;
  status: string;
  name: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  signed_at?: string | null;
  times_viewed?: number;
  last_view_at?: string | null;
}

export interface ZapSignDoc {
  open_id: number;
  token: string;
  status: string;
  name: string;
  original_file?: string | null;
  signed_file?: string | null;
  created_at?: string;
  last_update_at?: string;
  signers: ZapSignSigner[];
  external_id?: string;
  deleted?: boolean;
}

export function zapsignConfig(): { apiUrl: string; token: string } | null {
  const token = (Deno.env.get('ZAPSIGN_API_TOKEN') ?? '').trim();
  if (!token) return null;
  const apiUrl = (Deno.env.get('ZAPSIGN_API_URL') ?? ZAPSIGN_API_URL_DEFAULT).replace(/\/+$/, '');
  return { apiUrl, token };
}

export class ZapSignError extends Error {
  status: number;
  detalhe?: string;
  constructor(message: string, status: number, detalhe?: string) {
    super(message);
    this.status = status;
    this.detalhe = detalhe;
  }
}

async function zapsignFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = zapsignConfig();
  if (!cfg) throw new ZapSignError('ZAPSIGN_API_TOKEN não configurado no servidor.', 500);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.apiUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detalhe = typeof data === 'string' ? data : JSON.stringify(data);
      const msg =
        res.status === 401 || res.status === 403
          ? 'ZapSign recusou o token da API (401/403). Confira ZAPSIGN_API_TOKEN.'
          : `ZapSign respondeu ${res.status}.`;
      throw new ZapSignError(msg, res.status, detalhe?.slice(0, 800));
    }
    return data as T;
  } catch (err) {
    if (err instanceof ZapSignError) throw err;
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Tempo esgotado ao falar com a ZapSign.' : String(err);
    throw new ZapSignError(msg, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export interface CreateDocSignerInput {
  name: string;
  email?: string;
  /** Só dígitos, sem DDI (ex.: 11998989222). */
  phone_number?: string;
  phone_country?: string;
  external_id?: string;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  custom_message?: string;
}

export interface CreateDocInput {
  name: string;
  markdown_text?: string;
  base64_pdf?: string;
  signers: CreateDocSignerInput[];
  external_id?: string;
  folder_path?: string;
  brand_name?: string;
  metadata?: Array<{ key: string; value: string }>;
  date_limit_to_sign?: string;
}

export function createDoc(input: CreateDocInput): Promise<ZapSignDoc> {
  const signers = input.signers.map((s) => ({
    name: s.name,
    email: s.email ?? '',
    phone_country: s.phone_number ? (s.phone_country ?? '55') : '',
    phone_number: s.phone_number ?? '',
    auth_mode: 'assinaturaTela',
    lock_name: true,
    // Não bloqueia e-mail/telefone: aluno pode corrigir um contato desatualizado na hora.
    send_automatic_email: !!s.send_automatic_email && !!s.email,
    send_automatic_whatsapp: !!s.send_automatic_whatsapp && !!s.phone_number,
    external_id: s.external_id ?? '',
    custom_message: s.custom_message ?? '',
  }));
  return zapsignFetch<ZapSignDoc>('/docs/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name.slice(0, 255),
      lang: 'pt-br',
      ...(input.markdown_text ? { markdown_text: input.markdown_text } : {}),
      ...(input.base64_pdf ? { base64_pdf: input.base64_pdf } : {}),
      signers,
      external_id: input.external_id ?? '',
      folder_path: input.folder_path ?? '/GC/',
      brand_name: input.brand_name ?? 'Instituto Academy Mind',
      disable_signer_emails: false,
      allow_refuse_signature: true,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.date_limit_to_sign ? { date_limit_to_sign: input.date_limit_to_sign } : {}),
    }),
  });
}

export function detailDoc(token: string): Promise<ZapSignDoc> {
  return zapsignFetch<ZapSignDoc>(`/docs/${encodeURIComponent(token)}/`, { method: 'GET' });
}

/**
 * Exclui o documento na ZapSign (soft delete: sai da interface e o link de
 * assinatura deixa de funcionar; segue acessível pela API). Sem volta.
 */
export function deleteDoc(token: string): Promise<ZapSignDoc> {
  return zapsignFetch<ZapSignDoc>(`/docs/${encodeURIComponent(token)}/`, { method: 'DELETE' });
}

/** Normaliza o status ZapSign para o nosso conjunto. */
export function normalizeStatus(raw: string | null | undefined, signers?: ZapSignSigner[]): ZapSignStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'signed' || s === 'completed') return 'signed';
  if (s === 'refused' || s === 'rejected') return 'refused';
  if (s === 'deleted') return 'deleted';
  if (s === 'expired') return 'expired';
  if (signers && signers.length > 0 && signers.every((x) => String(x.status).toLowerCase() === 'signed')) return 'signed';
  return 'pending';
}

/** Comparação em tempo constante (token do webhook). */
export function tokenEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Só dígitos; remove DDI 55 se vier junto (ZapSign recebe DDI separado). */
export function phoneToZapSign(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.startsWith('55')) return d.slice(2);
  return d;
}
