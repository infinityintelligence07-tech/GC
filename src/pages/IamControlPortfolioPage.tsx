import { useMemo, useState } from 'react';
import { useAppStore, formatCurrency, formatCurrencyCompact } from '@/store/useAppStore';
import { Student } from '@/types';
import {
  isAwaitingIamGcApproval,
  isIamControlStudent,
  normalizeIamContratoStatus,
} from '@/lib/iamPendenteConciliacao';
import { resolveStudentDisplayStatus, isOperationalPendente } from '@/lib/studentDisplayStatus';
import IamControlSyncSection from '@/components/IamControlSyncSection';
import { Cloud, Users, Wallet, Clock, CheckCircle2 } from 'lucide-react';

function sumOpen(student: Student): number {
  return student.installments
    .filter((i) => !i.paid)
    .reduce((acc, i) => acc + i.value, 0);
}

export default function IamControlPortfolioPage() {
  const { students } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<'todos' | 'pendente' | 'conciliado' | 'pago' | 'aberto'>('todos');
  const [productFilter, setProductFilter] = useState('');

  const iamStudents = useMemo(
    () => students.filter(isIamControlStudent),
    [students],
  );

  const products = useMemo(
    () => [...new Set(iamStudents.map((s) => s.product).filter(Boolean))].sort(),
    [iamStudents],
  );

  const stats = useMemo(() => {
    let aberto = 0;
    let pendentes = 0;
    let conciliados = 0;
    let pagos = 0;
    for (const s of iamStudents) {
      const open = sumOpen(s);
      aberto += open;
      if (isAwaitingIamGcApproval(s)) pendentes += 1;
      else if (normalizeIamContratoStatus(s.iamControlContratoStatus) === 'CONCILIADO') conciliados += 1;
      if (s.status === 'Pago' || open < 0.01) pagos += 1;
    }
    return { total: iamStudents.length, aberto, pendentes, conciliados, pagos };
  }, [iamStudents]);

  const filtered = useMemo(() => {
    return iamStudents
      .filter((s) => {
        if (productFilter && s.product !== productFilter) return false;
        const iamStatus = normalizeIamContratoStatus(s.iamControlContratoStatus);
        const open = sumOpen(s);
        switch (statusFilter) {
          case 'pendente':
            return isAwaitingIamGcApproval(s);
          case 'conciliado':
            return iamStatus === 'CONCILIADO' && !isAwaitingIamGcApproval(s);
          case 'pago':
            return s.status === 'Pago' || open < 0.01;
          case 'aberto':
            return open >= 0.01;
          default:
            return true;
        }
      })
      .sort((a, b) => sumOpen(b) - sumOpen(a));
  }, [iamStudents, productFilter, statusFilter]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-primary">
          <Cloud size={22} strokeWidth={1.8} />
          <h1 className="text-xl font-semibold tracking-tight">IAM Control — Carteira</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Alunos sincronizados do IAM Control. Esta carteira não entra na dashboard principal nem nas carteiras dos assessores.
        </p>
      </div>

      <IamControlSyncSection />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={<Users size={18} />} label="Alunos IAM" value={String(stats.total)} />
        <StatCard icon={<Wallet size={18} />} label="Saldo em aberto" value={formatCurrencyCompact(stats.aberto)} accent />
        <StatCard icon={<Clock size={18} />} label="Aguardando GC" value={String(stats.pendentes)} />
        <StatCard icon={<Cloud size={18} />} label="Conciliados IAM" value={String(stats.conciliados)} />
        <StatCard icon={<CheckCircle2 size={18} />} label="Quitados" value={String(stats.pagos)} />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <FilterChip active={statusFilter === 'todos'} onClick={() => setStatusFilter('todos')}>Todos</FilterChip>
        <FilterChip active={statusFilter === 'aberto'} onClick={() => setStatusFilter('aberto')}>Com saldo</FilterChip>
        <FilterChip active={statusFilter === 'pendente'} onClick={() => setStatusFilter('pendente')}>Aguardando GC</FilterChip>
        <FilterChip active={statusFilter === 'conciliado'} onClick={() => setStatusFilter('conciliado')}>Conciliados</FilterChip>
        <FilterChip active={statusFilter === 'pago'} onClick={() => setStatusFilter('pago')}>Quitados</FilterChip>
        <select
          className="ml-auto text-sm border rounded-md px-2 py-1.5 bg-background"
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
        >
          <option value="">Todos os produtos</option>
          {products.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Produto</th>
                <th className="px-3 py-2 font-medium">Status IAM</th>
                <th className="px-3 py-2 font-medium">Status GC</th>
                <th className="px-3 py-2 font-medium text-right">Contrato</th>
                <th className="px-3 py-2 font-medium text-right">Aberto</th>
                <th className="px-3 py-2 font-medium">Parc.</th>
                <th className="px-3 py-2 font-medium">AC</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const open = sumOpen(s);
                const unpaid = s.installments.filter((i) => !i.paid).length;
                const displayStatus = isOperationalPendente(s) ? 'Pendente' : resolveStudentDisplayStatus(s);
                const iamStatus = normalizeIamContratoStatus(s.iamControlContratoStatus) || '—';
                return (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2">{s.product}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{iamStatus.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-3 py-2">{displayStatus}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(s.saleValue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(open)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{unpaid > 0 ? `${unpaid} abertas` : '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.ac || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhum aluno IAM neste filtro.</p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-xs">{label}</span></div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}
