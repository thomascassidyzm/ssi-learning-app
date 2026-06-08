-- ============================================================================
-- SECURITY FIX #2 (CRITICAL/HIGH) — lock anon-callable SECURITY DEFINER funcs
-- ============================================================================
-- All four run with owner privileges (bypass RLS) and were EXECUTE-able by the
-- public anon key (granted to PUBLIC by Postgres default). None pinned a
-- search_path. Verified callers (2026-06-08):
--   - get_cascade_courses(text)   : SERVER ONLY (api/entitlement/user.ts, service-role)
--   - auto_entitle_popty_user()   : trigger fn, no direct caller (fires as owner)
--   - find_learner_by_email(text) : client, but only AFTER auth (useAuth account-linking)
--   - get_staff_with_emails()     : authenticated admin view (admin/SchoolsSetup.vue)
-- Pattern: Postgres grants EXECUTE to PUBLIC by default, so we REVOKE FROM
-- PUBLIC and GRANT back only to the role(s) that actually call each function.

-- ---- get_cascade_courses: server-only -> service_role only --------------------
-- Took caller-supplied p_user_id with no ownership check (cross-tenant
-- entitlement enumeration). Only the service-role server route calls it.
ALTER FUNCTION public.get_cascade_courses(text) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.get_cascade_courses(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_cascade_courses(text) TO service_role;

-- ---- auto_entitle_popty_user: trigger fn -> no client EXECUTE -----------------
-- Writes entitlements. As a trigger it runs with owner rights regardless of
-- who holds EXECUTE, so removing client EXECUTE blocks direct abuse, breaks nothing.
ALTER FUNCTION public.auto_entitle_popty_user() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.auto_entitle_popty_user() FROM PUBLIC, anon, authenticated;

-- ---- find_learner_by_email: cut anon (unauthenticated enumeration) ------------
-- Returns id + auth user_id + role for any email. Legit use is an already-
-- authenticated user linking their own session email -> keep authenticated.
-- NOTE (Phase B): also gate the body to the caller's own JWT email to stop an
-- authenticated user enumerating arbitrary emails. Deferred — needs a staged
-- test that the Supabase JWT carries an `email` claim for every auth method.
ALTER FUNCTION public.find_learner_by_email(text) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.find_learner_by_email(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.find_learner_by_email(text) TO authenticated, service_role;

-- ---- get_staff_with_emails: cut anon + gate body on is_ssi_admin() ------------
-- Returned every teacher/school_admin/govt_admin name+email to anyone. Add an
-- admin gate (the only caller is the ssi_admin SchoolsSetup view) and pin path.
CREATE OR REPLACE FUNCTION public.get_staff_with_emails()
 RETURNS TABLE(user_id text, display_name text, educational_role text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT l.user_id, l.display_name, l.educational_role, l.verified_emails[1] AS email
  FROM learners l
  WHERE l.educational_role IN ('teacher', 'school_admin', 'govt_admin')
    AND public.is_ssi_admin()          -- non-admin callers get zero rows
  ORDER BY l.display_name;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_staff_with_emails() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_staff_with_emails() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
