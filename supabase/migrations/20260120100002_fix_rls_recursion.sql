-- ============================================
-- Fix RLS Infinite Recursion
-- ============================================
-- The original policies created circular references between
-- schools, classes, and user_tags. This drops those and
-- uses simple public read policies for testing.
--
-- Date: 2026-01-20

-- Drop problematic policies on schools
DROP POLICY IF EXISTS "School admins can view own school" ON schools;
DROP POLICY IF EXISTS "School admins can update own school" ON schools;
DROP POLICY IF EXISTS "Teachers can view their school" ON schools;
DROP POLICY IF EXISTS "Govt admins can view schools in their region" ON schools;
DROP POLICY IF EXISTS "SSi admins can manage all schools" ON schools;
DROP POLICY IF EXISTS "Anyone can create school with valid code" ON schools;

-- Drop problematic policies on classes
DROP POLICY IF EXISTS "Teachers can manage own classes" ON classes;
DROP POLICY IF EXISTS "School admins can view all classes in school" ON classes;
DROP POLICY IF EXISTS "Students can view classes they belong to" ON classes;
DROP POLICY IF EXISTS "Teachers in school can create classes" ON classes;

-- Drop problematic policies on user_tags
DROP POLICY IF EXISTS "Users can view own tags" ON user_tags;
DROP POLICY IF EXISTS "Teachers can view student tags in their classes" ON user_tags;
DROP POLICY IF EXISTS "School admins can view all tags in school" ON user_tags;
DROP POLICY IF EXISTS "Users can add own class tag" ON user_tags;
DROP POLICY IF EXISTS "Teachers can add student tags to their classes" ON user_tags;
DROP POLICY IF EXISTS "School admins can add teacher tags" ON user_tags;
DROP POLICY IF EXISTS "Users can remove own class tag" ON user_tags;
DROP POLICY IF EXISTS "Teachers can remove students from their classes" ON user_tags;

-- Drop problematic policies on govt_admins
DROP POLICY IF EXISTS "Govt admins can view own record" ON govt_admins;
DROP POLICY IF EXISTS "SSi admins can manage govt admins" ON govt_admins;

-- Drop problematic policies on invite_codes
DROP POLICY IF EXISTS "Users can view codes they created" ON invite_codes;
DROP POLICY IF EXISTS "SSi admins can view all codes" ON invite_codes;
DROP POLICY IF EXISTS "SSi admins can create govt_admin codes" ON invite_codes;
DROP POLICY IF EXISTS "Govt admins can create school_admin codes" ON invite_codes;
DROP POLICY IF EXISTS "School admins can create teacher codes" ON invite_codes;
DROP POLICY IF EXISTS "Teachers can create student codes" ON invite_codes;

-- Drop progress table policies that might conflict
DROP POLICY IF EXISTS "Teachers can view student enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "Teachers can view student lego progress" ON lego_progress;
DROP POLICY IF EXISTS "Teachers can view student seed progress" ON seed_progress;
DROP POLICY IF EXISTS "Teachers can view student sessions" ON sessions;
DROP POLICY IF EXISTS "School admins can view student enrollments" ON course_enrollments;
DROP POLICY IF EXISTS "School admins can view student sessions" ON sessions;

-- Now the simple public read policies from the previous migration should work
-- If they don't exist yet, create them:

DO $$
BEGIN
  -- Schools
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read schools for god mode' AND tablename = 'schools') THEN
    CREATE POLICY "Public read schools for god mode" ON schools FOR SELECT USING (true);
  END IF;

  -- Classes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read classes for god mode' AND tablename = 'classes') THEN
    CREATE POLICY "Public read classes for god mode" ON classes FOR SELECT USING (true);
  END IF;

  -- User tags
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read user_tags for god mode' AND tablename = 'user_tags') THEN
    CREATE POLICY "Public read user_tags for god mode" ON user_tags FOR SELECT USING (true);
  END IF;

  -- Govt admins
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read govt_admins for god mode' AND tablename = 'govt_admins') THEN
    CREATE POLICY "Public read govt_admins for god mode" ON govt_admins FOR SELECT USING (true);
  END IF;

  -- Invite codes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read invite_codes for god mode' AND tablename = 'invite_codes') THEN
    CREATE POLICY "Public read invite_codes for god mode" ON invite_codes FOR SELECT USING (true);
  END IF;
END $$;

-- Also allow inserts for entity creation in God Mode
CREATE POLICY "Public insert schools for god mode" ON schools FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert classes for god mode" ON classes FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert user_tags for god mode" ON user_tags FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert learners for god mode" ON learners FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert govt_admins for god mode" ON govt_admins FOR INSERT WITH CHECK (true);

-- ============================================
-- COMPLETE
-- ============================================
