import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Espaço no cabeçalho, ao lado do seletor de empresa, que cada página preenche
 * com seus próprios controles. O estado continua na página: só o lugar onde os
 * botões aparecem é que muda.
 */
export const HeaderActionsSlotContext = createContext<HTMLElement | null>(null);

export default function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderActionsSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}
