-- ============================================
-- SSi Schools System Migration
-- ============================================
-- Creates the full schools hierarchy:
--   ssi_admin -> govt_admin -> school_admin -> teacher -> student
--
-- Two play modes:
--   1. Class Play: Teacher on smartboard, progress to class.current_seed
--   2. Individual Play: Student logged in, progress to learner record, linked via CLASS tag
--
-- Date: 2026-01-20

-- ============================================
-- 1. REGIONS
-- Geographic regions for government admin scope
-- ============================================

CREATE TABLE IF NOT EXISTS regions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL,  -- ISO 3166-1 alpha-2 (GB, FR, ES, IE)
  primary_language TEXT NOT NULL,  -- ISO 639-3 (cym, bre, eus, gle)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial regions for Celtic/minority languages
INSERT INTO regions (code, name, country_code, primary_language) VALUES
  ('wales', 'Wales', 'GB', 'cym'),
  ('scotland', 'Scotland', 'GB', 'gla'),
  ('ireland', 'Ireland', 'IE', 'gle'),
  ('cornwall', 'Cornwall', 'GB', 'cor'),
  ('isle_of_man', 'Isle of Man', 'IM', 'glv'),
  ('brittany', 'Brittany', 'FR', 'bre'),
  ('basque_es', 'Basque Country (Spain)', 'ES', 'eus'),
  ('basque_fr', 'Basque Country (France)', 'FR', 'eus'),
  ('catalonia', 'Catalonia', 'ES', 'cat')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE regions IS 'Geographic regions for government language authorities';

-- ============================================
-- 2. INVITE CODES
-- Unified invite code system for all role types
-- ============================================

CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,  -- Format: ABC-123
  code_type TEXT NOT NULL CHECK (code_type IN ('govt_admin', 'school_admin', 'teacher', 'student')),

  -- Who created this code
  created_by TEXT NOT NULL,  -- Clerk user_id

  -- What the code grants
  grants_region TEXT REFERENCES regions(code),  -- For govt_admin codes
  grants_school_id UUID,  -- For teacher codes (FK added after schools table)
  grants_class_id UUID,   -- For student codes (FK added after classes table)

  -- Usage limits
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,  -- NULL = unlimited
  use_count INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_invite_codes_code ON invite_codes(code);
CREATE INDEX idx_invite_codes_type ON invite_codes(code_type);
CREATE INDEX idx_invite_codes_school ON invite_codes(grants_school_id) WHERE grants_school_id IS NOT NULL;
CREATE INDEX idx_invite_codes_class ON invite_codes(grants_class_id) WHERE grants_class_id IS NOT NULL;

COMMENT ON TABLE invite_codes IS 'Unified invite codes for all role types. Format: ABC-123';

-- ============================================
-- 3. GOVERNMENT ADMINS
-- Regional language authority administrators
-- ============================================

CREATE TABLE IF NOT EXISTS govt_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,  -- Clerk user_id
  region_code TEXT NOT NULL REFERENCES regions(code),
  organization_name TEXT NOT NULL,  -- e.g., 'Welsh Government Language Office'

  -- Audit trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,  -- Clerk user_id of ssi_admin who created
  invite_code_id UUID REFERENCES invite_codes(id)
);

CREATE INDEX idx_govt_admins_user ON govt_admins(user_id);
CREATE INDEX idx_govt_admins_region ON govt_admins(region_code);

COMMENT ON TABLE govt_admins IS 'Government/regional language authority administrators';

-- ============================================
-- 4. SCHOOLS
-- School records with teacher invite codes
-- ============================================

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id TEXT NOT NULL,  -- Clerk user_id of school admin
  school_name TEXT NOT NULL,

  -- Optional region link (for govt admin visibility)
  region_code TEXT REFERENCES regions(code),

  -- Teacher invite code (auto-generated)
  teacher_join_code TEXT NOT NULL UNIQUE,

  -- Audit trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invite_code_id UUID REFERENCES invite_codes(id)  -- Which code was used to create this school
);

CREATE INDEX idx_schools_admin ON schools(admin_user_id);
CREATE INDEX idx_schools_region ON schools(region_code) WHERE region_code IS NOT NULL;
CREATE INDEX idx_schools_join_code ON schools(teacher_join_code);

-- Add FK from invite_codes to schools
ALTER TABLE invite_codes
  ADD CONSTRAINT fk_invite_codes_school
  FOREIGN KEY (grants_school_id) REFERENCES schools(id);

COMMENT ON TABLE schools IS 'School records. admin_user_id is the Clerk ID of the school admin.';

