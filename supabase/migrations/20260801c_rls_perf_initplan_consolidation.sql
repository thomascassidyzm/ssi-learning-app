-- RLS PERFORMANCE PASS — initplan wraps + permissive-policy consolidation
-- (Supabase Performance Advisor: 14× auth_rls_initplan + 86× multiple_permissive_policies
--  as measured live 2026-08-01 by supabase/secfix-toolkit/rls-perf-2026-08-01/lint_*.sql;
--  before-state: before_pg_policies.json in the same dir. Rollback: rollback_20260801c.sql.)
--
-- PRIME DIRECTIVE: semantics preserved EXACTLY — every consolidation below is the
-- literal OR of the policies it replaces, or a drop justified by a subsumption
-- proof stated inline. Two facts carry most of the proofs:
--
--   FACT 1: is_god_user() is defined as `SELECT public.is_ssi_admin()` (deprecated
--           alias since 2026-06-16) — every "God users …" policy is EXACTLY is_ssi_admin().
--   FACT 2: can_view_learner_data(x) contains `OR public.is_ssi_admin()` as an
--           unconditional disjunct — so any `USING (is_ssi_admin())` SELECT policy
--           stacked on a `USING (can_view_learner_data(learner_id))` policy adds
--           nothing to the union and can be dropped outright.
--
-- Role-scoping note: policies moved from TO public → TO authenticated are ones whose
-- predicates are identically FALSE/NULL for anon (they compare against auth.uid(),
-- which is NULL for anon, or check learner/admin rows that require a uid). anon gets
-- zero rows before and after; the linter stops evaluating them for anon/authenticator/
-- dashboard_user/cli_login_postgres/pgbouncer/supabase_privileged_role.
-- Policies that DO serve anon (courses read, regions read) keep anon in scope.
--
-- initplan: every auth.uid() below is written `(select auth.uid())` (lint 0003), and
-- zero-arg stable helpers (is_ssi_admin, current_learner_id) are wrapped
-- `(select fn())` for the same one-eval-per-query effect. Row-dependent helpers
-- (can_view_learner_data(learner_id), is_school_admin_of(school_id), …) cannot be
-- init-planned and stay as-is. The four legacy `auth.jwt() ->> 'sub'` uses in
-- invite_codes INSERT become `(select auth.uid())::text` — the canonical equal
-- (same conversion migration 20260512 applied estate-wide).

BEGIN;

------------------------------------------------------------------------------
-- 1. classes  (God-ALL + per-action stack → one policy per action)
-- Before, authenticated effective:
--   SELECT: classes_select ∨ God-read(is_god) ∨ God-write-USING(is_god) ∨ classes_select_admin_subtree(is_ssi ∨ govt-subtree)
--           = classes_select ∨ is_ssi_admin ∨ govt-subtree            [FACT 1; is_ssi absorbed]
--   INSERT: classes_insert ∨ is_god  = own-teacher ∨ is_ssi_admin
--   UPDATE: classes_update ∨ is_god  (USING and CHECK identical on both)
--   DELETE: is_god only (God-ALL leg; authenticated currently holds NO DELETE grant —
--           policy recreated anyway so the policy layer stays identical if grants ever change)
------------------------------------------------------------------------------
DROP POLICY "God users can read all classes"  ON public.classes;
DROP POLICY "God users can write all classes" ON public.classes;
DROP POLICY classes_select                    ON public.classes;
DROP POLICY classes_select_admin_subtree      ON public.classes;
DROP POLICY classes_insert                    ON public.classes;
DROP POLICY classes_update                    ON public.classes;

CREATE POLICY classes_select ON public.classes FOR SELECT TO authenticated
  USING (
    teacher_user_id = (select auth.uid())::text
    OR is_school_admin_of(school_id)
    OR has_user_tag('class', 'CLASS:' || id::text)
    OR (select is_ssi_admin())
    OR EXISTS (SELECT 1 FROM schools s
               WHERE s.id = classes.school_id
                 AND is_govt_admin_over_group(s.group_id))
  );
