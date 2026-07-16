-- ============================================================================
-- can_view_learner_data(): extend read visibility to a class's OWN learner
-- row (owner ruling 2026-07-16 — class as first-class learner).
--
-- Every OTHER read-visibility path this function already grants (school_admin
-- via SCHOOL: tag, teacher/school_admin via CLASS: tag) works by joining the
-- TARGET learner's own user_tags row — but a class-entity learner has no auth
-- uid, so it never HAS a user_tags row. Without this, useSharedBeltProgress's
-- direct course_enrollments read (course_enrollments_scoped_select policy,
-- which calls this function) is silently RLS-blocked for a class's own
-- enrollment row: the belt/progress DISPLAY goes dark in play-as-class even
-- though writes (server-mediated via /api/school/class-progress) succeed.
--
-- This is a READ-ONLY visibility extension — write authorization is
-- unaffected (course_enrollments_own_insert/_own_update still require
-- learner_id = current_learner_id(), matching standing RLS doctrine: writes
-- to another learner's row are never RLS-granted, only ever server-mediated).
-- Same shape as the existing CLASS: tag branch, just keyed on
-- classes.class_learner_id instead of a student's user_tags row.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_view_learner_data(p_learner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
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
                         AND s.admin_user_id = (auth.uid())::text)
               OR EXISTS (SELECT 1 FROM public.classes c
                          LEFT JOIN public.schools s2 ON s2.id = c.school_id
                          WHERE ut.tag_value = 'CLASS:' || c.id::text
                            AND (c.teacher_user_id = (auth.uid())::text
                                 OR s2.admin_user_id = (auth.uid())::text))
             )
         )
      OR EXISTS (
           SELECT 1 FROM public.classes c
           LEFT JOIN public.schools s3 ON s3.id = c.school_id
           WHERE c.class_learner_id = p_learner_id
             AND (
               c.teacher_user_id = (auth.uid())::text
               OR s3.admin_user_id = (auth.uid())::text
               OR EXISTS (SELECT 1 FROM public.class_teachers ct
                          WHERE ct.class_id = c.id AND ct.teacher_user_id = (auth.uid())::text)
             )
         )
$function$;

NOTIFY pgrst, 'reload schema';
