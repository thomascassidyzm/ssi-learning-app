-- invite_codes delete-family FK hardening (invites-unification fallout, 2026-07-18).
--
-- Founder hit it live: deleting a school with a class 500s on
--   "update or delete on table classes violates foreign key constraint
--    fk_invite_codes_class on table invite_codes".
-- Root cause: post-unification, class/school/group join codes live in
-- invite_codes with FKs to their org row, but those FKs were ON DELETE NO
-- ACTION. deleteSchoolCascade cleaned up grants_school_id codes but never the
-- class-level grants_class_id codes, so the schools->classes cascade tripped
-- fk_invite_codes_class. The same latent hole existed on the school and group
-- code FKs (only masked by app-level manual cleanup).
--
-- A code is meaningless once its target org row is gone, so the org->code FKs
-- cascade. But 14 learners (live) reference an org code via
-- learners.invite_code_id (a redemption record) — cascading a code would then
-- just move the failure to learners_invite_code_id_fkey. So the redeemer->code
-- FKs SET NULL: the redeemer survives, its dead pointer is nulled. Together the
-- whole delete family (school / class / group / subtree) is FK-sound end to end,
-- no path can trip an invite_codes constraint.
--
-- No BEGIN/COMMIT here on purpose — canary_invite_codes_ondelete_fk.cjs wraps
-- this file in one transaction, replays the real delete paths as a fixture, and
-- COMMITs only if every assertion is green (RLS doctrine rule 4).

-- org row deleted -> its codes are dead, cascade them away
ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS fk_invite_codes_class;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT fk_invite_codes_class
  FOREIGN KEY (grants_class_id) REFERENCES public.classes(id) ON DELETE CASCADE;

ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS fk_invite_codes_school;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT fk_invite_codes_school
  FOREIGN KEY (grants_school_id) REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_grants_group_id_fkey;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT invite_codes_grants_group_id_fkey
  FOREIGN KEY (grants_group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

-- code deleted -> a redeemer survives, its dead pointer is nulled
ALTER TABLE public.learners DROP CONSTRAINT IF EXISTS learners_invite_code_id_fkey;
ALTER TABLE public.learners
  ADD CONSTRAINT learners_invite_code_id_fkey
  FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id) ON DELETE SET NULL;

ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_invite_code_id_fkey;
ALTER TABLE public.schools
  ADD CONSTRAINT schools_invite_code_id_fkey
  FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id) ON DELETE SET NULL;

ALTER TABLE public.govt_admins DROP CONSTRAINT IF EXISTS govt_admins_invite_code_id_fkey;
ALTER TABLE public.govt_admins
  ADD CONSTRAINT govt_admins_invite_code_id_fkey
  FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
