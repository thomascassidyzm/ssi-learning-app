-- 20260908c_practice_minutes_from_playback_ledger.sql
--
-- ONE DEFINITION OF A MINUTE, ACROSS THE WHOLE APP.
--
-- A minute is a minute in which the app was actually PLAYING audio to the
-- learner. That is the founder ruling of 2026-08-19 ("no cap — make the
-- measurement accurate"), and the accurate measurement already exists and
-- already accrues: `learner_speaking_opportunities.play_seconds`, banked per
-- learner / course / day from the segments between playback start and stop,
-- flushed on visibilitychange and beforeunload so a closed tab keeps its tail.
--
-- WHY THIS CHANGES. `admin_practice_minutes(_by_course)` summed
-- `sessions.duration_seconds`, which until 2026-08-20 was WALL CLOCK: on rows
-- whose accumulator never closed it equalled `ended_at - started_at` exactly.
-- Measured against production on 2026-09-08: 165 of 182 March sessions, and
-- 2,353 of 2,857 August sessions, carry that wall-clock signature; one real
-- session ran seven days and logged 10,109 minutes. Across every real learner
-- the RPC returns 121,537 minutes where the playback ledger holds 25,647.
--
-- The learner's own Total Time tile was repointed at the ledger on 2026-08-19
-- (api/me/engaged-time.ts). Until this migration the admin and schools
-- surfaces still read the wall-clock number, so a learner saw 43h for
-- themselves while an admin looking at the same person saw 437h. This closes
-- that: both sides now read the same counter and cannot disagree.
--
-- NOT A CAP. The founder explicitly rejected clamping the wrong number at read
-- time. Nothing here caps anything; it reads a different, correct counter.
--
-- KNOWN GAP, STATED. The ledger begins 2026-05-14; sessions go back to
-- 2026-03-18. Playback before that date was never recorded as playback and is
-- not recoverable, so these figures are a floor for the longest-standing
-- accounts, exactly as the learner-facing tile already is. Cross-checked on
-- 113 June/July learner-days whose session accumulator demonstrably DID close:
-- ledger 2,946 min against sessions 3,575 min, i.e. the ledger runs a little
-- low rather than high — honest in the safe direction.
--
-- The position-derived estimate branch is unchanged and still flags itself
-- with is_estimated; it fires only when a learner+course has no ledger rows at
-- all. Learners with session rows but no ledger rows are a real set (71 of
-- them since the 2026-08-20 fix) but hold ONE minute between them.
--
-- Grants and the SEC25-D-02 admin guard on the platform-wide call are restated
-- unchanged so this migration cannot loosen either.

create or replace function public.admin_practice_minutes(p_learner_ids uuid[])
returns table(learner_id uuid, practice_minutes integer, is_estimated boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with logged as (
    select lso.learner_id, lso.course_code as course_id, sum(lso.play_seconds) as seconds
    from learner_speaking_opportunities lso
    where lso.learner_id = any(p_learner_ids)
    group by lso.learner_id, lso.course_code
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
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
BEGIN
  -- SEC25-D-02: the no-argument call aggregates EVERY learner on the platform.
  -- That is an ssi_admin view; scoped calls (explicit learner ids) stay open to
  -- the authenticated dashboards that already pass their own scope.
  IF p_learner_ids IS NULL
     AND NOT public.is_ssi_admin()
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: admin required for platform-wide practice minutes';
  END IF;

  RETURN QUERY
  with logged as (
    select lso.learner_id, lso.course_code as course_id, sum(lso.play_seconds) as seconds
    from learner_speaking_opportunities lso
    where (p_learner_ids is null or lso.learner_id = any(p_learner_ids))
    group by lso.learner_id, lso.course_code
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
  select combined.course_id as course_code,
         round(sum(combined.seconds) / 60.0)::int as practice_minutes,
         bool_or(combined.is_estimated) as is_estimated
  from combined
  group by combined.course_id;
END;
$$;

-- Posture restated, not loosened (SEC25-D-02 + 20260907 scope repoint).
revoke all on function public.admin_practice_minutes(uuid[]) from public;
revoke all on function public.admin_practice_minutes(uuid[]) from anon;
revoke all on function public.admin_practice_minutes(uuid[]) from authenticated;
grant execute on function public.admin_practice_minutes(uuid[]) to service_role;

revoke all on function public.admin_practice_minutes_by_course(uuid[]) from public;
revoke all on function public.admin_practice_minutes_by_course(uuid[]) from anon;
revoke all on function public.admin_practice_minutes_by_course(uuid[]) from authenticated;
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role;

notify pgrst, 'reload schema';
