REVOKE EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_student_negativado(uuid, text) TO service_role;