-- ============================================
-- 5. CLASSES
-- Class records with student invite codes and class play state
-- ============================================

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_user_id TEXT NOT NULL,  -- Clerk user_id

  class_name TEXT NOT NULL,  -- e.g., 'Year 7 Welsh'
  course_code TEXT NOT NULL,  -- e.g., 'cym_for_eng_v2'

  -- Student invite code (auto-generated)
  student_join_code TEXT NOT NULL UNIQUE,

  -- Class Play state (separate from individual student progress)
  current_seed INTEGER NOT NULL DEFAULT 1,
  helix_state JSONB NOT NULL DEFAULT '{
    "active_thread": 1,
    "threads": {
      "1": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0},
      "2": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0},
      "3": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}
    }
  }'::jsonb,

  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_classes_school ON classes(school_id);
CREATE INDEX idx_classes_teacher ON classes(teacher_user_id);
CREATE INDEX idx_classes_join_code ON classes(student_join_code);
CREATE INDEX idx_classes_course ON classes(course_code);

-- Add FK from invite_codes to classes
ALTER TABLE invite_codes
  ADD CONSTRAINT fk_invite_codes_class
  FOREIGN KEY (grants_class_id) REFERENCES classes(id);

COMMENT ON TABLE classes IS 'Class records. current_seed and helix_state track Class Play position.';

-- ============================================
-- 6. USER TAGS
-- Soft connections between users and schools/classes
-- ============================================

CREATE TABLE IF NOT EXISTS user_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,  -- Clerk user_id

  tag_type TEXT NOT NULL CHECK (tag_type IN ('school', 'class')),
  tag_value TEXT NOT NULL,  -- 'SCHOOL:{uuid}' or 'CLASS:{uuid}'

  -- Role within this context
  role_in_context TEXT NOT NULL CHECK (role_in_context IN ('admin', 'teacher', 'student')),

  -- Audit trail
  added_by TEXT NOT NULL,  -- Clerk user_id who added this tag
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,  -- Soft delete - NULL means active

  -- Prevent duplicate active tags
  CONSTRAINT unique_active_tag UNIQUE (user_id, tag_type, tag_value)
);

-- Partial index for active tags only
CREATE INDEX idx_user_tags_active ON user_tags(user_id, tag_type) WHERE removed_at IS NULL;
CREATE INDEX idx_user_tags_school ON user_tags(tag_value) WHERE tag_type = 'school' AND removed_at IS NULL;
CREATE INDEX idx_user_tags_class ON user_tags(tag_value) WHERE tag_type = 'class' AND removed_at IS NULL;

COMMENT ON TABLE user_tags IS 'Soft connections between users and schools/classes. removed_at enables soft delete.';

-- ============================================
-- 7. UPDATE LEARNERS TABLE
-- Add role columns
-- ============================================

ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS educational_role TEXT
    CHECK (educational_role IN ('student', 'teacher', 'school_admin', 'govt_admin'));

ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS platform_role TEXT
    CHECK (platform_role IN ('ssi_admin'));

COMMENT ON COLUMN learners.educational_role IS 'Role in school context: student, teacher, school_admin, govt_admin. NULL = individual learner.';
COMMENT ON COLUMN learners.platform_role IS 'Platform-level role. Only ssi_admin for Tom/Aran.';

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Generate join code in ABC-123 format
CREATE OR REPLACE FUNCTION generate_join_code()
RETURNS TEXT AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- No I, O (confusable)
  numbers TEXT := '0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  -- 3 letters
  FOR i IN 1..3 LOOP
    result := result || substr(letters, floor(random() * 24 + 1)::int, 1);
  END LOOP;

  result := result || '-';

  -- 3 numbers
  FOR i IN 1..3 LOOP
    result := result || substr(numbers, floor(random() * 10 + 1)::int, 1);
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Auto-generate join codes on insert
CREATE OR REPLACE FUNCTION set_school_join_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER := 0;
BEGIN
  IF NEW.teacher_join_code IS NULL OR NEW.teacher_join_code = '' THEN
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.teacher_join_code := new_code;
        RETURN NEW;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_schools_join_code
  BEFORE INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION set_school_join_code();

CREATE OR REPLACE FUNCTION set_class_join_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER := 0;
BEGIN
  IF NEW.student_join_code IS NULL OR NEW.student_join_code = '' THEN
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.student_join_code := new_code;
        RETURN NEW;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_classes_join_code
  BEFORE INSERT ON classes
  FOR EACH ROW EXECUTE FUNCTION set_class_join_code();

-- Auto-update updated_at
CREATE TRIGGER tr_schools_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_classes_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 9. REPORTING VIEWS
-- ============================================

