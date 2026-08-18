import { Student } from '@/types';
import { BookOpen, CheckCircle, XCircle, Clock } from 'lucide-react';

interface StudentJourneyFooterProps {
  student: Student;
}

export default function StudentJourneyFooter({ student }: StudentJourneyFooterProps) {
  // Build product history from productHistory + current product
  const allProducts = [];

  // Add current product
  allProducts.push({
    product: student.product,
    enrollmentDate: student.enrollmentDate,
    status: student.status === 'Excluído' || student.statusCancelamento === 'cancelado' ? 'cancelado' : student.status === 'Em Negociação' ? 'em_risco' : 'ativo'
  });

  // Add historical products if available
  if (student.productHistory && student.productHistory.length > 0) {
    allProducts.push(...student.productHistory);
  }

  // Sort by enrollment date
  allProducts.sort((a, b) => new Date(b.enrollmentDate).getTime() - new Date(a.enrollmentDate).getTime());

  if (allProducts.length <= 1) {
    return null;
  }

  const getStatusColor = (status: string) => {
    if (status === 'ativo' || status === 'ativo') return 'bg-blue-100 text-blue-800 border-blue-200';
    if (status === 'cancelado') return 'bg-red-100 text-red-800 border-red-200';
    if (status === 'concluído') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'em_risco') return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getStatusIcon = (status: string) => {
    if (status === 'ativo') return <Clock size={12} />;
    if (status === 'cancelado') return <XCircle size={12} />;
    if (status === 'concluído') return <CheckCircle size={12} />;
    return null;
  };

  const getStatusLabel = (status: string) => {
    if (status === 'ativo') return 'Ativo';
    if (status === 'cancelado') return 'Cancelado';
    if (status === 'concluído') return 'Concluído';
    if (status === 'em_risco') return 'Em Risco';
    return status;
  };

  return (
    <div className="mt-6 pt-4 border-t border-border">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={13} className="text-muted-foreground" />
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          Jornada do Aluno ({allProducts.length} curso{allProducts.length !== 1 ? 's' : ''})
        </h4>
      </div>

      <div className="space-y-1.5">
        {allProducts.map((product, idx) => (
          <div
            key={`${product.product}-${product.enrollmentDate}`}
            className={`flex items-center gap-2 p-2.5 rounded-lg border ${getStatusColor(product.status)}`}
          >
            {getStatusIcon(product.status) && (
              <span className="flex-shrink-0">{getStatusIcon(product.status)}</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold truncate">{product.product}</p>
              <p className="text-[9px] opacity-75 truncate">
                {new Date(product.enrollmentDate).toLocaleDateString('pt-BR')}
              </p>
            </div>
            <span className="text-[8px] font-bold uppercase whitespace-nowrap px-2 py-0.5 rounded">
              {getStatusLabel(product.status)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
