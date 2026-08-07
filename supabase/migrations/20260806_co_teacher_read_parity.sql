-- 20260806_co_teacher_read_parity.sql
--
-- CO-TEACHING READ PARITY (item A-74, Welsh teacher's share-a-class request).
--
-- The problem, measured live 2026-08-06 as a simulated co-teacher inside a
-- rolled-back transaction:
--
--                        lead teacher   co-teacher (tag only)
--   class roster tags         14              1  (own only)
--   pupil `learners` rows      1              0
--   pupil sessions            13              0
--   pupil seed_progress       28              0
--
-- A co-teacher added via `POST /api/teacher/class-teachers` today gets the
-- class row and can even rename the class (`classes_update` already uses
-- `is_class_teacher(id)`), and then sees a SILENTLY EMPTY dashboard. That is
-- exactly the silent-empty failure class the RLS doctrine in CLAUDE.md exists
-- to prevent.
--
-- Root cause, read out of the LIVE database (`pg_get_functiondef` /
-- `pg_policies`). Note for the record: `supabase/schema.sql` was NOT stale here
-- — it matched live byte-for-byte. The earlier "already fixed, no work needed"
-- reading of the dump was a MISREAD OF WHICH BRANCH carried the disjunct, not
-- drift. Both branches mention `class_teachers`/`is_class_teacher`; only one of
-- them gates pupils. Read the branch, not the grep hit:
--
--   `can_view_learner_data(uuid)` has TWO teacher branches.
--     * the `class_learner_id` branch (the class's own aggregate learner row)
--       ALREADY carries a `class_teachers` disjunct — this is what a reader of
--       `supabase/schema.sql` sees and mistakes for "already fixed";
--     * the PUPIL branch (matching `user_tags.tag_value = 'CLASS:'||c.id`,
--       i.e. real children in the class) checks ONLY
--       `c.teacher_user_id = auth.uid()::text OR s2.admin_user_id = ...`.
--       No membership fallback. That is the gap.
--
--   `user_tags_select` and `user_tags_update` carry the identical gap in their
--   `classes` EXISTS clause.
--
-- The fix is a MONOTONIC WIDENING: add the class-membership disjunct
-- (`is_class_teacher`) beside the existing lead-pointer test, everywhere the
-- lead pointer is already accepted. Every other branch —  own-row,
-- `is_god_user()`, `is_ssi_admin()`, govt_admins, school_admin — is reproduced
-- VERBATIM. Nobody who can read today loses access.
--
-- Why `user_tags_update` is included as well as `user_tags_select`: removing a
-- student from a class is a CLIENT-DIRECT `user_tags.update({removed_at})` at
-- `packages/player-vue/src/views/schools/ClassDetail.vue:301-312`, not a
-- server endpoint. Widening SELECT alone would leave a co-teacher able to SEE
-- the roster and silently unable to change it. The widened principal set is
-- exactly the one `classes_update` already trusts to rename and
-- `api/school/delete-class.ts` already trusts to DELETE the class, so this
-- adds no principal that could not already do something strictly larger.
--
-- Recursion safety: `is_class_teacher` is SECURITY DEFINER owned by `postgres`
-- (rolbypassrls = true, verified live), so reading `user_tags` from inside a
-- `user_tags` policy does not re-enter RLS.
--
-- Surfaces touched by the ONE `CREATE OR REPLACE` of `can_view_learner_data`:
-- `learners`, `sessions`, `seed_progress`, `lego_progress`,
-- `course_enrollments`, and the `class_student_progress` view. A half-rebase
-- here would leave co-teachers with everything EXCEPT student progress — a
-- silently empty gradebook — so all six move together.
--
-- The `(SELECT auth.uid())` initplan wrapping in the policies is preserved
-- deliberately: it is the per-statement-evaluation form installed by
-- 20260801c_rls_perf_initplan_consolidation.sql. Do not unwrap it.
--
-- This migration enables/disables RLS on NOTHING. The org-table RLS posture is
-- gated separately in CLAUDE.md and is not moved here.
--
-- Canary: supabase/secfix-toolkit/canary_co_teacher_read_parity.cjs
-- Rollback: supabase/secfix-toolkit/rollback_co_teacher_read_parity.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. can_view_learner_data — add the membership disjunct to the PUPIL branch
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
                         AND s.admin_user_id = (auth.uid())::text)
               OR EXISTS (SELECT 1 FROM public.classes c
                          LEFT JOIN public.schools s2 ON s2.id = c.school_id
                          WHERE ut.tag_value = 'CLASS:' || c.id::text
                            AND (c.teacher_user_id = (auth.uid())::text
                                 OR s2.admin_user_id = (auth.uid())::text
                                 -- co-teaching read parity (A-74, 2026-08-06)
                                 OR public.is_class_teacher(c.id)))
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

-- ---------------------------------------------------------------------------
-- 2. user_tags_select — the class roster read
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT TO authenticated
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
                -- co-teaching read parity (A-74, 2026-08-06)
                OR public.is_class_teacher(c.id)))
  );

-- ---------------------------------------------------------------------------
-- 3. user_tags_update — the client-direct remove-student write
-- ---------------------------------------------------------------------------
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
                -- co-teaching write parity (A-74, 2026-08-06)
                OR public.is_class_teacher(c.id)))
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
                -- co-teaching write parity (A-74, 2026-08-06)
                OR public.is_class_teacher(c.id)))
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
