-- 2026-09-07 — A CLASS ALWAYS BELONGS TO A GROUP.
--
-- FOUNDER RULING (Tom, 2026-09-07): "the class has to belong to a group
-- somehow, even if the group is the root group — the org itself."
--
-- `classes.group_id` was ADDED by 20260718_the_model_expand.sql (I7: classes
-- affiliate to ANY node) and backfilled ONCE, at migration time. Nothing has
-- written it since: the school lane creates classes with `school_id` only
-- (packages/player-vue/src/composables/schools/useClassesData.ts) and the
-- tutor lane with neither. Live count on the day of this ruling: 110 of 148
-- classes carried no group_id, 100 of them created AFTER the expand migration
-- that introduced the column. So "which group contains this class?" was
-- unanswerable for two thirds of the estate, and answering it by hand in each
-- writer is exactly the appending this repo keeps regretting.
--
-- DERIVE IT, ONCE, IN THE DATABASE. A class attached to a school belongs to
-- that school's own NODE (schools.node_group_id — THE MODEL I2). The trigger
-- fills it on every insert and on any move between schools, whoever writes,
-- so no future writer has to remember.
--
-- NOT A READ CHANGE. Every reader of classes-in-a-subtree already UNIONs
-- `group_id` with the legacy `school_id` arm and dedupes by class id
-- (groupRollups.ts, groups/[id]/home.ts, groups/[id]/rate-compare.ts), so a
-- class that gains a group_id is counted exactly once, before and after.
--
-- NOT A TUTOR CHANGE. A personal-tutor class has no school and no group by
-- design (THE MODEL §1.3/I5, `school_id IS NULL`); there is no org to contain
-- it and this migration leaves those rows alone.
--
-- SECURITY DEFINER: the trigger must resolve the school's node for ANY writer,
-- including a client-side insert under RLS that cannot itself see the schools
-- row. search_path is pinned (SEC25-D-01). It reads one already-related id and
-- grants nothing.

BEGIN;

CREATE OR REPLACE FUNCTION public.classes_derive_group_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.group_id IS NULL AND NEW.school_id IS NOT NULL THEN
    SELECT s.node_group_id INTO NEW.group_id
    FROM public.schools s
    WHERE s.id = NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.classes_derive_group_id() IS
  'A class belongs to a group (founder ruling 2026-09-07). Fills classes.group_id from the school''s own node when the writer did not set it.';

DROP TRIGGER IF EXISTS tr_classes_derive_group_id ON public.classes;
CREATE TRIGGER tr_classes_derive_group_id
  BEFORE INSERT OR UPDATE OF school_id, group_id ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.classes_derive_group_id();

-- Heal what the one-off 2026-07-18 backfill could not know about: every class
-- created since, whose school owns a node.
UPDATE public.classes c
SET group_id = s.node_group_id
FROM public.schools s
WHERE c.school_id = s.id
  AND c.group_id IS NULL
  AND s.node_group_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
