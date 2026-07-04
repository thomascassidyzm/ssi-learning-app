-- Course-scope the lego_progress + seed_progress unique keys.
--
-- BUG (2026-07-04 review): lego_progress UNIQUE(learner_id, lego_id) and
-- seed_progress UNIQUE(learner_id, seed_id) omit course_id — but lego/seed ids
-- (S0001L01, S0001…) are identical across EVERY course. So a learner taking two
-- courses could only ever hold ONE course's per-lego/seed progress: the second
-- course's INSERT collided with the first, and a point read returned the wrong
-- course's row. Belt/position is unaffected (that rides
-- course_enrollments.last_completed_lego_id, already per-course); this only bit
-- the per-lego adaptation state (fibonacci/reps/retired) of multi-course
-- learners.
--
-- ⚠️ EXPAND-CONTRACT — DO NOT APPLY until the code that scopes
-- getLegoProgressById by course_id is live on MAIN.
--   • The read fix lands on dev first, then promotes dev → staging → main.
--   • dev/staging/prod share ONE database. Applying this while un-patched code
--     is still running on any of them would let a multi-course learner match
--     TWO rows on (learner_id, lego_id), breaking that code's .single() read.
--   • Once the patched read is on main, this is safe to apply.
--
-- Adding the 3-column unique cannot fail on existing data: the old 2-column
-- unique was stricter, so at most one row already exists per (learner, lego)
-- and per (learner, seed). This migration does NOT recover progress a
-- multi-course learner already lost — it only stops future collapse.
--
-- SIBLING (not fixed here — separate call): learner_lego_metrics also upserts
-- on onConflict:'learner_id,lego_id' (LegoMetricsStore) and likely has the same
-- cross-course collision for the difficulty series. Flagged for a follow-up.

ALTER TABLE public.lego_progress
  DROP CONSTRAINT IF EXISTS lego_progress_learner_id_lego_id_key,
  ADD CONSTRAINT lego_progress_learner_id_lego_id_course_id_key
    UNIQUE (learner_id, lego_id, course_id);

ALTER TABLE public.seed_progress
  DROP CONSTRAINT IF EXISTS seed_progress_learner_id_seed_id_key,
  ADD CONSTRAINT seed_progress_learner_id_seed_id_course_id_key
    UNIQUE (learner_id, seed_id, course_id);

NOTIFY pgrst, 'reload schema';
