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
-- PHASE 1: DROP VIEWS THAT DEPEND ON learners TABLE
-- Views create hard dependencies on column types
-- ============================================

-- Drop learner-related views (these reference learners table)
DROP VIEW IF EXISTS learner_stats CASCADE;
DROP VIEW IF EXISTS course_progress CASCADE;
DROP VIEW IF EXISTS weekly_leaderboard CASCADE;
DROP VIEW IF EXISTS learner_consistency CASCADE;

-- ============================================
-- PHASE 2: DROP POLICIES THAT DEPEND ON learners.user_id
-- Must happen BEFORE we can alter the column type
-- ============================================

-- Drop the auto-create trigger (Clerk doesn't create auth.users records)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Drop learners policies (direct dependency)
DROP POLICY IF EXISTS "Users can view own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can update own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can insert own learner profile" ON learners;

-- Drop course_enrollments policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Users can insert own enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Users can update own enrollments" ON course_enrollments;

-- Drop lego_progress policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own lego progress" ON lego_progress;
DROP POLICY IF EXISTS "Users can insert own lego progress" ON lego_progress;
DROP POLICY IF EXISTS "Users can update own lego progress" ON lego_progress;

-- Drop seed_progress policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own seed progress" ON seed_progress;
DROP POLICY IF EXISTS "Users can insert own seed progress" ON seed_progress;
DROP POLICY IF EXISTS "Users can update own seed progress" ON seed_progress;

-- Drop sessions policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;

-- Drop response_metrics policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own metrics" ON response_metrics;
DROP POLICY IF EXISTS "Users can insert own metrics" ON response_metrics;

-- Drop spike_events policies (subquery dependency)
DROP POLICY IF EXISTS "Users can view own spikes" ON spike_events;
DROP POLICY IF EXISTS "Users can insert own spikes" ON spike_events;

-- Drop policies on optional tables (may not exist yet)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_baselines') THEN
    DROP POLICY IF EXISTS "Users can view own baselines" ON learner_baselines;
    DROP POLICY IF EXISTS "Users can insert own baselines" ON learner_baselines;
    DROP POLICY IF EXISTS "Users can update own baselines" ON learner_baselines;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_points') THEN
    DROP POLICY IF EXISTS "Users can view own points" ON learner_points;
    DROP POLICY IF EXISTS "Users can insert own points" ON learner_points;
    DROP POLICY IF EXISTS "Users can update own points" ON learner_points;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_milestones') THEN
    DROP POLICY IF EXISTS "Users can view own milestones" ON learner_milestones;
    DROP POLICY IF EXISTS "Users can insert own milestones" ON learner_milestones;
  END IF;
END $$;

-- ============================================
-- PHASE 3: ALTER THE COLUMN TYPE
-- ============================================

-- Drop foreign key constraint
ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_user_id_fkey;

-- Change user_id from UUID to TEXT for Clerk's string IDs
ALTER TABLE learners ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- ============================================
-- PHASE 4: RECREATE VIEWS
-- ============================================

-- Learner stats view (with user_id now as TEXT)
CREATE OR REPLACE VIEW learner_stats AS
SELECT
  l.id AS learner_id,
  l.user_id,
  COUNT(DISTINCT e.course_id) AS courses_enrolled,
  SUM(e.total_practice_minutes) AS total_practice_minutes,
  COUNT(DISTINCT s.id) AS total_sessions,
  SUM(s.items_practiced) AS total_items_practiced,
  MAX(s.started_at) AS last_session_at
FROM learners l
LEFT JOIN course_enrollments e ON e.learner_id = l.id
LEFT JOIN sessions s ON s.learner_id = l.id
GROUP BY l.id, l.user_id;

-- Course progress view
CREATE OR REPLACE VIEW course_progress AS
SELECT
  e.learner_id,
  e.course_id,
  e.enrolled_at,
  e.last_practiced_at,
  e.total_practice_minutes,
  COUNT(DISTINCT lp.lego_id) AS legos_seen,
  COUNT(DISTINCT CASE WHEN lp.is_retired THEN lp.lego_id END) AS legos_retired,
  COUNT(DISTINCT sp.seed_id) AS seeds_introduced
FROM course_enrollments e
LEFT JOIN lego_progress lp ON lp.learner_id = e.learner_id AND lp.course_id = e.course_id
LEFT JOIN seed_progress sp ON sp.learner_id = e.learner_id AND sp.course_id = e.course_id AND sp.is_introduced = TRUE
GROUP BY e.learner_id, e.course_id, e.enrolled_at, e.last_practiced_at, e.total_practice_minutes;

-- Weekly leaderboard view (only if learner_points table exists from gamification)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_points') THEN
    EXECUTE '
      CREATE OR REPLACE VIEW weekly_leaderboard AS
      WITH weekly_stats AS (
        SELECT
          s.learner_id,
          s.course_id,
          SUM(s.points_earned) as weekly_points,
          COUNT(*) as session_count
        FROM sessions s
        WHERE s.started_at >= date_trunc(''week'', CURRENT_TIMESTAMP)
        GROUP BY s.learner_id, s.course_id
      ),
      ranked AS (
        SELECT
          ws.*,
          l.display_name,
          ROW_NUMBER() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points DESC) as rank,
          PERCENT_RANK() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points) as percentile
        FROM weekly_stats ws
        JOIN learners l ON l.id = ws.learner_id
      )
      SELECT
        learner_id,
        display_name,
        course_id,
        weekly_points,
        session_count,
        rank,
        ROUND((1 - percentile) * 100)::INTEGER as top_percentile
      FROM ranked
    ';
  END IF;
