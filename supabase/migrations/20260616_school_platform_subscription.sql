-- ============================================================================
-- School / tutor PLATFORM subscription (Stream A / lever-3).
--
-- The "money path" for schools: a school pays £15/teacher/mo for the platform
-- (dashboard + analytics). A free trial gates dashboard access on expiry:
--   • premium-track  (trialled a premium course)  → 1 MONTH free  (premium_1mo)
--   • free-track     (trialled a free course)      → 1 YEAR  free  (free_1yr)
--   • tutor                                         → 1 MONTH always
-- Limited to ONE trialled language per school, and ONE trial per email per
-- track FOREVER (email-burn — see trial_burns).
--
-- NOT YET APPLIED. The app code that reads these columns is written to
-- FAIL OPEN: if platform_status / platform_expires_at are absent or NULL, the
-- dashboard gate treats the account as ACTIVE. The hard gate only bites once
-- these columns exist AND status is expired. So this file can sit unapplied on
-- the shared DB without locking anyone out; apply it deliberately (Tom) before
-- the first paying school.
--
-- Belonging = 1:1 (a school is one row) → columns ON schools, not a join table
-- (CLAUDE.md "tags-not-folders" distinguishes belonging[hard FK/columns] from
-- grouping[M2M tags]; this is belonging).
-- ============================================================================

-- 1. schools — the platform-subscription state for the school as a whole.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS platform_status          TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_course_code        TEXT,
  ADD COLUMN IF NOT EXISTS trial_kind               TEXT,
  ADD COLUMN IF NOT EXISTS platform_expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teacher_seats            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_customer_id     TEXT;

-- Allowed lifecycle states. Mirrors subscriptions.status vocabulary + 'trial'
-- (a pre-payment platform trial) and 'expired' (a trial that ran out unpaid).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schools_platform_status_check'
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_platform_status_check
      CHECK (platform_status IN ('trial','active','past_due','expired','cancelled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schools_trial_kind_check'
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_trial_kind_check
      CHECK (trial_kind IS NULL OR trial_kind IN ('premium_1mo','free_1yr'));
  END IF;
END $$;

COMMENT ON COLUMN schools.platform_status IS
  'Platform-subscription lifecycle: trial|active|past_due|expired|cancelled. The dashboard gate = active OR (trial AND platform_expires_at > now). App FAILS OPEN when this is NULL/absent.';
COMMENT ON COLUMN schools.trial_course_code IS
  'The ONE language the school may trial. A second different course requires checkout.';
COMMENT ON COLUMN schools.trial_kind IS
  'premium_1mo (premium course → 30d) | free_1yr (free course → 365d; schools pay for the platform even on free courses, so still time-limited).';
COMMENT ON COLUMN schools.teacher_seats IS
  'Paid teacher seats = Paddle quantity on the per-seat price (£15/teacher/mo).';

-- 2. teachers — mirror the platform columns so the TUTOR gate (always 1mo)
--    reads symmetrically with the school gate. (§5 default: mirror for symmetry.)
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS platform_status     TEXT,
  ADD COLUMN IF NOT EXISTS platform_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_platform_status_check'
  ) THEN
    ALTER TABLE teachers
      ADD CONSTRAINT teachers_platform_status_check
      CHECK (platform_status IS NULL OR platform_status IN ('trial','active','past_due','expired','cancelled'));
  END IF;
END $$;

COMMENT ON COLUMN teachers.platform_status IS
  'Tutor platform-subscription lifecycle (NULL = legacy/no trial set; app fails open). 1-month trial then £15/mo.';
COMMENT ON COLUMN teachers.platform_expires_at IS
  'Tutor dashboard gate: active OR (trial AND platform_expires_at > now). NULL fails open.';

-- 3. trial_burns — one trial per email per track, FOREVER. Keyed on email (the
--    only stable identity) so it outlives a deleted/recreated learner row and an
--    expired trial. burn-BEFORE-grant: provision.ts inserts here first; a 23505
--    on the PK means already burned → deny the trial (un-farmable by deleting
--    the account or letting the trial lapse).
CREATE TABLE IF NOT EXISTS trial_burns (
  email     TEXT NOT NULL,
  track     TEXT NOT NULL CHECK (track IN ('school','tutor')),
  burned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  school_id UUID,                       -- which school this burn provisioned (audit; NULL for tutor)
  PRIMARY KEY (email, track)
);
COMMENT ON TABLE trial_burns IS
  'One platform trial per (email, track) forever. INSERT before granting; 23505 = already burned = deny. Keyed on email so it survives learner-row deletion/recreation and trial expiry.';

-- Service-role bypasses RLS; enable RLS with no policy so nothing client-side
-- can read the burn ledger (an email enumeration surface otherwise).
ALTER TABLE trial_burns ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
