-- Harden the two SECURITY DEFINER role-check functions by pinning search_path.
--
-- Why: without SET search_path, a SECURITY DEFINER function looks up unqualified
-- objects via the caller's search_path. A caller who can create a table named
-- `learners` in a schema earlier in their search_path can intercept the lookup
-- and force the function to return true. Pinning search_path closes that.
--
-- Bodies are unchanged from 20260512_unify_user_id_auth_pattern.sql.

CREATE OR REPLACE FUNCTION is_god_user() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM learners
    WHERE user_id = (SELECT auth.uid()::text)
    AND educational_role = 'god'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_ssi_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.uid()::text)
    AND platform_role = 'ssi_admin'
  );
$$;

NOTIFY pgrst, 'reload schema';
