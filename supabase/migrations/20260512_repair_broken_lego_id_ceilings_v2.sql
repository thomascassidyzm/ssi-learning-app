-- Corrective repair: the previous attempt
-- (20260512_repair_broken_lego_id_ceilings.sql) updated only
-- highest_completed_lego_id and left last_completed_lego_id alone.
-- The fresh ratchet trigger fires BEFORE the UPDATE commits and
-- re-derives highest_completed_lego_id from the cursor:
--
--     NEW.last_completed_lego_id = 'S0275L01' (unchanged)
--     prev_high_lego             = 'S0275L01' (current ceiling)
--     'S0275L01' > 'S0275L01'    = FALSE → keep prev_high_lego
--
-- So my SET of NEW.highest_completed_lego_id = 'S0300L02' got
-- overwritten back to 'S0275L01'. Net effect: no change.
--
-- Fix: update BOTH the cursor and the ceiling in one UPDATE. The
-- trigger then sees the lifted cursor, the cursor > prev_high_lego
-- check passes, and the ceiling lifts correctly.
--
-- This also fixes the "cursor regressed to a mid-course LEGO via an
-- infinite-play random-USE writeback" pattern: there's no meaningful
-- "current position" inside infinite play, so resetting the cursor
-- to the course's last main-loop LEGO is the right move — the
-- runtime's infinite-play detection then drops the learner straight
-- into a fresh series of infinite-play rounds on next session.

UPDATE course_enrollments e
SET
  last_completed_lego_id    = cs.last_lego_id,
  highest_completed_lego_id = cs.last_lego_id
FROM (
  SELECT
    course_code,
    MAX(lego_id) AS last_lego_id,
    COUNT(*)    AS main_loop_count
  FROM course_legos
  WHERE is_new = TRUE
  GROUP BY course_code
) cs
WHERE e.course_id = cs.course_code
  AND e.highest_completed_round_index IS NOT NULL
  AND e.highest_completed_round_index >= cs.main_loop_count
  AND (
    e.highest_completed_lego_id IS NULL
    OR e.highest_completed_lego_id < cs.last_lego_id
  );
