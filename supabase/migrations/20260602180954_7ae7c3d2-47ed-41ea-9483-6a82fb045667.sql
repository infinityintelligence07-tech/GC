-- Revoke execute on internal SECURITY DEFINER helpers from anon/public.
-- These functions are only meant to be called from RLS policies of authenticated users.
REVOKE EXECUTE ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_company_access(uuid, uuid) FROM PUBLIC, anon;

-- Tighten storage.objects policy on company-logos bucket:
-- Files remain publicly readable via their public URL (that's how public buckets work),
-- but we drop the broad SELECT policy so anonymous clients can no longer LIST all files in the bucket.
DROP POLICY IF EXISTS "company logos public read" ON storage.objects;