-- Migration: Create courses catalog table
-- This table stores metadata about available courses for the course selector UI

-- Course catalog metadata
CREATE TABLE IF NOT EXISTS courses (
  course_code TEXT PRIMARY KEY,        -- e.g., 'spa_for_eng_v2'
  title TEXT NOT NULL,                 -- e.g., 'Spanish'
  subtitle TEXT,                       -- e.g., 'for English Speakers'
  known_language TEXT NOT NULL,        -- ISO 639-1: 'en', 'es', etc.
  target_language TEXT NOT NULL,       -- ISO 639-1: 'es', 'it', etc.
  known_language_name TEXT NOT NULL,   -- e.g., 'English'
  target_language_name TEXT NOT NULL,  -- e.g., 'Spanish'
  known_flag TEXT NOT NULL,            -- e.g., '🇬🇧'
  target_flag TEXT NOT NULL,           -- e.g., '🇪🇸'
  total_seeds INTEGER DEFAULT 0,
  version TEXT DEFAULT '1.0',
  is_active BOOLEAN DEFAULT true,      -- Available for enrollment
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for filtering by known language (language chaining)
CREATE INDEX IF NOT EXISTS idx_courses_known_language ON courses(known_language);

-- RLS policy: Anyone can read courses
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Courses are viewable by everyone" ON courses;
CREATE POLICY "Courses are viewable by everyone" ON courses FOR SELECT USING (true);

-- Seed the table with available courses
INSERT INTO courses (course_code, title, subtitle, known_language, target_language,
                     known_language_name, target_language_name, known_flag, target_flag, total_seeds)
VALUES
  -- From English
  ('spa_for_eng_v2', 'Spanish', 'for English Speakers', 'en', 'es', 'English', 'Spanish', '🇬🇧', '🇪🇸', 668),
  ('ita_for_eng_v2', 'Italian', 'for English Speakers', 'en', 'it', 'English', 'Italian', '🇬🇧', '🇮🇹', 668),
  ('fra_for_eng_v2', 'French', 'for English Speakers', 'en', 'fr', 'English', 'French', '🇬🇧', '🇫🇷', 668),
  ('deu_for_eng_v2', 'German', 'for English Speakers', 'en', 'de', 'English', 'German', '🇬🇧', '🇩🇪', 668),
  ('cym_for_eng_v2', 'Welsh', 'for English Speakers', 'en', 'cy', 'English', 'Welsh', '🇬🇧', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', 668),
  ('por_for_eng_v2', 'Portuguese', 'for English Speakers', 'en', 'pt', 'English', 'Portuguese', '🇬🇧', '🇵🇹', 668),
  ('jpn_for_eng_v2', 'Japanese', 'for English Speakers', 'en', 'ja', 'English', 'Japanese', '🇬🇧', '🇯🇵', 500),
  ('zho_for_eng_v2', 'Chinese', 'for English Speakers', 'en', 'zh', 'English', 'Chinese', '🇬🇧', '🇨🇳', 500),
  ('kor_for_eng_v2', 'Korean', 'for English Speakers', 'en', 'ko', 'English', 'Korean', '🇬🇧', '🇰🇷', 500),
  ('ara_for_eng_v2', 'Arabic', 'for English Speakers', 'en', 'ar', 'English', 'Arabic', '🇬🇧', '🇸🇦', 500),
  -- Language chaining: From Spanish
  ('ita_for_spa_v1', 'Italian', 'para hispanohablantes', 'es', 'it', 'Spanish', 'Italian', '🇪🇸', '🇮🇹', 500),
  ('fra_for_spa_v1', 'French', 'para hispanohablantes', 'es', 'fr', 'Spanish', 'French', '🇪🇸', '🇫🇷', 500),
  ('por_for_spa_v1', 'Portuguese', 'para hispanohablantes', 'es', 'pt', 'Spanish', 'Portuguese', '🇪🇸', '🇵🇹', 500),
  ('eng_for_spa_v1', 'English', 'para hispanohablantes', 'es', 'en', 'Spanish', 'English', '🇪🇸', '🇬🇧', 500)
ON CONFLICT (course_code) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  total_seeds = EXCLUDED.total_seeds,
  is_active = EXCLUDED.is_active;

-- Add foreign key constraint to course_enrollments (if not already present)
-- This ensures course_enrollments.course_id references a valid course
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'course_enrollments_course_id_fkey'
  ) THEN
    ALTER TABLE course_enrollments
    ADD CONSTRAINT course_enrollments_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES courses(course_code);
  END IF;
END $$;
