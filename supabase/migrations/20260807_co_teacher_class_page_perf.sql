-- SUPERSEDED, NEVER APPLIED. DO NOT RUN THIS FILE.
-- Verified against the live database 2026-08-08: it was never applied, and it
-- has since gone stale in two ways that would each have caused real harm (a
-- tag-designated school admin blacked out; a co-teacher handed the lead
-- teacher's write authority). Its diagnosis is sound and is preserved here as
-- the record. The fix that actually shipped is
-- 20260808_co_teacher_class_page_perf.sql.
--
-- 20260807_co_teacher_class_page_perf.sql
--
-- CO-TEACHER CLASS PAGE TIMES OUT ON PRODUCTION.
--
-- Found by the Chepstow end-to-end run on saysomethingin.app, 2026-08-07
-- (write-up: https://watson-1.tail4968cb.ts.net/d/5777430b). A non-lead
-- co-teacher opening her class detail page got 5 x 500 per load:
--
--   500 /rest/v1/class_activity_stats?class_id=eq.ea59ef42-...
--   500 /rest/v1/class_student_progress?class_id=eq.ea59ef42-...
--       {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- The lead teacher and the school admin, same page, same class, same minute:
-- 0 x 500. Role-specific and perfectly reproducible.
--
-- NOT a permissions bug. Replayed as her real auth uid under RLS, every row
-- she needs is visible to her: class_teachers returns both teacher rows,
-- classes.student_join_code returns the code. She is allowed to see it; the
-- query just never finishes. This is the read parity shipped yesterday in
-- 20260806_co_teacher_read_parity.sql working correctly but too slowly to be
-- usable — the feature is functionally dead on its core page.
--
-- ---------------------------------------------------------------------------
-- ROOT CAUSE, read out of EXPLAIN (ANALYZE, BUFFERS) on live data
-- ---------------------------------------------------------------------------
--
-- Both views are security_invoker=on and both join `user_tags`, so the
-- `user_tags_select` policy runs per candidate row, and `learners_select`
-- runs `can_view_learner_data(id)` per candidate learner.
--
-- For a SCHOOL ADMIN the OR-chain short-circuits on the first disjunct —
-- `schools.admin_user_id = auth.uid()`, one index lookup — and the whole thing
-- is cheap. A NON-LEAD CO-TEACHER fails every cheap disjunct and falls through
-- to the membership branch, which was written as a CORRELATED EXISTS over
-- `classes` carrying a per-row `is_class_teacher(c.id)` call. There is no
-- index on `'CLASS:' || c.id::text`, so each evaluation seq-scanned all 67
-- classes and made a SECURITY DEFINER call per class row.
--
-- The planner then made it far worse. Those policy quals costed so high that
-- driving the join from `user_tags` looked astronomically expensive
-- (cost=0.28..228810.64 on a 877-row table), so it chose to drive from
-- `learners` instead and apply RLS to the whole table:
--
--   Seq Scan on learners l  (cost=0.00..615.31 rows=598)
--                           (actual time=1933.462..1998.318 rows=3 loops=1)
--     Filter: (user_id = ... OR can_view_learner_data(id) OR is_ssi_admin())
--     Rows Removed by Filter: 1087
--     Buffers: shared hit=185662
--
-- 1090 calls of can_view_learner_data to answer a question about ONE class —
-- a class which, in the test, has zero students. 185k buffers, ~2.0s per view,
-- two views per page load, several loads in flight: past the statement
-- timeout. It also grows with the size of the whole learners table rather than
-- with the size of the class, so it gets worse every week.
--
-- ---------------------------------------------------------------------------
-- THE FIX: evaluate the caller's scope ONCE, not once per row
-- ---------------------------------------------------------------------------
--
-- `my_readable_tag_values()` returns the set of `user_tags.tag_value` strings
-- the caller may read. It is uncorrelated — it depends on auth.uid() and
-- nothing else — so `tag_value IN (SELECT public.my_readable_tag_values())`
-- plans as a hashed InitPlan: ONE evaluation per query, then a hash probe per
-- row. The 67-row seq scan per row and the per-row SECURITY DEFINER call both
-- disappear, the cost estimate on `user_tags` collapses, and the planner
-- stops seq-scanning `learners`.
--
-- Measured on live data, as the real co-teacher, both views of the failing
-- page (see the canary output in the commit message):
--
--   co-teacher    ~2050 ms  ->  ~85 ms      (24x; and now O(class), not O(db))
--   school admin    ~30 ms  ->  ~30 ms      (unchanged, as intended)
--
-- SEMANTICS ARE UNCHANGED. The four branches of my_readable_tag_values() are
-- exactly the four disjuncts the previous policy carried:
--   1. my own class 'teacher' tags        <- was is_class_teacher(c.id)
--   2. schools I administer               <- was s.admin_user_id  = auth.uid()
--   3. classes I am lead teacher of       <- was c.teacher_user_id = auth.uid()
--   4. classes inside schools I administer<- was s2.admin_user_id = auth.uid()
-- The own-row and is_god_user() disjuncts are reproduced verbatim, as is the
-- `role_in_context` guard on the UPDATE WITH CHECK. Every other branch of
-- can_view_learner_data — own-row, is_god_user, is_ssi_admin, govt_admins, and
-- the whole class_learner_id branch — is reproduced VERBATIM.
--
-- One deliberate, immaterial difference: branch 1 no longer additionally
-- requires a matching row in `classes` to exist. It never did inside
-- `is_class_teacher` either, which sourced its answer from `user_tags` alone;
-- the tag is the authority on both sides. The only reachable case is "I hold a
-- teacher tag on a class row that has been deleted, and a learner still holds
-- a student tag on that same deleted class" — and requiring the classes row
-- back would reinstate the seq scan this migration exists to remove.
--
-- Verified rather than argued: the canary replays 8 read surfaces as 15 real
-- principals (co-teachers, lead teachers, school admins, govt admins,
-- students, a stranger) before and after, and asserts the visible id sets are
-- byte-identical. Nobody gains a row, nobody loses one.
--
-- `is_class_teacher(uuid)` is intentionally LEFT IN PLACE — `classes_update`
-- still uses it, correctly, on a single already-identified row where the
-- correlated form costs nothing.
--
-- The `(SELECT auth.uid())` initplan wrapping is preserved deliberately: it is
-- the per-statement-evaluation form installed by
-- 20260801c_rls_perf_initplan_consolidation.sql. Do not unwrap it.
--
-- This migration enables/disables RLS on NOTHING and grants NOTHING new.
--
-- Canary:   supabase/secfix-toolkit/canary_co_teacher_class_page_perf.cjs
-- Rollback: supabase/secfix-toolkit/rollback_co_teacher_class_page_perf.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The caller's readable tag scope, computed once per query
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
   WHERE ut.user_id = (auth.uid())::text
     AND ut.tag_type = 'class'
     AND ut.role_in_context = 'teacher'
     AND ut.removed_at IS NULL
  UNION
  -- 2. schools I administer
  SELECT 'SCHOOL:' || s.id::text
    FROM public.schools s
   WHERE s.admin_user_id = (auth.uid())::text
  UNION
  -- 3. classes I am the lead teacher of
  SELECT 'CLASS:' || c.id::text
    FROM public.classes c
   WHERE c.teacher_user_id = (auth.uid())::text
  UNION
  -- 4. classes inside schools I administer
  SELECT 'CLASS:' || c.id::text
    FROM public.classes c
    JOIN public.schools s2 ON s2.id = c.school_id
   WHERE s2.admin_user_id = (auth.uid())::text;
$function$;

REVOKE ALL ON FUNCTION public.my_readable_tag_values() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_readable_tag_values() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 2. can_view_learner_data — pupil branch off the correlated EXISTS
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
-- 3. user_tags_select — the class roster read
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
-- 4. user_tags_update — the client-direct remove-student write
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_tags_update ON public.user_tags;
CREATE POLICY user_tags_update ON public.user_tags
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())::text
    OR public.is_god_user()
    OR user_tags.tag_value IN (SELECT public.my_readable_tag_values())
  )
  WITH CHECK (
    public.is_god_user()
    OR (user_id = (SELECT auth.uid())::text
        AND role_in_context IS DISTINCT FROM 'teacher'
        AND role_in_context IS DISTINCT FROM 'admin')
    OR user_tags.tag_value IN (SELECT public.my_readable_tag_values())
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
