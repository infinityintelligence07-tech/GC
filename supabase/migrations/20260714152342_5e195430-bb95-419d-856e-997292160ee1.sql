UPDATE public.students
SET status = 'Negativado',
    status_mode = 'Manual',
    history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Correção automática: status restaurado para "Negativado" (reverso indevido detectado após ajuste do sistema).'
    ))
WHERE id = '086203c6-cad3-4e80-94b8-7c2c8b8d1ab2';