/**
 * Renderização dos modelos da aba Documentos (texto com placeholders {{CAMPO}})
 * para preview/PDF e para o Markdown aceito pela ZapSign. Módulo puro (sem
 * store) para poder ser testado isolado.
 */

/** Normaliza a chave de um placeholder: sem acento, maiúscula, espaços únicos. */
export function normalizeTemplateKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Substitui os {{CAMPO}} do modelo. A chave é comparada normalizada, então
 * {{TOTAL APÓS RENEGOCIAÇÃO}} e {{total_apos_renegociacao}} são o mesmo campo.
 * Placeholder sem valor conhecido vira "—" (não fica {{...}} no documento).
 */
export function renderTemplate(content: string, vars: TemplateVars): string {
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    if (v === null || v === undefined) continue;
    lookup.set(normalizeTemplateKey(k), String(v));
  }
  return content.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, raw: string) => {
    const val = lookup.get(normalizeTemplateKey(raw));
    return val === undefined || val === '' ? '—' : val;
  });
}

/** Placeholders do modelo que não têm valor nas variáveis informadas. */
export function missingTemplateVars(content: string, vars: TemplateVars): string[] {
  const known = new Set(Object.keys(vars).map(normalizeTemplateKey));
  const faltando = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const k = m[1].trim();
    if (!known.has(normalizeTemplateKey(k))) faltando.add(k);
  }
  return [...faltando];
}

/** Primeira linha não vazia do texto (título do documento). */
export function templateTitle(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? 'Documento';
}

const RE_LINHA_ASSINATURA = /^[\s_\-=]{3,}$/;
const RE_ROTULO = /^([^:]{2,60}):(\s.*|)$/;

// ─── Marcação inline dos modelos ──────────────────────────────────────────────
// O conteúdo continua sendo texto puro (localStorage, TXT, DOCX achatado). A
// formatação aplicada pela barra da aba Documentos usa marcadores leves:
//   **negrito**   *itálico*   ++sublinhado++
//   "- item" / "• item"  → lista com marcadores
//   "1. item" / "1) item" → lista numerada
// O PDF (HTML) e a ZapSign (Markdown) interpretam esses marcadores; o texto
// exportado/importado em TXT os mantém como estão.

/** Marcadores aceitos pela barra de formatação. */
export const TEMPLATE_MARKS = {
  bold: '**',
  italic: '*',
  underline: '++',
} as const;

const RE_BOLD = /\*\*(?!\s)([^\n]*?[^\s*])\*\*/g;
const RE_ITALIC = /(^|[^*\\])\*(?![\s*])([^*\n]*?[^\s*])\*(?!\*)/g;
const RE_UNDERLINE = /\+\+(?!\s)([^\n]*?[^\s+])\+\+/g;
const RE_LISTA_MARCADOR = /^(\s*)(?:-|•|\u2022)\s+(.*)$/;
const RE_LISTA_NUMERADA = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;

/** Remove todos os marcadores inline e prefixos de lista de um texto. */
export function stripTemplateMarks(text: string): string {
  return text
    .split('\n')
    .map((linha) => {
      const m = linha.match(RE_LISTA_MARCADOR);
      if (m) return `${m[1]}${m[2]}`;
      const n = linha.match(RE_LISTA_NUMERADA);
      if (n) return `${n[1]}${n[3]}`;
      return linha;
    })
    .join('\n')
    .replace(RE_BOLD, '$1')
    .replace(RE_UNDERLINE, '$1')
    .replace(RE_ITALIC, '$1$2');
}

/** Linha do modelo contém algum marcador inline? */
export function hasTemplateMarks(text: string): boolean {
  RE_BOLD.lastIndex = 0;
  RE_UNDERLINE.lastIndex = 0;
  RE_ITALIC.lastIndex = 0;
  return (
    RE_BOLD.test(text) ||
    RE_UNDERLINE.test(text) ||
    RE_ITALIC.test(text) ||
    text.split('\n').some((l) => RE_LISTA_MARCADOR.test(l) || RE_LISTA_NUMERADA.test(l))
  );
}

/** Marcadores inline → tags HTML (o texto já deve estar escapado). */
function inlineMarksToHtml(escaped: string): string {
  return escaped
    .replace(RE_BOLD, '<strong>$1</strong>')
    .replace(RE_UNDERLINE, '<u>$1</u>')
    .replace(RE_ITALIC, '$1<em>$2</em>');
}

/** Marcadores inline → Markdown da ZapSign (sublinhado vira <u>, aceito no Markdown). */
function inlineMarksToMarkdown(linha: string): string {
  return linha.replace(RE_UNDERLINE, '<u>$1</u>');
}

type BlocoLista = { tipo: 'ul' | 'ol'; itens: Array<{ texto: string; numero?: number }> };

/**
 * Converte o texto renderizado em Markdown para a ZapSign, preservando o
 * visual do modelo:
 *  - primeira linha → título (#);
 *  - cada linha vira um parágrafo (Markdown juntaria linhas vizinhas);
 *  - "RÓTULO EM CAIXA ALTA: valor" → rótulo em negrito;
 *  - linha só de underscores (linha de assinatura) recebe um espaço
 *    inseparável na frente para não virar régua horizontal (---);
 *  - "|" vira "/" (a ZapSign não renderiza tabela e o pipe quebra a linha);
 *  - **negrito** / *itálico* passam direto; ++sublinhado++ vira <u>;
 *  - linhas "- item" / "1. item" consecutivas ficam juntas (lista).
 * A ZapSign não honra escape com barra invertida, então nada é escapado.
 */
