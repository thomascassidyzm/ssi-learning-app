-- Track the learner's furthest point in a course separately from their cursor.
--
-- last_completed_round_index is a CURSOR — it can move backwards when a learner
-- intentionally revisits earlier content because they found something hard.
--
-- highest_completed_round_index is a CEILING — max-only, never decreases. The
-- resting-state UI offers a "skip to round N" jump when the cursor is behind
-- the ceiling, so revisiting doesn't strand the learner.
--
-- highest_completed_lego_id is the companion navigational hook: lego IDs have
-- the form S0042L05, so seed (and therefore the chunk to load) falls out of
-- the lego for free. We don't store seed separately.
--
-- A BEFORE INSERT/UPDATE trigger maintains both ceiling fields atomically.
-- Whenever last_completed_round_index advances past the existing ceiling, both
-- fields get lifted together. Sideways or backwards cursor moves leave the
-- ceiling untouched. ProgressStore therefore stays simple — it writes only the
-- cursor pair, and the DB enforces the ratchet invariant.

ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS highest_completed_round_index INTEGER,
  ADD COLUMN IF NOT EXISTS highest_completed_lego_id TEXT;

CREATE OR REPLACE FUNCTION ratchet_highest_completed_round()
RETURNS TRIGGER AS $$
DECLARE
  prev_high_round INTEGER;
  prev_high_lego TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    prev_high_round := NULL;
    prev_high_lego := NULL;
  ELSE
    prev_high_round := OLD.highest_completed_round_index;
    prev_high_lego := OLD.highest_completed_lego_id;
  END IF;

  IF NEW.last_completed_round_index IS NOT NULL AND
     (prev_high_round IS NULL OR NEW.last_completed_round_index > prev_high_round) THEN
    -- Cursor reached new ground — lift both ceiling fields together.
    NEW.highest_completed_round_index := NEW.last_completed_round_index;
    NEW.highest_completed_lego_id := NEW.last_completed_lego_id;
  ELSE
    -- Cursor went sideways or backwards — preserve the existing ceiling.
    NEW.highest_completed_round_index := prev_high_round;
    NEW.highest_completed_lego_id := prev_high_lego;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS course_enrollments_ratchet_highest_round
  ON course_enrollments;

CREATE TRIGGER course_enrollments_ratchet_highest_round
  BEFORE INSERT OR UPDATE OF last_completed_round_index,
                              last_completed_lego_id,
                              highest_completed_round_index,
                              highest_completed_lego_id
  ON course_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION ratchet_highest_completed_round();

-- Backfill existing rows: a no-op write to last_completed_round_index forces
-- the trigger to fire, which lifts the ceiling to match the current cursor.
UPDATE course_enrollments
   SET last_completed_round_index = last_completed_round_index
 WHERE last_completed_round_index IS NOT NULL;