CREATE POLICY classes_insert ON public.classes FOR INSERT TO authenticated
  WITH CHECK (teacher_user_id = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY classes_update ON public.classes FOR UPDATE TO authenticated
  USING      (teacher_user_id = (select auth.uid())::text OR is_class_teacher(id) OR (select is_ssi_admin()))
  WITH CHECK (teacher_user_id = (select auth.uid())::text OR is_class_teacher(id) OR (select is_ssi_admin()));
CREATE POLICY classes_delete ON public.classes FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 2. schools  (same shape as classes)
-- Before, authenticated effective:
--   SELECT: schools_select ∨ is_god ∨ schools_select_admin_subtree(is_ssi ∨ govt-over-group)
--   INSERT: schools_insert ∨ is_god ; UPDATE: schools_update ∨ is_god ; DELETE: is_god
--   (schools_update had no WITH CHECK → CHECK defaulted to USING; preserved below.)
------------------------------------------------------------------------------
DROP POLICY "God users can read all schools"  ON public.schools;
DROP POLICY "God users can write all schools" ON public.schools;
DROP POLICY schools_select                    ON public.schools;
DROP POLICY schools_select_admin_subtree      ON public.schools;
DROP POLICY schools_insert                    ON public.schools;
DROP POLICY schools_update                    ON public.schools;

CREATE POLICY schools_select ON public.schools FOR SELECT TO authenticated
  USING (
    admin_user_id = (select auth.uid())::text
    OR has_user_tag('school', 'SCHOOL:' || id::text)
    OR (select is_ssi_admin())
    OR is_govt_admin_over_group(group_id)
  );
CREATE POLICY schools_insert ON public.schools FOR INSERT TO authenticated
  WITH CHECK (admin_user_id = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY schools_update ON public.schools FOR UPDATE TO authenticated
  USING      (admin_user_id = (select auth.uid())::text OR (select is_ssi_admin()))
  WITH CHECK (admin_user_id = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY schools_delete ON public.schools FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 3. govt_admins
-- Before, authenticated effective: SELECT own ∨ is_god×2 ; INSERT own ∨ is_god ;
-- UPDATE/DELETE is_god (God-ALL legs — no UPDATE/DELETE grant today, recreated for
-- policy-layer fidelity).
------------------------------------------------------------------------------
DROP POLICY "God users can read all govt_admins"  ON public.govt_admins;
DROP POLICY "God users can write all govt_admins" ON public.govt_admins;
DROP POLICY govt_admins_select                    ON public.govt_admins;
DROP POLICY govt_admins_insert                    ON public.govt_admins;

CREATE POLICY govt_admins_select ON public.govt_admins FOR SELECT TO authenticated
  USING (user_id = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY govt_admins_insert ON public.govt_admins FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY govt_admins_update ON public.govt_admins FOR UPDATE TO authenticated
  USING ((select is_ssi_admin())) WITH CHECK ((select is_ssi_admin()));
CREATE POLICY govt_admins_delete ON public.govt_admins FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 4. courses — SEVEN stacked SELECT policies collapse to one.
-- courses_select_public is `USING (true)` TO public, so the effective SELECT
-- predicate for BOTH anon and authenticated is exactly TRUE; the six
-- status/visibility-gated policies are strict subsets of true and add nothing.
-- Consolidated policy = USING (true) TO anon, authenticated — IDENTICAL behavior.
-- ⚠ FLAGGED TO TOM (not decided here): this means anon already sees EVERY course
-- row regardless of status/visibility/new_app_status. If that is an accidental
-- over-grant, tightening it is a separate, deliberate security change.
------------------------------------------------------------------------------
DROP POLICY "Anon can read courses"                     ON public.courses;
DROP POLICY "Public users can view all courses"         ON public.courses;
DROP POLICY "Public users can view visible courses"     ON public.courses;
DROP POLICY "Authenticated users can view all courses"  ON public.courses;
DROP POLICY "Authenticated users can view visible courses" ON public.courses;
DROP POLICY courses_read_policy                         ON public.courses;
DROP POLICY courses_select_public                       ON public.courses;

CREATE POLICY courses_select ON public.courses FOR SELECT TO anon, authenticated
  USING (true);

------------------------------------------------------------------------------
-- 5. entitlement_codes — God-ALL(public) duplicated per-action admin policies.
-- is_god_user() = is_ssi_admin() [FACT 1] → each action's union is is_ssi_admin().
-- anon/other roles: is_ssi_admin() is FALSE without an authenticated uid → scoping
-- TO authenticated changes nothing (56 role×action lint pairs die here and in §6).
------------------------------------------------------------------------------
DROP POLICY "God users manage entitlement codes" ON public.entitlement_codes;
DROP POLICY entitlement_codes_admin_select       ON public.entitlement_codes;
DROP POLICY entitlement_codes_insert_admin       ON public.entitlement_codes;
DROP POLICY entitlement_codes_update_admin       ON public.entitlement_codes;
DROP POLICY entitlement_codes_delete_admin       ON public.entitlement_codes;

CREATE POLICY entitlement_codes_select ON public.entitlement_codes FOR SELECT TO authenticated
  USING ((select is_ssi_admin()));
CREATE POLICY entitlement_codes_insert ON public.entitlement_codes FOR INSERT TO authenticated
  WITH CHECK ((select is_ssi_admin()));
CREATE POLICY entitlement_codes_update ON public.entitlement_codes FOR UPDATE TO authenticated
  USING ((select is_ssi_admin())) WITH CHECK ((select is_ssi_admin()));
CREATE POLICY entitlement_codes_delete ON public.entitlement_codes FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 6. user_entitlements
-- SELECT union: own-learner-IN ∨ (own-limit1 ∨ is_ssi) ∨ is_god = own-learner-IN ∨ is_ssi_admin.
-- (own-IN uses ALL learner rows for the uid; current_learner_id() is LIMIT 1 of the
--  same set, so it is a subset of the IN — the IN form is kept to preserve
--  multi-learner-per-uid reads exactly.)
-- INSERT/UPDATE/DELETE union: is_god ∨ is_ssi = is_ssi_admin.
------------------------------------------------------------------------------
DROP POLICY "God users manage all entitlements"    ON public.user_entitlements;
DROP POLICY "Users read own entitlements"          ON public.user_entitlements;
DROP POLICY user_entitlements_select_own_or_admin  ON public.user_entitlements;
DROP POLICY user_entitlements_insert_admin         ON public.user_entitlements;
DROP POLICY user_entitlements_update_admin         ON public.user_entitlements;
DROP POLICY user_entitlements_delete_admin         ON public.user_entitlements;

CREATE POLICY user_entitlements_select ON public.user_entitlements FOR SELECT TO authenticated
  USING (
    learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
    OR (select is_ssi_admin())
  );
CREATE POLICY user_entitlements_insert ON public.user_entitlements FOR INSERT TO authenticated
  WITH CHECK ((select is_ssi_admin()));
CREATE POLICY user_entitlements_update ON public.user_entitlements FOR UPDATE TO authenticated
  USING ((select is_ssi_admin())) WITH CHECK ((select is_ssi_admin()));
CREATE POLICY user_entitlements_delete ON public.user_entitlements FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 7. invite_codes
-- SELECT union: own-created ∨ is_god ∨ is_ssi = own-created ∨ is_ssi_admin.
-- INSERT union: literal OR of all five stacked CHECKs (four role-ladder rules +
-- own-created). auth.jwt()->>'sub' → (select auth.uid())::text (canonical equal).
-- (Client roles currently hold no SELECT/INSERT grant on this table — reads are
-- server-mediated since 2026-07-05 — so these are latent; recreated faithfully.)
------------------------------------------------------------------------------
DROP POLICY "God users can read all invite_codes"          ON public.invite_codes;
DROP POLICY "SSi admins can view all codes"                ON public.invite_codes;
DROP POLICY "Users can view codes they created"            ON public.invite_codes;
DROP POLICY "SSi admins can create govt_admin codes"       ON public.invite_codes;
DROP POLICY "Govt admins can create school_admin codes"    ON public.invite_codes;
DROP POLICY "School admins can create teacher codes"       ON public.invite_codes;
DROP POLICY "Teachers can create student codes"            ON public.invite_codes;
DROP POLICY invite_codes_insert                            ON public.invite_codes;

CREATE POLICY invite_codes_select ON public.invite_codes FOR SELECT TO authenticated
  USING (created_by = (select auth.uid())::text OR (select is_ssi_admin()));
CREATE POLICY invite_codes_insert ON public.invite_codes FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (select auth.uid())::text
    OR (code_type = 'govt_admin' AND EXISTS (
          SELECT 1 FROM public.learners
          WHERE learners.user_id = (select auth.uid())::text
            AND learners.platform_role = 'ssi_admin'))
    OR (code_type = 'school_admin' AND EXISTS (
          SELECT 1 FROM public.govt_admins
          WHERE govt_admins.user_id = (select auth.uid())::text))
    OR (code_type = 'teacher' AND EXISTS (
          SELECT 1 FROM public.schools
          WHERE schools.admin_user_id = (select auth.uid())::text
            AND schools.id = invite_codes.grants_school_id))
    OR (code_type = 'student' AND EXISTS (
          SELECT 1 FROM public.classes
          WHERE classes.teacher_user_id = (select auth.uid())::text
            AND classes.id = invite_codes.grants_class_id))
  );

------------------------------------------------------------------------------
-- 8. Learner-data spine: DROP-only. Each 'Admins can read all X' (is_ssi_admin)
-- is subsumed by the surviving scoped SELECT, whose predicate contains
-- is_ssi_admin() as an unconditional disjunct [FACT 2; learners_select contains
-- can_view_learner_data(id)]. Union unchanged → no replacement policy needed.
------------------------------------------------------------------------------
DROP POLICY "Admins can read all course_enrollments" ON public.course_enrollments;
DROP POLICY "Admins can read all lego_progress"      ON public.lego_progress;
DROP POLICY "Admins can read all seed_progress"      ON public.seed_progress;
DROP POLICY "Admins can read all sessions"           ON public.sessions;
DROP POLICY "Admins can read all learners"           ON public.learners;

------------------------------------------------------------------------------
-- 9. learner_* state tables: merge admin-read into the own-read SELECT.
-- Union: own-learner-IN ∨ is_ssi_admin. Own policies were TO public with predicates
-- identically false for anon (auth.uid() NULL) → TO authenticated is a no-op change.
-- INSERT/UPDATE/DELETE own-policies untouched (single per action, no stacking).
------------------------------------------------------------------------------
DROP POLICY "Admins can read all learner_l1_state"               ON public.learner_l1_state;
DROP POLICY "Users can view own l1 state"                        ON public.learner_l1_state;
CREATE POLICY "Users can view own l1 state" ON public.learner_l1_state FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
         OR (select is_ssi_admin()));

DROP POLICY "Admins can read all learner_lego_metrics"           ON public.learner_lego_metrics;
DROP POLICY "Users can view own lego metrics"                    ON public.learner_lego_metrics;
CREATE POLICY "Users can view own lego metrics" ON public.learner_lego_metrics FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
         OR (select is_ssi_admin()));

DROP POLICY "Admins can read all meta commentary state"          ON public.learner_meta_commentary_state;
DROP POLICY "Users can view own meta commentary state"           ON public.learner_meta_commentary_state;
CREATE POLICY "Users can view own meta commentary state" ON public.learner_meta_commentary_state FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
         OR (select is_ssi_admin()));

