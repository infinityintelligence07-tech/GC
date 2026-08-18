DROP POLICY IF EXISTS students_delete_admin ON public.students;
CREATE POLICY students_delete_edit ON public.students FOR DELETE TO authenticated
USING (public.has_tab_edit(auth.uid(), 'alunos') OR public.has_role(auth.uid(), 'admin'::public.app_role));