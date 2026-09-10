-- Guarda do desfecho "Negativar Contrato" (10/09/2026).
--
-- Um cliente com o front antigo ainda aberto reconcilia o vínculo do aluno com
-- o caso de cancelamento e, sem conhecer 'negativacao' nem a etapa "Iniciar
-- Negativação", devolve a ficha para 'solicitado' / "Solicitação Cancelamento"
-- (aconteceu duas vezes com Lucilene dos Santos Barbosa em 10/09: 15:41 e 15:47).
--
-- Enquanto o MESMO caso continuar marcado como negativar_contrato, a ficha não
-- pode voltar ao funil de cancelamento: mantém 'negativacao' e o status
-- "À Negativar" / "Negativado". Um novo pedido de cancelamento (outro
-- cancellation_case_id) não é afetado.
CREATE OR REPLACE FUNCTION public.students_negativacao_contrato_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_negativar boolean;
BEGIN
  IF OLD.status_cancelamento IS DISTINCT FROM 'negativacao' THEN
    RETURN NEW;
  END IF;
  IF NEW.status_cancelamento IS DISTINCT FROM 'solicitado' THEN
    RETURN NEW;
  END IF;
  IF NEW.cancellation_case_id IS DISTINCT FROM OLD.cancellation_case_id THEN
    RETURN NEW; -- novo pedido de cancelamento: segue normal
  END IF;

  SELECT c.negativar_contrato INTO v_negativar
  FROM public.cancellation_cases c
  WHERE c.id = OLD.cancellation_case_id;

  IF coalesce(v_negativar, false) THEN
    NEW.status_cancelamento := 'negativacao';
    IF NEW.status = 'Solicitação Cancelamento' THEN
      NEW.status := CASE WHEN OLD.status IN ('À Negativar', 'Negativado') THEN OLD.status ELSE 'À Negativar' END;
      NEW.status_mode := 'Manual';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS students_negativacao_contrato_guard ON public.students;
CREATE TRIGGER students_negativacao_contrato_guard
  BEFORE UPDATE OF status_cancelamento ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.students_negativacao_contrato_guard();
