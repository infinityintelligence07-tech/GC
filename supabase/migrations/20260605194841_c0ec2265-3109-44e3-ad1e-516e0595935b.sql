-- Restrict notifications INSERT: users can only create notifications for themselves
-- or addressed to their own AC, unless they are admin (server-side via service_role bypasses RLS).
DROP POLICY IF EXISTS notifications_insert_auth ON public.notifications;

CREATE POLICY notifications_insert_scoped
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (user_id IS NOT NULL AND user_id = auth.uid())
  OR (ac_id IS NOT NULL AND ac_id = current_ac_id())
);