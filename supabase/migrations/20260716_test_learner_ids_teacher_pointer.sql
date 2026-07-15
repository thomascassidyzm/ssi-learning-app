-- Owner ruling 2026-07-15: real-learner definition for the board is now
-- explicit — ANY learner attached to a school/class is test data (every
-- school's learner data today is fake; this stays correct going forward
-- because it keys off schools.is_test — a real school arriving with
-- is_test=false makes its learners count). ALL other learners are real
-- customers, except admin/test accounts (plus-address, ssi_admin/tester,
-- is_demo/is_internal).
--
-- test_learner_ids() (20260715_test_learner_exclusion.sql) already covers
-- school/class attachment via schools.admin_user_id and user_tags
-- SCHOOL:/CLASS: rows. This adds the one attachment path it missed:
-- classes.teacher_user_id (the legacy direct-pointer column — class_teachers
-- is a view over the same user_tags rows already covered, so it's not a new
-- path, but the raw column is). No behavioural change today (the 5 rows this
-- adds were already is_demo=true) — this closes the gap for the next real
-- school's teacher who might be attached only via this column.
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
     OR (l.user_id IS NOT NULL AND l.user_id IN (
           SELECT c.teacher_user_id FROM classes c JOIN schools s ON c.school_id = s.id
           WHERE s.is_test AND c.teacher_user_id IS NOT NULL
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

COMMENT ON FUNCTION public.test_learner_ids() IS
  'Canonical test/internal learner set for analytics + board metrics. Real-learner definition (owner ruling 2026-07-15): any learner attached to a school/class via an is_test school is test data; all other learners are real EXCEPT admin/test accounts (is_demo, is_internal, thomas.cassidy+ plus-address). service_role only (used server-side; SECURITY DEFINER callers like update_daily_contributions run as owner and bypass the grant).';

NOTIFY pgrst, 'reload schema';
