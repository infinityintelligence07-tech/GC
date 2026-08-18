import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  showPrefix?: boolean;
  disabled?: boolean;
  title?: string;
  min?: number;
  autoFocus?: boolean;
  id?: string;
}

function formatBR(value: number): string {
  if (!value) return '';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parse de texto digitado em BR para número.
 * Aceita formas parciais durante a digitação:
 *   "1234"        → 1234
 *   "1.234"       → 1234
 *   "12.345"      → 12345
 *   "1.234,5"     → 1234.5
 *   "1.234,56"    → 1234.56
 *   "1234,5"      → 1234.5
 *   "1234,56"     → 1234.56
 *   ",5"          → 0.5
 *
 * Regra: se houver vírgula, ela é o separador decimal; tudo antes (com pontos
 * que são milhares) é a parte inteira. Se NÃO houver vírgula, pontos também
 * são milhares (não decimal). Isso evita o bug em que digitar "12345" virava
 * outro número por interpretar "." como decimal.
 */
function parseBR(raw: string): number {
  if (!raw) return 0;
  // Mantém apenas dígitos, ponto e vírgula
  let clean = raw.replace(/[^\d.,]/g, '');
  if (!clean) return 0;

  // Garante no máximo uma vírgula (a primeira é o separador decimal)
  const firstComma = clean.indexOf(',');
  if (firstComma !== -1) {
    const intPart = clean.slice(0, firstComma).replace(/\./g, '');
    const decPart = clean.slice(firstComma + 1).replace(/[.,]/g, '').slice(0, 2);
    clean = `${intPart}.${decPart}`;
  } else {
    // Sem vírgula → pontos são milhares, removemos todos
    clean = clean.replace(/\./g, '');
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * CurrencyInput — campo padrão para valores em Real (BRL).
 * - Prefixo "R$" à esquerda (showPrefix, default true)
 * - Formato BR: 1.234,56
 * - Campo permanece vazio quando o valor é 0 (não pré-digita zero)
 * - Mantém o texto cru durante a digitação (sem reformatar a cada tecla)
 * - Re-formata no blur
 */
export default function CurrencyInput({
  value,
  onChange,
  placeholder = '0,00',
  className = '',
  showPrefix = true,
  disabled,
  title,
  min,
  autoFocus,
  id,
}: Props) {
  const [text, setText] = useState<string>(value ? formatBR(value) : '');
  const focusedRef = useRef(false);

  // Sync externo: só atualiza o texto quando o componente NÃO está focado
  // (evita reformatar/normalizar durante a digitação do usuário). Isso era a
  // causa do bug em valores com 5+ dígitos.
  useEffect(() => {
    if (focusedRef.current) return;
    setText(value ? formatBR(value) : '');
  }, [value]);

  return (
    <div className="relative w-full">
      {showPrefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          R$
        </span>
      )}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        className={`input-field w-full ${showPrefix ? 'pl-9' : ''} ${className}`}
        value={text}
        onChange={(e) => {
          // Mantém apenas caracteres aceitos, preservando exatamente o que o
          // usuário digitou (sem reformatar). A formatação BR só ocorre no blur.
          const raw = e.target.value.replace(/[^\d.,]/g, '');
          setText(raw);
          const parsed = parseBR(raw);
          if (min !== undefined && parsed < min) {
            onChange(min);
          } else {
            onChange(parsed);
          }
        }}
        onFocus={(e) => {
          focusedRef.current = true;
          // Seleciona tudo ao focar para facilitar substituição
          e.currentTarget.select();
        }}
        onBlur={() => {
          focusedRef.current = false;
          // Re-formata para o padrão BR a partir do valor numérico atual
          setText(value ? formatBR(value) : '');
        }}
      />
    </div>
  );
}
