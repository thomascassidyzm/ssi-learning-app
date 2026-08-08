-- 20260808_co_teacher_class_page_perf.sql
--
-- THE CLASS DETAIL PAGE TAKES ~4.5 SECONDS FOR EVERY TEACHER.
--
-- Measured against the live database on 2026-08-08, replaying the exact reads
-- ClassDetail.vue issues for class ea59ef42 ("ZZ Test - Year 7 Welsh"), as the
-- real principals under RLS (SET LOCAL role authenticated + real jwt sub),
-- best of three runs each, network round-trip included:
--
--                          co-teacher (non-lead)   lead teacher / school admin
--   class_activity_stats           4312 ms                    4178 ms
--   class_student_progress         4144 ms                    4040 ms
--   user_tags roster                 87 ms                      86 ms
--   class_teachers                   97 ms                      96 ms
--   classes row                      46 ms                      45 ms
--
-- 20260807_co_teacher_class_page_perf.sql was written for this and never
-- applied: verified live 2026-08-08, `my_readable_tag_values` DOES NOT EXIST
-- and can_view_learner_data / user_tags_select / user_tags_update all still
-- carry the pre-fix correlated form. This migration supersedes it. That file
-- is left on disk as the record of the diagnosis; do not apply it (see the two
-- ways it has since gone stale, below).
--
-- ---------------------------------------------------------------------------
-- ROOT CAUSE, read out of EXPLAIN (ANALYZE, BUFFERS) on live data
-- ---------------------------------------------------------------------------
--
-- Both views are security_invoker=on and both join `user_tags` and `learners`,
-- so `user_tags_select` runs per candidate tag row and `learners_select` runs
-- `can_view_learner_data(id)` per candidate learner. Both policies phrase the
-- caller's scope as CORRELATED EXISTS subqueries over `schools` and `classes`
-- carrying per-row SECURITY DEFINER calls (`is_school_admin_of`,
-- `is_class_teacher`). There is no index on `'CLASS:' || c.id::text`, so each
-- evaluation seq-scans all 67 classes and all 24 schools.
--
-- Costed that way, driving the join from `user_tags` looks astronomical, so the
-- planner drives from `learners` and applies RLS to the whole table:
--
--   ->  Index Scan using idx_user_tags_class on user_tags ut
--         (cost=0.28..311128.96 rows=469) (actual time=130.783 rows=0 loops=1)
--   ->  Materialize (actual time=4314.953..4400.876 rows=3 loops=1)
--         ->  Seq Scan on learners l  (cost=0.00..624.11 rows=607)
--                                     (actual time=4314.950..4400.869 rows=3)
--               Filter: (user_id = ... OR can_view_learner_data(id)
--                        OR is_ssi_admin())
--               Rows Removed by Filter: 1090
--               Buffers: shared hit=499851
--   Execution Time: 4540.710 ms
--
-- 1093 evaluations of can_view_learner_data and 499,851 buffer hits to answer a
-- question about ONE class — a class which, in this test, has zero students.
-- The cost grows with the size of the whole `learners` table, not with the size
-- of the class, so it gets worse every week. It is NOT a permissions bug: every
-- row each principal needs is visible to them; the query is just too slow to be
-- usable, and on production it has been crossing the statement timeout.
--
-- This is no longer specific to co-teachers. When the correlated form was first
-- diagnosed (2026-08-07) the school admin short-circuited on the cheap
-- `schools.admin_user_id` disjunct and stayed at ~30 ms. 20260807c/d moved
-- `is_school_admin_of` onto a two-branch form that also consults a school admin
-- TAG, so the cheap short-circuit is gone and every teacher-shaped principal
-- now pays the full price. That is what the numbers above show.
--
-- ---------------------------------------------------------------------------
-- THE FIX: evaluate the caller's scope ONCE, not once per row
-- ---------------------------------------------------------------------------
--
-- `my_readable_tag_values()` returns the set of `user_tags.tag_value` strings
-- the caller may read. It is uncorrelated — it depends on auth.uid() and
-- nothing else — so `tag_value IN (SELECT public.my_readable_tag_values())`
-- plans as a hashed InitPlan: ONE evaluation per query, then a hash probe per
-- row. The per-row seq scans and the per-row SECURITY DEFINER calls both
-- disappear, the cost estimate on `user_tags` collapses, and the planner stops
-- seq-scanning `learners`.
--
-- `my_manageable_tag_values()` is the same idea for the write side: the strict
-- subset of that scope over which the caller has FULL authority, teacher rows
-- included. It is exactly branches 2-4 of the readable set (schools I
-- administer, classes in them, classes I lead) and deliberately excludes
-- branch 1 (classes I merely co-teach). See the semantics section.
--
-- ---------------------------------------------------------------------------
-- SEMANTICS ARE UNCHANGED — and two corrections to the 2026-08-07 draft
-- ---------------------------------------------------------------------------
--
-- The branches of my_readable_tag_values() are exactly the disjuncts the
-- current LIVE policies carry, expanded to include what the helper functions
-- resolve to today:
--   1. classes I hold a 'teacher' tag on   <- is_class_teacher(c.id)
--   2. schools I administer, BOTH ways     <- is_school_admin_of(s.id)
--        a. schools.admin_user_id = me                (the founding admin)
--        b. my 'school'/'admin' user_tag              (every later admin)
--   3. classes I am lead teacher of        <- c.teacher_user_id = me
--   4. classes inside schools I administer <- is_school_admin_of(c.school_id)
-- Every branch keeps the existence requirement the correlated EXISTS had: each
-- tag_value is generated by joining to the `schools` or `classes` row it names,
-- so a tag pointing at a deleted row grants nothing, exactly as before.
--
-- The 2026-08-07 draft got two of these wrong, which is why it is superseded
-- rather than simply applied:
--
--   * IT WOULD HAVE STRIPPED TAG-DESIGNATED SCHOOL ADMINS. Its branches 2 and 4
--     tested `s.admin_user_id = auth.uid()` only. That was faithful when it was
--     written; 20260807c/d then added the school-admin-tag branch to
--     is_school_admin_of. Measured live 2026-08-08: 28 active school admin
--     tags, of which 6 belong to people who are NOT the schools.admin_user_id
--     pointer. Those 6 would have silently lost their whole school.
--
--   * IT WOULD HAVE HANDED CO-TEACHERS THE LEAD TEACHER'S WRITE AUTHORITY.
--     20260806b_co_teacher_manage_ruling.sql narrowed the co-teacher disjunct
--     of user_tags_update to student rows only, implementing the founder's
--     ruling that only the lead teacher or a leader above may change who
--     teaches a class. The draft folded that disjunct into the same undivided
--     my_readable_tag_values() set the admin branches use, dropping the
--     `role_in_context` guard on it — so a co-teacher could have reinstated a
--     removed co-teacher, or soft-deleted the lead teacher's own tag, straight
--     from the browser. Splitting readable from manageable is what keeps that
--     ruling intact while still collapsing to a hashed InitPlan.
--
-- can_view_learner_data changes in ONE branch — the user_tags membership
-- branch. Own-row, is_god_user, is_ssi_admin, govt_admins and the whole
-- class_learner_id branch are reproduced VERBATIM, is_school_admin_of included
-- (that branch is correlated on an already-narrow row set, where it costs
-- nothing).
--
-- Verified rather than argued: the canary replays 8 read surfaces as 17 real
-- principals before and after and asserts the visible id sets are
-- byte-identical, then replays the write side as a co-teacher and asserts the
-- teacher-row write is still refused. Nobody gains a row, nobody loses one.
--
-- `is_class_teacher(uuid)` is intentionally LEFT IN PLACE — `classes_update`
-- still uses it, correctly, on a single already-identified row.
--
-- The `(SELECT auth.uid())` initplan wrapping is preserved deliberately: it is
-- the per-statement-evaluation form installed by
-- 20260801c_rls_perf_initplan_consolidation.sql. Do not unwrap it.
--
-- This migration enables/disables RLS on NOTHING and grants NOTHING new.
--
-- Canary:   supabase/secfix-toolkit/canary_co_teacher_class_page_perf_2026-08-08.cjs
-- Rollback: supabase/secfix-toolkit/rollback_co_teacher_class_page_perf_2026-08-08.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The strict subset the caller may WRITE teacher/admin rows on
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_manageable_tag_values()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH my_schools AS (
    -- the founding admin: the school's own pointer column
    SELECT s.id
      FROM public.schools s
     WHERE s.admin_user_id = (auth.uid())::text
    UNION
    -- every subsequent admin: the service-role-written school admin tag
    SELECT s.id
      FROM public.schools s
      JOIN public.user_tags ut ON ut.tag_value = 'SCHOOL:' || s.id::text
     WHERE ut.user_id = (auth.uid())::text
       AND ut.tag_type = 'school'
       AND ut.role_in_context = 'admin'
       AND ut.removed_at IS NULL
  )
  -- 2. schools I administer
  SELECT 'SCHOOL:' || id::text FROM my_schools
  UNION
  -- 3. classes I am the lead teacher of
  SELECT 'CLASS:' || c.id::text
    FROM public.classes c
   WHERE c.teacher_user_id = (auth.uid())::text
  UNION
  -- 4. classes inside schools I administer
  SELECT 'CLASS:' || c.id::text
    FROM public.classes c
   WHERE c.school_id IN (SELECT id FROM my_schools);
