-- Contrato IAM CONCILIADO e quitado à vista (cartão integral / PIX / à vista)
-- não passa pela aprovação GC (regra 20260826000000 / 20260903134000). Mas a
-- aprovação só era gravada por reparos pontuais: quando a ficha VIRAVA quitada
-- depois de já estar na fila (ex.: 20260908200000 passou a somar o cartão na
-- entrada), ela ficava com status "Pendente"/Manual travado e o item IAM
-- CONTROL → GC aberto. Caso: Hélio Jorde de Mattos (Confronto) + 32 fichas
-- do Confronto/Leader Skills de 24-25/08.
--
-- Agora o banco fecha isso sozinho, em qualquer insert/update da ficha:
--   * grava iam_gc_conciliado_at;
--   * "Pendente" (rótulo da fila) vira Pago/Automático — outros status manuais
--     (Negativado, Solicitação Cancelamento…) não são tocados;
--   * fecha o item iam_pendente aberto.
-- Ficha cancelada fica de fora (regra própria em cancellation_case_finaliza_aluno).

CREATE OR REPLACE FUNCTION public.students_iam_quitado_avista_autoaprova()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.iam_control_aluno_id IS NULL
     OR NEW.iam_gc_conciliado_at IS NOT NULL
     OR upper(coalesce(NEW.iam_control_contrato_status, '')) <> 'CONCILIADO'
     OR coalesce(NEW.status_cancelamento, 'nenhum') = 'cancelado'
     OR NEW.status = 'Cancelado'
     OR coalesce(NEW.total_installments, 0) <> 0
     OR coalesce(NEW.sale_value, 0) <= 0
     OR coalesce(NEW.down_payment, 0) < coalesce(NEW.sale_value, 0) - 0.01
  THEN
    RETURN NEW;
  END IF;

  NEW.iam_gc_conciliado_at := now();
  IF NEW.status = 'Pendente' THEN
    NEW.status := 'Pago';
    NEW.status_mode := 'Automático';
  END IF;
  NEW.history := coalesce(NEW.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Contrato IAM CONCILIADO quitado à vista (cartão / PIX / à vista): entra direto na carteira e nos totais, sem aprovação GC. Item da fila IAM CONTROL → GC fechado automaticamente.'
  ));

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.conciliacao_items ci
       SET status = 'conciliado',
           conciliado_at = now(),
           conciliado_por_nome = 'Sistema IAM',
           conciliado_nota = 'Fechado automaticamente: contrato quitado à vista no IAM (entra direto na dashboard, sem aprovação GC).',
           updated_at = now()
     WHERE ci.student_id = NEW.id
       AND ci.tipo = 'iam_pendente'
       AND ci.status IN ('pendente', 'aprovado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_iam_quitado_avista_autoaprova ON public.students;
CREATE TRIGGER students_iam_quitado_avista_autoaprova
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_iam_quitado_avista_autoaprova();

COMMENT ON FUNCTION public.students_iam_quitado_avista_autoaprova() IS
  'IAM CONCILIADO quitado à vista: grava aprovação GC, tira "Pendente" e fecha item iam_pendente aberto.';

-- Backfill: fichas que já estão nessa situação. O UPDATE dispara o trigger,
-- que aplica exatamente a mesma regra.
UPDATE public.students s
   SET updated_at = now()
  FROM public.companies co
 WHERE co.id = s.company_id AND co.active
   AND s.iam_control_aluno_id IS NOT NULL
   AND s.iam_gc_conciliado_at IS NULL
   AND upper(coalesce(s.iam_control_contrato_status, '')) = 'CONCILIADO'
   AND coalesce(s.status_cancelamento, 'nenhum') <> 'cancelado'
   AND s.status <> 'Cancelado'
   AND coalesce(s.total_installments, 0) = 0
   AND coalesce(s.sale_value, 0) > 0
   AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01;
