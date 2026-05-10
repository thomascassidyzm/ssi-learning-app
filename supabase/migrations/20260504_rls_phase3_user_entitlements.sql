-- ============================================================================
-- RLS Phase 3: user_entitlements
-- ============================================================================
-- Locks down the table that records who has paid/redeemed for what course
-- access. 31 rows currently. Each row carries a learner_id, the courses they
-- were granted, and an expiry — leaks here would reveal which users are
-- subscribers and what they have access to.
--
-- Policies:
--   SELECT — own row (learner_id chains via learners.user_id) OR admin
--   INSERT/UPDATE/DELETE — service-role only (the redemption API + admin tools
--                          write here; users never insert client-side)
--
-- Depends on the is_ssi_admin() helper added in Phase 1.
--
-- Rollback: at bottom.
-- ============================================================================

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_entitlements_select_own_or_admin"
  ON public.user_entitlements FOR SELECT
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.jwt()->>'sub'))
    OR public.is_ssi_admin()
  );

-- Reload PostgREST so the policy takes effect immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.user_entitlements DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "user_entitlements_select_own_or_admin" ON public.user_entitlements;
-- NOTIFY pgrst, 'reload schema';
