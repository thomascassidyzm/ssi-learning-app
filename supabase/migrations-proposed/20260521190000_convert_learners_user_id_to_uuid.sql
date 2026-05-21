-- ============================================================
-- PROPOSED — not applied; review carefully before moving to active folder
-- ============================================================
-- Convert learners.user_id back from TEXT to UUID
-- ============================================================
-- Date authored: 2026-05-21
--
-- Context
-- -------
-- Migration 20251219120000 converted learners.user_id from UUID to
-- TEXT. That migration was never fully shipped — Supabase Auth (UUID
-- subjects) is canonical. The conversion stuck because reverting it
-- is destructive (drops the foreign key to auth.users and forces
-- every dependent view/policy to be rebuilt).
--
-- Today's symptoms
-- ----------------
-- * Every policy on learners has to cast: auth.uid()::text = user_id
-- * Joins to auth.users require explicit casts
-- * New tables (player_events) use UUID and split the convention
--
-- What this migration does
-- ------------------------
-- 1. Verifies every learners.user_id value is a valid UUID (i.e. no
--    stray non-UUID strings ever leaked in).
-- 2. Drops dependent views, policies, and the existing column.
-- 3. Re-adds learners.user_id as UUID with the foreign key back to
--    auth.users (ON DELETE CASCADE so deleting an auth.users row
--    removes the learner — same behaviour as 2025-12 baseline).
-- 4. Re-creates every policy without the ::text cast, using
--    auth.uid() = user_id directly.
-- 5. Re-creates dependent views.
-- 6. Refreshes the handle_new_user() trigger so NEW.id is inserted
--    as UUID (not NEW.id::text).
--
-- What this migration does NOT do
-- -------------------------------
-- * It does not touch the other legacy TEXT user_id columns:
--     - schools.admin_user_id
--     - classes.teacher_user_id
--     - user_tags.user_id
--     - govt_admins.user_id
--     - schools.created_by, classes.added_by, user_tags.added_by
--   Those are independent and can be converted in follow-ups.
-- * It assumes 20260521180000_block_anon_role_escalation.sql has
--   already run (the handle_new_user() trigger needs to exist before
--   we rewrite it).
--
-- Pre-flight checks Tom should run before applying
-- ------------------------------------------------
--   SELECT COUNT(*) FROM learners WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--   -- Expected: 0. If non-zero, find and fix the bad rows first.
--
--   SELECT COUNT(*) FROM learners l WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = l.user_id);
--   -- Expected: 0. If non-zero, those learners point at no auth user — decide whether to delete or anchor them first.
--
-- Rollback
-- --------
-- Reverse with:
--   ALTER TABLE learners ALTER COLUMN user_id TYPE TEXT USING user_id::text;
-- ...and recreate the TEXT-era policies (see 20260512_unify_user_id_auth_pattern.sql).

BEGIN;

-- ============================================
-- 1. Sanity check: every value must already be a valid UUID
-- ============================================
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM learners
  WHERE user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'learners.user_id has % rows that are not valid UUIDs — clean those up first', bad_count;
  END IF;
END $$;

-- ============================================
-- 2. Drop dependent views (will be rebuilt below)
-- ============================================
DROP VIEW IF EXISTS learner_stats CASCADE;
DROP VIEW IF EXISTS course_progress CASCADE;
DROP VIEW IF EXISTS weekly_leaderboard CASCADE;
DROP VIEW IF EXISTS learner_consistency CASCADE;

-- ============================================
-- 3. Drop policies that compare user_id with auth.uid()::text
-- ============================================
DROP POLICY IF EXISTS "Users can view own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can update own learner profile" ON learners;
DROP POLICY IF EXISTS "Users can insert own learner profile" ON learners;
DROP POLICY IF EXISTS learners_claim_by_email_select ON learners;
DROP POLICY IF EXISTS learners_claim_by_email_update ON learners;

-- ============================================
-- 4. Alter the column type
-- ============================================
ALTER TABLE learners ALTER COLUMN user_id TYPE UUID USING user_id::uuid;

-- Re-add the foreign key to auth.users (matches the pre-conversion baseline)
ALTER TABLE learners
  ADD CONSTRAINT learners_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

-- ============================================
-- 5. Recreate policies without ::text casts
-- ============================================
CREATE POLICY "Users can view own learner profile" ON learners
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own learner profile" ON learners
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT is still blocked at the GRANT layer by
-- 20260521180000_block_anon_role_escalation.sql. The trigger does
-- the insert as SECURITY DEFINER.

-- Multi-email claim policies (from 20260316_verified_emails.sql)
CREATE POLICY learners_claim_by_email_select ON learners
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR verified_emails @> ARRAY[auth.jwt()->>'email']::text[]
  );

CREATE POLICY learners_claim_by_email_update ON learners
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR verified_emails @> ARRAY[auth.jwt()->>'email']::text[]
  )
  WITH CHECK (
    user_id = auth.uid()
    OR verified_emails @> ARRAY[auth.jwt()->>'email']::text[]
  );

-- ============================================
-- 6. Update handle_new_user() to insert UUID directly
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.learners (user_id, display_name, verified_emails)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN NEW.email IS NULL OR NEW.email = '' THEN '{}'::text[] ELSE ARRAY[lower(NEW.email)] END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ============================================
-- 7. Recreate views (same shape, but user_id is now UUID)
-- ============================================
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

NOTIFY pgrst, 'reload schema';

COMMIT;
