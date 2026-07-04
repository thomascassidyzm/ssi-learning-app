-- ============================================================================
-- SECURITY FIX #16 (Lane B2) — own-row RLS on the LIVE learner tables +
--                              jwt->>'sub' policy-drift cleanup
-- ============================================================================
-- Design: ~/Desktop/SSi-secfix-2026-06-09/LANE_B_identity_design.md
-- Tables: learners, sessions, course_enrollments, lego_progress,
--         seed_progress, daily_contributions.
--
-- WHY NOW (the two original gates dissolved):
--   * anon has been fully revoked on these tables since 2026-06-02 — 8 days
--     of live traffic prove no real path writes them as anon.
--   * the transaction-scoped canary with simulated JWTs (+ fixtures) is the
--     verification the 06-02 session lacked when it chose REVOKE over RLS.
-- Sharpest hole closed: learners had column-level UPDATE on user_id for
-- authenticated with RLS OFF -> ANY signed-in user could repoint ANY
-- learner's user_id to their own auth uid (account takeover). Now own-row.
--
-- READ MODEL (one place, like the bridge): can_view_learner_data(learner_id)
--   = own row | god | ssi_admin | govt_admin | school principal | class
--   teacher (via learners.user_id -> user_tags SCHOOL:/CLASS: scope).
-- WRITE MODEL: own row only, via current_learner_id(). The multi-email link
--   (learners.user_id OLD->NEW) moves into claim_learner() below — DEFINER,
--   gated on the caller's JWT email being in the learner's verified_emails.
--   (App pair: useAuth.ts calls claim_learner instead of direct UPDATE.)
-- GUESTS are untouched: learner_id columns are uuid; guest-<uuid> strings
--   never could be written; guests are localStorage-only.
-- Demo schools rows keyed on Clerk-era fake ids go dark by design (wipe
--   licence, Tom 2026-06-10); demo data to be regenerated to conform.

-- ====== read-scope helper: the ONE place principal visibility lives ======
CREATE OR REPLACE FUNCTION public.can_view_learner_data(p_learner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_learner_id = public.current_learner_id()
      OR public.is_god_user()
      OR public.is_ssi_admin()
      OR EXISTS (SELECT 1 FROM public.govt_admins g
                 WHERE g.user_id = (auth.uid())::text)
      OR EXISTS (
           SELECT 1
           FROM public.learners l
           JOIN public.user_tags ut
             ON ut.user_id = l.user_id AND ut.removed_at IS NULL
           WHERE l.id = p_learner_id
             AND (
               EXISTS (SELECT 1 FROM public.schools s
                       WHERE ut.tag_value = 'SCHOOL:' || s.id::text
                         AND s.admin_user_id = (auth.uid())::text)
               OR EXISTS (SELECT 1 FROM public.classes c
                          LEFT JOIN public.schools s2 ON s2.id = c.school_id
                          WHERE ut.tag_value = 'CLASS:' || c.id::text
                            AND (c.teacher_user_id = (auth.uid())::text
                                 OR s2.admin_user_id = (auth.uid())::text))
             )
         )
$$;
REVOKE ALL ON FUNCTION public.can_view_learner_data(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_learner_data(uuid) TO authenticated, service_role;

-- ====== multi-email link bridge (replaces the client-side learners UPDATE) ======
CREATE OR REPLACE FUNCTION public.claim_learner(p_learner_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_uid text; my_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'claim_learner: permission denied (not authenticated)';
  END IF;
  my_email := lower(coalesce(auth.jwt()->>'email',''));
  IF my_email = '' THEN
    RAISE EXCEPTION 'claim_learner: permission denied (no email claim)';
  END IF;
  SELECT user_id INTO old_uid FROM public.learners
   WHERE id = p_learner_id
     AND my_email IN (SELECT lower(e)
                      FROM unnest(coalesce(verified_emails, ARRAY[]::text[])) e);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_learner: permission denied (email not verified on learner)';
  END IF;
  UPDATE public.learners SET user_id = (auth.uid())::text WHERE id = p_learner_id;
  RETURN old_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_learner(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_learner(uuid) TO authenticated;

-- ====== daily_contributions: trigger goes DEFINER, table goes read-only ======
ALTER FUNCTION public.update_daily_contributions() SECURITY DEFINER SET search_path = public;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='daily_contributions' LOOP
    EXECUTE format('DROP POLICY %I ON public.daily_contributions', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.daily_contributions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.daily_contributions FROM anon, authenticated;
CREATE POLICY daily_contributions_public_read ON public.daily_contributions
  FOR SELECT TO anon, authenticated USING (true);  -- community aggregates, public by design

-- ====== learners ======
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='learners' LOOP
    EXECUTE format('DROP POLICY %I ON public.learners', p.policyname);
  END LOOP;
END $$;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.learners TO authenticated;  -- signup path; WITH CHECK gates it
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.learners FROM authenticated;

-- direct own-row check FIRST: INSERT ... RETURNING evaluates the SELECT policy
-- on the new row within the same statement, where current_learner_id() (STABLE,
-- reads learners) cannot yet see it — the direct column comparison can.
CREATE POLICY learners_select ON public.learners
  FOR SELECT TO authenticated
  USING (user_id = (auth.uid())::text OR public.can_view_learner_data(id));
CREATE POLICY learners_insert_self ON public.learners
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.uid())::text);
CREATE POLICY learners_update_own ON public.learners
  FOR UPDATE TO authenticated
  USING (user_id = (auth.uid())::text)
  WITH CHECK (user_id = (auth.uid())::text);
CREATE POLICY learners_delete_own ON public.learners
  FOR DELETE TO authenticated
  USING (user_id = (auth.uid())::text);   -- account self-delete; children go via FK cascade

-- ====== the 4 progress tables: own-row writes, principal-scoped reads ======
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','course_enrollments','lego_progress','seed_progress']
  LOOP
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id))',
      t || '_scoped_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (learner_id = public.current_learner_id())',
      t || '_own_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (learner_id = public.current_learner_id()) WITH CHECK (learner_id = public.current_learner_id())',
      t || '_own_update', t);
  END LOOP;
END $$;

-- ====== jwt->>'sub' drift cleanup on the already-enforced tables ======
-- (same value as auth.uid()::text today; codified canonical before they diverge)
DROP POLICY IF EXISTS "Users can view codes they created" ON public.invite_codes;
CREATE POLICY "Users can view codes they created" ON public.invite_codes
  FOR SELECT TO authenticated USING (created_by = (auth.uid())::text);
DROP POLICY IF EXISTS "SSi admins can view all codes" ON public.invite_codes;
CREATE POLICY "SSi admins can view all codes" ON public.invite_codes
  FOR SELECT TO authenticated USING (public.is_ssi_admin());

DROP POLICY IF EXISTS "SSi admins can manage regions" ON public.regions;
CREATE POLICY "SSi admins can manage regions" ON public.regions
  FOR ALL TO authenticated
  USING (public.is_ssi_admin()) WITH CHECK (public.is_ssi_admin());

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT TO authenticated USING (learner_id = public.current_learner_id());

DROP POLICY IF EXISTS user_entitlements_select_own_or_admin ON public.user_entitlements;
CREATE POLICY user_entitlements_select_own_or_admin ON public.user_entitlements
  FOR SELECT TO authenticated
  USING (learner_id = public.current_learner_id() OR public.is_ssi_admin());

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: authorization-layer only (no data rewrites in this migration):
-- DISABLE ROW LEVEL SECURITY per table + re-grant to restore pre-state.
