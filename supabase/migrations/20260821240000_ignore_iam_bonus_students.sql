-- Não importar alunos bônus do IAM Control (réplicas de inscrição).

CREATE OR REPLACE FUNCTION public.iam_name_is_bonus(p_nome text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    regexp_replace(
      translate(lower(btrim(coalesce(p_nome, ''))), 'áàâãäéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaeeeeiiiiooooouuuucnyy'),
      '[^a-z0-9]',
      '',
      'g'
    ),
    ''
  ) LIKE '%bonus%';
$$;

COMMENT ON FUNCTION public.iam_name_is_bonus(text) IS
  'True quando o nome indica réplica de inscrição bônus (ex.: "NOME (bônus 1)").';

CREATE OR REPLACE FUNCTION public.iam_control_upsert_student(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
    v_iam_id       bigint  := nullif(p->>'iam_control_aluno_id', '')::bigint;
    v_nome         text    := btrim(coalesce(p->>'nome', ''));
    v_email        text    := coalesce(p->>'email', '');
    v_whatsapp     text    := coalesce(p->>'whatsapp', '');
    v_cpf          text    := coalesce(p->>'cpf', '');
    v_cpf_digits   text    := regexp_replace(v_cpf, '[^0-9]', '', 'g');
    v_end          jsonb   := coalesce(p->'endereco', '{}'::jsonb);
    v_fin          jsonb   := coalesce(p->'financeiro', '{}'::jsonb);
    v_matricula    jsonb;
    v_produto      text    := '';
    v_data_matric  text    := '';
    v_sale_value   numeric := coalesce(nullif(v_fin->>'valor_total_contratado', '')::numeric, 0);
    v_student_id   uuid;
    v_matched_by   text    := null;
    v_empatados    int     := 0;
    v_acao         text;
    v_company_id   uuid    := coalesce(
        public.current_company_id(),
        '00000000-0000-0000-0000-0000000a1a11'::uuid
    );
    v_tem_matricula_nao_bonus boolean := false;
begin
    if v_nome = '' then
        return jsonb_build_object('acao', 'ignorado', 'motivo', 'nome vazio', 'iam_control_aluno_id', v_iam_id);
    end if;

    if public.iam_name_is_bonus(v_nome) then
        return jsonb_build_object(
            'acao', 'ignorado',
            'motivo', 'aluno bonus',
            'iam_control_aluno_id', v_iam_id
        );
    end if;

    select exists (
        select 1
        from jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
        where coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
    ) into v_tem_matricula_nao_bonus;

    if jsonb_array_length(coalesce(p->'matriculas', '[]'::jsonb)) > 0
       and not v_tem_matricula_nao_bonus then
        return jsonb_build_object(
            'acao', 'ignorado',
            'motivo', 'somente matriculas bonus',
            'iam_control_aluno_id', v_iam_id
        );
    end if;

    select m into v_matricula
    from jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    where coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
    order by (m->>'data_matricula') desc nulls last
    limit 1;

    if v_matricula is not null then
        v_data_matric := coalesce(left(v_matricula->>'data_matricula', 10), '');
        select coalesce(t->>'nome', '') into v_produto
        from jsonb_array_elements(coalesce(v_matricula->'treinamentos', '[]'::jsonb)) t
        limit 1;
    end if;
    v_produto := coalesce(v_produto, '');

    if v_iam_id is not null then
        select s.id into v_student_id
        from public.students s
        where s.iam_control_aluno_id = v_iam_id
          and s.company_id = v_company_id
        limit 1;

        if v_student_id is not null then
            v_matched_by := 'id';
        end if;
    end if;

    if v_student_id is null and length(v_cpf_digits) >= 11 and v_produto <> '' then
        select s.id into v_student_id
        from public.students s
        where s.company_id = v_company_id
          and s.cpf_digits = v_cpf_digits
          and lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
        order by s.created_at asc nulls last
        limit 1;

        if v_student_id is not null then
            v_matched_by := 'cpf_produto';
        end if;
    end if;

    if v_student_id is null then
        select r.id, r.empatados
        into v_student_id, v_empatados
        from (
            select c.id,
                   c.pontos,
                   count(*) over (partition by c.pontos) as empatados
            from (
                select s.id,
                       (case when public.iam_normalize_phone(v_whatsapp) <> ''
                              and public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp)
                             then 2 else 0 end)
                     + (case when public.iam_normalize_email(v_email) <> ''
                              and public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email)
                             then 2 else 0 end)
                     + (case when public.iam_normalize_name(v_nome) <> ''
                              and public.iam_normalize_name(s.name) = public.iam_normalize_name(v_nome)
                             then 1 else 0 end) as pontos
                from public.students s
                where s.company_id = v_company_id
                  and s.iam_control_aluno_id is null
                  and (
                      (public.iam_normalize_phone(v_whatsapp) <> ''
                       and public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp))
                   or (public.iam_normalize_email(v_email) <> ''
                       and public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email))
                  )
                  and (
                    v_produto = ''
                    or lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
                  )
            ) c
            where c.pontos >= 3
        ) r
        order by r.pontos desc
        limit 1;

        if v_student_id is not null then
            if v_empatados > 1 then
                return jsonb_build_object(
                    'acao', 'ambiguo',
                    'iam_control_aluno_id', v_iam_id,
                    'motivo', v_empatados || ' cadastros conferem com os mesmos dados'
                );
            end if;
            v_matched_by := 'identidade';
        end if;
    end if;

    if v_student_id is not null then
        update public.students s set
            iam_control_aluno_id    = coalesce(v_iam_id, s.iam_control_aluno_id),
            iam_control_synced_at   = now(),
            name                    = v_nome,
            email                   = coalesce(nullif(v_email, ''), s.email),
            whatsapp                = coalesce(nullif(v_whatsapp, ''), s.whatsapp),
            cpf                     = coalesce(nullif(v_cpf, ''), s.cpf),
            address                 = coalesce(nullif(v_end->>'logradouro', ''), s.address),
            numero                  = coalesce(nullif(v_end->>'numero', ''), s.numero),
            cidade                  = coalesce(nullif(v_end->>'cidade', ''), s.cidade),
            estado                  = coalesce(nullif(v_end->>'estado', ''), s.estado),
            cep                     = coalesce(nullif(v_end->>'cep', ''), s.cep),
            product                 = coalesce(nullif(s.product, ''), v_produto),
            enrollment_date         = coalesce(nullif(s.enrollment_date, ''), v_data_matric),
            data_treinamento_origem = coalesce(nullif(s.data_treinamento_origem, ''), nullif(v_data_matric, '')),
            sale_value              = case when coalesce(s.sale_value, 0) = 0 then v_sale_value else s.sale_value end
        where s.id = v_student_id;

        v_acao := 'atualizado';
    else
        insert into public.students (
            company_id,
            iam_control_aluno_id, iam_control_synced_at,
            name, email, whatsapp, cpf,
            address, numero, cidade, estado, cep,
            product, enrollment_date, data_treinamento_origem, sale_value
        ) values (
            v_company_id,
            v_iam_id, now(),
            v_nome, nullif(v_email, ''), v_whatsapp, v_cpf,
            coalesce(v_end->>'logradouro', ''), coalesce(v_end->>'numero', ''),
            coalesce(v_end->>'cidade', ''), coalesce(v_end->>'estado', ''), coalesce(v_end->>'cep', ''),
            v_produto, v_data_matric, nullif(v_data_matric, ''), v_sale_value
        )
        returning id into v_student_id;

        v_acao := 'criado';
        v_matched_by := 'novo';
    end if;

    return jsonb_build_object(
        'acao', v_acao,
        'student_id', v_student_id,
        'iam_control_aluno_id', v_iam_id,
        'casado_por', v_matched_by
    );
end;
$function$;

-- Remove fichas bônus já importadas do IAM (sem vínculo financeiro real).
DELETE FROM public.cancellation_cases cc
WHERE cc.student_id IN (
  SELECT s.id
  FROM public.students s
  WHERE public.iam_name_is_bonus(s.name)
);

DELETE FROM public.students s
WHERE public.iam_name_is_bonus(s.name);