-- Class student progress view (for teacher dashboard)
CREATE OR REPLACE VIEW class_student_progress AS
SELECT
  c.id AS class_id,
  c.class_name,
  c.course_code,
  c.school_id,
  c.teacher_user_id,
  ut.user_id AS student_user_id,
  l.id AS learner_id,
  l.display_name AS student_name,

  -- Progress metrics
  COALESCE(
    (SELECT COUNT(*) FROM seed_progress sp
     WHERE sp.learner_id = l.id
       AND sp.course_id = c.course_code
       AND sp.is_introduced = true),
    0
  ) AS seeds_completed,

  COALESCE(
    (SELECT COUNT(*) FROM lego_progress lp
     WHERE lp.learner_id = l.id
       AND lp.course_id = c.course_code
       AND lp.is_retired = true),
    0
  ) AS legos_mastered,

  COALESCE(
    (SELECT SUM(duration_seconds) FROM sessions s
     WHERE s.learner_id = l.id
       AND s.course_id = c.course_code),
    0
  ) AS total_practice_seconds,

  (SELECT MAX(ended_at) FROM sessions s
   WHERE s.learner_id = l.id
     AND s.course_id = c.course_code) AS last_active_at,

  ut.added_at AS joined_class_at

FROM classes c
JOIN user_tags ut
  ON ut.tag_value = 'CLASS:' || c.id::text
  AND ut.tag_type = 'class'
  AND ut.removed_at IS NULL
  AND ut.role_in_context = 'student'
JOIN learners l ON l.user_id = ut.user_id;

COMMENT ON VIEW class_student_progress IS 'Student progress within classes. Used by teacher dashboard.';

-- School summary view (for school admin dashboard)
CREATE OR REPLACE VIEW school_summary AS
SELECT
  s.id AS school_id,
  s.school_name,
  s.region_code,
  s.admin_user_id,
  s.created_at,

  -- Teacher count
  (SELECT COUNT(DISTINCT ut.user_id)
   FROM user_tags ut
   WHERE ut.tag_value = 'SCHOOL:' || s.id::text
     AND ut.tag_type = 'school'
     AND ut.role_in_context = 'teacher'
     AND ut.removed_at IS NULL) AS teacher_count,

  -- Class count
  (SELECT COUNT(*) FROM classes c WHERE c.school_id = s.id AND c.is_active = true) AS class_count,

  -- Student count (across all classes)
  (SELECT COUNT(DISTINCT ut.user_id)
   FROM classes c
   JOIN user_tags ut ON ut.tag_value = 'CLASS:' || c.id::text
     AND ut.tag_type = 'class'
     AND ut.role_in_context = 'student'
     AND ut.removed_at IS NULL
   WHERE c.school_id = s.id) AS student_count,

  -- Total practice hours (all students in school)
  (SELECT COALESCE(SUM(sess.duration_seconds) / 3600.0, 0)
   FROM classes c
   JOIN user_tags ut ON ut.tag_value = 'CLASS:' || c.id::text
     AND ut.tag_type = 'class'
     AND ut.role_in_context = 'student'
     AND ut.removed_at IS NULL
   JOIN learners l ON l.user_id = ut.user_id
   JOIN sessions sess ON sess.learner_id = l.id AND sess.course_id = c.course_code
   WHERE c.school_id = s.id) AS total_practice_hours

FROM schools s;

COMMENT ON VIEW school_summary IS 'Aggregated school statistics. Used by school admin dashboard.';

-- Region summary view (for govt admin dashboard)
CREATE OR REPLACE VIEW region_summary AS
SELECT
  r.code AS region_code,
  r.name AS region_name,
  r.country_code,
  r.primary_language,

  -- School count
  (SELECT COUNT(*) FROM schools s WHERE s.region_code = r.code) AS school_count,

  -- Teacher count
  (SELECT COUNT(DISTINCT ut.user_id)
   FROM schools s
   JOIN user_tags ut ON ut.tag_value = 'SCHOOL:' || s.id::text
     AND ut.tag_type = 'school'
     AND ut.role_in_context = 'teacher'
     AND ut.removed_at IS NULL
   WHERE s.region_code = r.code) AS teacher_count,

  -- Student count
  (SELECT COUNT(DISTINCT ut2.user_id)
   FROM schools s
   JOIN classes c ON c.school_id = s.id
   JOIN user_tags ut2 ON ut2.tag_value = 'CLASS:' || c.id::text
     AND ut2.tag_type = 'class'
     AND ut2.role_in_context = 'student'
     AND ut2.removed_at IS NULL
   WHERE s.region_code = r.code) AS student_count,

  -- Total practice hours (aggregated)
  (SELECT COALESCE(SUM(sess.duration_seconds) / 3600.0, 0)
   FROM schools s
   JOIN classes c ON c.school_id = s.id
   JOIN user_tags ut ON ut.tag_value = 'CLASS:' || c.id::text
     AND ut.tag_type = 'class'
     AND ut.role_in_context = 'student'
     AND ut.removed_at IS NULL
   JOIN learners l ON l.user_id = ut.user_id
   JOIN sessions sess ON sess.learner_id = l.id AND sess.course_id = c.course_code
   WHERE s.region_code = r.code) AS total_practice_hours

