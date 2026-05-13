-- Per-LEGO adaptive metrics
-- Tracks mastery state per (learner, lego) for per-LEGO pause adaptation.
-- Read on player mount, upserted every 10 cycles + on pagehide.

CREATE TABLE IF NOT EXISTS learner_lego_metrics (
  learner_id          UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  lego_id             TEXT NOT NULL,
  course_code         TEXT NOT NULL,
  mastery_state       TEXT NOT NULL DEFAULT 'acquisition'
    CHECK (mastery_state IN ('acquisition','consolidating','confident','mastered')),
  consecutive_smooth  INTEGER NOT NULL DEFAULT 0,
  consecutive_fast    INTEGER NOT NULL DEFAULT 0,
  n_samples           INTEGER NOT NULL DEFAULT 0,
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (learner_id, lego_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_lego_metrics_learner_course
  ON learner_lego_metrics(learner_id, course_code);

ALTER TABLE learner_lego_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lego metrics"
  ON learner_lego_metrics FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert own lego metrics"
  ON learner_lego_metrics FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update own lego metrics"
  ON learner_lego_metrics FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete own lego metrics"
  ON learner_lego_metrics FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP TRIGGER IF EXISTS update_learner_lego_metrics_updated_at ON learner_lego_metrics;
CREATE TRIGGER update_learner_lego_metrics_updated_at
  BEFORE UPDATE ON learner_lego_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE learner_lego_metrics IS 'Per-LEGO mastery state for adaptive pause timing. Sparse; only LEGOs the learner has practiced.';
COMMENT ON COLUMN learner_lego_metrics.mastery_state IS 'acquisition -> consolidating -> confident -> mastered. Drives pause multiplier.';
COMMENT ON COLUMN learner_lego_metrics.consecutive_smooth IS 'Smooth responses since last reset. Advances state at threshold (default 3).';
COMMENT ON COLUMN learner_lego_metrics.consecutive_fast IS 'Fast responses since last reset. Fast-tracks state at threshold (default 5).';
