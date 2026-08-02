-- ROLLBACK for 20260801c_rls_perf_initplan_consolidation.sql
-- Machine-generated from before_pg_policies.json (live dump 2026-08-01).
-- Drops every policy the migration created, recreates every policy it dropped,
-- byte-faithful to the deparsed before-state predicates.
BEGIN;

DROP POLICY IF EXISTS "classes_select" ON public.classes;
DROP POLICY IF EXISTS "classes_insert" ON public.classes;
DROP POLICY IF EXISTS "classes_update" ON public.classes;
DROP POLICY IF EXISTS "classes_delete" ON public.classes;
DROP POLICY IF EXISTS "schools_select" ON public.schools;
DROP POLICY IF EXISTS "schools_insert" ON public.schools;
DROP POLICY IF EXISTS "schools_update" ON public.schools;
DROP POLICY IF EXISTS "schools_delete" ON public.schools;
DROP POLICY IF EXISTS "govt_admins_select" ON public.govt_admins;
DROP POLICY IF EXISTS "govt_admins_insert" ON public.govt_admins;
DROP POLICY IF EXISTS "govt_admins_update" ON public.govt_admins;
DROP POLICY IF EXISTS "govt_admins_delete" ON public.govt_admins;
DROP POLICY IF EXISTS "courses_select" ON public.courses;
DROP POLICY IF EXISTS "entitlement_codes_select" ON public.entitlement_codes;
DROP POLICY IF EXISTS "entitlement_codes_insert" ON public.entitlement_codes;
DROP POLICY IF EXISTS "entitlement_codes_update" ON public.entitlement_codes;
DROP POLICY IF EXISTS "entitlement_codes_delete" ON public.entitlement_codes;
DROP POLICY IF EXISTS "user_entitlements_select" ON public.user_entitlements;
DROP POLICY IF EXISTS "user_entitlements_insert" ON public.user_entitlements;
DROP POLICY IF EXISTS "user_entitlements_update" ON public.user_entitlements;
DROP POLICY IF EXISTS "user_entitlements_delete" ON public.user_entitlements;
DROP POLICY IF EXISTS "invite_codes_select" ON public.invite_codes;
DROP POLICY IF EXISTS "invite_codes_insert" ON public.invite_codes;
DROP POLICY IF EXISTS "Users can view own l1 state" ON public.learner_l1_state;
DROP POLICY IF EXISTS "Users can view own lego metrics" ON public.learner_lego_metrics;
DROP POLICY IF EXISTS "Users can view own meta commentary state" ON public.learner_meta_commentary_state;
DROP POLICY IF EXISTS "Users can view own pod state" ON public.learner_pod_state;
DROP POLICY IF EXISTS "Users can view own speaking opportunities" ON public.learner_speaking_opportunities;
DROP POLICY IF EXISTS "regions_insert" ON public.regions;
DROP POLICY IF EXISTS "regions_update" ON public.regions;
DROP POLICY IF EXISTS "regions_delete" ON public.regions;
DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;

CREATE POLICY "God users can read all classes" ON public.classes FOR SELECT TO authenticated
  USING (is_god_user());
CREATE POLICY "God users can write all classes" ON public.classes FOR ALL TO authenticated
  USING (is_god_user())
  WITH CHECK (is_god_user());
CREATE POLICY "classes_select" ON public.classes FOR SELECT
  USING (((teacher_user_id = (auth.uid())::text) OR is_school_admin_of(school_id) OR has_user_tag('class'::text, ('CLASS:'::text || (id)::text))));
CREATE POLICY "classes_select_admin_subtree" ON public.classes FOR SELECT TO authenticated
  USING ((is_ssi_admin() OR (EXISTS ( SELECT 1
   FROM schools s
  WHERE ((s.id = classes.school_id) AND is_govt_admin_over_group(s.group_id))))));
CREATE POLICY "classes_insert" ON public.classes FOR INSERT
  WITH CHECK ((teacher_user_id = (auth.uid())::text));
