-- Kamino sync setup
CREATE OR REPLACE FUNCTION public.gc_student_key(n text, p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(coalesce(n, ''))) || '||' || lower(trim(coalesce(p, '')))
$$;

CREATE TABLE IF NOT EXISTS public._kamino_sync_staging (
  skey text PRIMARY KEY,
  name text,
  whatsapp text,
  email text,
  ac text,
  product text,
  enrollment_date date,
  data_treinamento_origem date,
  due_day int,
  sale_value numeric,
  down_payment numeric,
  total_installments int,
  paid_installments int,
  installment_value numeric,
  installments jsonb,
  detalhes text,
  status text
);

CREATE OR REPLACE FUNCTION public.run_kamino_sync_from_staging()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_protected uuid[];
  v_deleted int;
  v_inserted int;
  v_updated int;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE active = true
  ORDER BY CASE WHEN name ILIKE '%iam%' THEN 0 ELSE 1 END, name LIMIT 1;

  CREATE TEMP TABLE matched_ids (id uuid PRIMARY KEY) ON COMMIT DROP;

  SELECT coalesce(array_agg(DISTINCT student_id), ARRAY[]::uuid[])
  INTO v_protected FROM public.cancellation_cases WHERE student_id IS NOT NULL;

  INSERT INTO matched_ids (id)
  SELECT s.id FROM public.students s
  JOIN public._kamino_sync_staging k ON public.gc_student_key(s.name, s.product) = k.skey
  ON CONFLICT DO NOTHING;

  UPDATE public.students s SET
    whatsapp = coalesce(nullif(k.whatsapp, ''), s.whatsapp, ''),
    email = coalesce(k.email, s.email),
    ac = coalesce(nullif(trim(s.ac), ''), k.ac, ''),
    sale_value = k.sale_value, down_payment = k.down_payment,
    total_installments = k.total_installments, paid_installments = k.paid_installments,
    installment_value = k.installment_value, installments = k.installments,
    due_day = k.due_day, detalhes = k.detalhes,
    enrollment_date = CASE WHEN s.id = ANY(v_protected) THEN s.enrollment_date ELSE k.enrollment_date END,
    data_treinamento_origem = CASE WHEN s.id = ANY(v_protected) THEN s.data_treinamento_origem ELSE k.data_treinamento_origem END,
    name = CASE WHEN s.id = ANY(v_protected) THEN s.name ELSE k.name END,
    product = CASE WHEN s.id = ANY(v_protected) THEN s.product ELSE k.product END,
    status = CASE WHEN s.id = ANY(v_protected) THEN s.status ELSE k.status END,
    updated_at = now()
  FROM public._kamino_sync_staging k
  WHERE public.gc_student_key(s.name, s.product) = k.skey;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO matched_ids (id)
  SELECT s.id FROM public.students s
  JOIN public._kamino_sync_staging k ON lower(trim(s.name)) = lower(trim(k.name))
  WHERE (SELECT count(*) FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name))) = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.students s3
      WHERE public.gc_student_key(s3.name, s3.product) = k.skey AND s3.id <> s.id
    )
  ON CONFLICT DO NOTHING;

  UPDATE public.students s SET
    whatsapp = coalesce(nullif(k.whatsapp, ''), s.whatsapp, ''),
    email = coalesce(k.email, s.email),
    ac = coalesce(nullif(trim(s.ac), ''), k.ac, ''),
    sale_value = k.sale_value, down_payment = k.down_payment,
    total_installments = k.total_installments, paid_installments = k.paid_installments,
    installment_value = k.installment_value, installments = k.installments,
    due_day = k.due_day, detalhes = k.detalhes,
    enrollment_date = CASE WHEN s.id = ANY(v_protected) THEN s.enrollment_date ELSE k.enrollment_date END,
    data_treinamento_origem = CASE WHEN s.id = ANY(v_protected) THEN s.data_treinamento_origem ELSE k.data_treinamento_origem END,
    name = CASE WHEN s.id = ANY(v_protected) THEN s.name ELSE k.name END,
    product = CASE WHEN s.id = ANY(v_protected) THEN s.product ELSE k.product END,
    status = CASE WHEN s.id = ANY(v_protected) THEN s.status ELSE k.status END,
    updated_at = now()
  FROM public._kamino_sync_staging k
  WHERE lower(trim(s.name)) = lower(trim(k.name))
    AND (SELECT count(*) FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name))) = 1
    AND s.id IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) <> k.skey;

  INSERT INTO public.students (
    id, company_id, name, whatsapp, email, cpf, address, numero, cidade, estado, cep,
    status, status_mode, ac, product, enrollment_date, data_treinamento_origem,
    due_day, sale_value, down_payment, total_installments, paid_installments,
    installment_value, installments, history, tags, detalhes
  )
  SELECT gen_random_uuid(), v_company, k.name, coalesce(k.whatsapp, ''), k.email,
    '', '', '', '', '', '', k.status, 'Automático', coalesce(k.ac, ''), k.product,
    k.enrollment_date, k.data_treinamento_origem, k.due_day,
    k.sale_value, k.down_payment, k.total_installments, k.paid_installments,
    k.installment_value, k.installments, '[]'::jsonb, '[]'::jsonb, k.detalhes
  FROM public._kamino_sync_staging k
  WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE public.gc_student_key(s.name, s.product) = k.skey)
    AND NOT EXISTS (
      SELECT 1 FROM public.students s WHERE lower(trim(s.name)) = lower(trim(k.name))
        AND (SELECT count(*) FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name))) = 1
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.students s SET
    sale_value = k.sale_value, down_payment = k.down_payment,
    total_installments = k.total_installments, paid_installments = k.paid_installments,
    installment_value = k.installment_value, installments = k.installments,
    due_day = k.due_day, detalhes = k.detalhes,
    whatsapp = coalesce(nullif(k.whatsapp, ''), s.whatsapp, ''),
    email = coalesce(k.email, s.email),
    ac = coalesce(nullif(trim(s.ac), ''), k.ac, ''),
    updated_at = now()
  FROM public._kamino_sync_staging k
  WHERE s.id = ANY(v_protected)
    AND public.gc_student_key(s.name, s.product) = k.skey
    AND s.id NOT IN (SELECT id FROM matched_ids);

  DELETE FROM public.conciliacao_import_errors e USING public.students s
  WHERE e.student_id = s.id AND NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);

  DELETE FROM public.conciliacao_items i USING public.students s
  WHERE i.student_id = s.id AND NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);

  DELETE FROM public.antecipacao_items a USING public.students s
  WHERE a.student_id = s.id AND NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);

  DELETE FROM public.students s
  WHERE NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.cancellation_cases cc SET
    ac = coalesce(nullif(trim(cc.ac), ''), s.ac),
    student_name = coalesce(s.name, cc.student_name),
    updated_at = now()
  FROM public.students s WHERE cc.student_id = s.id;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'inserted', v_inserted,
    'deleted', v_deleted,
    'students_final', (SELECT count(*) FROM public.students),
    'cancel_cases', (SELECT count(*) FROM public.cancellation_cases),
    'staging', (SELECT count(*) FROM public._kamino_sync_staging)
  );
END;
$$;
