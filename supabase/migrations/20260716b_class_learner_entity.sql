-- ============================================================================
-- Class as first-class learner (owner ruling 2026-07-16)
--
-- "A CLASS is a first-class learner citizen. When a class is created it gets
-- its OWN learner identity (own uuid/learner record, enrolled in the class
-- course) and PLAY-AS-CLASS plays AS THAT ENTITY — not as the staff member
-- driving it."
--
-- Root cause this closes: play-as-class (commit 8ca0f01b) attributed the live
-- cursor + telemetry to the DRIVING STAFF MEMBER's own learner row (the
-- position ratchet was skipped entirely — see the `props.classContext` guard
-- in LearningPlayer.vue). A teacher covering a class picked up practice
-- telemetry in the class's language against their own account, and the class
-- itself never accumulated a resumable position.
--
-- Design: reuse the EXISTING learners/course_enrollments machinery verbatim —
-- a class entity is a learners row like any other, just flagged
-- is_class_entity and never signed in. Its user_id (NOT NULL UNIQUE on
-- learners) holds a synthetic, non-colliding value ('class-learner:<classId>')
-- rather than a real auth uid — nobody ever authenticates AS it; all writes to
-- its rows are server-mediated (see api/school/class-progress.ts), matching
-- the standing doctrine that hierarchy/cross-user authz lives in endpoints,
-- never in clever RLS policies.
-- ============================================================================

ALTER TABLE public.learners
  ADD COLUMN IF NOT EXISTS is_class_entity boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.learners.is_class_entity IS
  'This learner row is a CLASS''s own learner identity (owner ruling 2026-07-16), not a human. Never signed in; user_id holds a synthetic class-learner:<classId> value. Excluded from real-learner counts (test_learner_ids()) — neither test data nor a countable human.';

CREATE INDEX IF NOT EXISTS learners_is_class_entity_true_idx
  ON public.learners USING btree (id) WHERE is_class_entity;

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS class_learner_id uuid REFERENCES public.learners(id);

CREATE INDEX IF NOT EXISTS idx_classes_class_learner ON public.classes (class_learner_id);

-- ----------------------------------------------------------------------------
-- Backfill: every existing class without a class_learner_id gets one, minted
-- and enrolled in its own course. Idempotent (guarded by the NULL check; safe
-- to re-run).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  cls RECORD;
  new_learner_id uuid;
BEGIN
  FOR cls IN
    SELECT id, class_name, course_code FROM public.classes WHERE class_learner_id IS NULL
  LOOP
    INSERT INTO public.learners (user_id, display_name, is_class_entity, educational_role)
    VALUES ('class-learner:' || cls.id::text, COALESCE(cls.class_name, 'Class'), true, NULL)
    RETURNING id INTO new_learner_id;

    UPDATE public.classes SET class_learner_id = new_learner_id WHERE id = cls.id;

    INSERT INTO public.course_enrollments (learner_id, course_id)
    VALUES (new_learner_id, cls.course_code)
    ON CONFLICT (learner_id, course_id) DO NOTHING;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- test_learner_ids(): a class entity is a THIRD category (neither test data
-- nor a real human) but this is the one canonical "exclude from real-learner
-- counting" set every board metric + the admin Users page already consults —
-- reusing it here (rather than inventing a parallel filter) means every
-- existing consumer picks up the exclusion for free. Net effect: class-entity
-- practice does NOT (yet) count toward daily_contributions' community minutes
-- rollup — flagged as an open, deliberately-not-decided question in
-- docs/schools/group-commercial-model.md, not a silent redefinition.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.test_learner_ids()
RETURNS TABLE(learner_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT l.id
  FROM learners l
  WHERE l.is_demo
     OR l.is_internal
     OR l.is_class_entity
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
  'Canonical test/internal/non-human learner set for analytics + board metrics. Superset of is_demo/is_internal; also excludes is_class_entity (a class''s own learner identity — see 20260716b_class_learner_entity.sql) and any school/class attachment to an is_test school. service_role only (used server-side; SECURITY DEFINER callers like update_daily_contributions run as owner and bypass the grant).';

NOTIFY pgrst, 'reload schema';
