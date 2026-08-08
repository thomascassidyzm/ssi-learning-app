-- rollback_co_teacher_class_page_perf_2026-08-08.sql
--
-- Reverses supabase/migrations/20260808_co_teacher_class_page_perf.sql,
-- restoring the exact pre-migration live state as read out of pg_get_expr /
-- pg_get_functiondef on 2026-08-08 before the canary ran.
--
-- The two scope functions are dropped last, after nothing references them.
-- This restores the ~4.3 s class detail page; it exists only so the perf fix
-- can be undone in one step if it ever proves to have changed semantics.

BEGIN;

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

DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND public.is_school_admin_of(s.id))
    OR EXISTS (SELECT 1 FROM public.classes c
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (SELECT auth.uid())::text
                      OR public.is_school_admin_of(c.school_id)
                      OR public.is_class_teacher(c.id)))
  );

DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND public.is_school_admin_of(s.id))
    OR EXISTS (SELECT 1 FROM public.classes c
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (SELECT auth.uid())::text
                      OR public.is_school_admin_of(c.school_id)
                      OR (public.is_class_teacher(c.id)
                          AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
                          AND user_tags.role_in_context IS DISTINCT FROM 'admin')))
  )
  WITH CHECK (
    public.is_god_user()
    OR (user_id = (SELECT auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
    OR EXISTS (SELECT 1 FROM public.schools s
               WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
                 AND public.is_school_admin_of(s.id))
    OR EXISTS (SELECT 1 FROM public.classes c
               WHERE user_tags.tag_value = 'CLASS:' || c.id::text
                 AND (c.teacher_user_id = (SELECT auth.uid())::text
                      OR public.is_school_admin_of(c.school_id)
                      OR (public.is_class_teacher(c.id)
                          AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
                          AND user_tags.role_in_context IS DISTINCT FROM 'admin')))
  );

DROP FUNCTION IF EXISTS public.my_readable_tag_values();
DROP FUNCTION IF EXISTS public.my_manageable_tag_values();

NOTIFY pgrst, 'reload schema';

COMMIT;
