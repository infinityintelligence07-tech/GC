// KPI combinado: Fundo / TMF / Antecipação.
// Considera SOMENTE as parcelas em aberto marcadas com alguma dessas tags (por parcela) ou,
// quando a tag está no nível do aluno, todas as parcelas em aberto dele.
// Não interfere nos demais indicadores — uma parcela pode aparecer aqui e em outros KPIs.

import type { Student, StudentTag } from '@/types';

export type TagKpiGroupKey = 'fundo_tmf_antecipacao';

export const TAG_KPI_GROUPS: { key: TagKpiGroupKey; label: string; matchers: string[]; color: string; text: string }[] = [
  { key: 'fundo_tmf_antecipacao', label: 'Fundo / TMF / Antecipação', matchers: ['fundo', 'tmf', 'antecipa'], color: 'border-l-indigo-500', text: 'text-indigo-600' },
];

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export interface TagKpiResult {
  key: TagKpiGroupKey;
  label: string;
  color: string;
  text: string;
  value: number;
  overdueValue: number;
  count: number;
  students: Student[];
}

/**
 * Calcula valor em aberto e nº de alunos para o grupo combinado Fundo / TMF / Antecipação.
 * @param students alunos já escopados pelos filtros da dashboard
 * @param studentTags catálogo de tags (para resolver id ↔ nome)
 * @param instInRange filtro de período aplicado às parcelas
 */
export function computeTagKpis(
  students: Student[],
  studentTags: StudentTag[],
  instInRange: (i: { dueDate: string }) => boolean = () => true,
): TagKpiResult[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const group = TAG_KPI_GROUPS[0];
  const matching = studentTags.filter((t) => group.matchers.some((m) => norm(t.name).includes(m)));
  const refs = new Set<string>();
  matching.forEach((t) => {
    refs.add(t.id);
    refs.add(norm(t.name));
  });
  // Permite também tags "virtuais" salvas direto pelo nome nas parcelas.
  group.matchers.forEach((m) => refs.add(m));

  const hasRef = (tags?: string[] | null) =>
    (tags ?? []).some((t) => {
      if (!t) return false;
      if (refs.has(t)) return true;
      const n = norm(t);
      return group.matchers.some((m) => n.includes(m));
    });

  let value = 0;
  let overdueValue = 0;
  const hit: Student[] = [];

  students.forEach((s) => {
    const studentLevel = hasRef(s.tags);
    const relevant = (s.installments || []).filter(
      (i) => !i.paid && instInRange(i) && (studentLevel || hasRef(i.tags)),
    );
    if (relevant.length === 0) return;
    const sum = relevant.reduce((a, i) => a + (i.value || 0), 0);
    value += sum;
    overdueValue += relevant
      .filter((i) => new Date(i.dueDate + 'T00:00:00').getTime() < todayMs)
      .reduce((a, i) => a + (i.value || 0), 0);
    hit.push({ ...s, installments: relevant });
  });

  return [{ key: group.key, label: group.label, color: group.color, text: group.text, value, overdueValue, count: hit.length, students: hit }];
}

