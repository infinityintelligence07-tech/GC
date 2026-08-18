-- 1) Remove a política RESTRICTIVE que bloqueia o usuário de ler a própria linha quando troca de empresa
DROP POLICY IF EXISTS app_users_company_isolation ON public.app_users;

-- Recria como RESTRICTIVE mas com bypass para o próprio registro e admin
CREATE POLICY app_users_company_isolation
ON public.app_users
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR company_id = current_company_id()
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR company_id = current_company_id()
);

-- 2) Limpa active company órfão (usuário aponta pra empresa que não tem acesso)
DELETE FROM public.user_active_company uac
WHERE NOT public.has_company_access(uac.user_id, uac.company_id);
