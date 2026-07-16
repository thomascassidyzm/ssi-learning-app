-- Demo-org containment (founder ask, 2026-07-16): a minted-link recipient
-- (govt_admin group leader) holds a REAL account and can create real
-- schools/classes under their group — deliberately, so the showcase feels
-- alive. Every school-creation code path (api/govt/create-school.ts,
-- api/admin/create-school.ts, api/code/redeem.ts's school_admin branch —
-- and any written later) must have its schools row inherit is_test/is_demo
-- from the group it's attached to, or a prospect playing freely pollutes
-- real board metrics (test_learner_ids() only excludes a learner attached
-- to an is_test SCHOOL — a school that itself forgot to inherit the flag
-- is invisible to that exclusion).
--
-- One trigger beats patching every call site: school creation has already
-- grown to 3+ independent endpoints in this codebase's own history — a
-- per-endpoint copy of "look up the group's flags" is exactly the kind of
-- duplication that drifts out of sync as a 4th, 5th path gets written.
-- OR, never AND, with the row's own value: a school explicitly flagged
-- is_test by its creator (e.g. the demo-school generator, which already
-- sets these directly) is never un-flagged by a later group_id change.
--
-- classes/learners need no equivalent trigger: test_learner_ids() already
-- checks class membership transitively via classes.school_id -> schools.is_test
-- (no is_test column exists on classes), so this one trigger closes the
-- whole chain.

CREATE OR REPLACE FUNCTION public.inherit_group_test_flags() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  group_is_test BOOLEAN;
  group_is_demo BOOLEAN;
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_test, is_demo INTO group_is_test, group_is_demo
  FROM public.groups WHERE id = NEW.group_id;

  NEW.is_test := COALESCE(NEW.is_test, FALSE) OR COALESCE(group_is_test, FALSE);
  NEW.is_demo := COALESCE(NEW.is_demo, FALSE) OR COALESCE(group_is_demo, FALSE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schools_inherit_group_test_flags ON public.schools;
CREATE TRIGGER schools_inherit_group_test_flags
  BEFORE INSERT OR UPDATE OF group_id ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.inherit_group_test_flags();

-- Backfill: any school already attached to an is_test/is_demo group whose
-- own flags weren't set (the exact gap this closes going forward).
UPDATE public.schools s
SET is_test = s.is_test OR g.is_test,
    is_demo = s.is_demo OR g.is_demo
FROM public.groups g
WHERE s.group_id = g.id
  AND (g.is_test OR g.is_demo)
  AND (s.is_test IS DISTINCT FROM (s.is_test OR g.is_test)
    OR s.is_demo IS DISTINCT FROM (s.is_demo OR g.is_demo));

NOTIFY pgrst, 'reload schema';