FROM regions r;

COMMENT ON VIEW region_summary IS 'Aggregated regional statistics. Used by govt admin dashboard. NO individual data exposed.';

-- ============================================
-- 10. ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all new tables
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE govt_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tags ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------
-- REGIONS: Public read, admin write
-- -----------------------------------------
CREATE POLICY "Anyone can view regions"
  ON regions FOR SELECT
  USING (true);

CREATE POLICY "SSi admins can manage regions"
  ON regions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM learners
      WHERE user_id = (auth.jwt()->>'sub')
        AND platform_role = 'ssi_admin'
    )
  );

-- -----------------------------------------
-- INVITE CODES: Creator and related admins
-- -----------------------------------------
CREATE POLICY "Users can view codes they created"
  ON invite_codes FOR SELECT
  USING (created_by = (auth.jwt()->>'sub'));

CREATE POLICY "SSi admins can view all codes"
  ON invite_codes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM learners
      WHERE user_id = (auth.jwt()->>'sub')
        AND platform_role = 'ssi_admin'
    )
  );

CREATE POLICY "SSi admins can create govt_admin codes"
  ON invite_codes FOR INSERT
  WITH CHECK (
    code_type = 'govt_admin' AND
    EXISTS (
      SELECT 1 FROM learners
      WHERE user_id = (auth.jwt()->>'sub')
        AND platform_role = 'ssi_admin'
    )
  );

CREATE POLICY "Govt admins can create school_admin codes"
  ON invite_codes FOR INSERT
  WITH CHECK (
    code_type = 'school_admin' AND
    EXISTS (
      SELECT 1 FROM govt_admins
      WHERE user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "School admins can create teacher codes"
  ON invite_codes FOR INSERT
  WITH CHECK (
    code_type = 'teacher' AND
    EXISTS (
      SELECT 1 FROM schools
      WHERE admin_user_id = (auth.jwt()->>'sub')
        AND id = grants_school_id
    )
  );

CREATE POLICY "Teachers can create student codes"
  ON invite_codes FOR INSERT
  WITH CHECK (
    code_type = 'student' AND
    EXISTS (
      SELECT 1 FROM classes
      WHERE teacher_user_id = (auth.jwt()->>'sub')
        AND id = grants_class_id
    )
  );

-- -----------------------------------------
-- GOVT ADMINS: SSi admins and self
-- -----------------------------------------
CREATE POLICY "Govt admins can view own record"
  ON govt_admins FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "SSi admins can manage govt admins"
  ON govt_admins FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM learners
      WHERE user_id = (auth.jwt()->>'sub')
        AND platform_role = 'ssi_admin'
    )
  );

-- -----------------------------------------
-- SCHOOLS: Admin, teachers, and govt admins for region
-- -----------------------------------------
CREATE POLICY "School admins can view own school"
  ON schools FOR SELECT
  USING (admin_user_id = (auth.jwt()->>'sub'));

CREATE POLICY "School admins can update own school"
  ON schools FOR UPDATE
  USING (admin_user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Teachers can view their school"
  ON schools FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_tags
      WHERE user_id = (auth.jwt()->>'sub')
        AND tag_value = 'SCHOOL:' || schools.id::text
        AND tag_type = 'school'
        AND removed_at IS NULL
    )
  );

CREATE POLICY "Govt admins can view schools in their region"
  ON schools FOR SELECT
  USING (
    region_code IN (
      SELECT region_code FROM govt_admins
      WHERE user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "SSi admins can manage all schools"
  ON schools FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM learners
      WHERE user_id = (auth.jwt()->>'sub')
        AND platform_role = 'ssi_admin'
    )
  );

-- Anyone can create a school (when using valid school_admin invite code)
CREATE POLICY "Anyone can create school with valid code"
  ON schools FOR INSERT
  WITH CHECK (true);  -- Validation happens in app layer via invite code

-- -----------------------------------------
-- CLASSES: Teacher, school admin, and students
-- -----------------------------------------
CREATE POLICY "Teachers can manage own classes"
  ON classes FOR ALL
  USING (teacher_user_id = (auth.jwt()->>'sub'));

