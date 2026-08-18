ALTER TABLE public.app_users
ALTER COLUMN permissions SET DEFAULT '{}'::jsonb;

UPDATE public.app_users
SET permissions = '{}'::jsonb
WHERE permissions IS NULL;

NOTIFY pgrst, 'reload schema';