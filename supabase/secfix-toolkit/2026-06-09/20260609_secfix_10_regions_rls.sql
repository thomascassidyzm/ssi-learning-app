-- ============================================================================
-- SECURITY FIX #10 (MED, Phase B / B1) — regions: stop anon corrupting ref data
-- ============================================================================
-- THE HOLE: regions (reference data: region name/code, feeds region_summary
-- analytics, govt-admin creation, school setup) has RLS OFF with anon
-- INSERT/UPDATE/DELETE granted — any logged-out visitor can rewrite or wipe the
-- region list.
--
-- VERIFIED 2026-06-09 (both repos): NO client writer in either repo. All writes
-- are service-role server routes / migration seeds. The only reads are
-- service-role (RLS-exempt) + one AUTHENTICATED ssi_admin read
-- (SchoolsSetup.vue:313). Popty does not touch the table. So enabling RLS (which
-- activates the dormant correct policies) + revoking anon writes breaks nothing.

-- Enable RLS — activates the two dormant policies that already encode the design:
--   "Anyone can view regions"       SELECT  USING (true)            [public]
--   "SSi admins can manage regions" ALL     USING (admin check)     [public]
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

-- Belt-and-braces: drop the anon write grants (anon keeps SELECT as harmless
-- reference data; the USING(true) SELECT policy gates rows under RLS).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.regions FROM anon;

NOTIFY pgrst, 'reload schema';

-- NOTE: the dormant "SSi admins can manage regions" policy uses the legacy
-- auth.jwt()->>'sub' predicate rather than the canonical learners.user_id =
-- auth.uid()::text. Functionally identical today (jwt sub == auth.uid() under
-- Supabase OTP); fine to ship, modernise opportunistically.
