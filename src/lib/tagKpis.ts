// KPI combinado: Boletos Antecipados (tags Fundo / TMF / Antecipação).
// Considera SOMENTE as parcelas em aberto marcadas com alguma dessas tags (por parcela) ou,
// quando a tag está no nível do aluno, todas as parcelas em aberto dele.
// Não interfere nos demais indicadores — uma parcela pode aparecer aqui e em outros KPIs.

import type { Student, StudentTag } from '@/types';

export type TagKpiGroupKey = 'fundo_tmf_antecipacao';

export const TAG_KPI_GROUPS: { key: TagKpiGroupKey; label: string; matchers: string[]; color: string; text: string }[] = [
  { key: 'fundo_tmf_antecipacao', label: 'Boletos Antecipados', matchers: ['fundo', 'tmf', 'antecipa'], color: 'border-l-indigo-500', text: 'text-indigo-600' },
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
 * Calcula valor em aberto e nº de alunos para o grupo Boletos Antecipados.
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
  const refs = getTagKpiGroupRefs(studentTags, group.key);

  let value = 0;
  let overdueValue = 0;
  const hit: Student[] = [];

  students.forEach((s) => {
    const studentLevel = tagsHitGroup(s.tags, refs, group.matchers);
    const relevant = (s.installments || []).filter(
      (i) => !i.paid && instInRange(i) && (studentLevel || tagsHitGroup(i.tags, refs, group.matchers)),
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

/** IDs das tags do catálogo que pertencem a um grupo de KPI (ex.: Fundo/TMF/Antecipação). */
export function getTagIdsForKpiGroup(studentTags: StudentTag[], key: TagKpiGroupKey): string[] {
  const group = TAG_KPI_GROUPS.find((g) => g.key === key);
  if (!group) return [];
  return studentTags
    .filter((t) => group.matchers.some((m) => norm(t.name).includes(m)))
    .map((t) => t.id);
}

/** Refs (id + nome normalizado + matchers) usadas pelo KPI — mesma lógica de computeTagKpis. */
export function getTagKpiGroupRefs(studentTags: StudentTag[], key: TagKpiGroupKey): Set<string> {
  const group = TAG_KPI_GROUPS.find((g) => g.key === key);
  const refs = new Set<string>();
  if (!group) return refs;
  studentTags
    .filter((t) => group.matchers.some((m) => norm(t.name).includes(m)))
    .forEach((t) => {
      refs.add(t.id);
      refs.add(norm(t.name));
    });
  group.matchers.forEach((m) => refs.add(m));
  return refs;
}

function tagsHitGroup(tags: string[] | null | undefined, refs: Set<string>, matchers: string[]): boolean {
  return (tags ?? []).some((t) => {
    if (!t) return false;
    if (refs.has(t)) return true;
    const n = norm(t);
    return matchers.some((m) => n.includes(m));
  });
}

/**
 * Aluno conta no KPI do grupo se tiver a tag no nível do aluno OU em alguma parcela
 * (OR entre Fundo/TMF/Antecipação — igual ao card).
 */
export function studentMatchesTagKpiGroup(
  student: Student,
  studentTags: StudentTag[],
  key: TagKpiGroupKey = 'fundo_tmf_antecipacao',
): boolean {
  const group = TAG_KPI_GROUPS.find((g) => g.key === key);
  if (!group) return false;
  const refs = getTagKpiGroupRefs(studentTags, key);
  if (tagsHitGroup(student.tags, refs, group.matchers)) return true;
  return (student.installments || []).some((i) => !i.paid && tagsHitGroup(i.tags, refs, group.matchers));
}

/**
 * Restringe o aluno às parcelas do grupo (quando a tag está só em parcelas) ou
 * mantém todas se a tag estiver no aluno — espelha o valor do card.
 */
export function applyTagKpiGroupToStudent(
  student: Student,
  studentTags: StudentTag[],
  key: TagKpiGroupKey = 'fundo_tmf_antecipacao',
): Student {
  const group = TAG_KPI_GROUPS.find((g) => g.key === key);
  if (!group) return student;
  const refs = getTagKpiGroupRefs(studentTags, key);
  const studentLevel = tagsHitGroup(student.tags, refs, group.matchers);
  const relevant = (student.installments || []).filter(
    (i) => !i.paid && (studentLevel || tagsHitGroup(i.tags, refs, group.matchers)),
  );
  if (relevant.length === 0) return { ...student, installments: [] };
  const avgValue = relevant.reduce((a, i) => a + (i.value || 0), 0) / relevant.length;
  return {
    ...student,
    installments: relevant,
    totalInstallments: relevant.length,
    paidInstallments: 0,
    installmentValue: avgValue,
  };
}
