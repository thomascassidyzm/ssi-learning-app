-- Migration: INF PLAY mode columns on course_enrollments
-- Purpose: 2026-05-19 — make INF PLAY an explicit mode separate from
--          position, per the design doc (~/Desktop/inf-play-mode-
--          redesign.md). current_mode persists across sessions so
--          resume respects the last state; infplay_round_index counts
--          rounds since entering INF PLAY (resets to 1 on entry, used
--          for the visible "INF round N" display and for the 89-round
--          spaced-rep drain math).
--
-- No backfill: learners past course end will auto-enter INF PLAY on
-- their next session-load (resolveStartLegoId detects no-next-LEGO
-- and writes mode='infplay'). New learners default to 'main'.
--
-- check constraint locks the enum so a typo or stale row can't put a
-- learner in an unknown state — playback code reads current_mode
-- without exhaustive fallback handling.

ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS current_mode TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS infplay_round_index INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'course_enrollments_current_mode_check'
  ) THEN
    ALTER TABLE public.course_enrollments
      ADD CONSTRAINT course_enrollments_current_mode_check
      CHECK (current_mode IN ('main', 'infplay'));
  END IF;
END $$;

COMMENT ON COLUMN public.course_enrollments.current_mode IS
  'Playback mode. main = normal course progression (intros, spaced rep, USE). infplay = past-course-end review-only mode (no intros, spaced rep + random USE). Set automatically by resolveStartLegoId when the learner hits course end; reset to main when they back-belt-skip out.';

COMMENT ON COLUMN public.course_enrollments.infplay_round_index IS
  'Rounds elapsed since entering INF PLAY mode. Resets to 1 on entry, increments per round_complete while in INF PLAY, reset to 0 on mode=main. Used for the 89-round spaced-rep drain math (rounds 1-89 still have fib offsets vs main-loop content) and for the visible "INF round N" display.';

NOTIFY pgrst, 'reload schema';
