-- Grant hygiene on the schools org tables (2026-07-04 RLS-window review).
--
-- Closes vandalism grants that Supabase's default-open GRANTs left behind on
-- the RLS-off org tables (verified live 2026-07-04):
--   • classes:            authenticated could DELETE any class row.
--   • govt_admins:        authenticated could DELETE or TRUNCATE the table.
--   • entitlement_grants: anon could SELECT every grant.
--
-- Deliberately KEPT — live client feature paths, verified by write-path scan:
--   • classes INSERT/UPDATE (create-class in useClassesData.ts, rename in
--     ClassDetail.vue, last_lego_id ratchet in updateClassProgress).
--   • authenticated SELECT everywhere it exists today (schools browse reads;
--     the org-table RLS pass owns tightening those — see CLAUDE.md
--     "Tighten RLS" section for the condition-based trigger).
--
-- Grant-layer only: no policies, no RLS enable, no silent-empty risk.
-- Applied via canary_grant_hygiene.cjs (supabase/secfix-toolkit/) which
-- asserts the kept paths stay alive and the closed paths deny, pre-COMMIT.

REVOKE DELETE, TRUNCATE ON public.classes FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.govt_admins FROM anon, authenticated;
REVOKE SELECT ON public.entitlement_grants FROM anon;

NOTIFY pgrst, 'reload schema';