CREATE POLICY "classes_update" ON public.classes FOR UPDATE
  USING (((teacher_user_id = (auth.uid())::text) OR is_class_teacher(id)))
  WITH CHECK (((teacher_user_id = (auth.uid())::text) OR is_class_teacher(id)));
CREATE POLICY "God users can read all schools" ON public.schools FOR SELECT TO authenticated
  USING (is_god_user());
CREATE POLICY "God users can write all schools" ON public.schools FOR ALL TO authenticated
  USING (is_god_user())
  WITH CHECK (is_god_user());
CREATE POLICY "schools_select" ON public.schools FOR SELECT
  USING (((admin_user_id = (auth.uid())::text) OR has_user_tag('school'::text, ('SCHOOL:'::text || (id)::text))));
CREATE POLICY "schools_select_admin_subtree" ON public.schools FOR SELECT TO authenticated
  USING ((is_ssi_admin() OR is_govt_admin_over_group(group_id)));
CREATE POLICY "schools_insert" ON public.schools FOR INSERT
  WITH CHECK ((admin_user_id = (auth.uid())::text));
CREATE POLICY "schools_update" ON public.schools FOR UPDATE
  USING ((admin_user_id = (auth.uid())::text));
CREATE POLICY "God users can read all govt_admins" ON public.govt_admins FOR SELECT TO authenticated
  USING (is_god_user());
CREATE POLICY "God users can write all govt_admins" ON public.govt_admins FOR ALL TO authenticated
  USING (is_god_user())
  WITH CHECK (is_god_user());
CREATE POLICY "govt_admins_select" ON public.govt_admins FOR SELECT
  USING ((user_id = (auth.uid())::text));
CREATE POLICY "govt_admins_insert" ON public.govt_admins FOR INSERT
  WITH CHECK ((user_id = (auth.uid())::text));
CREATE POLICY "Anon can read courses" ON public.courses FOR SELECT TO anon
  USING ((status = ANY (ARRAY['beta'::text, 'released'::text])));
CREATE POLICY "Public users can view all courses" ON public.courses FOR SELECT TO anon
  USING ((new_app_status = ANY (ARRAY['live'::text, 'beta'::text])));
CREATE POLICY "Public users can view visible courses" ON public.courses FOR SELECT TO anon
  USING ((visibility = ANY (ARRAY['public'::text, 'beta'::text])));
CREATE POLICY "Authenticated users can view all courses" ON public.courses FOR SELECT TO authenticated
  USING ((new_app_status = ANY (ARRAY['live'::text, 'beta'::text])));
CREATE POLICY "Authenticated users can view visible courses" ON public.courses FOR SELECT TO authenticated
  USING ((visibility = ANY (ARRAY['public'::text, 'beta'::text])));
CREATE POLICY "courses_read_policy" ON public.courses FOR SELECT TO authenticated
  USING ((status = ANY (ARRAY['beta'::text, 'released'::text])));
CREATE POLICY "courses_select_public" ON public.courses FOR SELECT
  USING (true);
CREATE POLICY "God users manage entitlement codes" ON public.entitlement_codes FOR ALL
  USING (is_god_user());
CREATE POLICY "entitlement_codes_admin_select" ON public.entitlement_codes FOR SELECT
  USING (is_ssi_admin());
CREATE POLICY "entitlement_codes_insert_admin" ON public.entitlement_codes FOR INSERT
  WITH CHECK (is_ssi_admin());
CREATE POLICY "entitlement_codes_update_admin" ON public.entitlement_codes FOR UPDATE
  USING (is_ssi_admin());
CREATE POLICY "entitlement_codes_delete_admin" ON public.entitlement_codes FOR DELETE
  USING (is_ssi_admin());
CREATE POLICY "God users manage all entitlements" ON public.user_entitlements FOR ALL
  USING (is_god_user());
CREATE POLICY "Users read own entitlements" ON public.user_entitlements FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "user_entitlements_select_own_or_admin" ON public.user_entitlements FOR SELECT TO authenticated
  USING (((learner_id = current_learner_id()) OR is_ssi_admin()));
