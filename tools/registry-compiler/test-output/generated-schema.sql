-- SSi Learning App Database Schema
-- Generated from Registry AST
-- Supabase PostgreSQL

-- ============================================
-- FUNCTIONS
-- ============================================

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COURSE
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
CREATE POLICY "Authenticated users can view course"
  ON courses FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage course"
  ON courses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_courses_updated_at ON courses;
CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COURSE SEED
-- ============================================

CREATE TABLE IF NOT EXISTS course_seeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  seed_number INTEGER NOT NULL,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  release_batch INTEGER,
  version INTEGER NOT NULL DEFAULT '1',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (course_code) REFERENCES courses(course_code) ON DELETE CASCADE,
  UNIQUE(course_code, seed_number)
);

CREATE INDEX idx_course_seeds_course_code ON course_seeds(course_code);

-- RLS
ALTER TABLE course_seeds ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view course seed"
  ON course_seeds FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage course seed"
  ON course_seeds FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_course_seeds_updated_at ON course_seeds;
CREATE TRIGGER update_course_seeds_updated_at
  BEFORE UPDATE ON course_seeds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COURSE LEGO
-- ============================================

CREATE TABLE IF NOT EXISTS course_legos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  seed_number INTEGER NOT NULL,
  lego_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  is_new BOOLEAN NOT NULL,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  components TEXT[],
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT '1',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (course_code) REFERENCES courses(course_code) ON DELETE CASCADE,
  UNIQUE(course_code, seed_number, lego_index)
);

CREATE INDEX idx_course_legos_course_code ON course_legos(course_code);

-- RLS
ALTER TABLE course_legos ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view course lego"
  ON course_legos FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage course lego"
  ON course_legos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_course_legos_updated_at ON course_legos;
CREATE TRIGGER update_course_legos_updated_at
  BEFORE UPDATE ON course_legos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COURSE PRACTICE PHRASE
-- ============================================

CREATE TABLE IF NOT EXISTS course_practice_phrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code TEXT NOT NULL,
  seed_number INTEGER NOT NULL,
  lego_index INTEGER NOT NULL,
  position INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  lego_count INTEGER NOT NULL,
  known_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  difficulty TEXT,
  register TEXT,
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT '1',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (course_code) REFERENCES courses(course_code) ON DELETE CASCADE,
  CHECK (difficulty IN ('easy', 'medium', 'hard')),
  CHECK (register IN ('casual', 'formal')),
  UNIQUE(course_code, seed_number, lego_index, position)
);

CREATE INDEX idx_course_practice_phrases_course_code ON course_practice_phrases(course_code);

-- RLS
ALTER TABLE course_practice_phrases ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view course practice phrase"
  ON course_practice_phrases FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage course practice phrase"
  ON course_practice_phrases FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_course_practice_phrases_updated_at ON course_practice_phrases;
CREATE TRIGGER update_course_practice_phrases_updated_at
  BEFORE UPDATE ON course_practice_phrases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- AUDIO SAMPLE
-- ============================================

