-- ============================================
-- GAMIFICATION TABLES
-- Points, evolution, milestones, contributions
--
-- Philosophy: Show results, hide mechanics.
-- Points come from hidden formula - can't be gamed.
-- ============================================

-- ============================================
-- LEARNER POINTS
-- Accumulated points and evolution per learner+course
-- ============================================

CREATE TABLE IF NOT EXISTS learner_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,

  -- Accumulated totals
  total_points INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,

  -- Evolution system (visible progress, hidden formula)
  evolution_score INTEGER NOT NULL DEFAULT 0,
  evolution_level SMALLINT NOT NULL DEFAULT 1,
  evolution_name TEXT NOT NULL DEFAULT 'First Words',

  -- Cached consistency data (updated on session end)
  sessions_last_10_days SMALLINT NOT NULL DEFAULT 0,
  sessions_last_30_days SMALLINT NOT NULL DEFAULT 0,
  current_consistency_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.0,

  -- Timestamps
  last_session_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(learner_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_points_learner ON learner_points(learner_id);
CREATE INDEX IF NOT EXISTS idx_learner_points_course ON learner_points(course_id);
CREATE INDEX IF NOT EXISTS idx_learner_points_evolution ON learner_points(course_id, evolution_score DESC);

-- RLS
ALTER TABLE learner_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own points" ON learner_points;
CREATE POLICY "Users can view own points"
  ON learner_points FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own points" ON learner_points;
CREATE POLICY "Users can insert own points"
  ON learner_points FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own points" ON learner_points;
CREATE POLICY "Users can update own points"
  ON learner_points FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- LEARNER MILESTONES
-- Journey timeline - transformation evidence
-- ============================================

CREATE TABLE IF NOT EXISTS learner_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,

  -- Milestone type (extensible via TEXT, not enum)
  milestone_type TEXT NOT NULL,
  -- Examples: first_session, 10_legos_confident, 50_legos_confident,
  --           response_under_2s, response_under_1s, natural_prosody,
  --           first_skip, first_revisit, 7_day_consistency, 30_day_consistency,
  --           seed_bank_first, evolution_level_5, evolution_level_10

  -- When it happened
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Context (the specific LEGO, time value, etc.)
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Display text (optional - can be computed)
  display_text TEXT,
  display_icon TEXT,

  UNIQUE(learner_id, course_id, milestone_type)
);

CREATE INDEX IF NOT EXISTS idx_milestones_learner ON learner_milestones(learner_id);
CREATE INDEX IF NOT EXISTS idx_milestones_learner_course ON learner_milestones(learner_id, course_id);
CREATE INDEX IF NOT EXISTS idx_milestones_achieved ON learner_milestones(learner_id, achieved_at DESC);

-- RLS
ALTER TABLE learner_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own milestones" ON learner_milestones;
CREATE POLICY "Users can view own milestones"
  ON learner_milestones FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert own milestones" ON learner_milestones;
CREATE POLICY "Users can insert own milestones"
  ON learner_milestones FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- ============================================
-- DAILY CONTRIBUTIONS
-- Aggregate stats per language per day
-- "Welsh Spoken Today" counter
-- ============================================

CREATE TABLE IF NOT EXISTS daily_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_language TEXT NOT NULL,  -- 3-letter code (e.g., 'cym', 'spa')
  contribution_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Aggregated metrics
  phrases_count INTEGER NOT NULL DEFAULT 0,
  minutes_practiced INTEGER NOT NULL DEFAULT 0,
  unique_speakers INTEGER NOT NULL DEFAULT 0,

  -- Updated via triggers or batch job
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(target_language, contribution_date)
);

CREATE INDEX IF NOT EXISTS idx_contributions_date ON daily_contributions(contribution_date DESC);
CREATE INDEX IF NOT EXISTS idx_contributions_lang_date ON daily_contributions(target_language, contribution_date DESC);

-- RLS - contributions are public (read-only for authenticated)
ALTER TABLE daily_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view contributions" ON daily_contributions;
CREATE POLICY "Anyone can view contributions"
  ON daily_contributions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage contributions" ON daily_contributions;
CREATE POLICY "Service role can manage contributions"
  ON daily_contributions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- EXTEND SESSIONS TABLE
-- Add points earned per session
-- ============================================

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS bonus_messages JSONB NOT NULL DEFAULT '[]';

-- ============================================
-- GAMIFICATION CONFIG
-- All parameters are configurable - nothing hardcoded
-- Can be overridden per course or globally
-- ============================================

