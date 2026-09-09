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

/**
 * Converte o texto renderizado em Markdown para a ZapSign, preservando o
 * visual do modelo:
 *  - primeira linha → título (#);
 *  - cada linha vira um parágrafo (Markdown juntaria linhas vizinhas);
 *  - "RÓTULO EM CAIXA ALTA: valor" → rótulo em negrito;
 *  - linha só de underscores (linha de assinatura) recebe um espaço
 *    inseparável na frente para não virar régua horizontal (---);
 *  - "|" vira "/" (a ZapSign não renderiza tabela e o pipe quebra a linha).
 * A ZapSign não honra escape com barra invertida, então nada é escapado.
 */
export function templateTextToZapSignMarkdown(text: string): string {
  const linhas = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let tituloFeito = false;
  for (const bruta of linhas) {
    const linha = bruta.replace(/\|/g, '/').trimEnd();
    if (!linha.trim()) continue;
    if (!tituloFeito) {
      out.push(`# ${linha.trim()}`);
      tituloFeito = true;
      continue;
    }
    if (RE_LINHA_ASSINATURA.test(linha)) {
      out.push(`\u00A0${linha.trim()}`);
      continue;
    }
    const rot = linha.match(RE_ROTULO);
    if (rot && rot[1] === rot[1].toUpperCase() && /[A-Z]/.test(rot[1])) {
      const valor = rot[2].trim();
      out.push(valor ? `**${rot[1].trim()}:** ${valor}` : `**${rot[1].trim()}:**`);
      continue;
    }
    out.push(linha);
  }
  return out.join('\n\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML de impressão (PDF pelo navegador) de um modelo renderizado. */
export function buildTemplatePrintHtml(text: string, logoSrc?: string): string {
  const linhas = text.replace(/\r\n/g, '\n').split('\n');
  const idxTitulo = linhas.findIndex((l) => l.trim().length > 0);
  const titulo = idxTitulo >= 0 ? linhas[idxTitulo].trim() : 'Documento';
  const corpo = linhas
    .slice(idxTitulo + 1)
    .map((l) => {
      const t = l.trimEnd();
      if (!t.trim()) return '<p class="blank">&nbsp;</p>';
      if (RE_LINHA_ASSINATURA.test(t)) return '<p class="sig-line"></p>';
      return `<p class="line">${escapeHtml(t)}</p>`;
    })
    .join('\n');

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
    p.line { margin: 0; text-align: justify; white-space: pre-wrap; }
    p.blank { margin: 0; line-height: 1; }
    p.sig-line { border-top: 1px solid #111; width: 60%; margin: 28px 0 4px; }
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
