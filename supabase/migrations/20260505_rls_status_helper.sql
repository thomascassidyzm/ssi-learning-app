-- ============================================================================
-- rls_status() — reusable diagnostic helper
-- ============================================================================
-- Returns the RLS state of public-schema tables: whether RLS is enabled, how
-- many policies are attached, and a summary of each policy (name, command,
-- permissive/restrictive, roles).
--
-- Apply once. Then a service-role caller can introspect from any script:
--
--   supabase.rpc('rls_status', { table_names: ['listening_pods', 'shared_audio'] })
--   supabase.rpc('rls_status', {})    -- all public tables
--
-- SECURITY DEFINER so it can read pg_catalog regardless of caller. EXECUTE
-- granted to service_role only — anon and authenticated users can't introspect
-- the security model from the client.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rls_status(table_names text[] DEFAULT NULL)
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  force_rls boolean,
  num_policies integer,
  policies jsonb
)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls,
    COUNT(p.polname)::integer AS num_policies,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', p.polname,
          'cmd',  CASE p.polcmd
                    WHEN 'r' THEN 'SELECT'
                    WHEN 'a' THEN 'INSERT'
                    WHEN 'w' THEN 'UPDATE'
                    WHEN 'd' THEN 'DELETE'
                    WHEN '*' THEN 'ALL'
                  END,
          'permissive', p.polpermissive,
          'roles', (SELECT array_agg(rolname::text)
                    FROM pg_roles r
                    WHERE r.oid = ANY(p.polroles))
        ) ORDER BY p.polname
      ) FILTER (WHERE p.polname IS NOT NULL),
      '[]'::jsonb
    ) AS policies
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE c.relkind = 'r'
    AND c.relnamespace = 'public'::regnamespace
    AND (table_names IS NULL OR c.relname = ANY(table_names))
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
  ORDER BY c.relname;
$$;

COMMENT ON FUNCTION public.rls_status(text[]) IS
  'Returns RLS state + policy summary for each public-schema table. SECURITY DEFINER. Callable by service_role only.';

-- Lock down access — diagnostic only, not for client/anon use.
REVOKE ALL ON FUNCTION public.rls_status(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_status(text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_status(text[]) TO service_role;

NOTIFY pgrst, 'reload schema';
