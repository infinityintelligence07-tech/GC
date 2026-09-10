-- Ficha que JÁ existe no GC pela planilha Kamino (carteira principal) e passa
-- a ser casada com um contrato do IAM Control não pode cair na fila
-- "IAM CONTROL → GC" nem sair dos totais/carteira: o financeiro dela é do GC
-- (proteção Kamino do pull) e já foi conciliado pela esteira normal.
--
-- Caso: CLODOALDO BRANDOLISE (Confronto). Ficha Kamino de 28/08, ajuste de
-- parcelas conciliado em 08/09 (Carol Romera). O pull completo de 10/09 casou o
-- contrato IAM 1182 (CONCILIADO no IAM) com essa ficha; como
-- iam_gc_conciliado_at estava NULL, o app abriu um item "Conciliado (aguarda
-- aprovação GC)", travou a ficha em Pendente/Manual e ela sumiu da carteira.
--
-- Regra (mesmo padrão de students_iam_quitado_avista_autoaprova):
--   * ficha Kamino (importada por planilha / conciliada Kamino×GC) com vínculo
--     IAM e sem aprovação GC → grava iam_gc_conciliado_at na hora;
--   * "Pendente" (rótulo da fila) volta para Automático — o app recalcula;
--   * fecha o item iam_pendente aberto.
-- Ficha cancelada fica de fora (regra própria do cancelamento).

CREATE OR REPLACE FUNCTION public.students_iam_ficha_kamino_autoaprova()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_status text := upper(coalesce(NEW.iam_control_contrato_status, ''));
  v_kamino boolean;
BEGIN
  IF NEW.iam_control_aluno_id IS NULL
     OR NEW.iam_gc_conciliado_at IS NOT NULL
     OR v_status NOT IN ('CONCILIADO', 'PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR')
     OR coalesce(NEW.status_cancelamento, 'nenhum') = 'cancelado'
     OR NEW.status = 'Cancelado'
  THEN
    RETURN NEW;
  END IF;

  v_kamino := jsonb_typeof(NEW.history) = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.history) h
    WHERE h->>'text' ILIKE 'Importado via planilha Kamino%'
       OR h->>'text' ILIKE 'Conciliação Kamino×GC%'
  );
  IF NOT v_kamino THEN
    v_kamino := EXISTS (
      SELECT 1 FROM public._kamino_sync_staging k
      WHERE k.skey = public.gc_student_key(NEW.name, NEW.product)
    );
  END IF;
  IF NOT v_kamino THEN
    RETURN NEW;
  END IF;

  NEW.iam_gc_conciliado_at := now();
  NEW.iam_control_contrato_status := 'CONCILIADO';
  IF NEW.status = 'Pendente' THEN
    NEW.status := 'Em Dia';
    NEW.status_mode := 'Automático';
  END IF;
  NEW.history := coalesce(NEW.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Contrato IAM ' || coalesce(NEW.iam_control_contrato_id, '?') || ' casado com ficha já existente no GC (planilha Kamino): financeiro do GC preservado, contrato aprovado automaticamente — não passa pela fila IAM CONTROL → GC.'
  ));

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.conciliacao_items ci
       SET status = 'conciliado',
           conciliado_at = now(),
           conciliado_por_nome = 'Sistema IAM',
           conciliado_nota = 'Fechado automaticamente: ficha já existia no GC (planilha Kamino) e foi apenas vinculada ao contrato do IAM Control.',
           updated_at = now()
     WHERE ci.student_id = NEW.id
       AND ci.tipo = 'iam_pendente'
       AND ci.status IN ('pendente', 'aprovado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_iam_ficha_kamino_autoaprova ON public.students;
CREATE TRIGGER students_iam_ficha_kamino_autoaprova
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_iam_ficha_kamino_autoaprova();

COMMENT ON FUNCTION public.students_iam_ficha_kamino_autoaprova() IS
  'Ficha Kamino vinculada a contrato IAM: grava aprovação GC na hora, tira "Pendente" e fecha item iam_pendente aberto.';

-- Backfill: fichas Kamino que já estão nessa situação (o UPDATE dispara o trigger).
UPDATE public.students s
   SET updated_at = now()
  FROM public.companies co
 WHERE co.id = s.company_id AND co.active
   AND s.iam_control_aluno_id IS NOT NULL
   AND s.iam_gc_conciliado_at IS NULL
   AND upper(coalesce(s.iam_control_contrato_status, '')) IN ('CONCILIADO', 'PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR')
   AND coalesce(s.status_cancelamento, 'nenhum') <> 'cancelado'
   AND s.status <> 'Cancelado'
   AND (
     EXISTS (
       SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.history) = 'array' THEN s.history ELSE '[]'::jsonb END) h
       WHERE h->>'text' ILIKE 'Importado via planilha Kamino%' OR h->>'text' ILIKE 'Conciliação Kamino×GC%'
     )
     OR EXISTS (SELECT 1 FROM public._kamino_sync_staging k WHERE k.skey = public.gc_student_key(s.name, s.product))
   );
