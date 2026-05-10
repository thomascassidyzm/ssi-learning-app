-- ============================================================================
-- Phase 7: REVOKE writes from anon + authenticated on learner / schools /
-- entitlement-edge tables that have no legitimate client-side writes.
-- ============================================================================
-- Same pattern as the content-tables REVOKE: lock writes at the GRANT layer
-- so anon and JWT-authenticated browser sessions get a clean
-- "permission denied for table X" error. Service role (production-api,
-- course-builder API, audio pipeline, sync scripts) keeps full access.
--
-- Reads stay open for now — fake test data only at present, and locking
-- reads requires per-table role design (own-row, teacher-of-class,
-- school-admin, etc.) which is the next phase.
--
-- Verified safe via codebase grep across packages/player-vue/src:
--   sessions               — 0 client writes
--   seed_progress          — 0 client writes
--   course_enrollments     — 0 (only a test-file comment)
--   schools                — 0 client writes
--   classes                — 0 client writes
--   class_student_progress — 0 client writes
--   entitlement_grants     — 0 client writes
--   groups                 — 0 client writes
--
-- Tables left ALONE in this phase (handled separately later):
--   learners   — has 1 client INSERT in SchoolsSetup.vue (admin)
--   user_tags  — has 1 client UPDATE in useAuth.ts (auth-link cascade)
--   govt_admins — also touched by useAuth.ts cascade (similar handling)
-- These will be paired with moving the flows to server-side APIs.
--
-- Rollback: at bottom.
-- ============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sessions               FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.seed_progress          FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.course_enrollments     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.schools                FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.classes                FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.class_student_progress FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.entitlement_grants     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.groups                 FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.sessions               TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.seed_progress          TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.course_enrollments     TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.schools                TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.classes                TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.class_student_progress TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.entitlement_grants     TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.groups                 TO anon, authenticated;
-- NOTIFY pgrst, 'reload schema';