$function$;

-- ---------------------------------------------------------------------------
-- 2. The caller's readable tag scope, computed once per query
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_readable_tag_values()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 1. classes I hold a 'teacher' tag on (co-teaching read parity, A-74)
  SELECT ut.tag_value
    FROM public.user_tags ut
    JOIN public.classes c ON ut.tag_value = 'CLASS:' || c.id::text
   WHERE ut.user_id = (auth.uid())::text
     AND ut.tag_type = 'class'
     AND ut.role_in_context = 'teacher'
     AND ut.removed_at IS NULL
  UNION
  -- 2-4: everything I administer or lead, where teacher rows are mine to write
  SELECT * FROM public.my_manageable_tag_values();
$function$;

REVOKE ALL ON FUNCTION public.my_readable_tag_values() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_manageable_tag_values() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_readable_tag_values()   TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_manageable_tag_values() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 3. can_view_learner_data — membership branch off the correlated EXISTS
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
             AND ut.tag_value IN (SELECT public.my_readable_tag_values())
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
-- 4. user_tags_select — the class roster read
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_tags_select ON public.user_tags;
CREATE POLICY user_tags_select ON public.user_tags
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR user_tags.tag_value IN (SELECT public.my_readable_tag_values())
  );

-- ---------------------------------------------------------------------------
-- 5. user_tags_update — the client-direct remove-student write
--    Full authority over my manageable scope; student rows only where I am
--    merely a co-teacher (20260806b_co_teacher_manage_ruling).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR user_tags.tag_value IN (SELECT public.my_manageable_tag_values())
    OR (user_tags.tag_value IN (SELECT public.my_readable_tag_values())
        AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
        AND user_tags.role_in_context IS DISTINCT FROM 'admin')
  )
  WITH CHECK (
    public.is_god_user()
    OR (user_id = (SELECT auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
    OR user_tags.tag_value IN (SELECT public.my_manageable_tag_values())
    OR (user_tags.tag_value IN (SELECT public.my_readable_tag_values())
        AND user_tags.role_in_context IS DISTINCT FROM 'teacher'
        AND user_tags.role_in_context IS DISTINCT FROM 'admin')
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
