-- ============================================
-- CONTENT TABLES
-- Course content populated by Dashboard (Popty)
-- Required for cycle views to function
-- ============================================

-- ============================================
-- COURSES
-- Course metadata and voice configuration
-- ============================================

CREATE TABLE IF NOT EXISTS courses (
  course_code TEXT PRIMARY KEY,
  known_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  display_name TEXT,
  known_voice TEXT NOT NULL,
  target_voice_1 TEXT NOT NULL,
  target_voice_2 TEXT NOT NULL,
  presentation_voice TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
DROP POLICY IF EXISTS "Authenticated users can view courses" ON courses;
CREATE POLICY "Authenticated users can view courses"
  ON courses FOR SELECT
  TO authenticated
  USING (true);

-- Service role can manage
DROP POLICY IF EXISTS "Service role can manage courses" ON courses;
CREATE POLICY "Service role can manage courses"
  ON courses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- COURSE SEEDS
-- Full sentences (source material)
-- ============================================

CREATE TABLE IF NOT EXISTS course_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE,
  seed_number INTEGER NOT NULL,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  release_batch INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_code, seed_number)
);

CREATE INDEX IF NOT EXISTS idx_course_seeds_course_code ON course_seeds(course_code);

-- RLS
ALTER TABLE course_seeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view course_seeds" ON course_seeds;
CREATE POLICY "Authenticated users can view course_seeds"
  ON course_seeds FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage course_seeds" ON course_seeds;
CREATE POLICY "Service role can manage course_seeds"
  ON course_seeds FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- COURSE LEGOS
-- Learning units extracted from seeds
-- ============================================

CREATE TABLE IF NOT EXISTS course_legos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE,
  seed_number INTEGER NOT NULL,
  lego_index INTEGER NOT NULL,
  lego_id TEXT GENERATED ALWAYS AS (
    'S' || lpad(seed_number::text, 4, '0') || 'L' || lpad(lego_index::text, 2, '0')
  ) STORED,
  type TEXT NOT NULL CHECK (type IN ('A', 'M')),
  is_new BOOLEAN NOT NULL DEFAULT true,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  components TEXT[],
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_code, seed_number, lego_index)
);

CREATE INDEX IF NOT EXISTS idx_course_legos_course_code ON course_legos(course_code);
CREATE INDEX IF NOT EXISTS idx_course_legos_lego_id ON course_legos(lego_id);

-- RLS
ALTER TABLE course_legos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view course_legos" ON course_legos;
CREATE POLICY "Authenticated users can view course_legos"
  ON course_legos FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage course_legos" ON course_legos;
CREATE POLICY "Service role can manage course_legos"
  ON course_legos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- COURSE PRACTICE PHRASES
-- Practice sentences for each LEGO
-- Position determines phrase type:
--   0 = component (parts of M-type LEGOs)
--   1 = debut (the LEGO itself)
--   2-7 = debut/practice phrases
--   8+ = eternal phrases
-- ============================================

CREATE TABLE IF NOT EXISTS course_practice_phrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE,
  seed_number INTEGER NOT NULL,
  lego_index INTEGER NOT NULL,
  position INTEGER NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 1,
  lego_count INTEGER NOT NULL DEFAULT 1,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  register TEXT CHECK (register IN ('casual', 'formal')),
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_code, seed_number, lego_index, position)
);

CREATE INDEX IF NOT EXISTS idx_course_practice_phrases_course_code ON course_practice_phrases(course_code);
CREATE INDEX IF NOT EXISTS idx_course_practice_phrases_lego ON course_practice_phrases(course_code, seed_number, lego_index);

-- RLS
ALTER TABLE course_practice_phrases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view course_practice_phrases" ON course_practice_phrases;
CREATE POLICY "Authenticated users can view course_practice_phrases"
  ON course_practice_phrases FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage course_practice_phrases" ON course_practice_phrases;
CREATE POLICY "Service role can manage course_practice_phrases"
  ON course_practice_phrases FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- AUDIO SAMPLES
-- Audio file references (populated by Phase 8)
-- ============================================

CREATE TABLE IF NOT EXISTS audio_samples (
  uuid TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  language TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('source', 'target1', 'target2', 'presentation')),
  s3_key TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_samples_text_role ON audio_samples(text_normalized, role);
CREATE INDEX IF NOT EXISTS idx_audio_samples_status ON audio_samples(status);

-- RLS
ALTER TABLE audio_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view audio_samples" ON audio_samples;
CREATE POLICY "Authenticated users can view audio_samples"
  ON audio_samples FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage audio_samples" ON audio_samples;
CREATE POLICY "Service role can manage audio_samples"
  ON audio_samples FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- LEGO INTRODUCTIONS
-- "The Spanish for X is..." audio
-- ============================================

CREATE TABLE IF NOT EXISTS lego_introductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL REFERENCES courses(course_code) ON DELETE CASCADE,
  lego_id TEXT NOT NULL,
  audio_uuid TEXT REFERENCES audio_samples(uuid),
  duration_ms INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_code, lego_id)
);

CREATE INDEX IF NOT EXISTS idx_lego_introductions_lego ON lego_introductions(course_code, lego_id);

-- RLS
ALTER TABLE lego_introductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view lego_introductions" ON lego_introductions;
CREATE POLICY "Authenticated users can view lego_introductions"
  ON lego_introductions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage lego_introductions" ON lego_introductions;
CREATE POLICY "Service role can manage lego_introductions"
  ON lego_introductions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE courses IS 'Course metadata and voice configuration';
COMMENT ON TABLE course_seeds IS 'Full sentences - source material for learning';
COMMENT ON TABLE course_legos IS 'Learning units extracted from seeds';
COMMENT ON TABLE course_practice_phrases IS 'Practice sentences for each LEGO, organized by position';
COMMENT ON TABLE audio_samples IS 'Audio file references - text+role lookup for audio UUIDs';
COMMENT ON TABLE lego_introductions IS 'Introduction audio for new LEGOs';

COMMENT ON COLUMN course_legos.type IS 'A = Atomic (single word), M = Molecular (multi-word phrase)';
COMMENT ON COLUMN course_legos.is_new IS 'true if this LEGO is being introduced for the first time in this seed';
COMMENT ON COLUMN course_practice_phrases.position IS '0=component, 1=debut, 2-7=practice, 8+=eternal';
COMMENT ON COLUMN audio_samples.role IS 'source=known language, target1/target2=target language voices';
