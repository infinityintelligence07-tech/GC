-- Acrescenta uma entrada ao histórico da ficha de forma atômica (sem ler e
-- reescrever o array inteiro no cliente). Usado pela edge function
-- iam-control-push-conciliacao, que roda em paralelo com a gravação da
-- aprovação feita pelo front — um overwrite do array perderia uma das duas.
CREATE OR REPLACE FUNCTION public.student_history_append(p_student_id uuid, p_text text, p_type text DEFAULT 'Sistema')
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE public.students
     SET history = coalesce(history, '[]'::jsonb)
                   || jsonb_build_array(jsonb_build_object('date', now(), 'type', p_type, 'text', p_text)),
         updated_at = now()
   WHERE id = p_student_id;
$$;

REVOKE ALL ON FUNCTION public.student_history_append(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_history_append(uuid, text, text) TO service_role;
