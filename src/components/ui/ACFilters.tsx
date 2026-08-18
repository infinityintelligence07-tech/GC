import { Filter } from 'lucide-react';
import { StudentStatus } from '@/types';

interface ACFiltersProps {
  products: string[];
  selectedProduct: string;
  setSelectedProduct: (product: string) => void;
  selectedStatus: StudentStatus | 'todos';
  setSelectedStatus: (status: StudentStatus | 'todos') => void;
}

const STATUS_OPTIONS: (StudentStatus | 'todos')[] = [
  'todos',
  'Aluno Novo',
  'Em Dia',
  'Vencido 1',
  'Vencido 2',
  'À Negativar',
  'Negativado',
  'Em Negociação',
  'Excluído',
  'Pendente',
];

export default function ACFilters({
  products,
  selectedProduct,
  setSelectedProduct,
  selectedStatus,
  setSelectedStatus,
}: ACFiltersProps) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 saas-shadow">
      <div className="flex items-center gap-3 flex-wrap">
        <Filter size={14} className="text-muted-foreground" />

        {/* Product filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Produto:</span>
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="input-field text-xs py-1.5"
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Status:</span>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as StudentStatus | 'todos')}
            className="input-field text-xs py-1.5"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'todos' ? 'Todos' : s}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