export function templateTextToZapSignMarkdown(text: string): string {
  const linhas = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let tituloFeito = false;
  let lista: string[] = [];
  const flushLista = () => {
    if (lista.length) out.push(lista.join('\n'));
    lista = [];
  };
  for (const bruta of linhas) {
    const linha = inlineMarksToMarkdown(bruta.replace(/\|/g, '/').trimEnd());
    if (!linha.trim()) {
      flushLista();
      continue;
    }
    if (!tituloFeito) {
      out.push(`# ${stripTemplateMarks(linha).trim()}`);
      tituloFeito = true;
      continue;
    }
    const marc = linha.match(RE_LISTA_MARCADOR);
    if (marc) {
      lista.push(`- ${marc[2].trim()}`);
      continue;
    }
    const numd = linha.match(RE_LISTA_NUMERADA);
    if (numd) {
      lista.push(`${numd[2]}. ${numd[3].trim()}`);
      continue;
    }
    flushLista();
    if (RE_LINHA_ASSINATURA.test(linha)) {
      out.push(`\u00A0${linha.trim()}`);
      continue;
    }
    const rot = linha.match(RE_ROTULO);
    if (rot && !linha.includes('**') && rot[1] === rot[1].toUpperCase() && /[A-Z]/.test(rot[1])) {
      const valor = rot[2].trim();
      out.push(valor ? `**${rot[1].trim()}:** ${valor}` : `**${rot[1].trim()}:**`);
      continue;
    }
    out.push(linha);
  }
  flushLista();
  return out.join('\n\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlocoLista(bloco: BlocoLista): string {
  const itens = bloco.itens
    .map((it) => {
      const valor = bloco.tipo === 'ol' && it.numero != null ? ` value="${it.numero}"` : '';
      return `<li${valor}>${inlineMarksToHtml(escapeHtml(it.texto))}</li>`;
    })
    .join('');
  return `<${bloco.tipo} class="lista">${itens}</${bloco.tipo}>`;
}

/**
 * HTML do corpo de um modelo renderizado (sem o título, que é a primeira linha
 * não vazia). Usado no PDF e nos previews em tela. Todo texto do usuário é
 * escapado; só entram as tags geradas pelos marcadores.
 */
export function templateBodyToHtml(text: string): string {
  const linhas = text.replace(/\r\n/g, '\n').split('\n');
  const idxTitulo = linhas.findIndex((l) => l.trim().length > 0);
  const out: string[] = [];
  let lista: BlocoLista | null = null;
  const flushLista = () => {
    if (lista) out.push(renderBlocoLista(lista));
    lista = null;
  };
  for (const l of linhas.slice(idxTitulo + 1)) {
    const t = l.trimEnd();
    if (!t.trim()) {
      flushLista();
      out.push('<p class="blank">&nbsp;</p>');
      continue;
    }
    const marc = t.match(RE_LISTA_MARCADOR);
    if (marc) {
      if (!lista || lista.tipo !== 'ul') {
        flushLista();
        lista = { tipo: 'ul', itens: [] };
      }
      lista.itens.push({ texto: marc[2] });
      continue;
    }
    const numd = t.match(RE_LISTA_NUMERADA);
    if (numd) {
      if (!lista || lista.tipo !== 'ol') {
        flushLista();
        lista = { tipo: 'ol', itens: [] };
      }
      lista.itens.push({ texto: numd[3], numero: Number(numd[2]) });
      continue;
    }
    flushLista();
    if (RE_LINHA_ASSINATURA.test(t)) {
      out.push('<p class="sig-line"></p>');
      continue;
    }
    out.push(`<p class="line">${inlineMarksToHtml(escapeHtml(t))}</p>`);
  }
  flushLista();
  return out.join('\n');
}

/** CSS compartilhado entre o PDF e o preview em tela dos modelos. */
export const TEMPLATE_BODY_CSS = `
    p.line { margin: 0; text-align: justify; white-space: pre-wrap; }
    p.blank { margin: 0; line-height: 1; }
    p.sig-line { border-top: 1px solid #111; width: 60%; margin: 28px 0 4px; }
    ul.lista, ol.lista { margin: 0 0 0 1.4em; padding: 0; text-align: justify; }
    ul.lista li, ol.lista li { margin: 0; white-space: pre-wrap; }
    ul.lista { list-style: disc; }
    ol.lista { list-style: decimal; }
`;

/** HTML de impressão (PDF pelo navegador) de um modelo renderizado. */
export function buildTemplatePrintHtml(text: string, logoSrc?: string): string {
  const titulo = stripTemplateMarks(templateTitle(text));
  const corpo = templateBodyToHtml(text);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(titulo)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Times New Roman', Times, serif; background: #fff; color: #111; padding: 40px 24px; line-height: 1.55; font-size: 13px; }
    .container { max-width: 780px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 28px; }
    .logo { max-width: 110px; margin: 0 auto 12px; }
    .logo img { max-width: 100%; height: auto; }
    .title { font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }
${TEMPLATE_BODY_CSS}
    @media print { body { padding: 0; } .container { max-width: 100%; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${logoSrc ? `<div class="logo"><img src="${logoSrc}" alt="IAM" /></div>` : ''}
      <div class="title">${escapeHtml(titulo)}</div>
    </div>
    ${corpo}
  </div>
</body>
</html>`;
}
