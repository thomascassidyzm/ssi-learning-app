-- ============================================================================
-- learner_lego_pairings (v2 brain view — synapse-strength edges)
-- ============================================================================
-- Per-learner per-course pair-firing table. One row per unordered pair
-- (lego_a < lego_b) that has fired together in at least one played cycle.
-- Drives the v2 brain view's timelapse — edges fade in at first_fired_at and
-- thicken proportionally to log(fire_count + 1).
--
-- Forward-only: we do NOT retroactively populate pairings from history. The
-- brain genuinely starts thin and grows from when this lands.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS learner_lego_pairings (
  learner_id     uuid NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_code    text NOT NULL,
  lego_a         text NOT NULL,
  lego_b         text NOT NULL,
  fire_count     int  NOT NULL DEFAULT 1,
  first_fired_at timestamptz NOT NULL DEFAULT now(),
  last_fired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, course_code, lego_a, lego_b),
  CHECK (lego_a < lego_b)  -- canonical pair order, store each pair once
);

CREATE INDEX IF NOT EXISTS idx_pairings_learner_course
  ON learner_lego_pairings(learner_id, course_code);

CREATE INDEX IF NOT EXISTS idx_pairings_first_fired
  ON learner_lego_pairings(learner_id, course_code, first_fired_at);

-- ============================================================================
-- RLS — same shape as learner_lego_metrics (own-row only)
-- ============================================================================

ALTER TABLE learner_lego_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own lego pairings" ON learner_lego_pairings;
CREATE POLICY "Users can view own lego pairings"
  ON learner_lego_pairings FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can insert own lego pairings" ON learner_lego_pairings;
CREATE POLICY "Users can insert own lego pairings"
  ON learner_lego_pairings FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can update own lego pairings" ON learner_lego_pairings;
CREATE POLICY "Users can update own lego pairings"
  ON learner_lego_pairings FOR UPDATE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

DROP POLICY IF EXISTS "Users can delete own lego pairings" ON learner_lego_pairings;
CREATE POLICY "Users can delete own lego pairings"
  ON learner_lego_pairings FOR DELETE
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

-- ============================================================================
-- record_lego_pairings(...) RPC
-- ----------------------------------------------------------------------------
-- Bulk-upsert N pairs for one (learner, course). Each pair bumps fire_count
-- by 1 and refreshes last_fired_at. Canonical order (lego_a < lego_b) is
-- enforced by the function so callers can pass pairs in any order.
--
-- Input shape:
--   _learner_id  uuid
--   _course_code text
--   _pairs       text[][]   -- 2D array: each inner row is [legoX, legoY]
--
-- Why an RPC: Supabase-JS .upsert() can't express "increment on conflict"
-- in a single round-trip. This function does one bulk INSERT ... ON CONFLICT
-- DO UPDATE which is atomic per-call and avoids N round trips.
-- ============================================================================

CREATE OR REPLACE FUNCTION record_lego_pairings(
  _learner_id  uuid,
  _course_code text,
  _pairs       text[][]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER  -- run as caller, RLS applies
AS $$
BEGIN
  IF _pairs IS NULL OR array_length(_pairs, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Canonicalise + dedupe via CTEs, then bulk-upsert in one statement.
  -- The generate_series index column is aliased to `idx` to avoid name
  -- clashes inside PL/pgSQL.
  WITH input AS (
    SELECT
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][1] ELSE _pairs[idx][2] END AS lego_a,
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][2] ELSE _pairs[idx][1] END AS lego_b
    FROM generate_series(1, array_length(_pairs, 1)) AS g(idx)
    WHERE _pairs[idx][1] IS NOT NULL
      AND _pairs[idx][2] IS NOT NULL
      AND _pairs[idx][1] <> _pairs[idx][2]
  ),
  -- Dedupe within this single call so repeated pairs only bump once per call.
  -- (A pair appearing twice in one cycle is one co-firing, not two.)
  deduped AS (
    SELECT DISTINCT lego_a, lego_b FROM input
  )
  INSERT INTO learner_lego_pairings AS p
    (learner_id, course_code, lego_a, lego_b, fire_count, first_fired_at, last_fired_at)
  SELECT _learner_id, _course_code, lego_a, lego_b, 1, now(), now()
  FROM deduped
  ON CONFLICT (learner_id, course_code, lego_a, lego_b) DO UPDATE
    SET fire_count    = p.fire_count + 1,
        last_fired_at = now();
END;
$$;

COMMENT ON TABLE learner_lego_pairings IS
  'Per-learner per-course co-firing counts for the v2 brain view timelapse. Forward-only — not backfilled from history.';
COMMENT ON COLUMN learner_lego_pairings.fire_count IS
  'Total cycles in which both legos appeared together. Drives synapse thickness via log(fire_count + 1).';
COMMENT ON FUNCTION record_lego_pairings(uuid, text, text[][]) IS
  'Bulk-upsert co-firing pairs for one (learner, course). Increments fire_count on conflict.';

COMMIT;

NOTIFY pgrst, 'reload schema';
