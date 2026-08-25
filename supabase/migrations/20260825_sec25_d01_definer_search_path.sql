-- SEC25-D-01 — pin `search_path` on the 16 SECURITY DEFINER functions that lacked it.
--
-- 2026-08-25 security audit, Area D
-- (docs/security-audit-2026-08-25/area-d-db-and-hygiene.md, SEC25-D-01).
--
-- WHY
-- A SECURITY DEFINER function runs with the OWNER's privileges but, by default,
-- resolves unqualified identifiers against the CALLER's `search_path`. A caller
-- who can create an object (a schema, a table, an operator, a function) earlier
-- in their own search_path can shadow a name the definer body references
-- unqualified and have their object executed with the owner's rights — the
-- classic Postgres "trojan-horse object" privilege-escalation primitive.
-- `SET search_path` on the function pins resolution at call time and closes it.
--
-- WHAT THIS IS NOT
-- This changes name RESOLUTION only, not one line of function logic — hence
-- ALTER FUNCTION rather than a body rewrite. Every function below already
-- behaves as if `public` were the search path (that is how they work today, on
-- the default `"$user", public`), so pinning `'public', 'pg_temp'` is a no-op
-- for every legitimate caller and a hard stop for a shadowing one.
--
-- `pg_temp` is listed LAST deliberately: leaving it out entirely puts it first
-- implicitly in some Postgres versions, which would reopen the very hole this
-- closes. Last is the safe position.
--
-- SCOPE
-- The 16 functions in the SEC25-D-01 roster, matching the roster pinned by
-- api/_utils/definerSearchPath.security.test.ts. The sibling functions that
-- already pin (claim_learner, is_ssi_admin, admin_user_course_stats,
-- find_learner_by_email, admin_practice_minutes*) are deliberately untouched.
--
-- GRANTS
-- No REVOKE here, therefore no GRANT to carry. ALTER FUNCTION ... SET does not
-- alter ownership or EXECUTE privileges; the existing grants survive verbatim.
-- (The EXECUTE posture of admin_practice_minutes* is SEC25-D-02, fixed in
-- 20260825_sec25_d02_practice_minutes_gate.sql — a different finding.)

begin;

alter function public.activate_brief_version(p_known_code text, p_target_code text, p_version text)
  set search_path to 'public', 'pg_temp';

alter function public.activate_prompt_version(p_phase_code text, p_version text)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_course_comparison()
  set search_path to 'public', 'pg_temp';

alter function public.analytics_engagement()
  set search_path to 'public', 'pg_temp';

alter function public.analytics_entitlement_funnel()
  set search_path to 'public', 'pg_temp';

alter function public.analytics_friction_map(p_course_id text)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_growth(p_period text, p_count integer)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_health(p_days integer)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_overview()
  set search_path to 'public', 'pg_temp';

alter function public.analytics_retention_cohorts(p_weeks integer)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_retention_days_active(p_weeks integer)
  set search_path to 'public', 'pg_temp';

alter function public.analytics_trial_conversion()
  set search_path to 'public', 'pg_temp';

alter function public.get_active_brief(p_known_code text, p_target_code text)
  set search_path to 'public', 'pg_temp';

alter function public.get_active_prompt(p_phase_code text)
  set search_path to 'public', 'pg_temp';

alter function public.get_my_verified_emails()
  set search_path to 'public', 'pg_temp';

-- Trigger function (no arguments in its signature).
alter function public.update_daily_contributions()
  set search_path to 'public', 'pg_temp';

-- Verification: after this migration, no SECURITY DEFINER function in `public`
-- should be missing a search_path setting. Run manually to confirm —
--
--   select p.proname, p.proconfig
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prosecdef
--      and (p.proconfig is null
--           or not exists (select 1 from unnest(p.proconfig) c
--                           where c like 'search_path=%'))
--    order by 1;
--
-- Expected: zero rows.

commit;

notify pgrst, 'reload schema';
