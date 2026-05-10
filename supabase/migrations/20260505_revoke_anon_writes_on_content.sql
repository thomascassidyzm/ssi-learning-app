-- ============================================================================
-- Lock writes on content tables via REVOKE (Path B alternative to RLS)
-- ============================================================================
-- Phase 6's RLS migration didn't take effect on the 9 content tables (the
-- ALTER TABLE ENABLE ROW LEVEL SECURITY + CREATE POLICY statements appear to
-- have rolled back; rls_status() confirms RLS=off and zero new policies).
--
-- Rather than diagnose the RLS failure, this migration uses a simpler model:
-- revoke INSERT/UPDATE/DELETE/TRUNCATE from the `anon` and `authenticated`
-- roles on every content table. Anon and JWT-authenticated browser sessions
-- get a permission-denied error at the GRANT layer — before RLS even runs.
-- No policies to debug, no silent failures.
--
-- Service role (production-api, course-builder API, audio pipeline, sync
-- scripts) still has full grants — it's a separate role and unaffected.
--
-- Reads stay open: SELECT grant remains for anon and authenticated so the
-- player and homepage continue to load content as today.
--
-- Verified safe via codebase grep: zero client-side writes to any of these
-- tables across packages/player-vue/src. All legitimate writes go through
-- service role.
--
-- Rollback: at bottom.
-- ============================================================================

-- Apply to each content table
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.course_seeds                  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.course_legos                  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.course_practice_phrases       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.course_audio                  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.canonical_seeds               FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.canonical_seed_translations   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.listening_pods                FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.listening_pod_sentences       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.shared_audio                  FROM anon, authenticated;

-- Reload PostgREST so the grant changes take effect immediately.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.course_seeds                TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.course_legos                TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.course_practice_phrases     TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.course_audio                TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.canonical_seeds             TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.canonical_seed_translations TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.listening_pods              TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.listening_pod_sentences     TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.shared_audio                TO anon, authenticated;
-- NOTIFY pgrst, 'reload schema';
