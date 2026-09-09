import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Student } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { termoDadosFaltantes, type TermoDadosAluno } from '@/lib/termoDadosAluno';

interface Options {
  student: Student | null | undefined;
  /** Fallbacks vindos do caso de cancelamento (nome/WhatsApp) quando a ficha não tem. */
  fallback?: Partial<TermoDadosAluno>;
}

/**
 * Dados do aluno usados no termo, com preenchimento manual quando algum não é reconhecido.
 * Abre o formulário sozinho na primeira renderização se faltar CPF, e-mail, WhatsApp ou nome.
 * Ao salvar, aplica no termo e (se houver ficha) persiste no cadastro do aluno.
 */
export function useTermoDadosAluno({ student, fallback }: Options) {
  const updateStudent = useAppStore((s) => s.updateStudent);
  const [manual, setManual] = useState<Partial<TermoDadosAluno>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [autoAberto, setAutoAberto] = useState(false);

  const dados = useMemo<Partial<TermoDadosAluno>>(
    () => ({
      name: manual.name ?? student?.name ?? fallback?.name ?? '',
      cpf: manual.cpf ?? student?.cpf ?? fallback?.cpf ?? '',
      email: manual.email ?? student?.email ?? fallback?.email ?? '',
      whatsapp: manual.whatsapp ?? student?.whatsapp ?? fallback?.whatsapp ?? '',
    }),
    [manual, student?.name, student?.cpf, student?.email, student?.whatsapp, fallback?.name, fallback?.cpf, fallback?.email, fallback?.whatsapp],
  );

  const faltantes = useMemo(() => termoDadosFaltantes(dados), [dados]);

  useEffect(() => {
    if (autoAberto) return;
    setAutoAberto(true);
    if (faltantes.length > 0) setFormOpen(true);
  }, [autoAberto, faltantes.length]);

  /** Ficha do aluno com os dados manuais aplicados (para o termo e o signatário ZapSign). */
  const studentEfetivo = useMemo<Student | null>(() => {
    if (!student) return null;
    return {
      ...student,
      name: dados.name || student.name,
      cpf: dados.cpf || student.cpf,
      email: dados.email || student.email,
      whatsapp: dados.whatsapp || student.whatsapp,
    };
  }, [student, dados]);

  const salvar = async (novo: TermoDadosAluno) => {
    setManual(novo);
    setFormOpen(false);
    if (!student) {
      toast.success('Dados aplicados ao termo.');
      return;
    }
    const patch: Partial<Student> = {};
    if (novo.name && novo.name !== student.name) patch.name = novo.name;
    if (novo.cpf && novo.cpf !== student.cpf) patch.cpf = novo.cpf;
    if (novo.email && novo.email !== (student.email ?? '')) patch.email = novo.email;
    if (novo.whatsapp && novo.whatsapp !== student.whatsapp) patch.whatsapp = novo.whatsapp;
    if (Object.keys(patch).length === 0) return;
    try {
      await updateStudent(student.id, {
        ...patch,
        history: [
          ...(student.history ?? []),
          {
            date: new Date().toISOString(),
            type: 'Sistema' as const,
            text: `Dados completados manualmente para o termo: ${Object.keys(patch)
              .map((k) => ({ name: 'nome', cpf: 'CPF', email: 'e-mail', whatsapp: 'WhatsApp' })[k as keyof TermoDadosAluno])
              .join(', ')}.`,
          },
        ],
      });
      toast.success('Dados aplicados ao termo e salvos na ficha do aluno.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Dados aplicados ao termo, mas não foi possível salvar na ficha.');
    }
  };

  return { dados, faltantes, formOpen, setFormOpen, studentEfetivo, salvar };
}
