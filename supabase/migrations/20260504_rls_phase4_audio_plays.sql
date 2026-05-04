-- ============================================================================
-- RLS Phase 4: audio_plays
-- ============================================================================
-- Analytics sink for audio playback events. ~49k rows. Currently every row
-- has user_id = NULL (column was added but never wired to auth on the client),
-- so there's no own-row identity to chain on.
--
-- All inserts come from the server-side audio proxy at api/audio/[audioId].ts
-- which uses SUPABASE_SERVICE_ROLE_KEY → bypasses RLS automatically. No
-- client-side flow reads this table; admin / analytics dashboards are the
-- only consumers.
--
-- Policy: SELECT for admins only. INSERT/UPDATE/DELETE: no policies — denied
-- for anon and authenticated users; service role bypasses as before.
--
-- Depends on the is_ssi_admin() helper added in Phase 1.
--
-- Rollback: at bottom.
-- ============================================================================

ALTER TABLE public.audio_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audio_plays_admin_select"
  ON public.audio_plays FOR SELECT
  USING (public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.audio_plays DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "audio_plays_admin_select" ON public.audio_plays;
-- NOTIFY pgrst, 'reload schema';
