-- 20260831_course_enrollments_cursor_trail
--
-- WHY
-- ---
-- `course_enrollments` holds a learner's cursor and nothing that dates it: no
-- `updated_at`, no audit table, no history. On 2026-08-31 a real learner was
-- found at round 1399 of a course they were 13 rounds into, and 22 enrollments
-- across 8 accounts were in the same state — and the row could not even be
-- DATED, let alone lined up against a client build or a session. An afternoon
-- of investigation ended without being able to separate "the learner chose
-- this" from "the machine did it to them".
--
-- WHAT AND WHY THIS SHAPE
-- -----------------------
-- The cheapest thing that actually answers "when did this cursor move" is a
-- database-written timestamp, because the database is the one participant that
-- is always present: it survives an offline client, a dropped telemetry
-- beacon, a killed tab and a learner who never comes back. One column, one
-- trigger, no new table, no RLS surface, no client change.
--
-- What it deliberately does NOT do is carry the client build — a Postgres
-- trigger has never heard of a bundle hash. That half is answered by the
-- `cursor_move` events emitted from `packages/core/src/persistence/
-- cursorTelemetry.ts`, which ride the existing `player_events` pipe and are
-- already stamped with `client_version` and `session_id`. Durable floor here;
-- rich correlation there. Neither duplicates the other's job.
--
-- ADDITIVE AND BEHAVIOUR-FREE. Nothing reads this column yet; no application
-- code path changes; no progress value is written by this migration.

ALTER TABLE public.course_enrollments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN public.course_enrollments.updated_at IS
  'Set by trigger on every UPDATE. Dates the most recent change to this '
  'enrollment (cursor included). NULL means the row has not been updated '
  'since 2026-08-31, when the column was added — it is not a backfill. '
  'Pair with player_events.cursor_move for the client build that made a move.';

CREATE OR REPLACE FUNCTION public.touch_course_enrollments_updated_at()
RETURNS trigger
LANGUAGE plpgsql
-- SEC25 D-01: DEFINER-free, but pin the search_path anyway so the function
-- cannot be redirected by a caller-set path.
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_course_enrollments_updated_at ON public.course_enrollments;
CREATE TRIGGER trg_course_enrollments_updated_at
  BEFORE UPDATE ON public.course_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_course_enrollments_updated_at();

NOTIFY pgrst, 'reload schema';
