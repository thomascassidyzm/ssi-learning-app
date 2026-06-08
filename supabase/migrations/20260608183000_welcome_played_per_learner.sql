-- ============================================================================
-- Course welcome: once EVER per learner (not once per course)
-- ============================================================================
-- The welcome was tracked on course_enrollments.welcome_played — per (learner,
-- course) — so every new course replayed it. And the gate only ever READ
-- localStorage, never the DB, so a PWA reinstall / new device replayed it too.
--
-- Move the flag to a per-learner, course-agnostic column. The client gate now
-- reads this for real learners (localStorage stays as the same-device fast
-- path); the mark goes through the service-role /api/welcome/played endpoint
-- because learners is column-write-locked for clients (20260521180000).

ALTER TABLE learners ADD COLUMN IF NOT EXISTS welcome_played_at timestamptz;

-- Backfill: any learner who already had the welcome marked on any enrollment
-- keeps "heard it" status so we don't re-welcome them.
UPDATE learners l
   SET welcome_played_at = now()
 WHERE welcome_played_at IS NULL
   AND EXISTS (
     SELECT 1 FROM course_enrollments e
      WHERE e.learner_id = l.id AND e.welcome_played = true
   );

-- learners already has table-level SELECT for `authenticated`, so the new
-- column is readable by real learners with no extra grant. Writes are
-- service-role only (endpoint). Guests use localStorage.

NOTIFY pgrst, 'reload schema';
