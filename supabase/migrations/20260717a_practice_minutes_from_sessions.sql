-- 20260717a_practice_minutes_from_sessions.sql
--
-- Fix: dashboard "0 minutes" for learners with real recorded practice time
-- (e.g. Chepstow learner Lucy: sessions row duration_seconds=235,
-- items_practiced=19 — real time — but admin_practice_minutes_by_course
-- returned 0 because player_events for that session were too tightly
-- clustered in time for the max(occurred_at)-min(occurred_at) span heuristic
-- to pick up any duration).
--
-- Ruled time model (founder, 2026-07-17): displayed time-in-app = logged
-- time when present, and `sessions.duration_seconds` (written by the client
-- at session end) IS the logged time — it is the primary source, not an
-- estimate. player_events is finer-grained telemetry, not the source of
-- truth for "how long did they practice". The June cutover
-- (be76c924/3c7bc940) moved these RPCs off the dead `course_enrollments
-- .total_practice_minutes` counter and onto player_events instead of onto
-- the raw `sessions` table — `class_activity_stats`/`class_student_progress`
-- (teacher roster views) never had this bug because they summed
-- sessions.duration_seconds directly all along.
--
-- This migration repoints both RPCs at sessions.duration_seconds as the
-- primary source. No cap/floor needed — duration_seconds is a real logged
-- value, not a heuristic span estimate.

create or replace function public.admin_practice_minutes(p_learner_ids uuid[])
returns table(learner_id uuid, practice_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.learner_id,
         round(sum(s.duration_seconds) / 60.0)::int as practice_minutes
  from sessions s
  where s.learner_id = any(p_learner_ids)
  group by s.learner_id;
$$;

create or replace function public.admin_practice_minutes_by_course(p_learner_ids uuid[] default null)
returns table(course_code text, practice_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  select s.course_id as course_code,
         round(sum(s.duration_seconds) / 60.0)::int as practice_minutes
  from sessions s
  where (p_learner_ids is null or s.learner_id = any(p_learner_ids))
  group by s.course_id;
$$;

grant execute on function public.admin_practice_minutes(uuid[]) to service_role, authenticated;
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role, authenticated;

notify pgrst, 'reload schema';
