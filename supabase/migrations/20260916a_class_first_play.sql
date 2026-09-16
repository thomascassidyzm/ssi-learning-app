-- 20260916a_class_first_play
--
-- WHY
-- ---
-- Tom's cohort ruling, 2026-09-16 (job #989): the school average on Class
-- Insights divides by every class on the course in the compare-to subtree
-- WHOSE FIRST SESSION IS ON OR BEFORE THE END OF THE WEEK BEING DRAWN, the
-- viewed class included. A class that has never played is in no denominator
-- anywhere — averaging a school against classes that never started reads the
-- school as half as busy as it is. Evaluating it per week is what stops past
-- bars changing retroactively: a class that first played in week 8 is ABSENT
-- from weeks 1 to 7, not a zero in them, so a new class joining never rewrites
-- the school's history.
--
-- That rule needs exactly one fact per class — when it first played — and
-- there was nowhere to read it. `course_enrollments.enrolled_at` is when a
-- class was SET UP, which is precisely the never-started case the rule
-- excludes.
--
-- WHAT
-- ----
-- One read-only function returning (class_id, first_play) for a set of class
-- ids, over BOTH records a class's play can live in:
--   · the diary (`player_events`) under the class's own account — every class
--     lesson since the 2026-08-19 play-as-class re-anchor; and
--   · `class_sessions`, the pre-re-anchor log and the demo seeds.
-- A class that appears in neither comes back with first_play NULL, which is
-- how the caller knows it has never started.
--
-- COST
-- ----
-- The correlated `min()` is an index-only scan backward on
-- idx_player_events_learner_time, one probe per class: 3ms for the 127 classes
-- of the busiest course, against 10.7 SECONDS for the GROUP BY form over the
-- 847k-row diary, which seq-scans. Written this way deliberately — do not
-- "simplify" it into a join and a GROUP BY.
--
-- POSTURE
-- -------
-- SECURITY INVOKER, so a browser caller reads it under its own RLS and a class
-- account's diary stays own-row; the insights endpoint calls it as the service
-- role. EXECUTE is revoked from PUBLIC and granted to service_role and
-- authenticated only. search_path is pinned even though INVOKER does not
-- require it — one hygiene rule, no exceptions to remember.

CREATE OR REPLACE FUNCTION public.class_first_play(p_class_ids uuid[])
RETURNS TABLE(class_id uuid, first_play timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    c.id,
    LEAST(
      (SELECT min(pe.occurred_at) FROM player_events pe WHERE pe.learner_id = c.class_learner_id),
      (SELECT min(cs.started_at)  FROM class_sessions cs WHERE cs.class_id   = c.id)
    )
  FROM classes c
  WHERE c.id = ANY(p_class_ids);
$$;

COMMENT ON FUNCTION public.class_first_play(uuid[]) IS
  'When each class first played, over the diary (class account) and class_sessions. NULL = never started. The one source for the Class Insights cohort rule (job #989, Tom 2026-09-16): a class joins the denominator in the week it first plays and never leaves.';

REVOKE ALL ON FUNCTION public.class_first_play(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.class_first_play(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.class_first_play(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
