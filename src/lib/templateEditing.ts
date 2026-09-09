/**
 * Operações da barra de formatação dos modelos (aba Documentos). Funções puras
 * sobre o texto + seleção do textarea, para manter o editor simples e testável.
 * Os marcadores gerados são os interpretados em `templateRender.ts`.
 */
import { stripTemplateMarks, TEMPLATE_MARKS } from '@/lib/templateRender';

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

export type InlineMark = keyof typeof TEMPLATE_MARKS;
export type ListKind = 'bullet' | 'number';

const RE_PREFIXO_LISTA = /^(\s*)(?:(?:-|•|\u2022)\s+|\d{1,3}[.)]\s+)/;

/** Índices [inícioDaLinha, fimDaLinha) que cobrem a seleção. */
function lineBounds(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nl = text.indexOf('\n', Math.max(end, from));
  const to = nl === -1 ? text.length : nl;
  return { from, to };
}

/**
 * Envolve a seleção com o marcador (negrito/itálico/sublinhado). Se a seleção
 * já estiver envolvida (por dentro ou por fora), remove o marcador. Sem seleção,
 * insere o par de marcadores e deixa o cursor entre eles.
 */
export function toggleInlineMark(sel: TextSelection, mark: InlineMark): TextSelection {
  const m = TEMPLATE_MARKS[mark];
  const { text, start, end } = sel;
  const antes = text.slice(0, start);
  const meio = text.slice(start, end);
  const depois = text.slice(end);

  if (start === end) {
    return { text: `${antes}${m}${m}${depois}`, start: start + m.length, end: start + m.length };
  }

  // Seleção contém o marcador nas pontas: **texto** → texto
  if (meio.length >= m.length * 2 && meio.startsWith(m) && meio.endsWith(m)) {
    const limpo = meio.slice(m.length, meio.length - m.length);
    return { text: `${antes}${limpo}${depois}`, start, end: start + limpo.length };
  }
  // Marcador logo fora da seleção: **[texto]** → texto
  if (antes.endsWith(m) && depois.startsWith(m)) {
    return {
      text: `${antes.slice(0, antes.length - m.length)}${meio}${depois.slice(m.length)}`,
      start: start - m.length,
      end: end - m.length,
    };
  }

  // Preserva espaços das pontas fora do marcador (** texto** não renderiza).
  const lead = meio.match(/^\s*/)?.[0] ?? '';
  const trail = meio.match(/\s*$/)?.[0] ?? '';
  const nucleo = meio.slice(lead.length, meio.length - trail.length);
  if (!nucleo) return sel;
  const novo = `${lead}${m}${nucleo}${m}${trail}`;
  return { text: `${antes}${novo}${depois}`, start, end: start + novo.length };
}

/**
 * Transforma as linhas cobertas pela seleção em lista (marcadores ou
 * numerada). Se todas já forem do tipo pedido, remove o prefixo.
 */
export function toggleList(sel: TextSelection, kind: ListKind): TextSelection {
  const { text, start, end } = sel;
  const { from, to } = lineBounds(text, start, end);
  const linhas = text.slice(from, to).split('\n');
  const isKind = (l: string) =>
    kind === 'bullet' ? /^\s*(?:-|•|\u2022)\s+/.test(l) : /^\s*\d{1,3}[.)]\s+/.test(l);
  const naoVazias = linhas.filter((l) => l.trim().length > 0);
  const todasDoTipo = naoVazias.length > 0 && naoVazias.every(isKind);

  let n = 0;
  const novas = linhas.map((l) => {
    if (!l.trim()) return l;
    const semPrefixo = l.replace(RE_PREFIXO_LISTA, '$1');
    if (todasDoTipo) return semPrefixo;
    n += 1;
    const indent = semPrefixo.match(/^\s*/)?.[0] ?? '';
    const corpo = semPrefixo.slice(indent.length);
    return kind === 'bullet' ? `${indent}- ${corpo}` : `${indent}${n}. ${corpo}`;
  });
  const bloco = novas.join('\n');
  return { text: `${text.slice(0, from)}${bloco}${text.slice(to)}`, start: from, end: from + bloco.length };
}

/**
 * Parágrafo: remove prefixos de lista das linhas selecionadas. Sem seleção e
 * em linha comum, insere uma quebra de parágrafo (linha em branco) no cursor.
 */
export function toParagraph(sel: TextSelection): TextSelection {
  const { text, start, end } = sel;
  const { from, to } = lineBounds(text, start, end);
  const linhas = text.slice(from, to).split('\n');
  const temLista = linhas.some((l) => RE_PREFIXO_LISTA.test(l));
  if (temLista) {
    const bloco = linhas.map((l) => l.replace(RE_PREFIXO_LISTA, '$1')).join('\n');
    return { text: `${text.slice(0, from)}${bloco}${text.slice(to)}`, start: from, end: from + bloco.length };
  }
  if (start === end) {
    const quebra = '\n\n';
    return { text: `${text.slice(0, start)}${quebra}${text.slice(start)}`, start: start + quebra.length, end: start + quebra.length };
  }
  return sel;
}

/**
 * Limpa a formatação (marcadores inline e prefixos de lista) da seleção. Sem
 * seleção, limpa a linha atual.
 */
export function clearFormatting(sel: TextSelection): TextSelection {
  const { text, start, end } = sel;
  const { from, to } = start === end ? lineBounds(text, start, end) : { from: start, to: end };
  const limpo = stripTemplateMarks(text.slice(from, to));
  return { text: `${text.slice(0, from)}${limpo}${text.slice(to)}`, start: from, end: from + limpo.length };
}
