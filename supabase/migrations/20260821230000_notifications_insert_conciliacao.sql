-- Permite que o setor de Conciliação (e admin) crie notificações para o AC
-- do assessor ao reprovar/aprovar ajustes. A política anterior só deixava
-- inserir para o próprio user_id / próprio ac_id, então a notificação de
-- "reprovado" falhava em silêncio e o assessor não recebia o aviso.

DROP POLICY IF EXISTS notifications_insert_scoped ON public.notifications;

CREATE POLICY notifications_insert_scoped
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'conciliacao'::public.app_role)
  OR (user_id IS NOT NULL AND user_id = auth.uid())
  OR (ac_id IS NOT NULL AND ac_id = public.current_ac_id())
);