DROP POLICY "Admins can read all learner_pod_state"              ON public.learner_pod_state;
DROP POLICY "Users can view own pod state"                       ON public.learner_pod_state;
CREATE POLICY "Users can view own pod state" ON public.learner_pod_state FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
         OR (select is_ssi_admin()));

DROP POLICY "Admins can read all learner_speaking_opportunities" ON public.learner_speaking_opportunities;
DROP POLICY "Users can view own speaking opportunities"          ON public.learner_speaking_opportunities;
CREATE POLICY "Users can view own speaking opportunities" ON public.learner_speaking_opportunities FOR SELECT TO authenticated
  USING (learner_id IN (SELECT id FROM public.learners WHERE user_id = (select auth.uid())::text)
         OR (select is_ssi_admin()));

------------------------------------------------------------------------------
-- 10. regions: split the admin ALL-policy into write-only actions; its SELECT leg
-- was subsumed by 'Anyone can view regions' USING (true), which stays (anon needs it).
------------------------------------------------------------------------------
DROP POLICY "SSi admins can manage regions" ON public.regions;
CREATE POLICY regions_insert ON public.regions FOR INSERT TO authenticated
  WITH CHECK ((select is_ssi_admin()));
CREATE POLICY regions_update ON public.regions FOR UPDATE TO authenticated
  USING ((select is_ssi_admin())) WITH CHECK ((select is_ssi_admin()));
CREATE POLICY regions_delete ON public.regions FOR DELETE TO authenticated
  USING ((select is_ssi_admin()));

------------------------------------------------------------------------------
-- 11. subscriptions: merge the two SELECTs (own ∨ is_ssi_admin).
-- update/delete admin policies untouched (single per action).
------------------------------------------------------------------------------
DROP POLICY "Users can view own subscription" ON public.subscriptions;
DROP POLICY subscriptions_admin_select        ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT TO authenticated
  USING (learner_id = (select current_learner_id()) OR (select is_ssi_admin()));

NOTIFY pgrst, 'reload schema';

COMMIT;