CREATE TABLE IF NOT EXISTS gamification_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id TEXT,  -- NULL = global default, specific course_id = override

  -- Point formula parameters
  base_points_audio_detected INTEGER NOT NULL DEFAULT 1,
  latency_bonus_flow_state INTEGER NOT NULL DEFAULT 3,      -- Much faster than baseline
  latency_bonus_faster INTEGER NOT NULL DEFAULT 2,          -- Faster than usual
  latency_bonus_baseline INTEGER NOT NULL DEFAULT 1,        -- At baseline
  latency_bonus_slower INTEGER NOT NULL DEFAULT 0,          -- No penalty

  duration_match_within_10_pct INTEGER NOT NULL DEFAULT 2,  -- Natural rhythm
  duration_match_within_20_pct INTEGER NOT NULL DEFAULT 1,
  duration_match_beyond_20_pct INTEGER NOT NULL DEFAULT 0,

  skip_bonus_confident INTEGER NOT NULL DEFAULT 3,          -- Skip consolidated LEGO
  revisit_bonus_honest INTEGER NOT NULL DEFAULT 2,          -- Self-awareness

  -- Consistency multiplier thresholds (10-day window)
  consistency_10d_threshold_high INTEGER NOT NULL DEFAULT 7,    -- x1.5
  consistency_10d_threshold_med INTEGER NOT NULL DEFAULT 5,     -- x1.3
  consistency_10d_threshold_low INTEGER NOT NULL DEFAULT 3,     -- x1.1
  consistency_10d_multiplier_high NUMERIC(3,2) NOT NULL DEFAULT 1.5,
  consistency_10d_multiplier_med NUMERIC(3,2) NOT NULL DEFAULT 1.3,
  consistency_10d_multiplier_low NUMERIC(3,2) NOT NULL DEFAULT 1.1,

  -- Consistency multiplier thresholds (30-day window, stacks)
  consistency_30d_threshold_high INTEGER NOT NULL DEFAULT 25,   -- x2.0
  consistency_30d_threshold_med INTEGER NOT NULL DEFAULT 20,    -- x1.5
  consistency_30d_threshold_low INTEGER NOT NULL DEFAULT 15,    -- x1.2
  consistency_30d_multiplier_high NUMERIC(3,2) NOT NULL DEFAULT 2.0,
  consistency_30d_multiplier_med NUMERIC(3,2) NOT NULL DEFAULT 1.5,
  consistency_30d_multiplier_low NUMERIC(3,2) NOT NULL DEFAULT 1.2,

  -- Hidden consistency bonuses
  bonus_7_of_10_days INTEGER NOT NULL DEFAULT 100,
  bonus_25_of_30_days_multiplier NUMERIC(3,2) NOT NULL DEFAULT 2.0,
  bonus_return_3_days INTEGER NOT NULL DEFAULT 50,
  bonus_return_7_days INTEGER NOT NULL DEFAULT 100,

  -- Return message thresholds (days)
  return_threshold_consolidating INTEGER NOT NULL DEFAULT 3,
  return_threshold_deep INTEGER NOT NULL DEFAULT 7,
  return_threshold_long INTEGER NOT NULL DEFAULT 30,

  -- Pomodoro nudge thresholds (minutes)
  pomodoro_first_nudge_minutes INTEGER NOT NULL DEFAULT 25,
  pomodoro_second_nudge_minutes INTEGER NOT NULL DEFAULT 35,
  pomodoro_third_nudge_minutes INTEGER NOT NULL DEFAULT 45,
  pomodoro_offer_listening_minutes INTEGER NOT NULL DEFAULT 60,

  -- Seed bank threshold
  seed_bank_threshold_days INTEGER NOT NULL DEFAULT 60,

  -- Session structure evolution (production vs listening %)
  session_early_production_pct INTEGER NOT NULL DEFAULT 90,   -- Seeds 1-50
  session_mid_production_pct INTEGER NOT NULL DEFAULT 70,     -- Seeds 50-150
  session_late_production_pct INTEGER NOT NULL DEFAULT 50,    -- Seeds 150+
  session_early_threshold INTEGER NOT NULL DEFAULT 50,
  session_mid_threshold INTEGER NOT NULL DEFAULT 150,

  -- Leaderboard settings
  leaderboard_top_n INTEGER NOT NULL DEFAULT 5,
  leaderboard_period_days INTEGER NOT NULL DEFAULT 7,

  -- Return messages (celebration, not guilt!)
  return_message_ready TEXT NOT NULL DEFAULT 'Ready when you are.',
  return_message_consolidating TEXT NOT NULL DEFAULT 'Your brain has been consolidating. Let''s see what stuck!',
  return_message_deep TEXT NOT NULL DEFAULT 'Deep consolidation complete. You might surprise yourself.',
  return_message_long TEXT NOT NULL DEFAULT 'Welcome back. Your brain remembers more than you think.',

  -- Pomodoro nudge messages
  pomodoro_message_first TEXT NOT NULL DEFAULT 'Your brain has been working hard. Good moment to pause.',
  pomodoro_message_second TEXT NOT NULL DEFAULT 'Research shows learning in chunks works better.',
  pomodoro_message_third TEXT NOT NULL DEFAULT 'You''ve been amazing today. Time for your brain to rest?',
  pomodoro_message_listening TEXT NOT NULL DEFAULT 'Would you like to switch to listening mode?',

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(course_id)  -- Only one config per course (NULL for global)
);

