-- Close the school_admin / govt_admin double-redeem race (WORKLIST 07-13):
-- RedeemCode.vue's doRedeem() double call site let 2-3 concurrent
-- /api/code/redeem requests all pass the select-then-insert "does this admin
-- already have a school?" check before any of them had written a row,
-- producing 3 `schools` rows for one admin_user_id on staging.
--
-- Every read site in this codebase already assumes admin_user_id is unique
-- per school (schoolScope.ts, provision.ts, actAsPersonas.ts all
-- `.eq('admin_user_id', x).maybeSingle()` or key a map by it) and likewise
-- for govt_admins.user_id — this migration makes that assumption a DB
-- guarantee instead of an unenforced convention, so a second concurrent
-- INSERT fails fast (23505) instead of silently succeeding as a duplicate.
-- api/code/redeem.ts catches that violation and reuses the winner's row.

CREATE UNIQUE INDEX IF NOT EXISTS schools_admin_user_id_key
  ON public.schools (admin_user_id)
  WHERE admin_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS govt_admins_user_id_key
  ON public.govt_admins (user_id);

NOTIFY pgrst, 'reload schema';