CREATE TABLE IF NOT EXISTS audio_samples (
  uuid TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  language TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  role TEXT NOT NULL,
  s3_key TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  version INTEGER NOT NULL DEFAULT '1',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- RLS
ALTER TABLE audio_samples ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view audio sample"
  ON audio_samples FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage audio sample"
  ON audio_samples FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_audio_samples_updated_at ON audio_samples;
CREATE TRIGGER update_audio_samples_updated_at
  BEFORE UPDATE ON audio_samples
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CANONICAL WELCOME
-- ============================================

CREATE TABLE IF NOT EXISTS canonical_welcomes (
  course_code TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  text_short TEXT,
  audio_uuid TEXT,
  voice_id TEXT NOT NULL,
  language TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (audio_uuid) REFERENCES audio_samples(uuid) ON DELETE CASCADE
);

CREATE INDEX idx_canonical_welcomes_audio_uuid ON canonical_welcomes(audio_uuid);

-- RLS
ALTER TABLE canonical_welcomes ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view canonical welcome"
  ON canonical_welcomes FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage canonical welcome"
  ON canonical_welcomes FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_canonical_welcomes_updated_at ON canonical_welcomes;
CREATE TRIGGER update_canonical_welcomes_updated_at
  BEFORE UPDATE ON canonical_welcomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CANONICAL ENCOURAGEMENT
-- ============================================

CREATE TABLE IF NOT EXISTS canonical_encouragements (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  type TEXT NOT NULL,
  order_position INTEGER,
  audio_uuid TEXT,
  voice_id TEXT,
  language TEXT NOT NULL DEFAULT 'eng',
  tags TEXT[],
  min_seeds_completed INTEGER,
  max_plays INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT 'true',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(text),
  CHECK (type IN ('pooled', 'ordered')),
  FOREIGN KEY (audio_uuid) REFERENCES audio_samples(uuid) ON DELETE CASCADE
);

CREATE INDEX idx_canonical_encouragements_audio_uuid ON canonical_encouragements(audio_uuid);

-- RLS
ALTER TABLE canonical_encouragements ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view canonical encouragement"
  ON canonical_encouragements FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage canonical encouragement"
  ON canonical_encouragements FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_canonical_encouragements_updated_at ON canonical_encouragements;
CREATE TRIGGER update_canonical_encouragements_updated_at
  BEFORE UPDATE ON canonical_encouragements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- LEARNER
-- ============================================

CREATE TABLE IF NOT EXISTS learners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learner"
  ON learners FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learner"
  ON learners FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own learner"
  ON learners FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own learner"
  ON learners FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_learners_updated_at ON learners;
CREATE TRIGGER update_learners_updated_at
  BEFORE UPDATE ON learners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COURSE ENROLLMENT
-- ============================================

CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL,
  course_code TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL,
  last_practiced_at TIMESTAMPTZ,
  total_practice_minutes INTEGER NOT NULL DEFAULT '0',
  helix_state JSONB NOT NULL DEFAULT '{}',
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  FOREIGN KEY (course_code) REFERENCES courses(course_code) ON DELETE CASCADE,
  UNIQUE(learner_id, course_code)
);

CREATE INDEX idx_course_enrollments_learner_id ON course_enrollments(learner_id);
CREATE INDEX idx_course_enrollments_course_code ON course_enrollments(course_code);

-- RLS
ALTER TABLE course_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own course enrollment"
  ON course_enrollments FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own course enrollment"
  ON course_enrollments FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own course enrollment"
  ON course_enrollments FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own course enrollment"
  ON course_enrollments FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- LEGO PROGRESS
-- ============================================

CREATE TABLE IF NOT EXISTS lego_progresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL,
  lego_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  fibonacci_position INTEGER NOT NULL DEFAULT '0',
  skip_number INTEGER NOT NULL DEFAULT '0',
  reps_completed INTEGER NOT NULL DEFAULT '0',
  is_retired BOOLEAN NOT NULL DEFAULT 'false',
  last_practiced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  UNIQUE(learner_id, lego_id)
);

CREATE INDEX idx_lego_progresses_learner_id ON lego_progresses(learner_id);

-- RLS
ALTER TABLE lego_progresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lego progress"
  ON lego_progresses FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own lego progress"
  ON lego_progresses FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own lego progress"
  ON lego_progresses FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own lego progress"
  ON lego_progresses FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_lego_progresses_updated_at ON lego_progresses;
CREATE TRIGGER update_lego_progresses_updated_at
  BEFORE UPDATE ON lego_progresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED PROGRESS
-- ============================================

CREATE TABLE IF NOT EXISTS seed_progresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL,
  seed_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  is_introduced BOOLEAN NOT NULL DEFAULT 'false',
  introduced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  UNIQUE(learner_id, seed_id)
);

CREATE INDEX idx_seed_progresses_learner_id ON seed_progresses(learner_id);

-- RLS
ALTER TABLE seed_progresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own seed progress"
  ON seed_progresses FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own seed progress"
  ON seed_progresses FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own seed progress"
  ON seed_progresses FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own seed progress"
  ON seed_progresses FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_seed_progresses_updated_at ON seed_progresses;
CREATE TRIGGER update_seed_progresses_updated_at
  BEFORE UPDATE ON seed_progresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SESSION
-- ============================================

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT '0',
  items_practiced INTEGER NOT NULL DEFAULT '0',
  spikes_detected INTEGER NOT NULL DEFAULT '0',
  final_rolling_average NUMERIC(10, 4) NOT NULL DEFAULT '0',
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_learner_id ON sessions(learner_id);

-- RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own session"
  ON sessions FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own session"
  ON sessions FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own session"
  ON sessions FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own session"
  ON sessions FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- RESPONSE METRIC
-- ============================================

CREATE TABLE IF NOT EXISTS response_metrics (
  db_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id TEXT PRIMARY KEY,
  session_id UUID NOT NULL,
  learner_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  lego_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  response_latency_ms INTEGER NOT NULL,
  phrase_length INTEGER NOT NULL,
  normalized_latency NUMERIC(10, 4) NOT NULL,
  thread_id INTEGER NOT NULL,
  triggered_spike BOOLEAN NOT NULL DEFAULT 'false',
  mode TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE
);

