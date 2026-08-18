// ─────────────────────────────────────────────────────────────────────────────
// Helper centralizado para reportar erros de mutação no banco.
// Mostra um toast discreto ao usuário e loga o detalhe no console.
// Uso: .catch(reportDbError('atualizar aluno'))
// ─────────────────────────────────────────────────────────────────────────────

import { toast } from 'sonner';

let lastShown = 0;
const COOLDOWN_MS = 1500; // evita spam quando vários erros acontecem em sequência

export function reportDbError(action: string) {
  return (err: unknown) => {
    console.error(`[DB ERROR] ${action}:`, err);
    const now = Date.now();
    if (now - lastShown < COOLDOWN_MS) return;
    lastShown = now;
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(`Falha ao ${action}`, {
      description: msg.length > 120 ? msg.slice(0, 120) + '…' : msg,
    });
  };
}
