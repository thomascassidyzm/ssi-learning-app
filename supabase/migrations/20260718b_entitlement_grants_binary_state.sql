-- Entitlements are binary (THE-MODEL.md §1.11) — founder-ruled 2026-07-18.
-- A node (group/school/class) is either TRIAL (exactly one course, auto-expiring)
-- or PAID (all courses, no list). Additive-only: entitlement_grants.granted_courses
-- keeps being written on every grant (compat, I10) — 'trial' writes a single-course
-- array, 'paid' writes a full live/beta-catalogue expansion — so every existing
-- reader (get_cascade_courses, useCourseAccess.ts, api/groups/index.ts) keeps
-- working unchanged with zero code change. `state` is the new unambiguous source
-- of truth for the admin UI; legacy rows (pre-dating this ruling) keep state NULL
-- and are read with a length-based display fallback client-side — never rewritten
-- automatically.

BEGIN;

ALTER TABLE public.entitlement_grants
  ADD COLUMN IF NOT EXISTS state text
  CHECK (state = ANY (ARRAY['trial'::text, 'paid'::text]));

COMMENT ON COLUMN public.entitlement_grants.state IS
  'THE MODEL §1.11: binary entitlement state. trial = exactly one course (granted_courses is a single-element array, expires_at auto-derived: 30d premium / 365d free). paid = all courses (granted_courses is a compat-only full live/beta-catalogue expansion, expires_at NULL). NULL = legacy/custom multi-course grant predating this ruling — left as-is, never auto-migrated.';

NOTIFY pgrst, 'reload schema';

COMMIT;
