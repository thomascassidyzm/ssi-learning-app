-- THE MODEL expand phase (docs/THE-MODEL.md §5) — founder-ruled 2026-07-18.
-- ONE recursive node: groups. Schools become nodes (label 'school'); classes and
-- people can affiliate to ANY node. EXPAND-CONTRACT: everything here is additive
-- and idempotent; deployed prod code reading schools/classes/user_tags in their
-- current shapes keeps working unchanged (invariant I10). No RLS posture change:
-- these are existing org tables (RLS-off by design until the gated org-RLS pass);
-- new columns inherit existing table grants, so no new GRANTs are required.

BEGIN;

-- 1. Label-not-type: widen the vocabulary in place (type is display-only).
COMMENT ON COLUMN public.groups.type IS
  'LABEL ONLY (THE MODEL, 2026-07-18): school, organisation, district, lea, nation, region, programme, ... Zero behavioural difference — no code may branch on it except to choose display wording/icon.';

-- 2. Every school is a node: the school''s OWN group node in the one tree.
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS node_group_id uuid REFERENCES public.groups(id);
COMMENT ON COLUMN public.schools.node_group_id IS
  'The school''s OWN node in the one group tree (THE MODEL I2). schools.group_id remains the legacy parent pointer; the node''s parent_id carries the same fact in the tree. schools row survives as the commercial attachment during expand phase.';
CREATE INDEX IF NOT EXISTS idx_schools_node_group_id ON public.schools (node_group_id);

-- Backfill: mint exactly one node per school lacking one. Trigger-maintained:
-- compute_group_path fills path; inherit_parent_group_test_flags handles flags
-- (we still copy the school's own is_demo/is_test explicitly — a school can be
-- test without its parent being test).
WITH src AS (
  SELECT s.id AS school_id, gen_random_uuid() AS node_id,
         s.school_name, s.group_id, s.is_demo, s.is_test, s.name_confirmed
  FROM public.schools s
  WHERE s.node_group_id IS NULL
),
ins AS (
  INSERT INTO public.groups (id, name, type, parent_id, is_demo, is_test, name_confirmed)
  SELECT node_id, school_name, 'school', group_id, is_demo, is_test, name_confirmed
  FROM src
  RETURNING id
)
UPDATE public.schools s
SET node_group_id = src.node_id
FROM src
WHERE s.id = src.school_id;

-- 3. Classes affiliate to ANY node (I7). school_id untouched for old code.
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.groups(id);
COMMENT ON COLUMN public.classes.group_id IS
  'Direct affiliation to ANY group node (THE MODEL I7). Dual-written with school_id during expand phase; school_id remains authoritative for deployed prod readers until contract.';
CREATE INDEX IF NOT EXISTS idx_classes_group_id ON public.classes (group_id);

UPDATE public.classes c
SET group_id = s.node_group_id
FROM public.schools s
WHERE c.school_id = s.id
  AND c.group_id IS NULL
  AND s.node_group_id IS NOT NULL;

-- 4. People affiliate to ANY node: allow tag_type 'group' (GROUP:<uuid>).
--    Loosening only — every existing row still passes.
ALTER TABLE public.user_tags DROP CONSTRAINT IF EXISTS user_tags_tag_type_check;
ALTER TABLE public.user_tags ADD CONSTRAINT user_tags_tag_type_check
  CHECK (tag_type = ANY (ARRAY['school'::text, 'class'::text, 'group'::text]));
COMMENT ON TABLE public.user_tags IS
  'Soft connections between users and org nodes. tag_type school/class (legacy, dual-written) or group (THE MODEL: GROUP:<groups.id>, any node). removed_at enables soft delete.';

NOTIFY pgrst, 'reload schema';

COMMIT;
