import { Users } from 'lucide-react';

export default function TeamPage() {
  return (
    <div className="flex flex-col items-center justify-center py-28 space-y-5">
      <div className="w-16 h-16 rounded-2xl bg-primary/6 flex items-center justify-center">
        <Users size={26} strokeWidth={1.6} className="text-primary/50" />
      </div>
      <div className="text-center">
        <h3 className="text-base font-semibold text-foreground tracking-tight">Equipe</h3>
        <p className="text-sm text-muted-foreground/60 mt-1.5 max-w-sm font-medium">
          Selecione um Assessor de Conta no menu lateral para visualizar sua carteira.
        </p>
      </div>
    </div>
  );
}