END $$;

-- Learner consistency view (only depends on sessions, not learners directly)
CREATE OR REPLACE VIEW learner_consistency AS
SELECT
  learner_id,
  course_id,
  COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') as sessions_10d,
  COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') as sessions_30d,
  EXTRACT(DAY FROM NOW() - MAX(started_at)) as days_since_last,
  CASE
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 7 THEN 1.5
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 5 THEN 1.3
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 3 THEN 1.1
    ELSE 1.0
  END *
  CASE
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 25 THEN 2.0
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 20 THEN 1.5
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 15 THEN 1.2
    ELSE 1.0
  END as consistency_multiplier
FROM sessions
GROUP BY learner_id, course_id;

-- ============================================
-- PHASE 5: RECREATE ALL POLICIES WITH CLERK JWT
-- ============================================

-- Learners policies
CREATE POLICY "Users can view own learner profile"
  ON learners FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can update own learner profile"
  ON learners FOR UPDATE
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert own learner profile"
  ON learners FOR INSERT
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

-- Course enrollments policies
CREATE POLICY "Users can view own enrollments"
  ON course_enrollments FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own enrollments"
  ON course_enrollments FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own enrollments"
  ON course_enrollments FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Lego progress policies
CREATE POLICY "Users can view own lego progress"
  ON lego_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own lego progress"
  ON lego_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own lego progress"
  ON lego_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Seed progress policies
CREATE POLICY "Users can view own seed progress"
  ON seed_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own seed progress"
  ON seed_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own seed progress"
  ON seed_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Sessions policies
CREATE POLICY "Users can view own sessions"
  ON sessions FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own sessions"
  ON sessions FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Response metrics policies
CREATE POLICY "Users can view own metrics"
  ON response_metrics FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own metrics"
  ON response_metrics FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Spike events policies
CREATE POLICY "Users can view own spikes"
  ON spike_events FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

CREATE POLICY "Users can insert own spikes"
  ON spike_events FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Learner baselines policies (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_baselines') THEN
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

-- Learner points policies (if table exists - from gamification)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_points') THEN
    EXECUTE 'CREATE POLICY "Users can view own points"
      ON learner_points FOR SELECT
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';

    EXECUTE 'CREATE POLICY "Users can insert own points"
      ON learner_points FOR INSERT
      WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';

    EXECUTE 'CREATE POLICY "Users can update own points"
      ON learner_points FOR UPDATE
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';
  END IF;
END $$;

-- Learner milestones policies (if table exists - from gamification)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'learner_milestones') THEN
    EXECUTE 'CREATE POLICY "Users can view own milestones"
      ON learner_milestones FOR SELECT
      USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';

    EXECUTE 'CREATE POLICY "Users can insert own milestones"
      ON learner_milestones FOR INSERT
      WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>''sub'')))';
  END IF;
END $$;

-- ============================================
-- DONE
-- ============================================

COMMENT ON TABLE learners IS 'Learner profiles. user_id stores Clerk user ID (string). Created by app on first sign-in.';
