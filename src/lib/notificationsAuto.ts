// ─── Notificações automáticas (Item 2 — Onda 2) ──────────────────────────────
// Gera notificações de "vencimento de hoje" para cada AC ativo, com a soma
// dos valores de parcelas pendentes que vencem hoje na carteira dele.
//
// Roda 1x por dia (controle por localStorage no useSupabaseSync).

import { isStudentInAcPortfolio } from '@/lib/acPortfolioVisibility';
import { useAppStore } from '@/store/useAppStore';
import { useNotificationsStore } from '@/store/useNotificationsStore';

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

export async function gerarNotificacoesVencimentoHoje(): Promise<void> {
  const { acs, students } = useAppStore.getState();
  const { notify } = useNotificationsStore.getState();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().split('T')[0];

  // Para cada AC ativo, soma valor que vence hoje na carteira dele
  for (const ac of acs.filter((a) => a.active)) {
    const carteira = students.filter((s) => s.ac === ac.name && isStudentInAcPortfolio(s));
    let totalHoje = 0;
    let qtdParcelas = 0;
    for (const s of carteira) {
      if (s.status === 'Excluído' || s.status === 'Cancelado') continue;
      for (const inst of s.installments || []) {
        if (inst.paid) continue;
        const due = parseDateLocal(inst.dueDate);
        due.setHours(0, 0, 0, 0);
        if (due.getTime() === today.getTime()) {
          totalHoje += inst.value;
          qtdParcelas += 1;
        }
      }
    }
    if (totalHoje <= 0) continue;
    try {
      await notify({
        acId: ac.id,
        type: 'vencimento_hoje',
        title: `Vence hoje: ${formatBRL(totalHoje)}`,
        body: `${qtdParcelas} parcela${qtdParcelas !== 1 ? 's' : ''} venc${qtdParcelas !== 1 ? 'em' : 'e'} hoje na sua carteira.`,
        meta: { date: todayKey, total: totalHoje, qtdParcelas },
      });
    } catch (e) {
      console.error('Falha ao notificar venc. hoje para AC', ac.name, e);
    }
  }
}
