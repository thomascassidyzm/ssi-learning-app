-- ============================================
-- God Mode Public Read Policies
-- ============================================
-- Allows the schools dashboard to read data for testing
-- without requiring authentication.
--
-- IMPORTANT: These are for TESTING ONLY. In production,
-- proper Clerk JWT auth would be used instead.
--
-- Date: 2026-01-20

-- -----------------------------------------
-- LEARNERS: Public read for God Mode
-- -----------------------------------------
CREATE POLICY "Public read for god mode testing"
  ON learners FOR SELECT
  USING (true);

-- -----------------------------------------
-- SCHOOLS: Public read for God Mode
-- -----------------------------------------
CREATE POLICY "Public read schools for god mode"
  ON schools FOR SELECT
  USING (true);

-- -----------------------------------------
-- CLASSES: Public read for God Mode
-- -----------------------------------------
CREATE POLICY "Public read classes for god mode"
  ON classes FOR SELECT
  USING (true);

-- -----------------------------------------
-- USER_TAGS: Public read for God Mode
-- -----------------------------------------
CREATE POLICY "Public read user_tags for god mode"
  ON user_tags FOR SELECT
  USING (true);

-- -----------------------------------------
-- GOVT_ADMINS: Public read for God Mode
-- -----------------------------------------
CREATE POLICY "Public read govt_admins for god mode"
  ON govt_admins FOR SELECT
  USING (true);

-- -----------------------------------------
-- VIEWS: Grant access to views
-- -----------------------------------------
-- Views inherit permissions from underlying tables,
-- but we need to ensure the anon role can access them

GRANT SELECT ON class_student_progress TO anon;
GRANT SELECT ON school_summary TO anon;
GRANT SELECT ON region_summary TO anon;

-- -----------------------------------------
-- SESSIONS: Public read for analytics
-- -----------------------------------------
CREATE POLICY "Public read sessions for god mode"
  ON sessions FOR SELECT
  USING (true);

-- -----------------------------------------
-- PROGRESS TABLES: Public read for analytics
-- -----------------------------------------
CREATE POLICY "Public read seed_progress for god mode"
  ON seed_progress FOR SELECT
  USING (true);

CREATE POLICY "Public read lego_progress for god mode"
  ON lego_progress FOR SELECT
  USING (true);

-- ============================================
-- COMPLETE
-- ============================================
