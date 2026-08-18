GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;

CREATE OR REPLACE FUNCTION public.mark_student_negativado(_student_id uuid, _actor_name text DEFAULT NULL)
RETURNS public.students
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _student public.students%ROWTYPE;
  _history jsonb;
  _entry jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT *
    INTO _student
    FROM public.students
   WHERE id = _student_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aluno não encontrado';
  END IF;

  IF _student.company_id IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'Aluno fora da empresa ativa';
  END IF;

  IF NOT public.has_any_tab_view(auth.uid(), ARRAY['alunos','equipe','dashboard','rendaExtra']) THEN
    RAISE EXCEPTION 'Sem permissão para negativar aluno';
  END IF;

  IF COALESCE(_student.status, '') NOT IN ('À Negativar', 'Negativado') THEN
    RAISE EXCEPTION 'Somente alunos À Negativar podem ser marcados como Negativado';
  END IF;

  _history := COALESCE(_student.history, '[]'::jsonb);

  IF COALESCE(_student.status, '') <> 'Negativado' THEN
    _entry := jsonb_build_object(
      'date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', COALESCE(NULLIF(_actor_name, ''), 'Usuário') || ' alterou o status manualmente para "Negativado".'
    );
    _history := _history || jsonb_build_array(_entry);
  END IF;

  UPDATE public.students
     SET status = 'Negativado',
         status_mode = 'Manual',
         history = _history,
         updated_at = now()
   WHERE id = _student_id
   RETURNING * INTO _student;

  RETURN _student;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_student_negativado(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) TO service_role;