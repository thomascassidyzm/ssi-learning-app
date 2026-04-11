-- ============================================
-- CONTRIBUTION FIX
-- Fixes to the daily_contributions trigger:
--   1. Recompute from sessions instead of using delta logic (avoids
--      integer division rounding errors that undercount globals)
--   2. Backfill historical session data into daily_contributions
-- ============================================

-- Replace the trigger function with a recompute-based version.
-- On every session insert/update, recalculate the affected day's totals
-- by aggregating all sessions for that (language, date). Simpler,
-- always correct, and cheap — one day at a time.
CREATE OR REPLACE FUNCTION update_daily_contributions()
RETURNS TRIGGER AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Recompute the whole row for this (language, date) from sessions.
  -- Sum duration_seconds FIRST, then divide by 60, so we don't accumulate
  -- per-row truncation errors.
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

-- Backfill historical daily_contributions from the sessions table.
-- One-shot population so existing data is reflected in the counter.
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
