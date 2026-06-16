-- ============================================================================
-- Make the admin-dashboard READ tier coherent at the ssi_admin level.
--
-- Two silent-failure root causes behind the all-zeros admin user cards (a
-- second cause beyond the brief's "boutique tables aren't filled"):
--
--   (A) Several "God users can read all X" admin-read policies gate on
--       is_god_user() while others (player_events) gate on is_ssi_admin(). On
--       the SAME admin page a pure ssi_admin could read one table and silently
--       get [] from another. Now that is_ssi_admin() includes god
--       (20260616_is_ssi_admin_includes_god), align every learner-data admin
--       read to is_ssi_admin() so the whole dashboard is reachable at the
--       ssi_admin tier (god still passes, since god implies ssi_admin).
--
--   (B) learner_lego_metrics / learner_l1_state / learner_speaking_opportunities
--       have ONLY own-row read policies and NO admin read gate. An admin reading
--       another learner's rows hits RLS and gets [] — even when the data exists.
--       Add an is_ssi_admin() admin read policy to each (mirrors the existing
--       admin reads on course_enrollments / sessions / seed_progress).
--
-- Scope note: schools/classes "God users can read all" policies are LEFT as-is
-- (schools-domain RLS is deliberately permissive/in-flux per CLAUDE.md until the
-- first paying school; god still reads them, and the user-management dashboard
-- doesn't depend on all-schools reads). This migration touches learner-data
-- admin reads only.
-- ============================================================================

-- (A) Re-gate the learner-data admin reads from is_god_user() -> is_ssi_admin().
-- DROP the old "God users..." names and recreate as "Admins..." for clarity.

-- course_enrollments (was 20260305_admin_dashboard_rls.sql)
DROP POLICY IF EXISTS "God users can read all course_enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Admins can read all course_enrollments"    ON course_enrollments;
CREATE POLICY "Admins can read all course_enrollments"
  ON course_enrollments FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- learners (was 20260226_rls_entitlements_fix.sql)
DROP POLICY IF EXISTS "God users can read all learners" ON learners;
DROP POLICY IF EXISTS "Admins can read all learners"    ON learners;
CREATE POLICY "Admins can read all learners"
  ON learners FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- sessions
DROP POLICY IF EXISTS "God users can read all sessions" ON sessions;
DROP POLICY IF EXISTS "Admins can read all sessions"    ON sessions;
CREATE POLICY "Admins can read all sessions"
  ON sessions FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- seed_progress
DROP POLICY IF EXISTS "God users can read all seed_progress" ON seed_progress;
DROP POLICY IF EXISTS "Admins can read all seed_progress"    ON seed_progress;
CREATE POLICY "Admins can read all seed_progress"
  ON seed_progress FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- lego_progress
DROP POLICY IF EXISTS "God users can read all lego_progress" ON lego_progress;
DROP POLICY IF EXISTS "Admins can read all lego_progress"    ON lego_progress;
CREATE POLICY "Admins can read all lego_progress"
  ON lego_progress FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- (B) Add the MISSING admin read gates on the three learner telemetry tables.

-- learner_lego_metrics (VAD-fed mastery; brief keeps this for the Mastered tile)
DROP POLICY IF EXISTS "Admins can read all learner_lego_metrics" ON learner_lego_metrics;
CREATE POLICY "Admins can read all learner_lego_metrics"
  ON learner_lego_metrics FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- learner_l1_state (Layer-1 listening fires)
DROP POLICY IF EXISTS "Admins can read all learner_l1_state" ON learner_l1_state;
CREATE POLICY "Admins can read all learner_l1_state"
  ON learner_l1_state FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

-- learner_speaking_opportunities (canonical practice-minutes / active-days source)
DROP POLICY IF EXISTS "Admins can read all learner_speaking_opportunities" ON learner_speaking_opportunities;
CREATE POLICY "Admins can read all learner_speaking_opportunities"
  ON learner_speaking_opportunities FOR SELECT TO authenticated
  USING (public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';
