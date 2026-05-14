-- Per-learner per-seed Layer 1 listening state.
--
-- Aran reported L1 never appearing in hrv_for_eng. Two bugs:
--   1. Chunk-local roundNumber broke graduation (fixed in commit 0a9520d:
--      now anchored to absolute LEGO ordinal in the catalogue).
--   2. seedL1FireCount was a function-local Map — reset every script
--      generation, so the Stage 1 → Stage 4 progression never compounded
--      across sessions. Every seed perpetually played the Stage 1 slow-
--      then-fast playlist; the methodology's decay to a single 2× rep
--      never happened.
--
-- This table persists the per-seed fire count so progression survives
-- session boundaries. Keyed by lego_id (the seed's completing LEGO —
-- highest lego_index for that seed_number) per the codebase convention
-- "always use LEGO number which encrypts seed number within it" — not
-- by bare seed_num.
--
-- Per CLAUDE.md: learners.user_id is TEXT, so RLS uses auth.uid()::text.

-- Drop the previous shape (seed_num-keyed) — 0 rows in production, safe.
DROP TABLE IF EXISTS learner_l1_state;

CREATE TABLE learner_l1_state (
  learner_id     UUID        NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_code    TEXT        NOT NULL,
  lego_id        TEXT        NOT NULL,  -- e.g. 'S0001L03' — the seed's completing LEGO
  fire_count     INTEGER     NOT NULL DEFAULT 0,
  last_fired_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (learner_id, course_code, lego_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_l1_state_learner_course
  ON learner_l1_state(learner_id, course_code);

ALTER TABLE learner_l1_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own l1 state"
  ON learner_l1_state FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can insert own l1 state"
  ON learner_l1_state FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can update own l1 state"
  ON learner_l1_state FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "Users can delete own l1 state"
  ON learner_l1_state FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP TRIGGER IF EXISTS update_learner_l1_state_updated_at ON learner_l1_state;
CREATE TRIGGER update_learner_l1_state_updated_at
  BEFORE UPDATE ON learner_l1_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE learner_l1_state IS 'Per-learner per-seed Layer 1 listening fire count, keyed by the seed''s completing lego_id. Used by generateLearningScript to compound the Stage 1→4 playlist progression across sessions.';
COMMENT ON COLUMN learner_l1_state.lego_id IS 'Completing LEGO of the seed (highest lego_index). Encodes seed identity per the codebase "always use LEGO number" convention.';
COMMENT ON COLUMN learner_l1_state.fire_count IS 'Total L1 fires for this seed across all sessions. Drives layer1StageFor(fireCount) → stage 1..4.';

NOTIFY pgrst, 'reload schema';
