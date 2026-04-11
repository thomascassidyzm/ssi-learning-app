-- ============================================
-- CONTRIBUTION TRIGGER
-- Keeps daily_contributions populated in real-time
-- when sessions are inserted or updated.
-- ============================================

-- Trigger function: increment daily_contributions on session insert/update
CREATE OR REPLACE FUNCTION update_daily_contributions()
RETURNS TRIGGER AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  -- Extract target language from course_id (e.g., 'cym' from 'cym_for_eng')
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Upsert the daily contribution row
  INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
  VALUES (
    v_target_lang,
    v_date,
    COALESCE(NEW.items_practiced, 0),
    COALESCE(NEW.duration_seconds, 0) / 60,
    1
  )
  ON CONFLICT (target_language, contribution_date)
  DO UPDATE SET
    phrases_count = daily_contributions.phrases_count
      + COALESCE(NEW.items_practiced, 0)
      - COALESCE(OLD.items_practiced, 0),
    minutes_practiced = daily_contributions.minutes_practiced
      + COALESCE(NEW.duration_seconds, 0) / 60
      - COALESCE(OLD.duration_seconds, 0) / 60,
    updated_at = NOW();

  -- Recalculate unique_speakers for accuracy (cheap — indexed)
  UPDATE daily_contributions
  SET unique_speakers = (
    SELECT COUNT(DISTINCT learner_id)
    FROM sessions
    WHERE SPLIT_PART(course_id, '_for_', 1) = v_target_lang
      AND started_at::date = v_date
  )
  WHERE target_language = v_target_lang
    AND contribution_date = v_date;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to sessions table
DROP TRIGGER IF EXISTS trg_update_daily_contributions ON sessions;
CREATE TRIGGER trg_update_daily_contributions
  AFTER INSERT OR UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_contributions();
