-- Teacher Offer (private tutor / affiliate scheme)
--
-- REUSES the schools `classes` table rather than inventing new class / progress
-- infrastructure. Each teacher owns one or more `classes` rows (with school_id
-- NULL for solo teachers). Each class has its own student_join_code (already
-- in classes schema) used as the student-facing referral code. Class-level
-- progress lives in classes.helix_state + classes.current_seed (already built
-- for the schools "Class Play" feature).
--
-- The teachers table holds teacher-specific profile + commercial fields that
-- don't belong on classes (display profile, student price default, Wise payout
-- config, referral_active flag).
--
-- The teacher_referrals table records student → class attribution with the
-- teacher's price locked at the time of attribution, so subsequent price
-- changes don't apply retroactively.
--
-- Architecture: affiliate / referral, NOT marketplace. SSi is merchant of
-- record for the student via Paddle; teacher receives commission monthly via
-- Wise (external transfer, not visible to Paddle).
--
-- RLS: deliberately permissive (no RLS on new tables) for now — matches the
-- schools-table posture per CLAUDE.md. Tighten when first paying teacher is
-- 2–3 weeks out.

-- ============================================
-- EXTEND CLASSES to support solo teachers
-- ============================================
-- Solo teachers (private tutors running their own classes) don't belong to a
-- school. Allow classes.school_id to be NULL. The schools-path still enforces
-- school_id via application logic.
ALTER TABLE classes ALTER COLUMN school_id DROP NOT NULL;

-- ============================================
-- TEACHERS
-- ============================================
-- One row per learner who signs up to the teacher offer. Student-facing
-- referral codes live on `classes.student_join_code` (schools table), not here.

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL UNIQUE REFERENCES learners(id) ON DELETE CASCADE,

  -- Teacher lifecycle
  referral_active BOOLEAN NOT NULL DEFAULT TRUE,  -- false when teacher cancels

  -- Profile (what students see)
  display_name TEXT NOT NULL,
  photo_url TEXT,
  bio TEXT,
  country TEXT,                                       -- ISO-2
  teaching_languages TEXT[] NOT NULL DEFAULT '{}',    -- course codes

  -- Commercial default for new class-referral sign-ups
  student_price_pence INTEGER NOT NULL DEFAULT 1500
    CHECK (student_price_pence BETWEEN 500 AND 1500), -- £5.00–£15.00

  -- Wired in later phases
  own_subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  payout_recipient_id TEXT,                           -- Wise recipient ID

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- TEACHER REFERRALS (attribution + locked price)
-- ============================================
-- Student → class attribution for the teacher offer. Class's owning teacher is
-- derived via classes.teacher_user_id → matched against teachers.learner_id →
-- auth.users.id, so we don't need a redundant teacher_id column here.

CREATE TABLE IF NOT EXISTS teacher_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,

  -- Attribution metadata
  source TEXT NOT NULL DEFAULT 'signup_link'
    CHECK (source IN ('signup_link', 'manual_link', 'admin')),

  -- Price locked at attribution time so teacher price changes don't apply
  -- retroactively to existing students (per 2026-04-23 decision with Aran).
  locked_price_pence INTEGER NOT NULL
    CHECK (locked_price_pence BETWEEN 500 AND 1500),

  -- Lifecycle (kept in sync with student's subscription state via webhook)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'cancelled', 'lapsed')),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,

  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_referrals_class
  ON teacher_referrals(class_id);

-- One live attribution per student (pending or active). Cancelled/lapsed
-- rows are kept for history; a student may re-link to a different class.
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_referrals_student_active
  ON teacher_referrals(student_learner_id)
  WHERE status IN ('pending', 'active');

-- ============================================
-- TRIGGERS
-- ============================================

DROP TRIGGER IF EXISTS update_teachers_updated_at ON teachers;
CREATE TRIGGER update_teachers_updated_at
  BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teacher_referrals_updated_at ON teacher_referrals;
CREATE TRIGGER update_teacher_referrals_updated_at
  BEFORE UPDATE ON teacher_referrals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE teachers IS
  'Private-tutor / affiliate teachers. One row per learner who signs up to the teacher offer. Referral codes live on classes.student_join_code, not here.';

COMMENT ON TABLE teacher_referrals IS
  'Student-to-class attribution for the teacher offer. locked_price_pence captures the teacher''s price at attribution so future price changes affect new sign-ups only. Teacher is derived via classes.teacher_user_id.';

COMMENT ON COLUMN teachers.referral_active IS
  'False when the teacher cancels their own subscription. Existing referrals continue to earn; new sign-ups via class links are blocked.';

COMMENT ON COLUMN teacher_referrals.status IS
  'pending = student visited /with/{class_code} but not yet subscribed. active = student has a paying subscription. cancelled/lapsed = ended; row retained for history.';
