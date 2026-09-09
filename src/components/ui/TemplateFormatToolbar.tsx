import { useEffect, useRef, type RefObject } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Pilcrow, RemoveFormatting } from 'lucide-react';
import {
  clearFormatting,
  toggleInlineMark,
  toggleList,
  toParagraph,
  type TextSelection,
} from '@/lib/templateEditing';

interface TemplateFormatToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

/**
 * Barra de formatação do editor de modelos (negrito, itálico, sublinhado,
 * listas, parágrafo e limpar formatação). Atua sobre a seleção do textarea e
 * grava marcadores leves no texto (ver `templateRender.ts`).
 */
export default function TemplateFormatToolbar({ textareaRef, value, onChange, disabled }: TemplateFormatToolbarProps) {
  // Seleção a restaurar depois que o React aplicar o novo valor no textarea.
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const sel = pendingSel.current;
    const ta = textareaRef.current;
    if (!sel || !ta) return;
    pendingSel.current = null;
    ta.focus();
    ta.setSelectionRange(sel.start, sel.end);
  }, [value, textareaRef]);

  const apply = (fn: (sel: TextSelection) => TextSelection) => {
    const ta = textareaRef.current;
    if (!ta || disabled) return;
    const atual: TextSelection = { text: value, start: ta.selectionStart, end: ta.selectionEnd };
    const novo = fn(atual);
    if (novo.text === atual.text) {
      ta.focus();
      ta.setSelectionRange(novo.start, novo.end);
      return;
    }
    pendingSel.current = { start: novo.start, end: novo.end };
    onChange(novo.text);
  };

  // Atalhos: Ctrl/Cmd+B, I, U.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        apply((s) => toggleInlineMark(s, 'bold'));
      } else if (k === 'i') {
        e.preventDefault();
        apply((s) => toggleInlineMark(s, 'italic'));
      } else if (k === 'u') {
        e.preventDefault();
        apply((s) => toggleInlineMark(s, 'underline'));
      }
    };
    ta.addEventListener('keydown', onKey);
    return () => ta.removeEventListener('keydown', onKey);
    // `apply` lê `value` da closure; recria o listener quando o texto muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled, textareaRef]);

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      role="toolbar"
      aria-label="Formatação do texto"
      onMouseDown={(e) => e.preventDefault()} // mantém a seleção do textarea
    >
      <button type="button" className={BTN} disabled={disabled} title="Negrito (Ctrl+B)" onClick={() => apply((s) => toggleInlineMark(s, 'bold'))}>
        <Bold size={13} />
      </button>
      <button type="button" className={BTN} disabled={disabled} title="Itálico (Ctrl+I)" onClick={() => apply((s) => toggleInlineMark(s, 'italic'))}>
        <Italic size={13} />
      </button>
      <button type="button" className={BTN} disabled={disabled} title="Sublinhado (Ctrl+U)" onClick={() => apply((s) => toggleInlineMark(s, 'underline'))}>
        <Underline size={13} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" className={BTN} disabled={disabled} title="Lista com marcadores" onClick={() => apply((s) => toggleList(s, 'bullet'))}>
        <List size={13} />
      </button>
      <button type="button" className={BTN} disabled={disabled} title="Lista numerada" onClick={() => apply((s) => toggleList(s, 'number'))}>
        <ListOrdered size={13} />
      </button>
      <button type="button" className={BTN} disabled={disabled} title="Parágrafo (remove lista / insere quebra de parágrafo)" onClick={() => apply(toParagraph)}>
        <Pilcrow size={13} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" className={BTN} disabled={disabled} title="Limpar formatação da seleção" onClick={() => apply(clearFormatting)}>
        <RemoveFormatting size={13} />
      </button>
    </div>
  );
}
