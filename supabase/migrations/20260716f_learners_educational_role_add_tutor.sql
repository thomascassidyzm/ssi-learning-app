-- Add 'tutor' to learners.educational_role's allowed values.
--
-- Found live-broken 2026-07-16 (tutors sign-up audit): api/onboarding/provision.ts
-- has assigned educational_role='tutor' to solo-tutor signups since the
-- /tutors -> /teach consolidation (2026-06-20), but the DB CHECK constraint
-- was never widened to allow it — every fresh tutor signup 500'd on
-- provisioning ("new row for relation \"learners\" violates check constraint
-- \"learners_educational_role_check\"") right after a successful OTP verify.
-- The raw Postgres error text was also being surfaced verbatim to the signup
-- page (fixed alongside this in api/onboarding/provision.ts).
--
-- Purely additive (widens an allowlist) — applied directly, no canary needed
-- (RLS doctrine rule 4 canary requirement is for auth/policy changes; this is
-- neither).

BEGIN;

ALTER TABLE public.learners DROP CONSTRAINT learners_educational_role_check;
ALTER TABLE public.learners ADD CONSTRAINT learners_educational_role_check
  CHECK (educational_role = ANY (ARRAY['student'::text, 'teacher'::text, 'school_admin'::text, 'govt_admin'::text, 'tutor'::text]));

COMMIT;
