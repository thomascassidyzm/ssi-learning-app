-- ============================================================================
-- RLS Phase 1: Payment + Teacher Offer tables
-- ============================================================================
-- Re-establishes Row Level Security on the four tables that touch real money
-- and personal payout data:
--
--   teachers             — display name, country, Wise payout recipient ID
--   teacher_referrals    — who's been referred to which class, locked prices
--   teacher_commissions  — monthly accrued earnings + payout state
--   subscriptions        — already RLS'd; we add an admin-can-see-all SELECT
--
-- These tables had NO RLS as of 2026-04-29 because of the global disable in
-- 20260326100000_disable_all_rls.sql. With staging payment testing live, anon
-- key holders could read every teacher's email + balance. This migration
-- locks that down.
--
-- Service-role calls (Paddle webhooks, Wise payout job, dashboard scripts,
-- course-builder API) BYPASS RLS automatically — they continue to work as
-- before. Only anonymous browser sessions and authenticated regular users
-- see any change.
--
-- Rollback: at bottom of this file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper: is_ssi_admin()
-- ----------------------------------------------------------------------------
-- Returns TRUE when the calling user is an SSi admin (platform_role='ssi_admin'
-- in the learners table). Used in admin-bypass policies. SECURITY DEFINER so
-- it can read the learners table even when learners RLS lands in a later phase.
CREATE OR REPLACE FUNCTION public.is_ssi_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.jwt()->>'sub')
    AND platform_role = 'ssi_admin'
  );
$$;

COMMENT ON FUNCTION public.is_ssi_admin() IS
  'TRUE if the JWT-bearing user is an SSi admin (learners.platform_role=ssi_admin). Used in RLS policies for admin override.';

-- ----------------------------------------------------------------------------
-- 1. teachers
-- ----------------------------------------------------------------------------
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teachers_select_own_or_admin"
  ON public.teachers FOR SELECT
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.jwt()->>'sub'))
    OR public.is_ssi_admin()
  );

CREATE POLICY "teachers_insert_own"
  ON public.teachers FOR INSERT
  WITH CHECK (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.jwt()->>'sub'))
  );

CREATE POLICY "teachers_update_own_or_admin"
  ON public.teachers FOR UPDATE
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.jwt()->>'sub'))
    OR public.is_ssi_admin()
  );

-- DELETE deliberately omitted — teachers are not deleted from the client.
-- Lifecycle (cancel) flips referral_active flag instead.

-- ----------------------------------------------------------------------------
-- 2. teacher_referrals
-- ----------------------------------------------------------------------------
ALTER TABLE public.teacher_referrals ENABLE ROW LEVEL SECURITY;

-- A teacher can see referrals into their own classes. classes.teacher_user_id
-- is the auth user_id of the class's teacher (one hop, not via teachers.id).
CREATE POLICY "teacher_referrals_select_own_or_admin"
  ON public.teacher_referrals FOR SELECT
  USING (
    class_id IN (
      SELECT id FROM public.classes
      WHERE teacher_user_id = (auth.jwt()->>'sub')
    )
    OR public.is_ssi_admin()
  );

-- INSERT/UPDATE deliberately not given to authenticated users. Referrals are
-- created by webhook + signup-link handlers (service role).

-- ----------------------------------------------------------------------------
-- 3. teacher_commissions
-- ----------------------------------------------------------------------------
ALTER TABLE public.teacher_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_commissions_select_own_or_admin"
  ON public.teacher_commissions FOR SELECT
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t
      JOIN public.learners l ON l.id = t.learner_id
      WHERE l.user_id = (auth.jwt()->>'sub')
    )
    OR public.is_ssi_admin()
  );

-- INSERT/UPDATE: webhook-driven (service role).

-- ----------------------------------------------------------------------------
-- 4. subscriptions — add admin SELECT policy on top of existing own-row policy
-- ----------------------------------------------------------------------------
-- The existing policies (created in 20260418_subscriptions.sql) already allow
-- own-row SELECT and INSERT. We add an admin SELECT so support can debug.
CREATE POLICY "subscriptions_admin_select"
  ON public.subscriptions FOR SELECT
  USING (public.is_ssi_admin());

-- ----------------------------------------------------------------------------
-- 5. Reload PostgREST so the policy changes take effect immediately
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.teachers DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.teacher_referrals DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.teacher_commissions DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "teachers_select_own_or_admin" ON public.teachers;
-- DROP POLICY IF EXISTS "teachers_insert_own" ON public.teachers;
-- DROP POLICY IF EXISTS "teachers_update_own_or_admin" ON public.teachers;
-- DROP POLICY IF EXISTS "teacher_referrals_select_own_or_admin" ON public.teacher_referrals;
-- DROP POLICY IF EXISTS "teacher_commissions_select_own_or_admin" ON public.teacher_commissions;
-- DROP POLICY IF EXISTS "subscriptions_admin_select" ON public.subscriptions;
-- DROP FUNCTION IF EXISTS public.is_ssi_admin();
-- NOTIFY pgrst, 'reload schema';
