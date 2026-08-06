-- rollback_co_teacher_read_parity.sql
-- Captured VERBATIM from the live DB immediately before applying
-- 20260806_co_teacher_read_parity.sql. Restores the pre-change state exactly.
-- Captured: 2026-08-06T22:12:08.518Z

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
$function$
;

DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_god_user() OR (EXISTS ( SELECT 1
   FROM schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM (classes c
     LEFT JOIN schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (( SELECT auth.uid() AS uid))::text) OR (s2.admin_user_id = (( SELECT auth.uid() AS uid))::text)))))));

DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE
  USING (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_god_user() OR (EXISTS ( SELECT 1
   FROM schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM (classes c
     LEFT JOIN schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (( SELECT auth.uid() AS uid))::text) OR (s2.admin_user_id = (( SELECT auth.uid() AS uid))::text)))))))
  WITH CHECK ((is_god_user() OR ((user_id = (( SELECT auth.uid() AS uid))::text) AND (role_in_context IS DISTINCT FROM 'teacher'::text) AND (role_in_context IS DISTINCT FROM 'admin'::text)) OR (EXISTS ( SELECT 1
   FROM schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM (classes c
     LEFT JOIN schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (( SELECT auth.uid() AS uid))::text) OR (s2.admin_user_id = (( SELECT auth.uid() AS uid))::text)))))));

NOTIFY pgrst, 'reload schema';

COMMIT;
