-- Learner Baselines (Calibration Data)
-- Stores the calibrated timing baseline per learner per course
-- Used for continuous adaptation relative to learner's personal patterns

-- ============================================
-- LEARNER BASELINES
-- ============================================

CREATE TABLE IF NOT EXISTS learner_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL,

  -- Calibration metadata
  calibrated_at TIMESTAMPTZ NOT NULL,
  calibration_items INTEGER NOT NULL,

  -- Latency statistics (normalized: ms per character)
  latency_mean NUMERIC(10, 4) NOT NULL,
  latency_std_dev NUMERIC(10, 4) NOT NULL,

  -- Duration delta statistics (ms difference from model audio)
  duration_delta_mean NUMERIC(10, 4) NOT NULL,
  duration_delta_std_dev NUMERIC(10, 4) NOT NULL,

  -- Whether learner had microphone/timing data during calibration
  had_timing_data BOOLEAN NOT NULL DEFAULT FALSE,

  -- Optional metadata (device type, notes, etc.)
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One baseline per learner per course
  UNIQUE(learner_id, course_id)
);

-- Indexes
CREATE INDEX idx_baselines_learner ON learner_baselines(learner_id);
CREATE INDEX idx_baselines_learner_course ON learner_baselines(learner_id, course_id);

-- RLS
ALTER TABLE learner_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own baselines"
  ON learner_baselines FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own baselines"
  ON learner_baselines FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own baselines"
  ON learner_baselines FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own baselines"
  ON learner_baselines FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()));

-- Auto-update updated_at trigger
DROP TRIGGER IF EXISTS update_learner_baselines_updated_at ON learner_baselines;
CREATE TRIGGER update_learner_baselines_updated_at
  BEFORE UPDATE ON learner_baselines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE learner_baselines IS 'Calibrated timing baseline per learner per course for adaptive learning';
COMMENT ON COLUMN learner_baselines.calibrated_at IS 'When the baseline was established';
COMMENT ON COLUMN learner_baselines.calibration_items IS 'Number of items used to establish baseline';
COMMENT ON COLUMN learner_baselines.latency_mean IS 'Mean normalized latency (ms per character)';
COMMENT ON COLUMN learner_baselines.latency_std_dev IS 'Standard deviation of normalized latency';
COMMENT ON COLUMN learner_baselines.duration_delta_mean IS 'Mean difference between learner and model duration (ms)';
COMMENT ON COLUMN learner_baselines.duration_delta_std_dev IS 'Standard deviation of duration delta';
COMMENT ON COLUMN learner_baselines.had_timing_data IS 'Whether microphone/VAD timing was available during calibration';
