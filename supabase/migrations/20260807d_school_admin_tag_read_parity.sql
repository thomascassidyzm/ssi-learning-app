-- School-admin READ PARITY for tag-based admins (2026-08-07).
--
-- THE BUG, found live while Tom tested staging as "Harbour Leader", School
-- Admin at "Harbour View School, Visakhapatnam": her Dashboard showed the
-- school's three classes, five teachers and 41 learners, while her Classes tab
-- said "0 classes" and offered the first-run "No classes yet" empty state.
--
-- WHY. The dashboard is SERVER-mediated (service role). Every /schools client
-- composable reads Supabase DIRECTLY, so it goes through RLS — and every
-- school-admin predicate in the live policy set asked exactly one question:
--
--     schools.admin_user_id = auth.uid()::text
--
-- That column is the FOUNDING admin pointer. Harbour Leader is a school admin
-- by USER TAG (tag_type='school', role_in_context='admin') — which is what the
-- invite path writes for every admin after the first. So she matched nothing,
-- the reads came back silently empty, and the UI reported that emptiness as
-- fact. Verified as her real JWT before this migration:
--
--     classes visible ......... 0   (of 3)
--     school user_tags ........ 1   (her own; of 7)
--     class user_tags ......... 0   (of 67 course-wide)
--     learners ................ 1   (herself; of 41 in her school)
--
-- 20260807c widened is_school_admin_of() to accept the admin tag, which fixes
-- classes_select. This migration finishes the job: the SAME legacy pointer test
-- is hand-inlined in user_tags_select, user_tags_update and
-- can_view_learner_data, so a tag-based admin could see her classes but still
-- not the teachers on them (the class_teachers VIEW reads user_tags under
-- security_invoker), nor her own school's pupils. A class page that cannot see
-- its teachers is exactly the surface a leader needs in order to attach one.
--
-- THE FIX. Every one of those inlined tests becomes a call to
-- is_school_admin_of(), so "am I an admin of this school?" has ONE definition
-- and cannot drift again. No new authority is granted beyond what 20260807c
-- already decided: an 'admin' tag is not self-mintable (user_tags_insert /
-- _update WITH CHECK refuse role_in_context 'admin' and 'teacher' from an
-- authenticated caller — service-role/god only), so honouring it merely
-- respects a grant the server already made.
--
-- is_school_admin_of() is SECURITY DEFINER, so calling it from a user_tags
-- policy reads user_tags with RLS bypassed — no recursion. Same shape as
-- is_class_teacher(), which these policies already call.
--
-- The function body below is IDENTICAL to 20260807c's. It is repeated so this
-- file is self-contained and order-independent; CREATE OR REPLACE with the
-- same definition is a no-op if 20260807c ran first.
--
-- Canaried per RLS doctrine rule 3:
--   supabase/secfix-toolkit/canary_school_admin_tag_read_parity.cjs

CREATE OR REPLACE FUNCTION public.is_school_admin_of(p_school_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    -- The founding admin: the school's own pointer column.
    SELECT 1 FROM public.schools s
    WHERE s.id = p_school_id
      AND s.admin_user_id = (auth.uid())::text
  ) OR EXISTS (
    -- Every subsequent admin: the service-role-written school admin tag.
    SELECT 1 FROM public.user_tags ut
    WHERE ut.user_id = (auth.uid())::text
      AND ut.tag_type = 'school'
      AND ut.role_in_context = 'admin'
      AND ut.removed_at IS NULL
      AND ut.tag_value = 'SCHOOL:' || (p_school_id)::text
  );
$function$;

-- ---------------------------------------------------------------------------
-- learners: a school admin sees their own school's learners.
-- Only the three inlined `admin_user_id` tests change; every other disjunct
-- (own row, god, ssi_admin, govt_admin, class teacher, co-teacher) is carried
-- over verbatim from the live 2026-08-06 definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_learner_data(p_learner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                         AND public.is_school_admin_of(s.id))
               OR EXISTS (SELECT 1 FROM public.classes c
                          WHERE ut.tag_value = 'CLASS:' || c.id::text
                            AND (c.teacher_user_id = (auth.uid())::text
                                 OR public.is_school_admin_of(c.school_id)
                                 -- co-teaching read parity (A-74, 2026-08-06)
                                 OR public.is_class_teacher(c.id)))
             )
         )
      OR EXISTS (
           SELECT 1 FROM public.classes c
           WHERE c.class_learner_id = p_learner_id
             AND (
               c.teacher_user_id = (auth.uid())::text
               OR public.is_school_admin_of(c.school_id)
               OR EXISTS (SELECT 1 FROM public.class_teachers ct
                          WHERE ct.class_id = c.id AND ct.teacher_user_id = (auth.uid())::text)
             )
         )
$function$;

-- ---------------------------------------------------------------------------
-- user_tags: a school admin sees (and maintains) the tags of their own school
-- and of its classes. This is what makes the class_teachers view — and so the
-- co-teacher panel, the teacher roster and "which classes does this teacher
-- teach" — non-empty for an admin who holds the tag rather than the pointer.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
        AND public.is_school_admin_of(s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE user_tags.tag_value = 'CLASS:' || c.id::text
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR public.is_school_admin_of(c.school_id)
          OR public.is_class_teacher(c.id)
        )
    )
  );

-- The UPDATE arm keeps its deliberate asymmetry: a co-teacher may maintain a
-- class's ordinary tags but may NOT write the privileged 'teacher'/'admin'
-- roles (those stay service-role only, which is why /api/teacher/class-teachers
-- exists). Only the admin test changes.
DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR EXISTS (
      SELECT 1 FROM public.schools s
      WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
        AND public.is_school_admin_of(s.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE user_tags.tag_value = 'CLASS:' || c.id::text
        AND (
          c.teacher_user_id = (SELECT auth.uid())::text
          OR public.is_school_admin_of(c.school_id)
          OR (
            public.is_class_teacher(c.id)
            AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
            AND user_tags.role_in_context IS DISTINCT FROM 'admin'
          )
        )
    )
  );

NOTIFY pgrst, 'reload schema';