-- Insert global defaults
INSERT INTO gamification_config (course_id) VALUES (NULL)
ON CONFLICT (course_id) DO NOTHING;

-- RLS - config readable by authenticated, writable by service role (admin)
ALTER TABLE gamification_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view config" ON gamification_config;
CREATE POLICY "Authenticated can view config"
  ON gamification_config FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage config" ON gamification_config;
CREATE POLICY "Service role can manage config"
  ON gamification_config FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to get config for a course (falls back to global)
CREATE OR REPLACE FUNCTION get_gamification_config(p_course_id TEXT)
RETURNS gamification_config AS $$
DECLARE
  result gamification_config;
BEGIN
  -- Try course-specific first
  SELECT * INTO result FROM gamification_config WHERE course_id = p_course_id;

  -- Fall back to global
  IF NOT FOUND THEN
    SELECT * INTO result FROM gamification_config WHERE course_id IS NULL;
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- EVOLUTION LEVELS REFERENCE
-- Configuration table for evolution thresholds
-- ============================================

CREATE TABLE IF NOT EXISTS evolution_levels (
  level SMALLINT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  min_score INTEGER NOT NULL,
  icon TEXT
);

INSERT INTO evolution_levels (level, name, description, min_score, icon) VALUES
  (1, 'First Words', 'The journey begins', 0, '🌱'),
  (2, 'Finding Voice', 'Starting to speak', 100, '🗣️'),
  (3, 'Building Blocks', 'Patterns emerging', 300, '🧱'),
  (4, 'Growing Confidence', 'Words flowing easier', 600, '📈'),
  (5, 'Confident Speaker', 'Words flowing naturally', 1000, '💬'),
  (6, 'Finding Rhythm', 'Cadence developing', 1500, '🎵'),
  (7, 'Smooth Talker', 'Responses quickening', 2200, '⚡'),
  (8, 'Conversation Ready', 'Ready for real talk', 3000, '🤝'),
  (9, 'Fluent Flow', 'Speaking feels natural', 4000, '🌊'),
  (10, 'Conversation Starter', 'Ready to engage', 5500, '💡'),
  (11, 'Cultural Bridge', 'Connecting worlds', 7000, '🌉'),
  (12, 'Expression Master', 'Nuance understood', 9000, '🎭'),
  (13, 'Rhythm Native', 'Prosody natural', 11500, '🎼'),
  (14, 'Deep Listener', 'Understanding flows', 14000, '👂'),
  (15, 'Native Rhythm', 'Speaking feels like home', 17000, '🏠'),
  (16, 'Language Keeper', 'Preserving the tongue', 20500, '📚'),
  (17, 'Voice of Tradition', 'Carrying forward', 24000, '🔥'),
  (18, 'Cultural Guardian', 'Protecting heritage', 28000, '🛡️'),
  (19, 'Language Elder', 'Wisdom earned', 33000, '🦉'),
  (20, 'Language Guardian', 'Keeper of the tongue', 40000, '👑')
ON CONFLICT (level) DO NOTHING;

-- RLS - levels are public reference data
ALTER TABLE evolution_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view evolution levels" ON evolution_levels;
CREATE POLICY "Anyone can view evolution levels"
  ON evolution_levels FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- VIEWS
-- ============================================

-- Weekly leaderboard view (Top 5 + percentile calculation)
CREATE OR REPLACE VIEW weekly_leaderboard AS
WITH weekly_stats AS (
  SELECT
    s.learner_id,
    s.course_id,
    SUM(s.points_earned) as weekly_points,
    COUNT(*) as session_count
  FROM sessions s
  WHERE s.started_at >= date_trunc('week', CURRENT_TIMESTAMP)
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
FROM ranked;

-- Consistency calculator view
CREATE OR REPLACE VIEW learner_consistency AS
SELECT
  learner_id,
  course_id,
  COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') as sessions_10d,
  COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') as sessions_30d,
  EXTRACT(DAY FROM NOW() - MAX(started_at)) as days_since_last,
  CASE
    -- 10-day multiplier
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 7 THEN 1.5
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 5 THEN 1.3
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '10 days') >= 3 THEN 1.1
    ELSE 1.0
  END *
  CASE
    -- 30-day multiplier (stacks)
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 25 THEN 2.0
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 20 THEN 1.5
    WHEN COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '30 days') >= 15 THEN 1.2
    ELSE 1.0
  END as consistency_multiplier
