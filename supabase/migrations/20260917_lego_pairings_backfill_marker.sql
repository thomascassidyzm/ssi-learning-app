-- learner_lego_pairings: a reversible marker for replayed history (job #59).
--
-- Job #52 found class play never reached this table: `record_lego_pairings` is
-- SECURITY INVOKER against own-row RLS, and a class entity's user_id is the
-- literal `class-learner:<classId>`, nobody's login, so every class flush was
-- refused. The fix routes class flushes through the teacher-authorised
-- /api/school/class-progress endpoint — forward only. The co-firing a class
-- did between 2026-07-16 and the fix is still recoverable, deterministically,
-- from its own audio_play rows, and this migration is what makes writing it
-- back SAFE: every replayed fire is tagged and separately counted, so the
-- whole backfill reverses with one statement and leaves live counts intact.
--
--   backfill_fire_count  how much of fire_count this tag contributed
--   backfill_tag         which run wrote it (NULL = purely live)
--   backfill_prev_first_fired_at
--                        first_fired_at as it stood BEFORE the backfill pulled
--                        it back to the real historical first firing; NULL when
--                        the backfill created the row.
--
-- Reversal (see scripts/backfill-class-lego-pairings.mjs --revert):
--   UPDATE learner_lego_pairings
--      SET fire_count = fire_count - backfill_fire_count,
--          first_fired_at = COALESCE(backfill_prev_first_fired_at, first_fired_at),
--          backfill_fire_count = 0, backfill_tag = NULL,
--          backfill_prev_first_fired_at = NULL
--    WHERE backfill_tag = '<tag>';
--   DELETE FROM learner_lego_pairings WHERE fire_count <= 0;

ALTER TABLE public.learner_lego_pairings
  ADD COLUMN IF NOT EXISTS backfill_fire_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_tag text,
  ADD COLUMN IF NOT EXISTS backfill_prev_first_fired_at timestamptz;

COMMENT ON COLUMN public.learner_lego_pairings.backfill_fire_count IS
  'How much of fire_count came from the run named in backfill_tag. Subtract it to reverse that run exactly.';
COMMENT ON COLUMN public.learner_lego_pairings.backfill_tag IS
  'Name of the backfill run that contributed backfill_fire_count. NULL means every fire on this row was recorded live.';
COMMENT ON COLUMN public.learner_lego_pairings.backfill_prev_first_fired_at IS
  'first_fired_at before the backfill moved it back to the real first firing. NULL when the backfill created the row.';

COMMENT ON TABLE public.learner_lego_pairings IS
  'Per-learner per-course co-firing counts for the v2 brain view timelapse. Live writes are forward-only; a tagged, reversible history replay is possible via record_lego_pairings_backfill (job #59).';

-- The replay twin of record_lego_pairings. Same canonicalisation, same
-- per-pair counts, same summing of pairs that canonicalise identically inside
-- one call. Three differences, all of them about being reversible:
--   * the replayed fires are ALSO banked in backfill_fire_count under _tag;
--   * a re-run REPLACES this tag's contribution instead of adding to it, so
--     the script is idempotent — run it twice and the counts do not double;
--   * first/last_fired_at come from the audio_play timestamps being replayed,
--     not now(), and only ever widen the row's window.
CREATE OR REPLACE FUNCTION public.record_lego_pairings_backfill(
  _learner_id uuid,
  _course_code text,
  _pairs text[],
  _counts integer[],
  _tag text,
  _first_fired_at timestamptz,
  _last_fired_at timestamptz
) RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _pairs IS NULL OR array_length(_pairs, 1) IS NULL OR _tag IS NULL THEN
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
  agg AS (
    SELECT lego_a, lego_b, SUM(cnt)::int AS cnt FROM input GROUP BY lego_a, lego_b
  )
  INSERT INTO learner_lego_pairings AS p
    (learner_id, course_code, lego_a, lego_b, fire_count, first_fired_at, last_fired_at,
     backfill_fire_count, backfill_tag, backfill_prev_first_fired_at)
  SELECT _learner_id, _course_code, lego_a, lego_b, cnt,
         COALESCE(_first_fired_at, now()), COALESCE(_last_fired_at, now()),
         cnt, _tag, NULL
  FROM agg
  ON CONFLICT (learner_id, course_code, lego_a, lego_b) DO UPDATE
    SET fire_count = p.fire_count
                     - (CASE WHEN p.backfill_tag = _tag THEN p.backfill_fire_count ELSE 0 END)
                     + EXCLUDED.backfill_fire_count,
        backfill_fire_count = EXCLUDED.backfill_fire_count,
        backfill_tag = _tag,
        -- Remember the live first_fired_at the first time this tag touches the
        -- row, so reversal restores it; a re-run must not overwrite that memory
        -- with the value the previous run already pulled back.
        backfill_prev_first_fired_at = CASE
          WHEN p.backfill_tag = _tag THEN p.backfill_prev_first_fired_at
          ELSE p.first_fired_at
        END,
        first_fired_at = LEAST(
          CASE WHEN p.backfill_tag = _tag
               THEN COALESCE(p.backfill_prev_first_fired_at, p.first_fired_at)
               ELSE p.first_fired_at END,
          EXCLUDED.first_fired_at),
        last_fired_at = GREATEST(p.last_fired_at, EXCLUDED.last_fired_at);
END;
$$;

-- Service role only: this is an operator tool, not a learner-facing write.
REVOKE ALL ON FUNCTION public.record_lego_pairings_backfill(uuid, text, text[], integer[], text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
