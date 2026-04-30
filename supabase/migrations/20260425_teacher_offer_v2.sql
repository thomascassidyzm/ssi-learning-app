-- Teacher offer v2 schema tweaks
--
-- Two changes that go with the v2 product decisions:
--
--   1. Flat student price (£10/mo) and flat teacher commission (£5/mo per
--      attributed paying student). Variable price slider is gone; the
--      `locked_price_pence` range CHECK on teacher_referrals is dropped.
--      The column itself stays for historical record and will simply always
--      be 1000 going forward. `teachers.student_price_pence` likewise
--      remains in place but is no longer driven by the teacher.
--
--   2. Dormant `verified` flag on `teachers`. We will flip this to TRUE
--      manually once the SSi facilitator certification track is live so the
--      learner-facing surface can show a "Trained SSi Facilitator" badge.
--      Defaults to FALSE; no behaviour attached to it in v2.

-- Verified-facilitator dormant lever (flipped manually when we want to surface a badge)
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop the variable-price CHECK constraint on teacher_referrals.locked_price_pence
-- (kept the column for historical record but no longer enforced as a range; will always
-- be 1000 going forward since student price is now flat £10)
ALTER TABLE teacher_referrals DROP CONSTRAINT IF EXISTS teacher_referrals_locked_price_pence_check;

COMMENT ON COLUMN teachers.verified IS 'Dormant in v1. Flip to TRUE to display a "Trained SSi Facilitator" badge once the certification track is live.';
