-- CANARY for the 2026-08-03 courses RLS tighten.
-- Read-only. Run BEFORE and AFTER the migration; the BEFORE run should show the
-- over-grant (drafts visible), the AFTER run should show the definition of done.
--
--   psql "$DATABASE_URL" -f supabase/secfix-toolkit/courses-rls-2026-08-03/canary_courses_rls.sql
--
-- Each probe runs inside its own transaction, SET LOCAL ROLE + a synthetic
-- request.jwt.claims — exactly what PostgREST sets for a real bearer token, so
-- auth.uid() resolves the same way it does for a live request.
--
-- Fixtures (verified live 2026-08-03):
--   LEARNER  2985746c-c6e6-4518-a3ba-e7f77557adb4  non-admin, enrolled in
--            fra_ca_for_eng (visibility=hidden, new_app_status=draft) — the
--            enrolled-but-not-discoverable case.
--   HIDDEN   the 57 rows with visibility NOT IN ('public','beta') AND
--            new_app_status NOT IN ('live','beta') — 55 hidden/draft/not_available,
--            fra_ca_for_eng (hidden/draft/draft), 1 private/draft/not_available.
--   STAFF    catrinlliar@gmail.com — a dashboard_users row that is NOT an ssi_admin.

\echo '=== 1. postgres/superuser view: the full table (RLS bypassed) ==='
SELECT count(*) AS all_courses,
       count(*) FILTER (WHERE visibility = ANY (ARRAY['public','beta'])
                          OR new_app_status = ANY (ARRAY['live','beta'])) AS discoverable,
       count(*) FILTER (WHERE NOT (visibility = ANY (ARRAY['public','beta'])
                          OR new_app_status = ANY (ARRAY['live','beta']))) AS not_discoverable
FROM public.courses;

\echo ''
\echo '=== 2. role anon, no JWT — expect: discoverable only (AFTER); all (BEFORE) ==='
BEGIN;
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_visible_rows FROM public.courses;
  SELECT count(*) AS anon_sees_undiscoverable
  FROM public.courses
  WHERE NOT (visibility = ANY (ARRAY['public','beta'])
             OR new_app_status = ANY (ARRAY['live','beta']));
ROLLBACK;

\echo ''
\echo '=== 3. role authenticated, real non-admin learner JWT ==='
\echo '    3a. total rows visible'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  SELECT count(*) AS learner_visible_rows FROM public.courses;
ROLLBACK;

\echo '    3b. DoD #1 — hidden AND unenrolled rows must NOT be returned (expect 0 after)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  SELECT count(*) AS hidden_unenrolled_leaked
  FROM public.courses c
  WHERE NOT (c.visibility = ANY (ARRAY['public','beta'])
             OR c.new_app_status = ANY (ARRAY['live','beta']))
    AND c.course_code <> 'fra_ca_for_eng';
ROLLBACK;

\echo '    3c. DoD #2 — discoverable courses ARE returned (expect the discoverable count from probe 1)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  SELECT count(*) AS discoverable_returned
  FROM public.courses
  WHERE visibility = ANY (ARRAY['public','beta'])
     OR new_app_status = ANY (ARRAY['live','beta']);
ROLLBACK;

\echo '    3d. DoD #3 — the enrolled-but-hidden course IS returned (expect 1 row)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  SELECT course_code, visibility, new_app_status
  FROM public.courses WHERE course_code = 'fra_ca_for_eng';
ROLLBACK;

\echo '    3e. cross-check — a DIFFERENT learner, NOT enrolled in fra_ca_for_eng, must not see it (expect 0 rows)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
  SELECT count(*) AS other_learner_sees_fra_ca
  FROM public.courses WHERE course_code = 'fra_ca_for_eng';
ROLLBACK;

\echo ''
\echo '=== 4. live catalogue query, as the learner app issues it (BrowseScreen.vue:237) ==='
\echo '    must be IDENTICAL before and after — this is the no-product-regression proof'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  SELECT count(*) AS catalogue_rows
  FROM public.courses WHERE new_app_status IN ('live','beta');
ROLLBACK;

\echo ''
\echo '=== 5. SSi admin keeps the full table on the authenticated key ==='
SELECT '{"sub":"' ||
       (SELECT user_id FROM public.learners WHERE platform_role = 'ssi_admin' ORDER BY user_id LIMIT 1)
       || '","role":"authenticated"}' AS admin_claims \gset
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = :'admin_claims';
  SELECT count(*) AS admin_visible_rows FROM public.courses;
ROLLBACK;

\echo ''
\echo '=== 5b. Popty dashboard staff (dashboard_users email, NOT an ssi_admin) keep the full table ==='
\echo '    the dashboard browser runs on the anon key + a real auth session -> role authenticated'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","email":"catrinlliar@gmail.com","role":"authenticated"}';
  SELECT count(*) AS dashboard_staff_visible_rows FROM public.courses;
ROLLBACK;

\echo '    5c. a NON-dashboard, non-admin email must NOT get the staff leg (expect 87)'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","email":"definitely-not-staff@example.invalid","role":"authenticated"}';
  SELECT count(*) AS random_authenticated_rows FROM public.courses;
ROLLBACK;

\echo ''
\echo '=== 6. policy inventory on public.courses (expect 5 after: 1 select + 3 admin write + service) ==='
SELECT polname, polcmd,
       (SELECT array_agg(rolname ORDER BY rolname) FROM pg_roles WHERE oid = ANY(polroles)) AS roles
FROM pg_policy WHERE polrelid = 'public.courses'::regclass ORDER BY polcmd, polname;

\echo ''
\echo '=== 7. initplan check — the helper must appear as an InitPlan, not a per-row call ==='
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"2985746c-c6e6-4518-a3ba-e7f77557adb4","role":"authenticated"}';
  EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT course_code FROM public.courses;
ROLLBACK;
