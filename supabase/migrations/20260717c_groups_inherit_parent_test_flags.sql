-- Organisations + full group hierarchy (founder ruling, 2026-07-17): groups
-- form an arbitrary-depth tree (parent_id + path, trg_compute_group_path) and
-- an ORGANISATION is simply the root of that tree — "demo" is a flag on it
-- (groups.is_demo, already live since 20260715_schools_groups_is_test_flag),
-- not a separate object type. No new table for the org concept itself.
--
-- Gap this closes: 20260715g's schools_inherit_group_test_flags trigger only
-- copies is_test/is_demo from a school's DIRECT group onto the school row —
-- it never propagates through the group tree itself. So a demo org's flag
-- reached schools attached directly to the root, but a school under a
-- great-grandchild group (Nick's tree: org -> region -> district -> school)
-- read is_test/is_demo = false from its own (unflagged) immediate group,
-- and the schools trigger dutifully copied that false through — invisible
-- demo data at any depth below the first level. Same shape, one level up:
-- a child group must inherit from its own parent group at insert/reparent
-- time, mirroring the schools trigger exactly, so the OR-cascade reaches
-- every depth by the time a leaf school ever attaches.
--
-- Same accepted limitation as the schools trigger it mirrors: this fires at
-- INSERT / UPDATE OF parent_id only, not retroactively when an ancestor's
-- own is_test/is_demo flips later — building the tree top-down (org first,
-- then its children) is the actual creation order, so the forward cascade
-- covers the real flow. The one-off backfill below handles pre-existing data.

CREATE OR REPLACE FUNCTION public.inherit_parent_group_test_flags() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  parent_is_test BOOLEAN;
  parent_is_demo BOOLEAN;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_test, is_demo INTO parent_is_test, parent_is_demo
  FROM public.groups WHERE id = NEW.parent_id;

  NEW.is_test := COALESCE(NEW.is_test, FALSE) OR COALESCE(parent_is_test, FALSE);
  NEW.is_demo := COALESCE(NEW.is_demo, FALSE) OR COALESCE(parent_is_demo, FALSE);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groups_inherit_parent_test_flags ON public.groups;
CREATE TRIGGER groups_inherit_parent_test_flags
  BEFORE INSERT OR UPDATE OF parent_id ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.inherit_parent_group_test_flags();

-- Backfill, path-ordered (shortest path first = parents before children) so
-- each row's cascade sees its own parent already corrected, however deep.
DO $$
DECLARE
  r RECORD;
  parent_is_test BOOLEAN;
  parent_is_demo BOOLEAN;
BEGIN
  FOR r IN SELECT id, parent_id, is_test, is_demo FROM public.groups ORDER BY length(path)
  LOOP
    IF r.parent_id IS NULL THEN
      CONTINUE;
    END IF;
    SELECT is_test, is_demo INTO parent_is_test, parent_is_demo
    FROM public.groups WHERE id = r.parent_id;
    IF COALESCE(parent_is_test, FALSE) AND NOT COALESCE(r.is_test, FALSE) THEN
      UPDATE public.groups SET is_test = TRUE WHERE id = r.id;
    END IF;
    IF COALESCE(parent_is_demo, FALSE) AND NOT COALESCE(r.is_demo, FALSE) THEN
      UPDATE public.groups SET is_demo = TRUE WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

-- Re-run the schools cascade now that some previously-unflagged groups may
-- have picked up is_test/is_demo above — same predicate as 20260715g's own
-- backfill, safe to re-run (idempotent, only touches rows that changed).
UPDATE public.schools s
SET is_test = s.is_test OR g.is_test,
    is_demo = s.is_demo OR g.is_demo
FROM public.groups g
WHERE s.group_id = g.id
  AND (g.is_test OR g.is_demo)
  AND (s.is_test IS DISTINCT FROM (s.is_test OR g.is_test)
    OR s.is_demo IS DISTINCT FROM (s.is_demo OR g.is_demo));

NOTIFY pgrst, 'reload schema';
