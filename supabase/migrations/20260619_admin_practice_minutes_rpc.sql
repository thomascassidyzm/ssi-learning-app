-- 20260619_admin_practice_minutes_rpc.sql
--
-- Practice time, derived from telemetry (player_events) — the single source of
-- truth for stats. Replaces reads of course_enrollments.total_practice_minutes,
-- a per-write counter that stopped being maintained ~mid-April 2026 and so
-- under-reported practice everywhere (e.g. a learner with 43h of real Croatian
-- showed "11m"). last_practiced_at kept being written, which is why "last
-- active" stayed correct while "practice time" rotted.
--
-- Method: per (learner, session) wall-clock span = max(occurred_at) -
-- min(occurred_at), summed. Capped at 2h/session (idle-tab guard) and floored
-- at 30s (ignore single-event blips). Validated against live data: reproduces
-- ~43.4h for the Croatian learner; whole-platform aggregate runs in ~100ms on
-- the (user_id, occurred_at) index.
--
-- Returns per-learner TOTAL minutes across all courses (what the admin list
-- needs). A per-course variant can follow for the schools surfaces.

create or replace function public.admin_practice_minutes(p_learner_ids uuid[])
returns table(learner_id uuid, practice_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  with sess as (
    select user_id, session_id,
           extract(epoch from (max(occurred_at) - min(occurred_at))) as secs
    from player_events
    where user_id = any(p_learner_ids)
    group by user_id, session_id
  )
  select user_id as learner_id,
         coalesce(
           round(sum(least(greatest(secs, 0), 7200)) filter (where secs >= 30) / 60.0),
           0
         )::int as practice_minutes
  from sess
  group by user_id;
$$;

grant execute on function public.admin_practice_minutes(uuid[]) to service_role, authenticated;

notify pgrst, 'reload schema';
