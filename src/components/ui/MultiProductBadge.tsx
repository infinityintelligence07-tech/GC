import { BookOpen } from 'lucide-react';
import { Student } from '@/types';

interface MultiProductBadgeProps {
  student: Student;
  compact?: boolean;
}

export default function MultiProductBadge({ student, compact = false }: MultiProductBadgeProps) {
  // Count total products
  const totalProducts = 1 + (student.productHistory?.length || 0);

  if (totalProducts <= 1) {
    return null;
  }

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200"
        title={`Inscrito em ${totalProducts} curso(s)`}
      >
        <BookOpen size={12} />
        <span className="text-[10px] font-semibold">{totalProducts}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800">
      <BookOpen size={13} />
      <span className="text-xs font-semibold">
        Inscrito em {totalProducts} curso{totalProducts !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