CREATE INDEX idx_response_metrics_session_id ON response_metrics(session_id);
CREATE INDEX idx_response_metrics_learner_id ON response_metrics(learner_id);

-- RLS
ALTER TABLE response_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own response metric"
  ON response_metrics FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own response metric"
  ON response_metrics FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own response metric"
  ON response_metrics FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own response metric"
  ON response_metrics FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- SPIKE EVENT
-- ============================================

CREATE TABLE IF NOT EXISTS spike_events (
  db_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id TEXT PRIMARY KEY,
  session_id UUID NOT NULL,
  learner_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  lego_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  latency NUMERIC(10, 4) NOT NULL,
  rolling_average NUMERIC(10, 4) NOT NULL,
  spike_ratio NUMERIC(10, 4) NOT NULL,
  response TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  CHECK (response IN ('repeat', 'breakdown'))
);

CREATE INDEX idx_spike_events_session_id ON spike_events(session_id);
CREATE INDEX idx_spike_events_learner_id ON spike_events(learner_id);

-- RLS
ALTER TABLE spike_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own spike event"
  ON spike_events FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own spike event"
  ON spike_events FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own spike event"
  ON spike_events FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own spike event"
  ON spike_events FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- LEARNER BASELINE
-- ============================================

CREATE TABLE IF NOT EXISTS learner_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  calibrated_at TIMESTAMPTZ NOT NULL,
  calibration_items INTEGER NOT NULL,
  latency_mean NUMERIC(10, 4) NOT NULL,
  latency_std_dev NUMERIC(10, 4) NOT NULL,
  duration_delta_mean NUMERIC(10, 4) NOT NULL,
  duration_delta_std_dev NUMERIC(10, 4) NOT NULL,
  had_timing_data BOOLEAN NOT NULL DEFAULT 'false',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (learner_id) REFERENCES learners(id) ON DELETE CASCADE,
  UNIQUE(learner_id, course_id)
);

CREATE INDEX idx_learner_baselines_learner_id ON learner_baselines(learner_id);

-- RLS
ALTER TABLE learner_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learner baseline"
  ON learner_baselines FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own learner baseline"
  ON learner_baselines FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own learner baseline"
  ON learner_baselines FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own learner baseline"
  ON learner_baselines FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_learner_baselines_updated_at ON learner_baselines;
CREATE TRIGGER update_learner_baselines_updated_at
  BEFORE UPDATE ON learner_baselines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CLASSIFICATION CONFIG
-- ============================================

CREATE TABLE IF NOT EXISTS classification_configs (
  config_key TEXT PRIMARY KEY,
  eternal_count INTEGER NOT NULL DEFAULT '5',
  eternal_selection_mode TEXT NOT NULL DEFAULT 'top_n',
  debut_max INTEGER DEFAULT '7',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (eternal_selection_mode IN ('top_n', 'min_word_count', 'percentage'))
);

-- RLS
ALTER TABLE classification_configs ENABLE ROW LEVEL SECURITY;

-- Public content table - authenticated users can read
CREATE POLICY "Authenticated users can view classification config"
  ON classification_configs FOR SELECT
  TO authenticated
  USING (true);

-- Admin-only write (use service role or create admin role)
CREATE POLICY "Service role can manage classification config"
  ON classification_configs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS update_classification_configs_updated_at ON classification_configs;
CREATE TRIGGER update_classification_configs_updated_at
  BEFORE UPDATE ON classification_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- LEARNER TEMPO PROFILE
-- ============================================

CREATE TABLE IF NOT EXISTS learner_tempo_profiles (
  learner_id UUID NOT NULL,
  tempo_band TEXT NOT NULL,
  consistency_band TEXT NOT NULL,
  mean_normalized_latency NUMERIC(10, 4) NOT NULL,
  variance_coefficient NUMERIC(10, 4) NOT NULL,
  assessment_complete BOOLEAN NOT NULL DEFAULT 'false',
  assessment_item_count INTEGER NOT NULL DEFAULT '0',
  sessions_in_current_band INTEGER NOT NULL DEFAULT '0',
  last_refined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

-- RLS
ALTER TABLE learner_tempo_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learner tempo profile"
  ON learner_tempo_profiles FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own learner tempo profile"
  ON learner_tempo_profiles FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own learner tempo profile"
  ON learner_tempo_profiles FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own learner tempo profile"
  ON learner_tempo_profiles FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));