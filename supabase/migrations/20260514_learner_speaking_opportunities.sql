-- ============================================================================
-- learner_speaking_opportunities — direct per-learner cycle/play-time counter
-- ============================================================================
-- Replaces the fragile sessions → items_practiced → checkpoint chain that was
-- silently failing (sessionStore null at init → guard short-circuits → no DB
-- write). This table is written to directly from recordCycleComplete on every
-- cycle, with no session boundary and no per-row cap.
--
-- "Speaking opportunities" = cycles where the learner is invited to speak.
-- One row per (learner, course, UTC day) so the modal's Today / 7d / 30d /
-- All-time tabs can sum the relevant slice cheaply.
--
-- Storage stays in seconds; minutes are floor(play_seconds / 60) at read time
-- to avoid any per-row rounding error.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS learner_speaking_opportunities (
  learner_id     uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_code    text NOT NULL,
  day            date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  opportunities  bigint NOT NULL DEFAULT 0,
  play_seconds   bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, course_code, day)
);

-- Hot query patterns: timeframe aggregations on (learner_id, course_code).
-- The PK already covers (learner, course, day) prefix lookups, so an extra
-- index is unnecessary.

-- RLS — own-row only, mirroring learner_lego_pairings / learner_lego_metrics.
ALTER TABLE learner_speaking_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own speaking opportunities" ON learner_speaking_opportunities;
CREATE POLICY "Users can view own speaking opportunities"
  ON learner_speaking_opportunities FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can insert own speaking opportunities" ON learner_speaking_opportunities;
CREATE POLICY "Users can insert own speaking opportunities"
  ON learner_speaking_opportunities FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can update own speaking opportunities" ON learner_speaking_opportunities;
CREATE POLICY "Users can update own speaking opportunities"
  ON learner_speaking_opportunities FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

-- ============================================================================
-- RPC: bump_speaking_opportunities(learner, course, opps_delta, seconds_delta)
-- ============================================================================
-- Single upsert that the client calls per cycle (opps_delta = 1, seconds_delta
-- = 0) and periodically for play time (opps_delta = 0, seconds_delta = N).
-- The (UTC day) key is computed server-side so all writes for a given day
-- coalesce onto one row even if the client clock is wrong.
-- ============================================================================

CREATE OR REPLACE FUNCTION bump_speaking_opportunities(
  p_learner_id   uuid,
  p_course_code  text,
  p_opps_delta   bigint DEFAULT 0,
  p_seconds_delta bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO learner_speaking_opportunities AS lso
    (learner_id, course_code, day, opportunities, play_seconds)
  VALUES
    (p_learner_id, p_course_code, (now() AT TIME ZONE 'UTC')::date,
     GREATEST(p_opps_delta, 0), GREATEST(p_seconds_delta, 0))
  ON CONFLICT (learner_id, course_code, day) DO UPDATE
    SET
      opportunities = lso.opportunities + GREATEST(p_opps_delta, 0),
      play_seconds  = lso.play_seconds  + GREATEST(p_seconds_delta, 0),
      updated_at    = now();
END;
$$;

COMMENT ON TABLE learner_speaking_opportunities IS
  'Per-learner per-course per-UTC-day count of speaking opportunities (cycles) and accumulated player play_seconds. Replaces sessions.items_practiced/duration_seconds for user-side contribution stats.';

COMMENT ON FUNCTION bump_speaking_opportunities IS
  'Upsert one row of (learner, course, UTC today) and add the supplied deltas. Called per cycle (opps_delta=1) and periodically for play time (seconds_delta).';

COMMIT;

NOTIFY pgrst, 'reload schema';
