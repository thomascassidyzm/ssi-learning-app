-- Migration: Replace Clerk auth.jwt()->>'sub' with Supabase auth.uid()::text
--
-- Context: Switching from Clerk to Supabase Auth (email OTP).
-- Supabase Auth uses auth.uid() which returns a UUID. Our learners.user_id
-- is TEXT, so we cast auth.uid()::text for comparisons.
--
-- Run manually in Supabase SQL editor.

-- ============================================================================
-- LEARNERS TABLE
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "learners_select" ON learners;
DROP POLICY IF EXISTS "learners_update" ON learners;
DROP POLICY IF EXISTS "learners_insert" ON learners;

-- Recreate with auth.uid()
CREATE POLICY "learners_select" ON learners FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE POLICY "learners_update" ON learners FOR UPDATE
  USING (user_id = auth.uid()::text);

CREATE POLICY "learners_insert" ON learners FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- ============================================================================
-- COURSE_ENROLLMENTS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "enrollments_select" ON course_enrollments;
DROP POLICY IF EXISTS "enrollments_insert" ON course_enrollments;
DROP POLICY IF EXISTS "enrollments_update" ON course_enrollments;

CREATE POLICY "enrollments_select" ON course_enrollments FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "enrollments_insert" ON course_enrollments FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "enrollments_update" ON course_enrollments FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

-- ============================================================================
-- LEGO_PROGRESS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "lego_progress_select" ON lego_progress;
DROP POLICY IF EXISTS "lego_progress_insert" ON lego_progress;
DROP POLICY IF EXISTS "lego_progress_update" ON lego_progress;

CREATE POLICY "lego_progress_select" ON lego_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "lego_progress_insert" ON lego_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "lego_progress_update" ON lego_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

-- ============================================================================
-- SEED_PROGRESS TABLE
-- ============================================================================

DROP POLICY IF EXISTS "seed_progress_select" ON seed_progress;
DROP POLICY IF EXISTS "seed_progress_insert" ON seed_progress;
DROP POLICY IF EXISTS "seed_progress_update" ON seed_progress;

CREATE POLICY "seed_progress_select" ON seed_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "seed_progress_insert" ON seed_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "seed_progress_update" ON seed_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

-- ============================================================================
-- AUDIO_PLAYS TABLE (if exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'audio_plays') THEN
    EXECUTE 'DROP POLICY IF EXISTS "audio_plays_select" ON audio_plays';
    EXECUTE 'DROP POLICY IF EXISTS "audio_plays_insert" ON audio_plays';
    EXECUTE 'CREATE POLICY "audio_plays_select" ON audio_plays FOR SELECT
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text))';
    EXECUTE 'CREATE POLICY "audio_plays_insert" ON audio_plays FOR INSERT
      WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text))';
  END IF;
END $$;

-- ============================================================================
-- SCHOOLS SYSTEM TABLES
-- ============================================================================

-- invite_codes: anyone can select active codes, created_by uses auth.uid()
DROP POLICY IF EXISTS "invite_codes_select" ON invite_codes;
DROP POLICY IF EXISTS "invite_codes_insert" ON invite_codes;

CREATE POLICY "invite_codes_select" ON invite_codes FOR SELECT
  USING (true); -- validation endpoint needs to read any code

CREATE POLICY "invite_codes_insert" ON invite_codes FOR INSERT
  WITH CHECK (created_by = auth.uid()::text);

-- user_tags
DROP POLICY IF EXISTS "user_tags_select" ON user_tags;
DROP POLICY IF EXISTS "user_tags_insert" ON user_tags;
DROP POLICY IF EXISTS "user_tags_delete" ON user_tags;

CREATE POLICY "user_tags_select" ON user_tags FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE POLICY "user_tags_insert" ON user_tags FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "user_tags_delete" ON user_tags FOR DELETE
  USING (user_id = auth.uid()::text);

-- schools
DROP POLICY IF EXISTS "schools_select" ON schools;
DROP POLICY IF EXISTS "schools_insert" ON schools;
DROP POLICY IF EXISTS "schools_update" ON schools;

CREATE POLICY "schools_select" ON schools FOR SELECT
  USING (
    admin_user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM user_tags
      WHERE user_id = auth.uid()::text
      AND tag_type = 'school'
      AND tag_value = 'SCHOOL:' || schools.id::text
      AND removed_at IS NULL
    )
  );

CREATE POLICY "schools_insert" ON schools FOR INSERT
  WITH CHECK (admin_user_id = auth.uid()::text);

CREATE POLICY "schools_update" ON schools FOR UPDATE
  USING (admin_user_id = auth.uid()::text);

-- classes
DROP POLICY IF EXISTS "classes_select" ON classes;
DROP POLICY IF EXISTS "classes_insert" ON classes;
DROP POLICY IF EXISTS "classes_update" ON classes;

CREATE POLICY "classes_select" ON classes FOR SELECT
  USING (
    teacher_user_id = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM schools WHERE id = classes.school_id AND admin_user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM user_tags
      WHERE user_id = auth.uid()::text
      AND tag_type = 'class'
      AND tag_value = 'CLASS:' || classes.id::text
      AND removed_at IS NULL
    )
  );

CREATE POLICY "classes_insert" ON classes FOR INSERT
  WITH CHECK (teacher_user_id = auth.uid()::text);

CREATE POLICY "classes_update" ON classes FOR UPDATE
  USING (teacher_user_id = auth.uid()::text)
  WITH CHECK (teacher_user_id = auth.uid()::text);

-- govt_admins
DROP POLICY IF EXISTS "govt_admins_select" ON govt_admins;
DROP POLICY IF EXISTS "govt_admins_insert" ON govt_admins;

CREATE POLICY "govt_admins_select" ON govt_admins FOR SELECT
  USING (user_id = auth.uid()::text);

CREATE POLICY "govt_admins_insert" ON govt_admins FOR INSERT
  WITH CHECK (user_id = auth.uid()::text);

-- ============================================================================
-- ENTITLEMENTS TABLE (if exists, from rls_entitlements_fix migration)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'entitlements') THEN
    EXECUTE 'DROP POLICY IF EXISTS "entitlements_select" ON entitlements';
    EXECUTE 'CREATE POLICY "entitlements_select" ON entitlements FOR SELECT
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text))';
  END IF;
END $$;

-- ============================================================================
-- Keep anon SELECT policies for public tables (courses, course_seeds, etc.)
-- These don't reference auth.jwt() so they're unchanged.
-- ============================================================================

-- Done! All RLS policies now use auth.uid()::text instead of auth.jwt()->>'sub'