FROM sessions
GROUP BY learner_id, course_id;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to calculate evolution level from score
CREATE OR REPLACE FUNCTION get_evolution_level(score INTEGER)
RETURNS TABLE(level SMALLINT, name TEXT, icon TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT el.level, el.name, el.icon
  FROM evolution_levels el
  WHERE el.min_score <= score
  ORDER BY el.min_score DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get return message based on days away (uses config)
CREATE OR REPLACE FUNCTION get_return_message(days_away INTEGER, p_course_id TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  cfg gamification_config;
BEGIN
  cfg := get_gamification_config(p_course_id);

  IF days_away IS NULL OR days_away <= 1 THEN
    RETURN cfg.return_message_ready;
  ELSIF days_away <= cfg.return_threshold_consolidating THEN
    RETURN cfg.return_message_consolidating;
  ELSIF days_away <= cfg.return_threshold_deep THEN
    RETURN cfg.return_message_deep;
  ELSE
    RETURN cfg.return_message_long;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get pomodoro nudge message (uses config)
CREATE OR REPLACE FUNCTION get_pomodoro_message(minutes_elapsed INTEGER, p_course_id TEXT DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
  cfg gamification_config;
BEGIN
  cfg := get_gamification_config(p_course_id);

  IF minutes_elapsed >= cfg.pomodoro_offer_listening_minutes THEN
    RETURN cfg.pomodoro_message_listening;
  ELSIF minutes_elapsed >= cfg.pomodoro_third_nudge_minutes THEN
    RETURN cfg.pomodoro_message_third;
  ELSIF minutes_elapsed >= cfg.pomodoro_second_nudge_minutes THEN
    RETURN cfg.pomodoro_message_second;
  ELSIF minutes_elapsed >= cfg.pomodoro_first_nudge_minutes THEN
    RETURN cfg.pomodoro_message_first;
  ELSE
    RETURN NULL;  -- No nudge yet
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate consistency multiplier (uses config)
CREATE OR REPLACE FUNCTION calculate_consistency_multiplier(
  sessions_10d INTEGER,
  sessions_30d INTEGER,
  p_course_id TEXT DEFAULT NULL
)
RETURNS NUMERIC AS $$
DECLARE
  cfg gamification_config;
  mult_10d NUMERIC := 1.0;
  mult_30d NUMERIC := 1.0;
BEGIN
  cfg := get_gamification_config(p_course_id);

  -- 10-day multiplier
  IF sessions_10d >= cfg.consistency_10d_threshold_high THEN
    mult_10d := cfg.consistency_10d_multiplier_high;
  ELSIF sessions_10d >= cfg.consistency_10d_threshold_med THEN
    mult_10d := cfg.consistency_10d_multiplier_med;
  ELSIF sessions_10d >= cfg.consistency_10d_threshold_low THEN
    mult_10d := cfg.consistency_10d_multiplier_low;
  END IF;

  -- 30-day multiplier (stacks)
  IF sessions_30d >= cfg.consistency_30d_threshold_high THEN
    mult_30d := cfg.consistency_30d_multiplier_high;
  ELSIF sessions_30d >= cfg.consistency_30d_threshold_med THEN
    mult_30d := cfg.consistency_30d_multiplier_med;
  ELSIF sessions_30d >= cfg.consistency_30d_threshold_low THEN
    mult_30d := cfg.consistency_30d_multiplier_low;
  END IF;

  RETURN mult_10d * mult_30d;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update updated_at on learner_points
DROP TRIGGER IF EXISTS update_learner_points_updated_at ON learner_points;
CREATE TRIGGER update_learner_points_updated_at
  BEFORE UPDATE ON learner_points
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE learner_points IS 'Accumulated points and evolution progress per learner+course';
COMMENT ON TABLE learner_milestones IS 'Journey timeline - transformation evidence';
COMMENT ON TABLE daily_contributions IS 'Aggregate language contribution stats - "Welsh Spoken Today"';
COMMENT ON TABLE evolution_levels IS 'Reference table for evolution level thresholds and names';

COMMENT ON COLUMN learner_points.evolution_score IS 'Hidden formula result - f(consistency, latency, prosody, frequency)';
COMMENT ON COLUMN learner_points.current_consistency_multiplier IS 'Cached multiplier from sessions in last 10/30 days';
COMMENT ON COLUMN sessions.points_earned IS 'Points earned this session (shown to user, formula hidden)';
COMMENT ON COLUMN sessions.bonus_messages IS 'Array of bonus messages to show user (e.g., "✨ Consistency bonus activated")';
