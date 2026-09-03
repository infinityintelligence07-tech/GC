import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  DOCUMENT_RELATIONS,
  DOCUMENT_RELATION_LABELS,
  type DocumentRelation,
} from '@/lib/managedDocuments';

interface DocumentRelationMultiSelectProps {
  selected: DocumentRelation[];
  onChange: (relations: DocumentRelation[]) => void;
  disabled?: boolean;
}

export default function DocumentRelationMultiSelect({
  selected,
  onChange,
  disabled = false,
}: DocumentRelationMultiSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DOCUMENT_RELATIONS.filter((id) => {
      if (selected.includes(id)) return false;
      if (!q) return true;
      return DOCUMENT_RELATION_LABELS[id].toLowerCase().includes(q);
    });
  }, [selected, query]);

  const add = (id: DocumentRelation) => {
    if (selected.includes(id)) return;
    onChange([...selected, id]);
    setQuery('');
    setOpen(false);
  };

  const remove = (id: DocumentRelation) => {
    onChange(selected.filter((x) => x !== id));
  };

  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Relacionado a</h4>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Selecione a quais situações ou processos este documento está relacionado
        </p>
      </div>

      <div ref={ref} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder="Digite para buscar..."
          className="input-field text-sm w-full"
        />

        {open && !disabled && filtered.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
            {filtered.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => add(id)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                {DOCUMENT_RELATION_LABELS[id]}
              </button>
            ))}
          </div>
        )}

        {open && !disabled && query.trim() && filtered.length === 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-sm text-muted-foreground">
            Nenhuma opção encontrada.
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-blue-50 text-blue-700 border border-blue-100"
            >
              {DOCUMENT_RELATION_LABELS[id]}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(id)}
                  className="text-blue-500 hover:text-blue-800 transition-colors"
                  aria-label={`Remover ${DOCUMENT_RELATION_LABELS[id]}`}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
