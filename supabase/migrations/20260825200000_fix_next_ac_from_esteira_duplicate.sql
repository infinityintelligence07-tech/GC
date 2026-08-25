-- Remove overload antigo (5 params); mantém versão com p_name (6 params, default NULL).
-- Corrige erro "function public.next_ac_from_esteira(...) is not unique" na sync IAM.

DROP FUNCTION IF EXISTS public.next_ac_from_esteira(uuid, text, text, text, uuid);
