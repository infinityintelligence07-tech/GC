-- Fila IAM CONTROL -> GC: aluno "voltava" para a fila logo depois de conciliado.
--
-- Caso: Luis Guilherme (Missão Governar). Itens conciliados 03/09 12:20:45 e
-- aprovação gravada no aluno no mesmo segundo; às 12:21:01 o front criou um
-- item novo "pendente" para o mesmo aluno. Causa: ensureIamPendenteConciliacaoItems
-- roda ao fim de um reload que buscou students e conciliacao_items em
-- paralelo — pegou o item já conciliado mas a ficha ainda sem
-- iam_gc_conciliado_at, e recriou o item com dados velhos. O mesmo reload em
-- duas abas também gerava itens duplicados (12:15:14 e 12:15:15).
--
-- Proteções no banco (o front também passa a reconferir antes de inserir):
--   1. fecha itens abertos de alunos já aprovados no GC;
--   2. fecha duplicatas (mantém o item aberto mais antigo por aluno);
--   3. índice único: no máximo 1 item iam_pendente aberto por aluno;
--   4. trigger: insert de iam_pendente para aluno já aprovado é descartado.

-- 1. Itens abertos de alunos já aprovados.
UPDATE public.conciliacao_items ci
SET status = 'conciliado',
    conciliado_at = coalesce(s.iam_gc_conciliado_at, now()),
    conciliado_por_nome = coalesce(ci.conciliado_por_nome, 'Sistema IAM'),
    conciliado_nota = coalesce(ci.conciliado_nota, 'Fechado automaticamente: contrato já aprovado na Conciliação GC (item recriado por corrida de sincronização).')
FROM public.students s
WHERE s.id = ci.student_id
  AND ci.tipo = 'iam_pendente'
  AND ci.status IN ('pendente', 'aprovado')
  AND s.iam_gc_conciliado_at IS NOT NULL;

-- 2. Duplicatas abertas: mantém o mais antigo.
WITH ranked AS (
  SELECT ci.id,
         row_number() OVER (PARTITION BY ci.student_id ORDER BY ci.created_at ASC, ci.id ASC) AS rn
  FROM public.conciliacao_items ci
  WHERE ci.tipo = 'iam_pendente'
    AND ci.status IN ('pendente', 'aprovado')
    AND ci.student_id IS NOT NULL
)
UPDATE public.conciliacao_items ci
SET status = 'conciliado',
    conciliado_at = now(),
    conciliado_por_nome = 'Sistema IAM',
    conciliado_nota = 'Fechado automaticamente: item duplicado na fila IAM CONTROL → GC (já existe item aberto para este aluno).'
FROM ranked r
WHERE r.id = ci.id AND r.rn > 1;

-- 3. Um item aberto por aluno.
CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_items_iam_pendente_aberto_uidx
  ON public.conciliacao_items (student_id)
  WHERE tipo = 'iam_pendente' AND status IN ('pendente', 'aprovado') AND student_id IS NOT NULL;

-- 4. Aluno já aprovado não recebe item novo. Reabertura legítima zera
--    iam_gc_conciliado_at no pull antes, então nunca cai aqui.
CREATE OR REPLACE FUNCTION public.conciliacao_items_iam_pendente_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.tipo <> 'iam_pendente' OR NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.status, 'pendente') NOT IN ('pendente', 'aprovado') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = NEW.student_id AND s.iam_gc_conciliado_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'IAM_PENDENTE_JA_APROVADO'
      USING HINT = 'Contrato já aprovado na Conciliação GC; item não criado.',
            ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conciliacao_items_iam_pendente_guard ON public.conciliacao_items;
CREATE TRIGGER conciliacao_items_iam_pendente_guard
  BEFORE INSERT ON public.conciliacao_items
  FOR EACH ROW EXECUTE FUNCTION public.conciliacao_items_iam_pendente_guard();

COMMENT ON FUNCTION public.conciliacao_items_iam_pendente_guard() IS
  'Impede item iam_pendente para aluno com iam_gc_conciliado_at preenchido (corrida entre reload do front e aprovação).';
