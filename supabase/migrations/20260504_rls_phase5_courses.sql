-- ============================================================================
-- RLS Phase 5: courses (content table — anon SELECT + admin write)
-- ============================================================================
-- 97 rows. Course catalog metadata: name, languages, voice_config, visibility,
-- pricing. Loaded on the homepage by anonymous visitors and by every learner
-- inside the app.
--
-- The risk here isn't read leakage — courses are public — it's WRITE
-- tampering: without RLS, anyone with the anon key could DELETE all courses
-- or rewrite voice_config. This migration locks writes to admin only.
--
-- Policies:
--   SELECT — everyone (anon + authenticated). No change to current behaviour.
--   INSERT/UPDATE/DELETE — admin only via is_ssi_admin().
--
-- Service role (course-builder API, dashboard tools, scripts) bypasses
-- RLS as before — unchanged.
--
-- This is the template for the remaining content tables (course_seeds,
-- course_legos, course_practice_phrases, course_audio, canonical_seeds,
-- canonical_seed_translations, listening_pods, listening_pod_sentences,
-- shared_audio). Once verified clean here, the same shape copies onto each.
--
-- Rollback: at bottom.
-- ============================================================================

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courses_select_public"
  ON public.courses FOR SELECT
  USING (true);

CREATE POLICY "courses_insert_admin"
  ON public.courses FOR INSERT
  WITH CHECK (public.is_ssi_admin());

CREATE POLICY "courses_update_admin"
  ON public.courses FOR UPDATE
  USING (public.is_ssi_admin());

CREATE POLICY "courses_delete_admin"
  ON public.courses FOR DELETE
  USING (public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (paste these lines into the SQL editor if anything breaks):
-- ============================================================================
-- ALTER TABLE public.courses DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "courses_select_public" ON public.courses;
-- DROP POLICY IF EXISTS "courses_insert_admin" ON public.courses;
-- DROP POLICY IF EXISTS "courses_update_admin" ON public.courses;
-- DROP POLICY IF EXISTS "courses_delete_admin" ON public.courses;
-- NOTIFY pgrst, 'reload schema';
