-- CLASSES: the browser may no longer open a class, nor change what course a class teaches
-- =======================================================================================
--
-- THE HOLE. api/school/create-class.ts decides whether a class may carry a
-- premium course (api/_utils/classCourseEntitlement.ts: paid school, the
-- school's own trialled course, a live grant, or a live ancestor org — with
-- premium-ness read from isCommercialCourse in @ssi/core/pricing, the one
-- source of truth). That decision runs inside a Vercel endpoint on the
-- service-role key. It never runs in the database.
--
-- Underneath it, `authenticated` held INSERT on public.classes, and the only
-- thing behind that grant was the RLS policy `classes_insert`,
-- WITH CHECK (teacher_user_id = auth.uid()::text) — row ownership, not one word
-- about the course. So a teacher, or anyone holding a teacher JWT, could
-- INSERT a class naming any premium course_code straight through PostgREST,
-- skipping the endpoint, and api/_utils/classCoverage.ts would then hand that
-- course to every student tagged into the class for as long as the school's
-- platform clock ran. cs/84 closed the endpoint; cs/90 repointed the browser's
-- own insert at the endpoint. Neither touched the grant. This does.
--
-- THE SECOND MOUTH. `authenticated` also held whole-table UPDATE, and the
-- `classes_update` policy is ownership-only too. A teacher could open a
-- heritage class through the endpoint and then UPDATE its course_code to a
-- premium one from the browser, arriving at the same place by another verb.
-- The browser's one legitimate UPDATE on this table is the Class Play resume
-- point, `last_lego_id` (useClassesData.updateClassProgress and
-- LearningPlayer.updateClassLegoProgress). Every other writer — create-class,
-- rename-class, remove-staff, class-teachers, provision, delete-class, the demo
-- refreshers — runs on the service-role key, which holds its own GRANT ALL.
-- So UPDATE is re-granted on that one column and nothing else.
--
-- WHAT DOES NOT CHANGE. The RLS policies stay exactly as they are: RLS keeps
-- answering "is this my row?" and the entitlement ladder stays in TypeScript,
-- which is the house doctrine (CLAUDE.md: hierarchy and commercial authz live
-- in server endpoints with tests; never author a clever policy). SELECT is
-- untouched, so teachers, school admins and tagged students read classes as
-- before. `anon` held nothing on this table and still holds nothing.
--
-- Canary: supabase/secfix-toolkit/canary_classes_writes_server_mediated.cjs —
-- applied in one transaction against the live shared database, committed only
-- with the bypass insert and the course_code update both refused and every
-- legitimate path still alive. dev, staging and main share that database, so
-- this is live everywhere the moment it commits.

REVOKE INSERT ON TABLE public.classes FROM authenticated;
REVOKE UPDATE ON TABLE public.classes FROM authenticated;
GRANT UPDATE (last_lego_id) ON TABLE public.classes TO authenticated;

NOTIFY pgrst, 'reload schema';
