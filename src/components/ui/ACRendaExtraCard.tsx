import { AC, Student } from '@/types';
import { formatCurrency } from '@/store/useAppStore';
import { Coins } from 'lucide-react';

interface ACRendaExtraCardProps {
  ac: AC;
  students: Student[];
}

export default function ACRendaExtraCard({ ac, students }: ACRendaExtraCardProps) {
  const acStudents = students.filter((s) => s.ac === ac.name && s.isRendaExtra);

  const assumidos = acStudents.length;
  const acordos = acStudents.filter((s) => s.rendaExtraStatus === 'Acordo Feito').length;
  const percentual = assumidos > 0 ? Math.round((acordos / assumidos) * 100) : 0;

  const valorAcordado = acStudents
    .filter((s) => s.rendaExtraStatus === 'Acordo Feito')
    .reduce((acc, s) => acc + (s.rendaExtraAcordoValue || 0), 0);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden saas-shadow flex flex-col">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 flex items-center gap-2">
        <Coins size={16} className="text-white" />
        <h3 className="text-xs font-bold text-white uppercase">{ac.name} - Renda Extra</h3>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground font-medium">Assumidos:</span>
          <span className="text-sm font-bold text-foreground">{assumidos} alunos</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground font-medium">Acordos:</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">{acordos}</span>
            <span className="text-[10px] text-muted-foreground">|</span>
            <span className="text-sm font-bold text-emerald-600">{percentual}%</span>
          </div>
        </div>

        <div className="border-t border-border pt-3 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-medium">Valor Acordado:</span>
            <span className="text-sm font-bold text-blue-600">{formatCurrency(valorAcordado)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
