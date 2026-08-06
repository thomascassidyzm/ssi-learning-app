-- 20260806b_co_teacher_manage_ruling.sql
--
-- WHO MAY CHANGE WHO TEACHES A CLASS — founder ruling, 2026-08-06, verbatim:
--
--   "any group leader or the current teacher of the class can add the
--    co-teacher I think"
--
-- The server half of this ruling lives in api/_utils/classTeacherAuth.ts
-- (`canManageClassTeachers`): the class's CURRENT (lead) teacher, or any group
-- leader ABOVE the class, or a platform admin. This migration closes the one
-- place the DB could contradict it.
--
-- THE GAP. `20260806_co_teacher_read_parity.sql` (same day, earlier) widened
-- `user_tags_update` with an `is_class_teacher(c.id)` disjunct. Its reason was
-- correct and stands: removing a STUDENT from a class is a client-direct
-- `user_tags.update({removed_at})` at ClassDetail.vue, so a co-teacher who
-- could see the roster but not change it would be the silent-empty failure
-- class all over again.
--
-- But that disjunct carries no `role_in_context` restriction, so it also lets a
-- co-teacher write TEACHER rows on their class straight from the browser —
-- reinstating a removed co-teacher (`removed_at = NULL`) or soft-deleting the
-- LEAD teacher's own tag. That is exactly the authority the ruling reserves for
-- the lead teacher and the leaders above, and it would have routed around the
-- server endpoint that enforces it.
--
-- THE FIX is a narrowing of one disjunct only: the membership branch keeps
-- student rows and loses teacher/admin rows. Every other branch is reproduced
-- VERBATIM — own-row, `is_god_user()`, school_admin, and the `teacher_user_id`
-- lead-pointer branch, which is the ruling's own principal and therefore keeps
-- full write authority over teacher rows.
--
-- Nobody loses an ability they exercise today: measured live 2026-08-06, ZERO
-- classes have more than one active teacher tag, so no co-teacher exists yet to
-- narrow. This lands the rule before the first one does.
--
-- `user_tags_select` is NOT touched — a co-teacher seeing who else teaches
-- their class is read parity, and correct. `user_tags_insert` is already
-- god-only for teacher rows, which is why adding a co-teacher is
-- server-mediated in the first place.
--
-- Canary: supabase/secfix-toolkit/canary_co_teacher_manage_ruling.cjs
-- Rollback: re-apply 20260806_co_teacher_read_parity.sql (its policy body is
-- the pre-image of this one).

BEGIN;

DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR EXISTS (
         SELECT 1 FROM public.schools s
         WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
           AND s.admin_user_id = (SELECT auth.uid())::text)
    OR EXISTS (
         SELECT 1 FROM public.classes c
         LEFT JOIN public.schools s2 ON s2.id = c.school_id
         WHERE user_tags.tag_value = 'CLASS:' || c.id::text
           AND (c.teacher_user_id = (SELECT auth.uid())::text
                OR s2.admin_user_id = (SELECT auth.uid())::text
                -- co-teaching write parity (A-74) — STUDENT rows only, per the
                -- 2026-08-06 ruling on who may change who teaches a class.
                OR (public.is_class_teacher(c.id)
                    AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
                    AND user_tags.role_in_context IS DISTINCT FROM 'admin')))
  )
  WITH CHECK (
    public.is_god_user()
    OR (user_id = (SELECT auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
    OR EXISTS (
         SELECT 1 FROM public.schools s
         WHERE user_tags.tag_value = 'SCHOOL:' || s.id::text
           AND s.admin_user_id = (SELECT auth.uid())::text)
    OR EXISTS (
         SELECT 1 FROM public.classes c
         LEFT JOIN public.schools s2 ON s2.id = c.school_id
         WHERE user_tags.tag_value = 'CLASS:' || c.id::text
           AND (c.teacher_user_id = (SELECT auth.uid())::text
                OR s2.admin_user_id = (SELECT auth.uid())::text
                OR (public.is_class_teacher(c.id)
                    AND role_in_context IS DISTINCT FROM 'teacher'
                    AND role_in_context IS DISTINCT FROM 'admin')))
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
