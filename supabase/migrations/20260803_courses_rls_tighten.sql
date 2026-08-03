-- COURSES RLS TIGHTEN — discoverable-or-enrolled, replacing a blanket USING (true)
-- Founder ruling (Tom, 2026-08-03): ordinary authenticated users must read only the
-- courses the product considers discoverable. Flagged as an over-grant by the
-- 2026-08-02 RLS performance sweep (see 20260801c §4, which recorded the finding
-- and explicitly deferred the security decision to a separate deliberate change).
--
-- ⚠ 20260801c IS NOT APPLIED LIVE (verified 2026-08-03 against project
--   swfvymspfxmnfhevgdkg: public.classes still carries its pre-20260801c policy set).
--   This migration is therefore written against the LIVE policy set, not against
--   20260801c's post-state. If 20260801c is ever applied later, its §4 must be
--   skipped — applying it as written would re-widen courses to USING (true).
--
------------------------------------------------------------------------------
-- BEFORE (live, 2026-08-03 — see secfix-toolkit/courses-rls-2026-08-03/
--         before_pg_policies_courses.json):
--   SEVEN permissive SELECT policies stack on public.courses. One of them,
--   `courses_select_public`, is USING (true) TO public, so the effective SELECT
--   predicate for anon AND authenticated is exactly TRUE — every course row,
--   including 57 unreleased drafts, is world-readable. The six status/visibility
--   -gated policies are strict subsets of true and contribute nothing.
--
-- AFTER: one SELECT policy, three disjuncts.
--
------------------------------------------------------------------------------
-- WHY THE DISCOVERABILITY LEG IS (visibility ∨ new_app_status), NOT visibility ALONE
--
-- Tom's ruling names `visibility` as the discoverability flag, and `beta` MEANS LIVE.
-- Both are honoured below. But `visibility` alone is NOT a safe gate today, and the
-- live data says so plainly: 46 courses carry visibility='hidden' while sitting at
-- new_app_status IN ('live','beta') — and those 46 hold 717 enrollments across 464
-- learners, 452 of them practised within the last 30 days (afr/ben/bul/cat/ces/dan/
-- ell/eng_for_{ben,guj,hin,kan,mar,pan,sin,tam,tel,urd}/…). They are the live
-- catalogue. The learner app has never read `visibility`: every catalogue query
-- filters on new_app_status IN ('live','beta') instead —
--   packages/player-vue/src/components/BrowseScreen.vue:237
--   packages/player-vue/src/components/CourseSelector.vue:373
--   packages/player-vue/src/App.vue:420
-- so `visibility` on those rows is simply stale, never maintained on the learner path.
-- Gating on it alone would delete 46 actively-practised courses from the production
-- browse screen — a product outage wearing a security fix's clothes.
--
-- The union of the two flags is the honest statement of "what the product serves
-- today". It excludes exactly 57 rows, every one of them draft/not_available:
--   hidden/draft/not_available  55 courses   (14 enrollments, all one SSi admin)
--   hidden/draft/draft           1 course    (fra_ca_for_eng — 7 enrollments, 5 real
--                                             learners: covered by the enrolled leg)
--   private/draft/not_available  1 course    (0 enrollments)
-- Nothing a learner can reach today stops being reachable.
--
-- If Tom wants `visibility` to become the SOLE gate, that is a content pass on the
-- 46 stale rows first (set visibility='public'/'beta' where the course is really
-- live), and dropping the second disjunct after. It is not a policy change.
------------------------------------------------------------------------------
--
-- Enrolled leg: course_enrollments.course_id holds the course_code (no FK; verified
-- 1503/1536 enrollment rows join cleanly to courses.course_code). The helper below
-- is SECURITY DEFINER so the policy does not re-enter RLS on course_enrollments and
-- learners (whose own SELECT policies call the row-dependent can_view_learner_data()).
-- It aggregates over ALL learner rows for the uid, so multi-learner-per-uid accounts
-- keep every enrolled course — the same fidelity 20260801c §6 preserved for
-- user_entitlements.
--
-- initplan (2026-08-02 sweep idiom, lint 0003): both function calls are written
-- `(select fn())` so they evaluate ONCE per query, not once per row. The two column
-- predicates are row-local and free. No new multiple-permissive-policies (lint 0006)
-- warning: seven SELECT policies become one, so this migration also clears the six
-- 0006 role×policy pairs 20260801c §4 was going to clear.
--
-- Rollback: secfix-toolkit/courses-rls-2026-08-03/rollback_20260803.sql
-- Canary:   secfix-toolkit/courses-rls-2026-08-03/canary_courses_rls.sql

BEGIN;