CREATE POLICY "user_entitlements_insert_admin" ON public.user_entitlements FOR INSERT
  WITH CHECK (is_ssi_admin());
CREATE POLICY "user_entitlements_update_admin" ON public.user_entitlements FOR UPDATE
  USING (is_ssi_admin());
CREATE POLICY "user_entitlements_delete_admin" ON public.user_entitlements FOR DELETE
  USING (is_ssi_admin());
CREATE POLICY "God users can read all invite_codes" ON public.invite_codes FOR SELECT TO authenticated
  USING (is_god_user());
CREATE POLICY "SSi admins can view all codes" ON public.invite_codes FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view codes they created" ON public.invite_codes FOR SELECT TO authenticated
  USING ((created_by = (auth.uid())::text));
CREATE POLICY "SSi admins can create govt_admin codes" ON public.invite_codes FOR INSERT
  WITH CHECK (((code_type = 'govt_admin'::text) AND (EXISTS ( SELECT 1
   FROM learners
  WHERE ((learners.user_id = (auth.jwt() ->> 'sub'::text)) AND (learners.platform_role = 'ssi_admin'::text))))));
CREATE POLICY "Govt admins can create school_admin codes" ON public.invite_codes FOR INSERT
  WITH CHECK (((code_type = 'school_admin'::text) AND (EXISTS ( SELECT 1
   FROM govt_admins
  WHERE (govt_admins.user_id = (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY "School admins can create teacher codes" ON public.invite_codes FOR INSERT
  WITH CHECK (((code_type = 'teacher'::text) AND (EXISTS ( SELECT 1
   FROM schools
  WHERE ((schools.admin_user_id = (auth.jwt() ->> 'sub'::text)) AND (schools.id = invite_codes.grants_school_id))))));
CREATE POLICY "Teachers can create student codes" ON public.invite_codes FOR INSERT
  WITH CHECK (((code_type = 'student'::text) AND (EXISTS ( SELECT 1
   FROM classes
  WHERE ((classes.teacher_user_id = (auth.jwt() ->> 'sub'::text)) AND (classes.id = invite_codes.grants_class_id))))));
CREATE POLICY "invite_codes_insert" ON public.invite_codes FOR INSERT
  WITH CHECK ((created_by = (auth.uid())::text));
CREATE POLICY "Admins can read all course_enrollments" ON public.course_enrollments FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Admins can read all lego_progress" ON public.lego_progress FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Admins can read all seed_progress" ON public.seed_progress FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Admins can read all sessions" ON public.sessions FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Admins can read all learners" ON public.learners FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Admins can read all learner_l1_state" ON public.learner_l1_state FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view own l1 state" ON public.learner_l1_state FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "Admins can read all learner_lego_metrics" ON public.learner_lego_metrics FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view own lego metrics" ON public.learner_lego_metrics FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "Admins can read all meta commentary state" ON public.learner_meta_commentary_state FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view own meta commentary state" ON public.learner_meta_commentary_state FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "Admins can read all learner_pod_state" ON public.learner_pod_state FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view own pod state" ON public.learner_pod_state FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "Admins can read all learner_speaking_opportunities" ON public.learner_speaking_opportunities FOR SELECT TO authenticated
  USING (is_ssi_admin());
CREATE POLICY "Users can view own speaking opportunities" ON public.learner_speaking_opportunities FOR SELECT
  USING ((learner_id IN ( SELECT learners.id
   FROM learners
  WHERE (learners.user_id = (( SELECT auth.uid() AS uid))::text))));
CREATE POLICY "SSi admins can manage regions" ON public.regions FOR ALL TO authenticated
  USING (is_ssi_admin())
  WITH CHECK (is_ssi_admin());
CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT TO authenticated
  USING ((learner_id = current_learner_id()));
CREATE POLICY "subscriptions_admin_select" ON public.subscriptions FOR SELECT
  USING (is_ssi_admin());

NOTIFY pgrst, 'reload schema';
COMMIT;
