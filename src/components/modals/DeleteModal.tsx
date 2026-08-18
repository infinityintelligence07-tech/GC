import type { ReactNode } from 'react';

interface Props {
  onConfirm: () => void;
  onClose: () => void;
  title?: string;
  description?: ReactNode;
}

export default function DeleteModal({ onConfirm, onClose, title, description }: Props) {
  return (
    <div className="fixed inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center z-50 fade-in">
      <div className="bg-card rounded-2xl w-full max-w-sm shadow-2xl border border-border p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">{title ?? 'Excluir Registro?'}</h2>
        <div className="text-xs text-muted-foreground mb-6 space-y-2 text-left">
          {description ?? <p className="text-center">Esta ação não pode ser desfeita.</p>}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground">
            Não
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground shadow-md">
            Sim, Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
