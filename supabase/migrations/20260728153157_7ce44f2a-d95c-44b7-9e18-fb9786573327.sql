
DROP POLICY IF EXISTS cancellation_cases_select_by_tab ON public.cancellation_cases;
CREATE POLICY cancellation_cases_select_by_tab ON public.cancellation_cases
  FOR SELECT
  USING (has_any_tab_view(auth.uid(), ARRAY['cancelamentos','conciliacao','alunos','dashboard','estornos','comissoes']));

DROP POLICY IF EXISTS cancellation_cases_update_edit ON public.cancellation_cases;
CREATE POLICY cancellation_cases_update_edit ON public.cancellation_cases
  FOR UPDATE
  USING (has_tab_edit(auth.uid(), 'cancelamentos') OR has_tab_edit(auth.uid(), 'estornos') OR has_tab_edit(auth.uid(), 'comissoes'));

DROP POLICY IF EXISTS students_select_by_tab ON public.students;
CREATE POLICY students_select_by_tab ON public.students
  FOR SELECT
  USING (has_any_tab_view(auth.uid(), ARRAY['alunos','cancelamentos','conciliacao','rendaExtra','dashboard','equipe','estornos','comissoes']));
