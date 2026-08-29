-- 20260825_sec25_d02_practice_minutes_gate.sql
--
-- SEC25-D-02 (2026-08-25 audit, high) — `admin_practice_minutes()` and
-- `admin_practice_minutes_by_course()` are SECURITY DEFINER, hold EXECUTE for
-- `anon`, and carry no internal auth check. The `_by_course` variant defaults
-- its argument to NULL and its body reads `where (p_learner_ids is null or …)`,
-- so a NO-ARGUMENT call from any holder of the public anon key returns
-- platform-wide practice minutes grouped by course. The per-learner variant
-- returns any named learner's practice time to the same caller.
--
-- The sibling `admin_user_course_stats()` already does this correctly
-- (`IF NOT public.is_ssi_admin() THEN RAISE EXCEPTION`). These two are the
-- callers that pass missed.
--
-- What this migration does, per call site (checked, not assumed):
--
--   admin_practice_minutes(uuid[])            — ONLY server callers, both
--     service-role behind verifyAdmin(): api/admin/users.ts:213,
--     api/admin/attention.ts:112. No browser caller anywhere.
--     → EXECUTE revoked from PUBLIC, anon AND authenticated; service_role only.
--
--   admin_practice_minutes_by_course(uuid[])  — four BROWSER callers on the
--     authenticated client: admin/useAdminCourses.ts:91 (no argument — the
--     platform-wide aggregate, ssi_admin page), admin/useAdminUserDetail.ts:184,
--     schools/useAnalyticsData.ts:196 and schools/StudentProgressView.vue:77
--     (all pass explicit learner ids).
--     → EXECUTE revoked from PUBLIC and anon; authenticated + service_role kept
--       so the live dashboards keep working, AND an internal gate added: the
--       NULL-argument (platform-wide) path now requires is_ssi_admin() or the
--       service role. Anonymous callers lose both paths; signed-in non-admins
--       lose the zero-knowledge platform-wide aggregate.
--
-- RESIDUAL, recorded deliberately rather than papered over: a signed-in user
-- can still call the _by_course variant with a learner UUID they already know.
-- Closing that means repointing the schools composables at a server endpoint on
-- the resolveVisibleScope pattern (CLAUDE.md's "client org-table reads
-- repointed" condition) — a separate pass, not this one.
--
-- Function bodies are otherwise byte-identical to 20260717c_position_derived_time_fallback.sql.

begin;

-- ── admin_practice_minutes: service_role only ────────────────────────────────
revoke all on function public.admin_practice_minutes(uuid[]) from public;
revoke all on function public.admin_practice_minutes(uuid[]) from anon;
revoke all on function public.admin_practice_minutes(uuid[]) from authenticated;
grant execute on function public.admin_practice_minutes(uuid[]) to service_role;

-- ── admin_practice_minutes_by_course: gate the NULL (platform-wide) path ─────
-- Recreated as plpgsql so the guard can run before the query, mirroring
-- admin_user_course_stats(). The SQL below the guard is unchanged.
create or replace function public.admin_practice_minutes_by_course(p_learner_ids uuid[] default null)
returns table(course_code text, practice_minutes integer, is_estimated boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
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
  select combined.course_id as course_code,
         round(sum(combined.seconds) / 60.0)::int as practice_minutes,
         bool_or(combined.is_estimated) as is_estimated
  from combined
  group by combined.course_id;
END;
$$;

revoke all on function public.admin_practice_minutes_by_course(uuid[]) from public;
revoke all on function public.admin_practice_minutes_by_course(uuid[]) from anon;
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
