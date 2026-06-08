-- Batched, count-aware record_lego_pairings.
--
-- The player now accumulates LEGO co-fire counts locally and flushes once per
-- pause/background instead of one RPC per cycle (~150/session -> ~1-3). To keep
-- fire_count meaning the same, the function takes a parallel `_counts` array and
-- increments fire_count by the per-pair count (GROUP BY SUM, replacing the old
-- DISTINCT + "+1").
--
-- Backward compatible: `_counts` DEFAULTs to NULL -> COALESCE 1 -> the old
-- "+1 per distinct pair" behaviour, so the previously-deployed 3-arg callers
-- keep working while the new client rolls out.

DROP FUNCTION IF EXISTS record_lego_pairings(uuid, text, text[][]);

CREATE OR REPLACE FUNCTION record_lego_pairings(
  _learner_id  uuid,
  _course_code text,
  _pairs       text[][],
  _counts      int[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER  -- run as caller, RLS applies
AS $$
BEGIN
  IF _pairs IS NULL OR array_length(_pairs, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH input AS (
    SELECT
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][1] ELSE _pairs[idx][2] END AS lego_a,
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][2] ELSE _pairs[idx][1] END AS lego_b,
      COALESCE(_counts[idx], 1) AS cnt
    FROM generate_series(1, array_length(_pairs, 1)) AS g(idx)
    WHERE _pairs[idx][1] IS NOT NULL
      AND _pairs[idx][2] IS NOT NULL
      AND _pairs[idx][1] <> _pairs[idx][2]
  ),
  -- Sum counts for pairs that canonicalise identically within this call
  -- (replaces the old DISTINCT; a single INSERT can't update a row twice).
  agg AS (
    SELECT lego_a, lego_b, SUM(cnt)::int AS cnt FROM input GROUP BY lego_a, lego_b
  )
  INSERT INTO learner_lego_pairings AS p
    (learner_id, course_code, lego_a, lego_b, fire_count, first_fired_at, last_fired_at)
  SELECT _learner_id, _course_code, lego_a, lego_b, cnt, now(), now()
  FROM agg
  ON CONFLICT (learner_id, course_code, lego_a, lego_b) DO UPDATE
    SET fire_count    = p.fire_count + EXCLUDED.fire_count,
        last_fired_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION record_lego_pairings(uuid, text, text[][], int[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
