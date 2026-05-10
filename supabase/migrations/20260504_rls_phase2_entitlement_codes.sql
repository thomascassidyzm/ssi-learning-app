-- ============================================================================
-- RLS Phase 2: entitlement_codes
-- ============================================================================
-- Locks down the redemption-codes table. Codes carry course access AND can
-- grant platform_role (potentially ssi_admin) — credentials-equivalent data.
-- Currently readable by anyone holding the anon key.
--
-- Policy: SELECT for admins only.
-- INSERT/UPDATE/DELETE: handled by service-role admin tools and the redemption
-- API endpoint (which validates a posted code string server-side rather than
-- letting the client query the table). RLS denies these for anon/authenticated
-- automatically since no policies are defined for those operations.
--
-- Depends on the is_ssi_admin() helper added in Phase 1.
--
-- Rollback: at bottom.
-- ============================================================================

ALTER TABLE public.entitlement_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entitlement_codes_admin_select"
  ON public.entitlement_codes FOR SELECT
  USING (public.is_ssi_admin());

-- Reload PostgREST so the policy takes effect immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.entitlement_codes DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "entitlement_codes_admin_select" ON public.entitlement_codes;
-- NOTIFY pgrst, 'reload schema';
