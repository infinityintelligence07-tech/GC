-- Fichas criadas pelo sync IAM Control chegavam sem Assessor (AC).
--
-- Causa: a trigger BEFORE INSERT `trg_students_assign_ac_esteira` (migração
-- 20260821014500) não está mais presente em produção — só `trg_students_updated`
-- existe em public.students. O payload do IAM não traz vendedor, então a esteira
-- (reuso do AC de outra ficha da mesma pessoa → senão round-robin) era o único
-- caminho para preencher o AC. Sem ela, 65 fichas IAM ficaram com ac = ''.
--
-- 1) Recria a trigger (função `students_assign_ac_esteira` continua no banco).
-- 2) Backfill das fichas IAM sem AC usando a mesma regra da esteira
--    (`next_ac_from_esteira`: reuso por CPF/nome, senão próximo da fila).
--    Produtos fora do GC (IPR / Imersão) continuam sem AC — a função devolve NULL.

DROP TRIGGER IF EXISTS trg_students_assign_ac_esteira ON public.students;
CREATE TRIGGER trg_students_assign_ac_esteira
  BEFORE INSERT ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.students_assign_ac_esteira();

DO $$
DECLARE
  r      record;
  v_ac   text;
  v_qtd  int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.company_id, s.cpf, s.name, s.product, s.history
    FROM public.students s
    WHERE s.iam_control_aluno_id IS NOT NULL
      AND coalesce(btrim(s.ac), '') = ''
    ORDER BY s.created_at ASC
  LOOP
    v_ac := public.next_ac_from_esteira(r.company_id, r.cpf, r.product, NULL, r.id, r.name);
    IF v_ac IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.students
    SET ac = v_ac,
        history = coalesce(r.history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'date', now(),
            'type', 'Sistema',
            'text', 'Assessor "' || v_ac || '" atribuído pela esteira (correção retroativa: ficha criada pelo IAM Control sem AC).'
          )
        )
    WHERE id = r.id;
    v_qtd := v_qtd + 1;
  END LOOP;

  RAISE NOTICE '[esteira] fichas IAM com AC preenchido: %', v_qtd;
END $$;