CREATE POLICY "School admins can view all classes in school"
  ON classes FOR SELECT
  USING (
    school_id IN (
      SELECT id FROM schools WHERE admin_user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Students can view classes they belong to"
  ON classes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_tags
      WHERE user_id = (auth.jwt()->>'sub')
        AND tag_value = 'CLASS:' || classes.id::text
        AND tag_type = 'class'
        AND removed_at IS NULL
    )
  );

CREATE POLICY "Teachers in school can create classes"
  ON classes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_tags
      WHERE user_id = (auth.jwt()->>'sub')
        AND tag_value = 'SCHOOL:' || school_id::text
        AND tag_type = 'school'
        AND removed_at IS NULL
    )
  );

-- -----------------------------------------
-- USER TAGS: Self, teachers, school admins
-- -----------------------------------------
CREATE POLICY "Users can view own tags"
  ON user_tags FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Teachers can view student tags in their classes"
  ON user_tags FOR SELECT
  USING (
    tag_type = 'class' AND
    role_in_context = 'student' AND
    EXISTS (
      SELECT 1 FROM classes c
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
        AND tag_value = 'CLASS:' || c.id::text
    )
  );

CREATE POLICY "School admins can view all tags in school"
  ON user_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM schools s
      WHERE s.admin_user_id = (auth.jwt()->>'sub')
        AND (
          tag_value = 'SCHOOL:' || s.id::text
          OR tag_value IN (
            SELECT 'CLASS:' || c.id::text FROM classes c WHERE c.school_id = s.id
          )
        )
    )
  );

-- Users can create their own tags (joining a class)
CREATE POLICY "Users can add own class tag"
  ON user_tags FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt()->>'sub') AND
    tag_type = 'class' AND
    role_in_context = 'student'
  );

-- Teachers/admins can add tags for others
CREATE POLICY "Teachers can add student tags to their classes"
  ON user_tags FOR INSERT
  WITH CHECK (
    tag_type = 'class' AND
    role_in_context = 'student' AND
    EXISTS (
      SELECT 1 FROM classes c
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
        AND tag_value = 'CLASS:' || c.id::text
    )
  );

-- School admins can add teacher tags
CREATE POLICY "School admins can add teacher tags"
  ON user_tags FOR INSERT
  WITH CHECK (
    tag_type = 'school' AND
    role_in_context = 'teacher' AND
    EXISTS (
      SELECT 1 FROM schools s
      WHERE s.admin_user_id = (auth.jwt()->>'sub')
        AND tag_value = 'SCHOOL:' || s.id::text
    )
  );

-- Users can remove themselves from a class (soft delete)
CREATE POLICY "Users can remove own class tag"
  ON user_tags FOR UPDATE
  USING (
    user_id = (auth.jwt()->>'sub') AND
    tag_type = 'class'
  );

-- Teachers can remove students from their classes
CREATE POLICY "Teachers can remove students from their classes"
  ON user_tags FOR UPDATE
  USING (
    tag_type = 'class' AND
    role_in_context = 'student' AND
    EXISTS (
      SELECT 1 FROM classes c
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
        AND tag_value = 'CLASS:' || c.id::text
    )
  );

-- ============================================
-- 11. UPDATE EXISTING TABLE POLICIES
-- Add policies for teachers/admins to view student progress
-- ============================================

-- Teachers can view progress of students in their classes
CREATE POLICY "Teachers can view student enrollments"
  ON course_enrollments FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Teachers can view student lego progress"
  ON lego_progress FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Teachers can view student seed progress"
  ON seed_progress FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Teachers can view student sessions"
  ON sessions FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      WHERE c.teacher_user_id = (auth.jwt()->>'sub')
    )
  );

-- School admins can view all student progress in their school
CREATE POLICY "School admins can view student enrollments"
  ON course_enrollments FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      JOIN schools s ON c.school_id = s.id
      WHERE s.admin_user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "School admins can view student sessions"
  ON sessions FOR SELECT
  USING (
    learner_id IN (
      SELECT l.id FROM learners l
      JOIN user_tags ut ON ut.user_id = l.user_id
        AND ut.tag_type = 'class'
        AND ut.role_in_context = 'student'
        AND ut.removed_at IS NULL
      JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
      JOIN schools s ON c.school_id = s.id
      WHERE s.admin_user_id = (auth.jwt()->>'sub')
    )
  );

-- ============================================
-- COMPLETE
-- ============================================

COMMENT ON SCHEMA public IS 'SSi Learning App schema with schools system. Migration: 20260120100000_schools_system.sql';
