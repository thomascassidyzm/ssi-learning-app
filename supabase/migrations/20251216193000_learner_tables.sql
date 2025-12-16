-- SSi Learning App Database Schema
-- Supabase PostgreSQL

-- ============================================
-- LEARNERS
-- ============================================

CREATE TABLE IF NOT EXISTS learners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  preferences JSONB NOT NULL DEFAULT '{
    "session_duration_minutes": 15,
    "encouragements_enabled": true,
    "turbo_mode_enabled": false,
    "volume": 1.0
  }'::jsonb,

  UNIQUE(user_id)
);

-- RLS
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learner profile"
  ON learners FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own learner profile"
  ON learners FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own learner profile"
  ON learners FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- COURSE ENROLLMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_practiced_at TIMESTAMPTZ,
  total_practice_minutes INTEGER NOT NULL DEFAULT 0,
  helix_state JSONB NOT NULL DEFAULT '{
    "active_thread": 1,
    "threads": {
      "1": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0},
      "2": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0},
      "3": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}
    },
    "injected_content": {}
  }'::jsonb,

  UNIQUE(learner_id, course_id)
);

CREATE INDEX idx_enrollments_learner ON course_enrollments(learner_id);
CREATE INDEX idx_enrollments_course ON course_enrollments(course_id);

-- RLS
ALTER TABLE course_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enrollments"
  ON course_enrollments FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own enrollments"
  ON course_enrollments FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own enrollments"
  ON course_enrollments FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- LEGO PROGRESS
-- ============================================

CREATE TABLE IF NOT EXISTS lego_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  lego_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  thread_id SMALLINT NOT NULL CHECK (thread_id BETWEEN 1 AND 3),
  fibonacci_position SMALLINT NOT NULL DEFAULT 0,
  skip_number INTEGER NOT NULL DEFAULT 0,
  reps_completed SMALLINT NOT NULL DEFAULT 0,
  is_retired BOOLEAN NOT NULL DEFAULT FALSE,
  last_practiced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(learner_id, lego_id)
);

CREATE INDEX idx_lego_progress_learner_course ON lego_progress(learner_id, course_id);
CREATE INDEX idx_lego_progress_thread ON lego_progress(learner_id, course_id, thread_id);

-- RLS
ALTER TABLE lego_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lego progress"
  ON lego_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own lego progress"
  ON lego_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own lego progress"
  ON lego_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- SEED PROGRESS
-- ============================================

CREATE TABLE IF NOT EXISTS seed_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  thread_id SMALLINT NOT NULL CHECK (thread_id BETWEEN 1 AND 3),
  is_introduced BOOLEAN NOT NULL DEFAULT FALSE,
  introduced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(learner_id, seed_id)
);

CREATE INDEX idx_seed_progress_learner_course ON seed_progress(learner_id, course_id);

-- RLS
ALTER TABLE seed_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own seed progress"
  ON seed_progress FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own seed progress"
  ON seed_progress FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own seed progress"
  ON seed_progress FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- SESSIONS
-- ============================================

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  items_practiced INTEGER NOT NULL DEFAULT 0,
  spikes_detected INTEGER NOT NULL DEFAULT 0,
  final_rolling_average NUMERIC(10, 4) NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_learner ON sessions(learner_id);
CREATE INDEX idx_sessions_learner_started ON sessions(learner_id, started_at DESC);

-- RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON sessions FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own sessions"
  ON sessions FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own sessions"
  ON sessions FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- RESPONSE METRICS
-- ============================================

CREATE TABLE IF NOT EXISTS response_metrics (
  db_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  lego_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  response_latency_ms INTEGER NOT NULL,
  phrase_length INTEGER NOT NULL,
  normalized_latency NUMERIC(10, 4) NOT NULL,
  thread_id SMALLINT NOT NULL,
  triggered_spike BOOLEAN NOT NULL DEFAULT FALSE,
  mode TEXT NOT NULL
);

CREATE INDEX idx_metrics_session ON response_metrics(session_id);
CREATE INDEX idx_metrics_learner ON response_metrics(learner_id);
CREATE INDEX idx_metrics_timestamp ON response_metrics(learner_id, timestamp DESC);

-- RLS
ALTER TABLE response_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own metrics"
  ON response_metrics FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own metrics"
  ON response_metrics FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- SPIKE EVENTS
-- ============================================

CREATE TABLE IF NOT EXISTS spike_events (
  db_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id TEXT NOT NULL,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,
  lego_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  latency NUMERIC(10, 4) NOT NULL,
  rolling_average NUMERIC(10, 4) NOT NULL,
  spike_ratio NUMERIC(10, 4) NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('repeat', 'breakdown')),
  thread_id SMALLINT NOT NULL
);

CREATE INDEX idx_spikes_session ON spike_events(session_id);
CREATE INDEX idx_spikes_learner ON spike_events(learner_id);

-- RLS
ALTER TABLE spike_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own spikes"
  ON spike_events FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own spikes"
  ON spike_events FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

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

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS update_learners_updated_at ON learners;
CREATE TRIGGER update_learners_updated_at
  BEFORE UPDATE ON learners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_lego_progress_updated_at ON lego_progress;
CREATE TRIGGER update_lego_progress_updated_at
  BEFORE UPDATE ON lego_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_seed_progress_updated_at ON seed_progress;
CREATE TRIGGER update_seed_progress_updated_at
  BEFORE UPDATE ON seed_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create learner profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.learners (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- VIEWS (for analytics)
-- ============================================

-- Learner stats view
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
