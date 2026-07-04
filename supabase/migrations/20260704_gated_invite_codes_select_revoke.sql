-- GATED: revoke authenticated SELECT on invite_codes.
--
-- Invite-code strings are bearer credentials (school_admin/teacher join codes
-- redeem into privilege grants), so any signed-in user being able to SELECT
-- the table is an enumeration → escalation path. The June-02 pass revoked
-- anon; this closes authenticated.
--
-- ⚠️ DO NOT APPLY until api/admin/codes.ts is live on MAIN.
--   • AdminAccess.vue read invite_codes directly as authenticated; the
--     2026-07-04 change repoints it to GET/POST /api/admin/codes
--     (service-role, verifyAuthToken-gated, own-created scoping preserved).
--   • dev/staging/prod share ONE database — applying this while un-patched
--     code runs on any of them breaks the admin/govt-admin invite list.
--   • Once the repoint is on main, apply via a canary run: assert
--     authenticated SELECT denies, service-role SELECT works, and
--     /api/code/validate + /api/code/redeem still function (both already
--     service-role since hotfix f8207bf6 / the redeem path).

REVOKE SELECT ON public.invite_codes FROM authenticated;

NOTIFY pgrst, 'reload schema';
