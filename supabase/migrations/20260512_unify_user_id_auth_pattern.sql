-- Unify auth patterns to auth.uid()::text everywhere.
--
-- Background: 20251219120000_clerk_auth_integration.sql changed learners.user_id
-- from UUID to TEXT to accommodate Clerk-style string IDs. Clerk was never
-- actually shipped — auth is Supabase — but user_id (and several sibling
-- columns) stayed TEXT, and policies authored during the Clerk window used
-- auth.jwt()->>'sub' instead of auth.uid().
--
-- Today there are three patterns in the database:
--   1. auth.uid() = user_id           — breaks (uuid = text)
--   2. auth.uid()::text = user_id     — canonical, works
--   3. (auth.jwt()->>'sub') = user_id — Clerk-era artefact, works incidentally
--
-- Patterns 2 and 3 evaluate to the same string under Supabase Auth today, but
-- they could diverge under impersonation or future JWT-claims work. This
-- migration converts every direct use of pattern 3 to pattern 2.
--
-- Policies that only call is_god_user() / is_ssi_admin() don't need recreating —
-- the function bodies are CREATE OR REPLACE'd in place.

-- ============================================
-- Helper functions
-- ============================================

CREATE OR REPLACE FUNCTION is_god_user() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM learners
    WHERE user_id = (SELECT auth.uid()::text)
    AND educational_role = 'god'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_ssi_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.uid()::text)
    AND platform_role = 'ssi_admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================
-- class_sessions: teacher write policy
-- ============================================

DROP POLICY IF EXISTS "Teachers can write own class_sessions" ON class_sessions;
CREATE POLICY "Teachers can write own class_sessions"
  ON class_sessions FOR ALL TO authenticated
  USING (teacher_user_id = (SELECT auth.uid()::text))
  WITH CHECK (teacher_user_id = (SELECT auth.uid()::text));

-- ============================================
-- learner_points
-- ============================================

DROP POLICY IF EXISTS "Users can view own points" ON learner_points;
CREATE POLICY "Users can view own points"
  ON learner_points FOR SELECT TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.uid()::text)
  ));

DROP POLICY IF EXISTS "Users can insert own points" ON learner_points;
CREATE POLICY "Users can insert own points"
  ON learner_points FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.uid()::text)
  ));

DROP POLICY IF EXISTS "Users can update own points" ON learner_points;
CREATE POLICY "Users can update own points"
  ON learner_points FOR UPDATE TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.uid()::text)
  ));

-- ============================================
-- learner_milestones
-- ============================================

DROP POLICY IF EXISTS "Users can view own milestones" ON learner_milestones;
CREATE POLICY "Users can view own milestones"
  ON learner_milestones FOR SELECT TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.uid()::text)
  ));

DROP POLICY IF EXISTS "Users can insert own milestones" ON learner_milestones;
CREATE POLICY "Users can insert own milestones"
  ON learner_milestones FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.uid()::text)
  ));

-- ============================================
-- audio_plays: read own (guarded — table may not exist in older envs)
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audio_plays') THEN
    DROP POLICY IF EXISTS "Users can read own audio plays" ON audio_plays;
    EXECUTE 'CREATE POLICY "Users can read own audio plays"
      ON audio_plays FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.uid()::text))';
  END IF;
END $$;

-- ============================================
-- teachers (referral system)
-- ============================================

DROP POLICY IF EXISTS "teachers_select_own_or_admin" ON public.teachers;
CREATE POLICY "teachers_select_own_or_admin"
  ON public.teachers FOR SELECT
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.uid()::text))
    OR public.is_ssi_admin()
  );

DROP POLICY IF EXISTS "teachers_insert_own" ON public.teachers;
CREATE POLICY "teachers_insert_own"
  ON public.teachers FOR INSERT
  WITH CHECK (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.uid()::text))
  );

DROP POLICY IF EXISTS "teachers_update_own_or_admin" ON public.teachers;
CREATE POLICY "teachers_update_own_or_admin"
  ON public.teachers FOR UPDATE
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (auth.uid()::text))
    OR public.is_ssi_admin()
  );

-- ============================================
-- teacher_referrals
-- ============================================

DROP POLICY IF EXISTS "teacher_referrals_select_own_or_admin" ON public.teacher_referrals;
CREATE POLICY "teacher_referrals_select_own_or_admin"
  ON public.teacher_referrals FOR SELECT
  USING (
    class_id IN (
      SELECT id FROM public.classes
      WHERE teacher_user_id = (auth.uid()::text)
    )
    OR public.is_ssi_admin()
  );

-- ============================================
-- teacher_commissions
-- ============================================

DROP POLICY IF EXISTS "teacher_commissions_select_own_or_admin" ON public.teacher_commissions;
CREATE POLICY "teacher_commissions_select_own_or_admin"
  ON public.teacher_commissions FOR SELECT
  USING (
    teacher_id IN (
      SELECT t.id FROM public.teachers t
      JOIN public.learners l ON l.id = t.learner_id
      WHERE l.user_id = (auth.uid()::text)
    )
    OR public.is_ssi_admin()
  );

-- ============================================
-- Reload PostgREST so policy changes take effect immediately
-- ============================================

NOTIFY pgrst, 'reload schema';
