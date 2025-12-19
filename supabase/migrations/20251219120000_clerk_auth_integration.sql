-- Clerk Authentication Integration Migration
-- Updates the database to work with Clerk as the auth provider instead of Supabase Auth
--
-- Key changes:
-- 1. Change learners.user_id from UUID to TEXT (Clerk uses string IDs like "user_2abc123")
-- 2. Remove foreign key reference to auth.users
-- 3. Update all RLS policies to use auth.jwt()->>'sub' instead of auth.uid()
-- 4. Remove the auto-create trigger (app creates learner on first sign-in)
--
-- Prerequisites: Enable Clerk as Third-Party Auth provider in Supabase Dashboard

-- ============================================
-- 1. DROP EXISTING CONSTRAINTS AND TRIGGERS
-- ============================================

-- Drop the auto-create trigger (Clerk doesn't create auth.users records)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- ============================================
-- 2. ALTER LEARNERS TABLE
-- ============================================

-- Drop foreign key constraint
ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_user_id_fkey;

-- Change user_id from UUID to TEXT for Clerk's string IDs
ALTER TABLE learners ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- ============================================
-- 3. UPDATE LEARNERS RLS POLICIES
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can update own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can insert own learner profile" ON learners;

-- Create new policies using Clerk JWT
CREATE POLICY "Users can view own learner profile"
  ON learners FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can update own learner profile"
  ON learners FOR UPDATE
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert own learner profile"
  ON learners FOR INSERT
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

-- ============================================
-- 4. UPDATE COURSE ENROLLMENTS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Users can insert own enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Users can update own enrollments" ON course_enrollments;

CREATE POLICY "Users can view own enrollments"
  ON course_enrollments FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own enrollments"
  ON course_enrollments FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own enrollments"
  ON course_enrollments FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 5. UPDATE LEGO PROGRESS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own lego progress" ON lego_progress;
DROP POLICY IF EXISTS "Users can insert own lego progress" ON lego_progress;
DROP POLICY IF EXISTS "Users can update own lego progress" ON lego_progress;

CREATE POLICY "Users can view own lego progress"
  ON lego_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own lego progress"
  ON lego_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own lego progress"
  ON lego_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 6. UPDATE SEED PROGRESS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own seed progress" ON seed_progress;
DROP POLICY IF EXISTS "Users can insert own seed progress" ON seed_progress;
DROP POLICY IF EXISTS "Users can update own seed progress" ON seed_progress;

CREATE POLICY "Users can view own seed progress"
  ON seed_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own seed progress"
  ON seed_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own seed progress"
  ON seed_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 7. UPDATE SESSIONS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;

CREATE POLICY "Users can view own sessions"
  ON sessions FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own sessions"
  ON sessions FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 8. UPDATE RESPONSE METRICS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own metrics" ON response_metrics;
DROP POLICY IF EXISTS "Users can insert own metrics" ON response_metrics;

CREATE POLICY "Users can view own metrics"
  ON response_metrics FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own metrics"
  ON response_metrics FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 9. UPDATE SPIKE EVENTS RLS POLICIES
-- ============================================

DROP POLICY IF EXISTS "Users can view own spikes" ON spike_events;
DROP POLICY IF EXISTS "Users can insert own spikes" ON spike_events;

CREATE POLICY "Users can view own spikes"
  ON spike_events FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own spikes"
  ON spike_events FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- ============================================
-- 10. UPDATE LEARNER BASELINES RLS POLICIES (if exists)
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'learner_baselines') THEN
    DROP POLICY IF EXISTS "Users can view own baselines" ON learner_baselines;
    DROP POLICY IF EXISTS "Users can insert own baselines" ON learner_baselines;
    DROP POLICY IF EXISTS "Users can update own baselines" ON learner_baselines;

    EXECUTE 'CREATE POLICY "Users can view own baselines"
      ON learner_baselines FOR SELECT
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';

    EXECUTE 'CREATE POLICY "Users can insert own baselines"
      ON learner_baselines FOR INSERT
      WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';

    EXECUTE 'CREATE POLICY "Users can update own baselines"
      ON learner_baselines FOR UPDATE
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';
  END IF;
END $$;

-- ============================================
-- 11. UPDATE VIEWS (if they reference auth.uid())
-- ============================================

-- The existing views don't use auth.uid() directly, so no changes needed
-- Views join on learner_id which still works

-- ============================================
-- DONE
-- ============================================

COMMENT ON TABLE learners IS 'Learner profiles. user_id stores Clerk user ID (string). Created by app on first sign-in.';
