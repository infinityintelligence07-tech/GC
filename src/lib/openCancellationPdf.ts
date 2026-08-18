import { supabase } from '@/integrations/supabase/client';

const PDF_MIME_TYPE = 'application/pdf';
const SIGNED_URL_TTL = 60 * 10; // 10 min

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

async function getSignedUrl(path: string, download?: string | boolean): Promise<string> {
  const { data, error } = await supabase.storage
    .from('cancellation-docs')
    .createSignedUrl(path, SIGNED_URL_TTL, download ? { download: typeof download === 'string' ? download : true } : undefined);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Não foi possível gerar o link do arquivo.');
  }
  return data.signedUrl;
}

async function fetchPdfBlob(pathOrUrl: string): Promise<Blob> {
  if (isHttpUrl(pathOrUrl)) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) throw new Error('Não foi possível carregar o PDF.');
    return await response.blob();
  }
  const { data, error } = await supabase.storage.from('cancellation-docs').download(pathOrUrl);
  if (error || !data) throw new Error(error?.message ?? 'Não foi possível carregar o PDF.');
  return data;
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
  if (!pathOrUrl) throw new Error('Arquivo não encontrado.');

  // 1) Se já é HTTPS, abre direto
  if (isHttpUrl(pathOrUrl)) {
    triggerLink(pathOrUrl, { newTab: true });
    return;
  }

  // 2) Prefere signed URL (HTTPS) — não é bloqueado por adblock
  try {
    const signed = await getSignedUrl(pathOrUrl);
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
  if (!pathOrUrl) throw new Error('Arquivo não encontrado.');

  if (isHttpUrl(pathOrUrl)) {
    // URLs HTTPS externas — tenta download direto; se falhar, fetch + blob
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

  // Prefere signed URL com download=filename
  try {
    const signed = await getSignedUrl(pathOrUrl, fileName);
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
