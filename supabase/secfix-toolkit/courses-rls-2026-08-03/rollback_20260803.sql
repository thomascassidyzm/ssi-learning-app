-- ROLLBACK for supabase/migrations/20260803_courses_rls_tighten.sql
-- Restores public.courses SELECT policies to their exact live state as captured
-- 2026-08-03 in before_pg_policies_courses.json (all seven, permissive, same roles,
-- same quals). Effective predicate returns to TRUE for anon and authenticated.
--
-- Run:
--   psql "$DATABASE_URL" -f supabase/secfix-toolkit/courses-rls-2026-08-03/rollback_20260803.sql

BEGIN;

DROP POLICY IF EXISTS courses_select ON public.courses;

CREATE POLICY "Anon can read courses" ON public.courses FOR SELECT TO anon
  USING (status = ANY (ARRAY['beta'::text, 'released'::text]));

CREATE POLICY "Public users can view all courses" ON public.courses FOR SELECT TO anon
  USING (new_app_status = ANY (ARRAY['live'::text, 'beta'::text]));

CREATE POLICY "Public users can view visible courses" ON public.courses FOR SELECT TO anon
  USING (visibility = ANY (ARRAY['public'::text, 'beta'::text]));

CREATE POLICY "Authenticated users can view all courses" ON public.courses FOR SELECT TO authenticated
  USING (new_app_status = ANY (ARRAY['live'::text, 'beta'::text]));

CREATE POLICY "Authenticated users can view visible courses" ON public.courses FOR SELECT TO authenticated
  USING (visibility = ANY (ARRAY['public'::text, 'beta'::text]));

CREATE POLICY courses_read_policy ON public.courses FOR SELECT TO authenticated
  USING (status = ANY (ARRAY['beta'::text, 'released'::text]));

-- TO public (no role list) — this is the one that made the effective predicate TRUE.
CREATE POLICY courses_select_public ON public.courses FOR SELECT
  USING (true);

-- The two helpers are left in place on rollback: they are inert once no policy
-- references them, and dropping them would break a re-apply. To remove entirely:
--   DROP FUNCTION IF EXISTS public.current_user_enrolled_course_codes();
--   DROP FUNCTION IF EXISTS public.is_dashboard_user();

NOTIFY pgrst, 'reload schema';

COMMIT;
