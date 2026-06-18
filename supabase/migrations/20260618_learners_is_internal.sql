-- ============================================================================
-- learners.is_internal: flag internal / QA / team accounts
--
-- Raw telemetry volume is dominated by internal traffic (soak-testers, team),
-- so adoption numbers are overstated. This is a SEPARATE axis from is_demo
-- (is_demo = synthetic seeded learners; is_internal = real human team/QA
-- accounts). Analytics excludes both.
--
-- Seed only the CONFIRMED internal/QA accounts by email (joined via
-- auth.users). Everyone else is treated as a real user and left false.
--   michael204351@gmail.com  -- soak-tester (24 courses)
--   ssi@digitalcsi.co.uk     -- internal
--   aran@hey.com             -- team
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + an UPDATE keyed on email.
-- ============================================================================

ALTER TABLE public.learners
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.learners.is_internal IS
  'Real human internal/QA/team account (not synthetic — see is_demo). Excluded from analytics aggregates so adoption metrics reflect external users only.';

-- Partial index mirrors learners_is_demo_true_idx; the analytics RPCs resolve
-- the excluded-id set from (is_demo OR is_internal).
CREATE INDEX IF NOT EXISTS learners_is_internal_true_idx
  ON public.learners USING btree (id) WHERE is_internal;

UPDATE public.learners
   SET is_internal = true
 WHERE user_id IN (
   SELECT id::text
     FROM auth.users
    WHERE lower(email) = ANY (ARRAY[
      'michael204351@gmail.com',
      'ssi@digitalcsi.co.uk',
      'aran@hey.com'
    ])
 );

NOTIFY pgrst, 'reload schema';