------------------------------------------------------------------------------
-- 1. Enrolled-course helper (SECURITY DEFINER, STABLE, pinned search_path).
--    Returns '{}' for anon (auth.uid() NULL) → the ANY() disjunct is FALSE.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_enrolled_course_codes()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(DISTINCT e.course_id), ARRAY[]::text[])
  FROM public.course_enrollments e
  JOIN public.learners l ON l.id = e.learner_id
  WHERE l.user_id = (auth.uid())::text
$$;

-- Popty dashboard staff. The dashboard browser client (ssi-dashboard-v7-clean
-- src/services/supabase.js:16) runs on the ANON key with a real Supabase auth
-- session, so its reads are role `authenticated` and DO hit this policy — and its
-- identity is the `dashboard_users` row keyed by email, NOT learners.platform_role.
-- Only 5 of the 18 dashboard users are also learners.platform_role='ssi_admin'
-- (verified live 2026-08-03), so is_ssi_admin() alone would blind the other 13 to
-- the 55 in-progress draft courses that are the dashboard's entire reason to exist
-- (src/services/supabase.js:95/116/494/517, src/views/ListeningConfig.vue:432,
--  src/views/JobsMonitor.vue:335, src/composables/useBuildMonitor.js:102).
-- This leg preserves exactly today's dashboard behaviour (all rows) and widens
-- nothing: dashboard_users is a staff table, 18 rows, admin-managed.
-- (dashboard_users.courses holds a per-user course scope — '*' or a list. Scoping
--  this leg by it would tighten further, but that scope is enforced in dashboard app
--  code today; making RLS the enforcer is a separate, deliberate change.)
CREATE OR REPLACE FUNCTION public.is_dashboard_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dashboard_users du
    WHERE lower(du.email) = lower(auth.jwt() ->> 'email')
  )
$$;

COMMENT ON FUNCTION public.is_dashboard_user() IS
  'True when the calling auth user''s JWT email matches a public.dashboard_users row '
  '(Popty content-dashboard staff). SECURITY DEFINER because dashboard_users RLS only '
  'lets a user read their OWN row. Used by the courses_select policy (2026-08-03).';

REVOKE ALL ON FUNCTION public.is_dashboard_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_dashboard_user() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.current_user_enrolled_course_codes() IS
  'Course codes the calling auth user is enrolled in, across all their learner rows. '
  'SECURITY DEFINER so RLS policies can use it without re-entering RLS on '
  'course_enrollments/learners. Used by the courses_select policy (2026-08-03).';

REVOKE ALL ON FUNCTION public.current_user_enrolled_course_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_enrolled_course_codes() TO anon, authenticated, service_role;

------------------------------------------------------------------------------
-- 2. Seven stacked SELECT policies → one.
------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anon can read courses"                        ON public.courses;
DROP POLICY IF EXISTS "Public users can view all courses"            ON public.courses;
DROP POLICY IF EXISTS "Public users can view visible courses"        ON public.courses;
DROP POLICY IF EXISTS "Authenticated users can view all courses"     ON public.courses;
DROP POLICY IF EXISTS "Authenticated users can view visible courses" ON public.courses;
DROP POLICY IF EXISTS courses_read_policy                            ON public.courses;
DROP POLICY IF EXISTS courses_select_public                          ON public.courses;

CREATE POLICY courses_select ON public.courses FOR SELECT TO anon, authenticated
  USING (
    -- discoverable: the visibility flag, plus the flag the learner app actually reads
    visibility = ANY (ARRAY['public'::text, 'beta'::text])
    OR new_app_status = ANY (ARRAY['live'::text, 'beta'::text])
    -- enrolled learners never lose access to a course they are progressing through
    -- the ::text[] cast is load-bearing: without it Postgres reads `= ANY (SELECT …)`
    -- as the subquery form and fails with `operator does not exist: text = text[]`.
    OR course_code = ANY ((select public.current_user_enrolled_course_codes())::text[])
    -- SSi admin UI (packages/player-vue admin views) runs on the authenticated key
    OR (select public.is_ssi_admin())
    -- Popty content dashboard staff — anon key + auth session, identity is dashboard_users
    OR (select public.is_dashboard_user())
  );

-- Unchanged and deliberately left in place:
--   courses_service_policy  ALL  TO service_role  USING (true)  — service role
--     bypasses RLS anyway; every Popty dashboard and learning-app API read of
--     courses goes through it.
--   courses_insert_admin / courses_update_admin / courses_delete_admin — writes
--     stay is_ssi_admin()-only; this migration touches SELECT only.

NOTIFY pgrst, 'reload schema';

COMMIT;
