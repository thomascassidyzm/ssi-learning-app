-- ============================================
-- RLS Entitlements Fix
-- ============================================
-- Replaces dangerous USING(true) god mode policies with
-- role-checked policies using invite-code-based entitlements.
-- Fixes broken auth.uid() policies for Clerk users.
-- Date: 2026-02-26

-- ============================================
-- 1a) Add 'god' to invite_codes.code_type
-- ============================================
ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check
  CHECK (code_type IN ('god', 'govt_admin', 'school_admin', 'teacher', 'student'));

-- ============================================
-- 1b) Add 'god' to learners.educational_role
-- ============================================
ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_educational_role_check;
ALTER TABLE learners ADD CONSTRAINT learners_educational_role_check
  CHECK (educational_role IN ('god', 'student', 'teacher', 'school_admin', 'govt_admin'));

-- ============================================
-- 2) Drop ALL god mode USING(true) policies
-- ============================================

-- From 20260120100001_god_mode_policies.sql
DROP POLICY IF EXISTS "Public read for god mode testing" ON learners;
DROP POLICY IF EXISTS "Public read schools for god mode" ON schools;
DROP POLICY IF EXISTS "Public read classes for god mode" ON classes;
DROP POLICY IF EXISTS "Public read user_tags for god mode" ON user_tags;
DROP POLICY IF EXISTS "Public read govt_admins for god mode" ON govt_admins;
DROP POLICY IF EXISTS "Public read sessions for god mode" ON sessions;
DROP POLICY IF EXISTS "Public read seed_progress for god mode" ON seed_progress;
DROP POLICY IF EXISTS "Public read lego_progress for god mode" ON lego_progress;
DROP POLICY IF EXISTS "Public read invite_codes for god mode" ON invite_codes;

-- From 20260120100002_fix_rls_recursion.sql
DROP POLICY IF EXISTS "Public insert schools for god mode" ON schools;
DROP POLICY IF EXISTS "Public insert classes for god mode" ON classes;
DROP POLICY IF EXISTS "Public insert user_tags for god mode" ON user_tags;
DROP POLICY IF EXISTS "Public insert learners for god mode" ON learners;
DROP POLICY IF EXISTS "Public insert govt_admins for god mode" ON govt_admins;

-- Revoke anon grants on views
REVOKE SELECT ON class_student_progress FROM anon;
REVOKE SELECT ON school_summary FROM anon;
REVOKE SELECT ON region_summary FROM anon;

-- Grant to authenticated instead
GRANT SELECT ON class_student_progress TO authenticated;
GRANT SELECT ON school_summary TO authenticated;
GRANT SELECT ON region_summary TO authenticated;

-- ============================================
-- 3) Create is_god_user() helper
-- ============================================
CREATE OR REPLACE FUNCTION is_god_user() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM learners
    WHERE user_id = (SELECT auth.jwt()->>'sub')
    AND educational_role = 'god'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- 4) God mode READ policies (authenticated only)
-- ============================================
CREATE POLICY "God users can read all learners"
  ON learners FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all sessions"
  ON sessions FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all seed_progress"
  ON seed_progress FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all lego_progress"
  ON lego_progress FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all schools"
  ON schools FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all classes"
  ON classes FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all user_tags"
  ON user_tags FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all govt_admins"
  ON govt_admins FOR SELECT TO authenticated
  USING (is_god_user());

CREATE POLICY "God users can read all invite_codes"
  ON invite_codes FOR SELECT TO authenticated
  USING (is_god_user());

-- ============================================
-- 5) God mode WRITE policies
-- ============================================
CREATE POLICY "God users can write all schools"
  ON schools FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

CREATE POLICY "God users can write all classes"
  ON classes FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

CREATE POLICY "God users can write all user_tags"
  ON user_tags FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

CREATE POLICY "God users can write all govt_admins"
  ON govt_admins FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

CREATE POLICY "God users can write all learners"
  ON learners FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

-- ============================================
-- 6) Fix class_sessions policies
-- ============================================
DROP POLICY IF EXISTS "anon_read_class_sessions" ON class_sessions;
DROP POLICY IF EXISTS "anon_write_class_sessions" ON class_sessions;

CREATE POLICY "Authenticated can read class_sessions"
  ON class_sessions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "God users can write class_sessions"
  ON class_sessions FOR ALL TO authenticated
  USING (is_god_user()) WITH CHECK (is_god_user());

CREATE POLICY "Teachers can write own class_sessions"
  ON class_sessions FOR ALL TO authenticated
  USING (teacher_user_id = (SELECT auth.jwt()->>'sub'))
  WITH CHECK (teacher_user_id = (SELECT auth.jwt()->>'sub'));

-- ============================================
-- 7) Fix broken auth.uid() policies for Clerk
-- ============================================

-- learner_points: replace auth.uid() with jwt sub
DROP POLICY IF EXISTS "Users can view own points" ON learner_points;
CREATE POLICY "Users can view own points"
  ON learner_points FOR SELECT TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.jwt()->>'sub')
  ));

DROP POLICY IF EXISTS "Users can insert own points" ON learner_points;
CREATE POLICY "Users can insert own points"
  ON learner_points FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.jwt()->>'sub')
  ));

DROP POLICY IF EXISTS "Users can update own points" ON learner_points;
CREATE POLICY "Users can update own points"
  ON learner_points FOR UPDATE TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.jwt()->>'sub')
  ));

-- learner_milestones: replace auth.uid() with jwt sub
DROP POLICY IF EXISTS "Users can view own milestones" ON learner_milestones;
CREATE POLICY "Users can view own milestones"
  ON learner_milestones FOR SELECT TO authenticated
  USING (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.jwt()->>'sub')
  ));

DROP POLICY IF EXISTS "Users can insert own milestones" ON learner_milestones;
CREATE POLICY "Users can insert own milestones"
  ON learner_milestones FOR INSERT TO authenticated
  WITH CHECK (learner_id IN (
    SELECT id FROM learners WHERE user_id = (SELECT auth.jwt()->>'sub')
  ));

-- audio_plays: fix if table exists (may not have been created yet)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audio_plays') THEN
    ALTER TABLE audio_plays ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    ALTER TABLE audio_plays DROP CONSTRAINT IF EXISTS audio_plays_user_id_fkey;

    DROP POLICY IF EXISTS "Users can read own audio plays" ON audio_plays;
    EXECUTE 'CREATE POLICY "Users can read own audio plays"
      ON audio_plays FOR SELECT TO authenticated
      USING (user_id = (SELECT auth.jwt()->>''sub''))';
  END IF;
END $$;

-- ============================================
-- 8) Fix algorithm_config performance
-- ============================================
DROP POLICY IF EXISTS "Service role can write algorithm_config" ON algorithm_config;
CREATE POLICY "Service role can write algorithm_config"
  ON algorithm_config FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role');

-- ============================================
-- 9) Seed god invite code
-- ============================================
INSERT INTO invite_codes (code, code_type, created_by, is_active)
VALUES ('SSI-GOD-2026', 'god', 'system', true)
ON CONFLICT DO NOTHING;

-- ============================================
-- COMPLETE
-- ============================================
