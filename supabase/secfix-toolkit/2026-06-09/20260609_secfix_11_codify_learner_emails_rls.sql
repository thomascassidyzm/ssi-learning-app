-- ============================================================================
-- SECURITY FIX #11 (drift fix) — codify learner_emails RLS-on in version control
-- ============================================================================
-- THE DRIFT: learner_emails (PII: 106 rows) is RLS-ENABLED on live prod, which
-- protects it (RLS on + 0 policies = deny-all; anon SELECT returns 0). BUT the
-- only migration that touches it — 20260427_learner_emails.sql:33 — explicitly
-- runs `ALTER TABLE learner_emails DISABLE ROW LEVEL SECURITY;`, and NO committed
-- migration re-enables it. The RLS-on state was applied directly to prod and is
-- NOT captured in version control. If the DB is ever rebuilt from migrations,
-- learner_emails comes back RLS-OFF and the PII is exposed to the anon key.
--
-- This migration codifies the live protection so a rebuild cannot regress it.
-- It is idempotent against current live state (RLS already on).

ALTER TABLE public.learner_emails ENABLE ROW LEVEL SECURITY;

-- Defense in depth: revoke the phantom anon grant (anon currently has a SELECT
-- grant that is masked by RLS deny-all; remove it so protection does not depend
-- solely on RLS staying on).
REVOKE ALL ON public.learner_emails FROM anon;

NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- ALSO DRIFT (Popty-owned, not in this repo — track separately, no action here):
--   canonical_pod_scenarios  — RLS on live, anon SELECT still granted, zero
--                              migration coverage anywhere.
--   dashboard_login_codes / dashboard_sessions / dashboard_users — RLS on live,
--                              anon revoked, never in any migration file.
-- These live only on prod; their RLS state should be captured in the Popty repo.
-- ----------------------------------------------------------------------------
