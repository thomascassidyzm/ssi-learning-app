-- ============================================================================
-- SECURITY FIX #6 (HIGH) — lock down dashboard_invite_codes (Popty escalation)
-- ============================================================================
-- THE HOLE: dashboard_invite_codes has RLS OFF, ZERO policies, and the anon
-- role holds SELECT + INSERT + UPDATE + DELETE. This is the Popty (dashboard)
-- equivalent of the already-closed `invite_codes` leak:
--   - anon SELECT  -> harvest valid codes, then self-provision a dashboard_users
--                     row at the code's role (up to admin) via /api/auth/.../redeem
--   - anon INSERT  -> forge an admin-role code outright = direct privilege
--                     escalation into the Popty production dashboard.
--
-- VERIFIED 2026-06-09 (both repos): EVERY read and write of this table goes
-- through the Popty SERVICE-role client (services/production-api.cjs:584/610/
-- 642/652/706 via services/supabase-client.cjs built from SUPABASE_SERVICE_KEY).
-- The dashboard frontend's anon-key client NEVER queries it; LoginForm.vue calls
-- the server route over HTTP, not the table. The learner app has zero references.
-- service-role bypasses RLS and grants, so this lock-down breaks nothing.

-- 1. Strip all client grants (anon was the escalation vector; authenticated is unused).
REVOKE ALL ON public.dashboard_invite_codes FROM anon;
REVOKE ALL ON public.dashboard_invite_codes FROM authenticated;

-- 2. Enable RLS with NO policies = deny-all for anon/authenticated.
--    service-role (bypassrls) and the table owner continue to bypass RLS, so
--    Popty keeps full access. NOT using FORCE — that would also block the owner
--    (postgres) connection used by direct-pooler tooling, an unnecessary footgun
--    here, and the repo convention is plain ENABLE.
ALTER TABLE public.dashboard_invite_codes ENABLE ROW LEVEL SECURITY;

-- 3. Reload PostgREST.
NOTIFY pgrst, 'reload schema';
