-- ============================================================================
-- SECURITY FIX #13 (Lane C) — lock down the 30 course-prod / Popty tables
-- ============================================================================
-- BEFORE: all 30 tables RLS-OFF with FULL anon+authenticated grants (SELECT,
-- INSERT, UPDATE, DELETE, TRUNCATE...) — any browser holding the public anon
-- key could read AND vandalise the entire course-production pipeline
-- (build_jobs, course_seed_drafts, language briefs, QA flags, try_links...).
--
-- CONSUMER MAP (cross-repo scan 2026-06-10: Popty src/ + api/ + services/
-- [Camberley production-api], learner-app src/ + api/):
--   * ALL Camberley services + ALL Vercel api/ routes use SERVICE_KEY -> RLS
--     bypass, unaffected by this migration.
--   * Popty BROWSER (anon key): READS audio_flags, course_gender_expansions,
--     orchestrator_messages, content_feedback. No writes.
--   * Learner-app BROWSER (anon or authenticated): READS lego_introductions
--     (presentation-audio backfill in generateLearningScript.ts); WRITES
--     content_feedback INSERT + sample_flags UPSERT (ReportIssueButton.vue),
--     tester_feedback INSERT (TesterFeedback.vue). All return=minimal (no
--     .select() chained) so no SELECT needed for the write-only paths.
--   * The other 23 tables: ZERO anon/authenticated consumers anywhere.
--
-- DESIGN (calibrated to blast radius, not blanket):
--   GROUP 1 (23 tables): RLS on + REVOKE ALL from anon/authenticated ->
--           service-role only.
--   GROUP 2 (4 tables): browser READ-ONLY — keep SELECT, kill writes:
--           audio_flags, course_gender_expansions, orchestrator_messages,
--           lego_introductions.
--   GROUP 3 (3 feedback tables): preserve the live write paths, kill the rest:
--           content_feedback  = SELECT + INSERT (Popty QA aggregation reads it
--                               from the browser; learner app inserts)
--           tester_feedback   = INSERT only
--           sample_flags      = SELECT + INSERT + UPDATE (learner-app upsert
--                               ON CONFLICT (audio_uuid,course_code) DO UPDATE
--                               needs all three)
--   All dormant policies on these tables are DROPPED first so enabling RLS
--   activates exactly the policy set written here (deterministic, no
--   drift-roulette from old half-applied migrations).
--
-- RESIDUAL (accepted, noted for a later hardening pass): anon can still read
-- 4 ops/content tables + content_feedback, and write feedback rows — that is
-- the live product behaviour (public feedback forms, Popty build monitor).
-- Hardening = move Popty browser reads behind service-role API endpoints,
-- then drop the SELECT policies here.
--
-- Verified via transaction-scoped canary (laneC_canary.cjs): replay every
-- consumer path above as its real role + deny-checks, COMMIT only if green.

-- ====== GROUP 1: full lockdown — service-role only (23 tables) ======
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apml_documents','build_jobs','build_lessons','checkpoint_approvals',
    'conversations','course_audio_usage','course_checkpoint_config',
    'course_checkpoint_results','course_export_states','course_lego_positions',
    'course_qa_flags','course_seed_drafts','language_briefs',
    'language_pair_briefs','raw_seed_uploads','recording_provenance',
    'target_audio','target_legos','target_phrases','target_seed_texts',
    'try_link_visits','try_links','voices']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ====== GROUP 2: browser read-only (4 tables) ======
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audio_flags','course_gender_expansions','orchestrator_messages',
    'lego_introductions']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
      t || '_public_read', t);
  END LOOP;
END $$;

-- ====== GROUP 3: feedback tables — preserve live write paths ======
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_feedback','tester_feedback','sample_flags']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- content_feedback: Popty browser aggregates it (SELECT); learner app inserts.
GRANT SELECT, INSERT ON public.content_feedback TO anon, authenticated;
CREATE POLICY content_feedback_public_read ON public.content_feedback
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY content_feedback_public_insert ON public.content_feedback
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- tester_feedback: learner-app feedback form, write-only from the client.
GRANT INSERT ON public.tester_feedback TO anon, authenticated;
CREATE POLICY tester_feedback_public_insert ON public.tester_feedback
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- sample_flags: learner-app UPSERT (insert + conflict-update); Popty QA
-- resolves via service-role.
GRANT SELECT, INSERT, UPDATE ON public.sample_flags TO anon, authenticated;
CREATE POLICY sample_flags_public_read ON public.sample_flags
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY sample_flags_public_insert ON public.sample_flags
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY sample_flags_public_update ON public.sample_flags
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: this migration only changes the authorization layer. To revert a
-- single table: DISABLE ROW LEVEL SECURITY + re-GRANT ALL to anon,
-- authenticated (the pre-2026-06-10 live state).
