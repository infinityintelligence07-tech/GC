import { useState, useRef, useEffect } from 'react';
import { Tag, X, ChevronDown } from 'lucide-react';
import type { StudentTag } from '@/types';
import { getTagStyle } from '@/lib/tagColors';

interface TagMultiSelectProps {
  studentTags: StudentTag[];
  tagFilters: string[];
  setTagFilters: (tags: string[]) => void;
}

export default function TagMultiSelect({ studentTags, tagFilters, setTagFilters }: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id: string) => {
    setTagFilters(
      tagFilters.includes(id) ? tagFilters.filter((t) => t !== id) : [...tagFilters, id]
    );
  };

  if (studentTags.length === 0) return null;

  const selectedTags = studentTags.filter((t) => tagFilters.includes(t.id));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input-field text-xs py-1.5 px-2.5 flex items-center gap-1.5 min-w-[140px] max-w-[260px]"
      >
        <Tag size={11} className="text-primary shrink-0" />
        {selectedTags.length === 0 ? (
          <span className="text-muted-foreground">Todas as Tags</span>
        ) : (
          <span className="flex items-center gap-1 overflow-hidden">
            {selectedTags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium truncate max-w-[80px]"
                style={getTagStyle(tag.color)}
              >
                {tag.name}
              </span>
            ))}
            {selectedTags.length > 2 && (
              <span className="text-[10px] text-muted-foreground font-medium">+{selectedTags.length - 2}</span>
            )}
          </span>
        )}
        <ChevronDown size={12} className="ml-auto text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
          {tagFilters.length > 0 && (
            <button
              onClick={() => setTagFilters([])}
              className="w-full text-left px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted flex items-center gap-2 transition-colors"
            >
              <X size={10} />
              Limpar filtros
            </button>
          )}
          {studentTags.map((tag) => {
            const selected = tagFilters.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggle(tag.id)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-muted flex items-center gap-2 transition-colors ${selected ? 'font-semibold' : ''}`}
              >
                <span
                  className="inline-block w-3 h-3 rounded border-2 shrink-0 flex items-center justify-center"
                  style={{
                    borderColor: tag.color,
                    backgroundColor: selected ? tag.color : 'transparent',
                  }}
                >
                  {selected && <span className="text-white text-[8px]">✓</span>}
                </span>
                <span className="truncate">{tag.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
