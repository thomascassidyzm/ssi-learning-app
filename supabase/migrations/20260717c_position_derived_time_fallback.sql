-- 20260717c_position_derived_time_fallback.sql
--
-- Ruled time model (founder, 2026-07-17): displayed time-in-app = LOGGED time
-- (sessions.duration_seconds, the primary source since fbcfd196) when present.
-- When session logs are MISSING for a learner+course but position/progress
-- data exists (course_enrollments.highest_completed_lego_id), fall back to a
-- POSITION-DERIVED estimate, always flagged as approximate. This is a backup
-- for the gap, never a replacement — it undercounts repeats/dwell and can't
-- see skipping. Logged and estimated seconds are never summed for the same
-- learner+course: it's one or the other, chosen by presence of session rows.
--
-- Estimator: legos_advanced (ordinal position of highest_completed_lego_id
-- within its course, 1-based, same lego_order pattern used by
-- admin_class_rate_leaders) x a single named constant,
-- public.position_derived_seconds_per_lego(). Default derived from real data
-- (read-only query against the live DB, 2026-07-17): among the 582 learner
-- x course pairs that have BOTH session logs and a highest_completed_lego_id,
-- median (total logged seconds / legos_advanced) = ~119.6s/lego -> 120s.
-- Founder can retune by editing this one function.
create or replace function public.position_derived_seconds_per_lego()
returns integer
language sql
immutable
as $$ select 120 $$;

-- Return-shape change (extra is_estimated column) requires a drop first —
-- CREATE OR REPLACE can't alter an existing function's return type.
drop function if exists public.admin_practice_minutes(uuid[]);
drop function if exists public.admin_practice_minutes_by_course(uuid[]);

create or replace function public.admin_practice_minutes(p_learner_ids uuid[])
returns table(learner_id uuid, practice_minutes integer, is_estimated boolean)
language sql
stable
security definer
set search_path = public
as $$
  with logged as (
    select s.learner_id, s.course_id, sum(s.duration_seconds) as seconds
    from sessions s
    where s.learner_id = any(p_learner_ids)
    group by s.learner_id, s.course_id
  ),
  lego_order as (
    select cl.course_code, cl.lego_id,
           row_number() over (partition by cl.course_code order by cl.seed_number, cl.lego_index) as ord
    from course_legos cl
  ),
  estimated as (
    select ce.learner_id, ce.course_id,
           lo.ord * public.position_derived_seconds_per_lego() as seconds
    from course_enrollments ce
    join lego_order lo on lo.course_code = ce.course_id and lo.lego_id = ce.highest_completed_lego_id
    where ce.learner_id = any(p_learner_ids)
      and ce.highest_completed_lego_id is not null
      and not exists (
        select 1 from logged l where l.learner_id = ce.learner_id and l.course_id = ce.course_id
      )
  ),
  combined as (
    select learner_id, seconds, false as is_estimated from logged
    union all
    select learner_id, seconds, true as is_estimated from estimated
  )
  select learner_id,
         round(sum(seconds) / 60.0)::int as practice_minutes,
         bool_or(is_estimated) as is_estimated
  from combined
  group by learner_id;
$$;

create or replace function public.admin_practice_minutes_by_course(p_learner_ids uuid[] default null)
returns table(course_code text, practice_minutes integer, is_estimated boolean)
language sql
stable
security definer
set search_path = public
as $$
  with logged as (
    select s.learner_id, s.course_id, sum(s.duration_seconds) as seconds
    from sessions s
    where (p_learner_ids is null or s.learner_id = any(p_learner_ids))
    group by s.learner_id, s.course_id
  ),
  lego_order as (
    select cl.course_code, cl.lego_id,
           row_number() over (partition by cl.course_code order by cl.seed_number, cl.lego_index) as ord
    from course_legos cl
  ),
  estimated as (
    select ce.learner_id, ce.course_id,
           lo.ord * public.position_derived_seconds_per_lego() as seconds
    from course_enrollments ce
    join lego_order lo on lo.course_code = ce.course_id and lo.lego_id = ce.highest_completed_lego_id
    where (p_learner_ids is null or ce.learner_id = any(p_learner_ids))
      and ce.highest_completed_lego_id is not null
      and not exists (
        select 1 from logged l where l.learner_id = ce.learner_id and l.course_id = ce.course_id
      )
  ),
  combined as (
    select course_id, seconds, false as is_estimated from logged
    union all
    select course_id, seconds, true as is_estimated from estimated
  )
  select course_id as course_code,
         round(sum(seconds) / 60.0)::int as practice_minutes,
         bool_or(is_estimated) as is_estimated
  from combined
  group by course_id;
$$;

grant execute on function public.position_derived_seconds_per_lego() to service_role, authenticated;
grant execute on function public.admin_practice_minutes(uuid[]) to service_role, authenticated;
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role, authenticated;

notify pgrst, 'reload schema';
