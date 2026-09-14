// ─── SheetJS sob demanda (CDN) ───────────────────────────────────────────────
// Mesmo CDN/versão dos importadores de alunos e conferência: a biblioteca só é
// baixada quando alguém abre um importador, e uma única vez por sessão.

export interface XLSXWorkbook {
  Sheets: Record<string, unknown>;
  SheetNames: string[];
}

export interface XLSXModule {
  read: (data: Uint8Array, opts: { type: 'array'; cellDates?: boolean }) => XLSXWorkbook;
  utils: {
    /** `header: 1` devolve matriz (array de linhas); sem header devolve objetos por coluna. */
    sheet_to_json: <T = unknown>(
      ws: unknown,
      opts?: { defval?: unknown; raw?: boolean; header?: 1 | 'A' | string[] },
    ) => T[];
  };
  SSF: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null };
}

const XLSX_CDN_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoadPromise: Promise<XLSXModule> | null = null;

export function loadXLSX(): Promise<XLSXModule> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is undefined'));
  const existing = (window as unknown as { XLSX?: XLSXModule }).XLSX;
  if (existing) return Promise.resolve(existing);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise<XLSXModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_CDN_URL;
    script.async = true;
    script.onload = () => {
      const x = (window as unknown as { XLSX?: XLSXModule }).XLSX;
      x ? resolve(x) : reject(new Error('XLSX indefinido'));
    };
    script.onerror = () => {
      xlsxLoadPromise = null;
      reject(new Error('Falha ao carregar SheetJS'));
    };
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}
