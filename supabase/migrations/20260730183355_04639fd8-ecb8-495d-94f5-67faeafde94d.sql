
INSERT INTO public.app_users (name, login, role, permissions, auth_user_id, company_id)
SELECT 'Infinity', 'Infinity', 'admin',
  '{"admin":"edit","alunos":"edit","cancelamentos":"edit","comissoes":"edit","conciliacao":"edit","config":"edit","dashboard":"edit","equipe":"edit","estornos":"edit","rendaExtra":"edit","registros":"edit","_canConfirmarPagamento":true}'::jsonb,
  '09b2189a-9cc2-45be-9bf1-05f32b45d974', '00000000-0000-0000-0000-0000000a1a11'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_users au WHERE au.auth_user_id = '09b2189a-9cc2-45be-9bf1-05f32b45d974'
);

INSERT INTO public.user_companies (user_id, company_id)
SELECT '09b2189a-9cc2-45be-9bf1-05f32b45d974', c.id FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id='09b2189a-9cc2-45be-9bf1-05f32b45d974' AND uc.company_id=c.id);

INSERT INTO public.user_roles (user_id, role)
SELECT '09b2189a-9cc2-45be-9bf1-05f32b45d974', 'admin'::public.app_role
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id='09b2189a-9cc2-45be-9bf1-05f32b45d974' AND ur.role='admin');

INSERT INTO public.user_active_company (user_id, company_id)
VALUES ('09b2189a-9cc2-45be-9bf1-05f32b45d974', '00000000-0000-0000-0000-0000000a1a11')
ON CONFLICT (user_id) DO UPDATE SET company_id = EXCLUDED.company_id;
