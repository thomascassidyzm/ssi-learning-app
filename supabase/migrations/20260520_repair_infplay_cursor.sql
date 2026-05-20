-- Migration: repair INF PLAY cursor rows where the bad-write bug left
-- last_completed_lego_id pointing at a random USE LEGO from an
-- infplay round, rather than the learner's last main-loop LEGO.
--
-- Bug (fixed in commit b16a8e7): persistCursorAtCurrentRound wrote
-- round.legoId directly. For infplay rounds, round.legoId is the
-- first random USE LEGO drawn (could be anywhere in the course).
-- saveRoundProgress had substitution logic but persistCursorAtCurrentRound
-- didn't. The handleSkipToNextBelt enterInfplay branch called
-- persistCursorAtCurrentRound right after landing on the first
-- infplay round → cursor was stamped with the random legoId.
--
-- Symptom: resting state shows "you've been further than this" with
-- the cursor visibly behind the furthest position, even though the
-- learner is in INF PLAY (which IS the furthest point per Tom's
-- 2026-05-20 design — see ~/Desktop/inf-play-mode-redesign.md).
--
-- Scope: only INF PLAY enrollments. Main-loop learners with cursor
-- < highest are in that state because they intentionally back-belt-
-- skipped — that's a valid state we MUST NOT regress. Only the
-- infplay corruption case is repaired here.

UPDATE public.course_enrollments
SET
  last_completed_lego_id = highest_completed_lego_id,
  last_completed_round_index = highest_completed_round_index,
  -- current_cycle_index belongs to the OLD bad round — drop it so
  -- the resume doesn't try to restore a stale mid-round position.
  current_cycle_index = 0
WHERE
  current_mode = 'infplay'
  AND highest_completed_lego_id IS NOT NULL
  AND (
    last_completed_lego_id IS NULL
    OR last_completed_lego_id <> highest_completed_lego_id
  );

-- For learners who were affected: their resume will now use
-- highest_completed_lego_id as the cursor. resolveStartLegoId throws
-- CourseEndNoNextLego (current_mode='infplay'), legacy path picks up
-- and lands them in the first infplay round. Clean.

NOTIFY pgrst, 'reload schema';
