import { supabase } from '@/integrations/supabase/client';

const PDF_MIME_TYPE = 'application/pdf';
const SIGNED_URL_TTL = 60 * 10; // 10 min
const BUCKET = 'cancellation-docs';

/** Extensões que o browser consegue exibir em nova aba. */
const VIEWABLE_RE = /\.(pdf|png|jpe?g|gif|webp|bmp|svg|heic|avif)(\?|$)/i;

export function isViewableInBrowser(pathOrUrl: string) {
  return VIEWABLE_RE.test(pathOrUrl);
}

function isPdfPath(pathOrUrl: string) {
  return /\.pdf(\?|$)/i.test(pathOrUrl);
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

/**
 * Extrai o path interno do bucket a partir de URLs do Storage Supabase
 * ou normaliza paths gravados com prefixo do bucket / barra inicial.
 */
export function normalizeCancellationStoragePath(pathOrUrl: string): string {
  const raw = (pathOrUrl || '').trim();
  if (!raw) return '';

  // URL completa do Storage (public, sign ou authenticated)
  const storageMatch = raw.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/cancellation-docs\/([^?]+)/i,
  );
  if (storageMatch?.[1]) {
    try {
      return decodeURIComponent(storageMatch[1]);
    } catch {
      return storageMatch[1];
    }
  }

  let path = raw;
  // Remove querystring de signed URLs grudadas no path
  const q = path.indexOf('?');
  if (q >= 0 && !isHttpUrl(path)) path = path.slice(0, q);

  path = path.replace(/^\/+/, '');
  if (path.toLowerCase().startsWith(`${BUCKET}/`)) {
    path = path.slice(BUCKET.length + 1);
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function candidatePaths(pathOrUrl: string): string[] {
  const normalized = normalizeCancellationStoragePath(pathOrUrl);
  const out: string[] = [];
  const push = (p: string) => {
    const t = p.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(normalized);
  push(pathOrUrl.trim());
  // Sem company prefix (uploads legados)
  if (normalized.includes('/')) {
    const parts = normalized.split('/');
    if (parts.length > 2) push(parts.slice(1).join('/'));
  }
  return out;
}

async function getSignedUrl(path: string, download?: string | boolean): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL, download ? { download: typeof download === 'string' ? download : true } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Não foi possível gerar o link do arquivo.');
  }
  return data.signedUrl;
}

async function getSignedUrlFromCandidates(pathOrUrl: string, download?: string | boolean): Promise<string> {
  const paths = candidatePaths(pathOrUrl);
  let lastError = 'Arquivo não encontrado no storage.';
  for (const path of paths) {
    try {
      return await getSignedUrl(path, download);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function fetchPdfBlob(pathOrUrl: string): Promise<Blob> {
  if (isHttpUrl(pathOrUrl) && !/\/storage\/v1\/object\//i.test(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) throw new Error('Não foi possível carregar o PDF.');
    return await response.blob();
  }

  const paths = candidatePaths(pathOrUrl);
  let lastError = 'Não foi possível carregar o PDF.';
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (!error && data) return data;
    lastError = error?.message ?? lastError;
  }
  throw new Error(lastError);
}

function triggerLink(url: string, opts: { download?: string; newTab?: boolean }) {
  const link = document.createElement('a');
  link.href = url;
  if (opts.newTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  if (opts.download) {
    link.download = opts.download;
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Abre o PDF em uma nova aba.
 * Usa signed URL do Supabase (HTTPS) para evitar ERR_BLOCKED_BY_CLIENT
 * que ocorre quando extensões (adblock/privacy) bloqueiam blob: URLs.
 * Faz fallback para blob local se a URL assinada falhar.
 */
export async function openCancellationPdf(pathOrUrl: string, fileName?: string) {
  if (!pathOrUrl?.trim()) throw new Error('Arquivo não encontrado.');

  const isSupabaseStorageUrl = isHttpUrl(pathOrUrl) && /\/storage\/v1\/object\//i.test(pathOrUrl);

  // 1) HTTPS externo (não-Storage) — abre direto
  if (isHttpUrl(pathOrUrl) && !isSupabaseStorageUrl) {
    triggerLink(pathOrUrl, { newTab: true });
    return;
  }

  // 2) Prefere signed URL (HTTPS) — inclui URLs antigas do Storage que possam ter expirado
  try {
    const signed = await getSignedUrlFromCandidates(pathOrUrl);
    triggerLink(signed, { newTab: true });
    return;
  } catch {
    // segue para fallback
  }

  // 3) Fallback: baixa blob e abre localmente
  const blob = await fetchPdfBlob(pathOrUrl);
  const viewBlob =
    isPdfPath(pathOrUrl) && blob.type !== PDF_MIME_TYPE ? new Blob([blob], { type: PDF_MIME_TYPE }) : blob;
  const objectUrl = URL.createObjectURL(viewBlob);
  try {
    triggerLink(objectUrl, { newTab: true });
  } catch {
    triggerLink(objectUrl, { download: fileName || 'arquivo' });
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/**
 * Faz download do PDF.
 * Usa signed URL com parâmetro `download` para forçar o browser a baixar,
 * sem depender de fetch (que pode ser bloqueado por CORS/extensões).
 */
export async function downloadCancellationPdf(pathOrUrl: string, fileName = 'contrato.pdf') {
  if (!pathOrUrl?.trim()) throw new Error('Arquivo não encontrado.');

  const isSupabaseStorageUrl = isHttpUrl(pathOrUrl) && /\/storage\/v1\/object\//i.test(pathOrUrl);

  if (isHttpUrl(pathOrUrl) && !isSupabaseStorageUrl) {
    try {
      const response = await fetch(pathOrUrl);
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerLink(objectUrl, { download: fileName });
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      triggerLink(pathOrUrl, { download: fileName, newTab: true });
    }
    return;
  }

  try {
    const signed = await getSignedUrlFromCandidates(pathOrUrl, fileName);
    triggerLink(signed, { download: fileName });
    return;
  } catch {
    // fallback: blob
  }

  const blob = await fetchPdfBlob(pathOrUrl);
  const viewBlob =
    isPdfPath(pathOrUrl) && blob.type !== PDF_MIME_TYPE ? new Blob([blob], { type: PDF_MIME_TYPE }) : blob;
  const objectUrl = URL.createObjectURL(viewBlob);
  triggerLink(objectUrl, { download: fileName });
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
