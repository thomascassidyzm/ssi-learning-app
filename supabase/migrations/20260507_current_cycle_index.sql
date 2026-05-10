-- Migration: track current cycle within an in-progress round.
-- Purpose: don't penalise the learner for an app reload (PWA update,
-- close+open) by restarting a 20-cycle round from cycle 0. We already
-- persist last_completed_round_index per round; this adds the cycle
-- cursor so we can resume mid-round.
--
-- Semantics: current_cycle_index is the next cycle to play within the
-- current round (current_round = last_completed_round_index + 1).
-- 0 means "start of round". Bumped on every cycle_completed; reset to
-- 0 on round_completed.

ALTER TABLE course_enrollments
ADD COLUMN IF NOT EXISTS current_cycle_index INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN course_enrollments.current_cycle_index IS
  'Cycle index within the in-progress round to resume from on reload. 0 = start of round.';
