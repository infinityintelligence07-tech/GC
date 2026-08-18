import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useCompanyStore } from '@/store/useCompanyStore';

export default function CompanySwitcher() {
  const { companies, activeCompanyId, setActiveCompany } = useCompanyStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const active = companies.find((c) => c.id === activeCompanyId);
  const visible = companies.filter((c) => c.active || c.id === activeCompanyId);

  if (!active) return null;
  // Sem permissão para mais de uma empresa → não mostra o seletor
  if (visible.length <= 1) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-xl border-border/60 bg-background/60 hover:bg-muted/60 transition-all text-foreground gap-[20px] border-2 px-[10px] py-[8px]"
        title="Trocar empresa"
      >
        <span
          className="w-2.5 h-2.5 rounded-full border border-border/40"
          style={{ background: active.color_primary }}
        />
        <span className="font-semibold truncate max-w-[160px] text-sm">{active.name}</span>
        <ChevronDown size={13} strokeWidth={2} className="text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 min-w-[240px] bg-background border border-border/60 rounded-xl shadow-lg z-50 p-1 fade-in">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={11} /> Empresas
          </div>
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setOpen(false);
                if (c.id !== activeCompanyId) setActiveCompany(c.id);
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all ${
                c.id === activeCompanyId ? 'bg-muted/60' : 'hover:bg-muted/40'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-border/40 shrink-0"
                style={{ background: c.color_primary }}
              />
              <span className="flex-1 text-left font-medium text-foreground truncate">
                {c.name}
              </span>
              {!c.active && (
                <span className="text-[9px] uppercase font-bold text-muted-foreground/70">
                  inativa
                </span>
              )}
              {c.id === activeCompanyId && <Check size={13} className="text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
