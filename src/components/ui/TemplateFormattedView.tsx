import { useMemo } from 'react';
import { TEMPLATE_BODY_CSS, stripTemplateMarks, templateBodyToHtml, templateTitle } from '@/lib/templateRender';

/** CSS do PDF com os seletores prefixados para valer só dentro do preview. */
const SCOPED_CSS = TEMPLATE_BODY_CSS.split('\n')
  .map((linha) => {
    const idx = linha.indexOf('{');
    if (idx === -1) return linha;
    const seletores = linha
      .slice(0, idx)
      .split(',')
      .map((s) => `.gc-tpl ${s.trim()}`)
      .join(', ');
    return `${seletores} ${linha.slice(idx)}`;
  })
  .join('\n');

interface TemplateFormattedViewProps {
  /** Texto do modelo (com marcadores). A primeira linha não vazia é o título. */
  text: string;
  /** Exibe o título (primeira linha) acima do corpo. */
  showTitle?: boolean;
  className?: string;
}

/**
 * Preview em tela de um modelo da aba Documentos, com a mesma renderização do
 * PDF (negrito, itálico, sublinhado, listas, linha de assinatura). O HTML vem
 * de `templateBodyToHtml`, que escapa todo o texto do usuário.
 */
export default function TemplateFormattedView({ text, showTitle = false, className = '' }: TemplateFormattedViewProps) {
  const html = useMemo(() => templateBodyToHtml(text), [text]);
  const titulo = useMemo(() => stripTemplateMarks(templateTitle(text)), [text]);
  return (
    <div className={`gc-tpl ${className}`}>
      <style>{SCOPED_CSS}</style>
      {showTitle && titulo && (
        <h3 className="text-center text-sm font-bold uppercase tracking-wide mb-4">{titulo}</h3>
      )}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
