-- THE MODEL delete-family completion (found by the deployed-dev verification
-- run, 2026-07-18 night): deleting a node-minted demo group 500s on
-- demo_orgs_group_id_fkey, and schools.node_group_id (added by
-- 20260718_the_model_expand.sql with default NO ACTION) is the same tripwire
-- one delete-path further along. Completes 20260718c's doctrine: org rows can
-- always be deleted; log/attachment rows survive with nulled pointers.
--
--   demo_orgs.group_id / school_id -> SET NULL: the mint record is sales
--   history + the expiry-cron driver, not structure. The org can go; the
--   prospect/metadata snapshot stays; the cron tolerates dead pointers (its
--   teardown target is simply already gone).
--
--   schools.node_group_id -> SET NULL: belt-and-braces. deleteGroupCascade
--   now deletes a school WITH its node (one-node semantics), so this FK
--   should never fire — but if any legacy path deletes a bare group, the
--   school survives with a nulled node pointer instead of a 500.
--
-- No BEGIN/COMMIT here — canary_the_model_delete_family.cjs wraps this file
-- in one transaction, replays the real delete paths, and COMMITs iff green.

ALTER TABLE public.demo_orgs DROP CONSTRAINT IF EXISTS demo_orgs_group_id_fkey;
ALTER TABLE public.demo_orgs
  ADD CONSTRAINT demo_orgs_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

ALTER TABLE public.demo_orgs DROP CONSTRAINT IF EXISTS demo_orgs_school_id_fkey;
ALTER TABLE public.demo_orgs
  ADD CONSTRAINT demo_orgs_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE SET NULL;

ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_node_group_id_fkey;
ALTER TABLE public.schools
  ADD CONSTRAINT schools_node_group_id_fkey
  FOREIGN KEY (node_group_id) REFERENCES public.groups(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
