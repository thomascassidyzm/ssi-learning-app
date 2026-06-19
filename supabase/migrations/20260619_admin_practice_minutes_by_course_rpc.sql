-- 20260619_admin_practice_minutes_by_course_rpc.sql
--
-- Per-course practice minutes derived from telemetry (player_events), the SSoT.
-- Companion to admin_practice_minutes() (per-learner total). Serves the two
-- remaining admin surfaces that still summed the dead
-- course_enrollments.total_practice_minutes counter:
--   * admin Courses     — pass no args (p_learner_ids = null) → per-course totals
--                         across ALL learners.
--   * admin User-Detail — pass [learnerId] → that learner's per-course minutes.
--
-- Inner group is per (learner, course, session) so spans never bleed across
-- learners even when p_learner_ids is null; then summed to per-course.
-- cap 2h/session, floor 30s — same rule as admin_practice_minutes().

create or replace function public.admin_practice_minutes_by_course(p_learner_ids uuid[] default null)
returns table(course_code text, practice_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select user_id, course_code, session_id,
           extract(epoch from (max(occurred_at) - min(occurred_at))) as secs
    from player_events
    where (p_learner_ids is null or user_id = any(p_learner_ids))
      and course_code is not null
    group by user_id, course_code, session_id
  )
  select course_code,
         coalesce(
           round(sum(least(greatest(secs, 0), 7200)) filter (where secs >= 30) / 60.0),
           0
         )::int as practice_minutes
  from sess
  group by course_code;
$$;

grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role, authenticated;

notify pgrst, 'reload schema';
