-- Migration: repair resume cursors stranded behind the ceiling.
--
-- Bug: in INF PLAY the per-round cursor write (saveRoundProgress /
-- persistCursorAtCurrentRound) stamped the round's RANDOM USE-phrase
-- legoId as last_completed_lego_id whenever the lastMainLoopLegoId
-- substitution anchor was empty. Result: an early legoId paired with a
-- high last_completed_round_index (e.g. S0001L01 @ round 103). Because
-- resume reads last_completed_lego_id, the learner was then pinned to
-- LEGO 1 on a course they had completed. The forward-only guard protects
-- the round_index, and the ratchet trigger protects highest_*, but the
-- CURSOR legoid had no floor.
--
-- Code fix (same commit): in INF PLAY the cursor is frozen at the ceiling
-- and never written per-round, so this can't recur. This migration clears
-- the existing backlog.
--
-- Invariant we restore: in INF PLAY, cursor == ceiling. (Supersedes the
-- 20260520_repair_infplay_cursor one-shot, which the live code kept
-- re-breaking every round; the code now KEEPS this true.)
--
-- Trigger-safe: we write last_completed_* = highest_completed_* (never the
-- highest_* columns directly — those are reverted by the ratchet trigger,
-- see 20260512_lego_id_independent_ratchet.sql). Setting last == highest is
-- a no-op for the ceiling (max(highest, highest) = highest).

-- Clause 1 — INF PLAY rows (Tom 2026-05-28: "anyone in INF PLAY in any
-- course"). In INF PLAY the cursor must equal the ceiling; any drift is
-- the bug above.
UPDATE public.course_enrollments
SET
  last_completed_lego_id     = highest_completed_lego_id,
  last_completed_round_index = highest_completed_round_index,
  current_cycle_index        = 0
WHERE current_mode = 'infplay'
  AND highest_completed_lego_id IS NOT NULL
  AND last_completed_lego_id IS DISTINCT FROM highest_completed_lego_id;

-- Clause 2 — rows flipped back to 'main' but with the cursor clobbered to
-- the very first LEGO (the failed-resume / INF-PLAY-leak signature, e.g.
-- the ita_for_eng row: main mode, infplay_round_index 31, cursor S0001L01,
-- ceiling S0300L02). Restricted to cursor at SEED 1 with the ceiling well
-- past white belt (seed >= 8) so we NEVER touch a learner who deliberately
-- belt-backed (which lands on a chosen belt, never seed 1 of a course they
-- have left). Setting cursor = ceiling self-heals: a finished course routes
-- to INF PLAY on next load (no LEGO past the final one), a mid-course
-- learner resumes forward from their true ceiling.
UPDATE public.course_enrollments
SET
  last_completed_lego_id     = highest_completed_lego_id,
  last_completed_round_index = highest_completed_round_index,
  current_cycle_index        = 0
WHERE current_mode = 'main'
  AND highest_completed_lego_id IS NOT NULL
  AND last_completed_lego_id ~ '^S[0-9]{4}L'
  AND highest_completed_lego_id ~ '^S[0-9]{4}L'
  AND substring(last_completed_lego_id    from 2 for 4)::int = 1
  AND substring(highest_completed_lego_id from 2 for 4)::int >= 8;

NOTIFY pgrst, 'reload schema';
