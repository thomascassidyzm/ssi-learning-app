-- Board-report correction 2026-07-15: learners.active_30d and minutes.total_30d
-- previously excluded ONLY is_demo learners. Verified live against production:
-- is_demo alone missed staff/QA accounts whose is_internal flag was never
-- backfilled, owner plus-address test signups (thomas.cassidy+...), and real
-- signups tied to is_test schools/classes (see 20260715_schools_groups_is_test_flag.sql).
-- Measured impact on the last 30 days: active learners 73 -> 61 (16% of the
-- previously-reported figure was still test); minutes 26,349 -> 18,204 (31%).
--
-- 1. Close a real gap: ssi_admin/tester platform_role accounts are staff/QA by
--    definition (learners_is_internal comment) but were never flagged.
UPDATE learners
SET is_internal = true
WHERE is_internal = false
  AND platform_role IN ('ssi_admin', 'tester');

-- 2. Single source of truth for "is this a test/internal learner?", reused by
--    board metrics (api/_utils/boardMetrics.ts, via .rpc()) AND the
--    daily_contributions trigger below — one definition, not two copies that
--    can drift. Superset of is_demo: demo OR internal OR owner plus-address OR
--    tied (as admin, or via SCHOOL:/CLASS: user_tags) to an is_test school.
CREATE OR REPLACE FUNCTION public.test_learner_ids()
RETURNS TABLE(learner_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT l.id
  FROM learners l
  WHERE l.is_demo
     OR l.is_internal
     OR EXISTS (SELECT 1 FROM unnest(l.verified_emails) e WHERE e ILIKE 'thomas.cassidy+%')
     OR (l.user_id IS NOT NULL AND l.user_id IN (
           SELECT admin_user_id FROM schools WHERE is_test AND admin_user_id IS NOT NULL
         ))
     OR EXISTS (
          SELECT 1 FROM user_tags ut
          WHERE ut.user_id = l.user_id AND ut.removed_at IS NULL AND ut.tag_type = 'school'
            AND ut.tag_value IN (SELECT 'SCHOOL:' || id::text FROM schools WHERE is_test)
        )
     OR EXISTS (
          SELECT 1 FROM user_tags ut
          WHERE ut.user_id = l.user_id AND ut.removed_at IS NULL AND ut.tag_type = 'class'
            AND ut.tag_value IN (
              SELECT 'CLASS:' || c.id::text FROM classes c JOIN schools s ON c.school_id = s.id WHERE s.is_test
            )
        );
$$;

REVOKE ALL ON FUNCTION public.test_learner_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_learner_ids() TO service_role;

COMMENT ON FUNCTION public.test_learner_ids() IS
  'Canonical test/internal learner set for analytics + board metrics. Superset of is_demo — see is_test on schools/groups. service_role only (used server-side; SECURITY DEFINER callers like update_daily_contributions run as owner and bypass the grant).';

-- 3. Widen the daily_contributions write-time exclusion from is_demo-only to
--    the full test_learner_ids() set (same function, applied going forward).
CREATE OR REPLACE FUNCTION public.update_daily_contributions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Recompute the whole row for (language, date) from sessions, EXCLUDING
  -- test/internal learners. SUM seconds first, divide by 60 after.
  INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
  SELECT
    v_target_lang,
    v_date,
    COALESCE(SUM(s.items_practiced), 0),
    COALESCE(SUM(s.duration_seconds), 0) / 60,
    COUNT(DISTINCT s.learner_id)
  FROM sessions s
  WHERE SPLIT_PART(s.course_id, '_for_', 1) = v_target_lang
    AND s.started_at::date = v_date
    AND NOT EXISTS (SELECT 1 FROM public.test_learner_ids() t WHERE t.learner_id = s.learner_id)
  ON CONFLICT (target_language, contribution_date)
  DO UPDATE SET
    phrases_count = EXCLUDED.phrases_count,
    minutes_practiced = EXCLUDED.minutes_practiced,
    unique_speakers = EXCLUDED.unique_speakers,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

-- 4. Backfill: recompute the last 40 days (30-day board window + buffer) of
--    daily_contributions rows with the widened exclusion. Reset-then-apply so
--    (language, date) combos whose entire contribution was test-only go to
--    zero rather than keeping their stale pre-correction value.
UPDATE daily_contributions
SET phrases_count = 0, minutes_practiced = 0, unique_speakers = 0, updated_at = NOW()
WHERE contribution_date >= (CURRENT_DATE - 40);

INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
SELECT
  SPLIT_PART(s.course_id, '_for_', 1),
  s.started_at::date,
  COALESCE(SUM(s.items_practiced), 0),
  COALESCE(SUM(s.duration_seconds), 0) / 60,
  COUNT(DISTINCT s.learner_id)
FROM sessions s
WHERE s.started_at >= (CURRENT_DATE - 40)
  AND NOT EXISTS (SELECT 1 FROM public.test_learner_ids() t WHERE t.learner_id = s.learner_id)
GROUP BY 1, 2
ON CONFLICT (target_language, contribution_date)
DO UPDATE SET
  phrases_count = EXCLUDED.phrases_count,
  minutes_practiced = EXCLUDED.minutes_practiced,
  unique_speakers = EXCLUDED.unique_speakers,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
