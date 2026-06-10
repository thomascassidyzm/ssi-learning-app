-- ============================================================================
-- SECURITY FIX #14 (Lane B0) — the identity bridge + lock the empty learner
--                              tables + player_events
-- ============================================================================
-- Design: ~/Desktop/SSi-secfix-2026-06-09/LANE_B_identity_design.md
-- Spine: learner-data tables key on learners.id (uuid, already true in all 17
-- learner_id columns); auth.uid() maps to it in EXACTLY ONE place — the
-- function below. Own-row policies everywhere else read identically:
-- learner_id = current_learner_id().
--
-- FACTS (verified live 2026-06-10):
--   * learner_points / learner_milestones / learner_practice_history /
--     response_metrics / spike_events: ALL EMPTY (0 rows ever). The
--     SessionStore.saveMetrics/saveSpikes write paths never fire live; the
--     other three have no app writers at all. Locking them now is free;
--     own-row policies make them safe if those paths ever wake.
--   * player_events (141k rows): written ONLY by api/player-events.ts
--     (service-role). user_id is uuid-typed but holds LEARNERS.ID values
--     (2000/2000 sampled), null for guests. No client reads or writes exist
--     -> full client lockout, service-role only.
--   * 11 dormant policies exist across these 6 tables -> dropped, recreated
--     deterministically.

-- ====== THE BRIDGE ======
CREATE OR REPLACE FUNCTION public.current_learner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT id FROM public.learners WHERE user_id = (auth.uid())::text $$;

REVOKE ALL ON FUNCTION public.current_learner_id() FROM public;
GRANT EXECUTE ON FUNCTION public.current_learner_id() TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.current_learner_id() IS
  'THE identity bridge: auth.uid() -> learners.id. The only place the auth-uid/learner-PK mapping (and its ::text cast) may live. Own-row policies on learner-data tables use learner_id = current_learner_id(). learners.user_id is unique-indexed (learners_user_id_key).';

-- ====== the 5 empty learner-data tables: own-row via the bridge ======
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'learner_points','learner_milestones','learner_practice_history',
    'response_metrics','spike_events']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (learner_id = public.current_learner_id())',
      t || '_own_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (learner_id = public.current_learner_id())',
      t || '_own_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (learner_id = public.current_learner_id()) WITH CHECK (learner_id = public.current_learner_id())',
      t || '_own_update', t);
  END LOOP;
END $$;

-- ====== player_events: service-role only (client posts via /api/player-events) ======
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='player_events' LOOP
    EXECUTE format('DROP POLICY %I ON public.player_events', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.player_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_events FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: authorization-layer only. Per table: DISABLE ROW LEVEL SECURITY +
-- re-GRANT (anon: ALL pre-existing; authenticated: ALL) to restore the
-- pre-2026-06-10 state. Bridge fn is additive and harmless to keep.
