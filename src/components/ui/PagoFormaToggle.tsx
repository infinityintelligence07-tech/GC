import { PAGO_FORMA_FILTER_HINT, PAGO_FORMA_FILTER_LABEL, type PagoFormaFilter } from '@/lib/pagoFormaFilter';

const OPTIONS: PagoFormaFilter[] = ['boleto', 'geral'];

interface PagoFormaToggleProps {
  value: PagoFormaFilter;
  onChange: (v: PagoFormaFilter) => void;
  className?: string;
}

/** Seletor "Somente boleto | Geral" dos cards Pago. */
export function PagoFormaToggle({ value, onChange, className = '' }: PagoFormaToggleProps) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Pago:</span>
      <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label="Filtro de forma de pagamento do card Pago">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            title={PAGO_FORMA_FILTER_HINT[opt]}
            aria-pressed={value === opt}
            className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
              value === opt ? 'bg-emerald-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {PAGO_FORMA_FILTER_LABEL[opt]}
          </button>
        ))}
      </div>
    </div>
  );
}
