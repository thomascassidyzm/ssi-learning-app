-- ============================================================================
-- CONTRIBUTION FIX (no cap)
-- ============================================================================
-- Supersedes 20260411_contribution_fix.sql. Same intent:
--   1. Recompute the affected day's totals from sessions on every insert/update
--      so we never accumulate integer-division rounding errors (the previous
--      delta-based trigger lost fractional seconds per row, undercounting
--      globals by 1-2 min for a heavy user).
--   2. Backfill historical daily_contributions from sessions with the same
--      recompute logic.
--
-- Difference from the prior fix: NO per-session 4h cap. SSi practice happens
-- on plane journeys, car rides, long commutes — those are real cycles, not
-- runaway sessions, and capping them treats legitimate use as suspicious.
-- The play-time the player accumulates is already honest (only counts when
-- audio is actually playing), so there's nothing to defend against.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_daily_contributions()
RETURNS TRIGGER AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Recompute the whole row for (language, date) from sessions.
  -- SUM seconds first, divide by 60 after — eliminates per-row truncation.
  INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
  SELECT
    v_target_lang,
    v_date,
    COALESCE(SUM(items_practiced), 0),
    COALESCE(SUM(duration_seconds), 0) / 60,
    COUNT(DISTINCT learner_id)
  FROM sessions
  WHERE SPLIT_PART(course_id, '_for_', 1) = v_target_lang
    AND started_at::date = v_date
  ON CONFLICT (target_language, contribution_date)
  DO UPDATE SET
    phrases_count = EXCLUDED.phrases_count,
    minutes_practiced = EXCLUDED.minutes_practiced,
    unique_speakers = EXCLUDED.unique_speakers,
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill historical daily_contributions from sessions, same logic, no cap.
INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
SELECT
  SPLIT_PART(course_id, '_for_', 1) AS target_language,
  started_at::date AS contribution_date,
  COALESCE(SUM(items_practiced), 0) AS phrases_count,
  COALESCE(SUM(duration_seconds), 0) / 60 AS minutes_practiced,
  COUNT(DISTINCT learner_id) AS unique_speakers
FROM sessions
WHERE course_id IS NOT NULL
  AND started_at IS NOT NULL
  AND course_id LIKE '%_for_%'
GROUP BY SPLIT_PART(course_id, '_for_', 1), started_at::date
ON CONFLICT (target_language, contribution_date)
DO UPDATE SET
  phrases_count = EXCLUDED.phrases_count,
  minutes_practiced = EXCLUDED.minutes_practiced,
  unique_speakers = EXCLUDED.unique_speakers,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
