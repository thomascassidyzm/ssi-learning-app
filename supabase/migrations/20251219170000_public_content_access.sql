-- ============================================
-- PUBLIC ACCESS TO CONTENT TABLES
-- ============================================
-- Allow anonymous (guest) users to read course content.
-- Content tables are public data - everyone should be able to learn.
-- Only progress/session tables need authenticated access.

-- ============================================
-- COURSES TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view courses" ON courses;
CREATE POLICY "Public users can view courses"
  ON courses FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- COURSE_SEEDS TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view course_seeds" ON course_seeds;
CREATE POLICY "Public users can view course_seeds"
  ON course_seeds FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- COURSE_LEGOS TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view course_legos" ON course_legos;
CREATE POLICY "Public users can view course_legos"
  ON course_legos FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- COURSE_PRACTICE_PHRASES TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view course_practice_phrases" ON course_practice_phrases;
CREATE POLICY "Public users can view course_practice_phrases"
  ON course_practice_phrases FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- AUDIO_SAMPLES TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view audio_samples" ON audio_samples;
CREATE POLICY "Public users can view audio_samples"
  ON audio_samples FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- LEGO_INTRODUCTIONS TABLE - Allow public read access
-- ============================================
DROP POLICY IF EXISTS "Public users can view lego_introductions" ON lego_introductions;
CREATE POLICY "Public users can view lego_introductions"
  ON lego_introductions FOR SELECT
  TO anon
  USING (true);

-- ============================================
-- VIEWS - Grant SELECT to anon role
-- ============================================
-- Views also need explicit permission for anon users

GRANT SELECT ON lego_cycles TO anon;
GRANT SELECT ON practice_cycles TO anon;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON POLICY "Public users can view courses" ON courses IS 'Allow guest users to browse available courses';
COMMENT ON POLICY "Public users can view course_seeds" ON course_seeds IS 'Allow guest users to read course content';
COMMENT ON POLICY "Public users can view course_legos" ON course_legos IS 'Allow guest users to read LEGO content';
COMMENT ON POLICY "Public users can view course_practice_phrases" ON course_practice_phrases IS 'Allow guest users to read practice phrases';
COMMENT ON POLICY "Public users can view audio_samples" ON audio_samples IS 'Allow guest users to access audio references';
COMMENT ON POLICY "Public users can view lego_introductions" ON lego_introductions IS 'Allow guest users to hear LEGO introductions';
