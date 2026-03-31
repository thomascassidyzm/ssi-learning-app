-- Add 'tester' platform role for external security/UX testers
-- Testers get full course access (auto-entitlement) and can submit feedback
-- Run manually in Supabase SQL editor

-- ============================================
-- 1. UPDATE learners.platform_role CHECK
-- ============================================

ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_platform_role_check;
ALTER TABLE learners ADD CONSTRAINT learners_platform_role_check
  CHECK (platform_role IS NULL OR platform_role IN ('ssi_admin', 'popty_user', 'tester'));

-- ============================================
-- 2. UPDATE invite_codes.code_type CHECK
-- ============================================

ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check
  CHECK (code_type IN ('ssi_admin', 'god', 'govt_admin', 'school_admin', 'teacher', 'student', 'tester'));

-- ============================================
-- 3. UPDATE auto-entitlement trigger to include testers
-- ============================================

CREATE OR REPLACE FUNCTION auto_entitle_popty_user() RETURNS trigger AS $auto_entitle$
BEGIN
  IF NEW.platform_role IN ('popty_user', 'ssi_admin', 'tester')
     AND (OLD.platform_role IS DISTINCT FROM NEW.platform_role) THEN
    -- Check if they already have a full entitlement (avoid duplicates)
    IF NOT EXISTS (
      SELECT 1 FROM user_entitlements
      WHERE learner_id = NEW.id
        AND access_type = 'full'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      INSERT INTO user_entitlements (learner_id, access_type, expires_at)
      VALUES (NEW.id, 'full', NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$auto_entitle$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists from 20260316_popty_user_role.sql, but recreate to be safe
DROP TRIGGER IF EXISTS trg_auto_entitle_popty_user ON learners;
CREATE TRIGGER trg_auto_entitle_popty_user
  AFTER UPDATE OF platform_role ON learners
  FOR EACH ROW EXECUTE FUNCTION auto_entitle_popty_user();

-- ============================================
-- 4. CREATE tester_feedback table
-- ============================================

CREATE TABLE IF NOT EXISTS tester_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  display_name TEXT,
  feedback_type TEXT NOT NULL DEFAULT 'bug',
  -- CHECK (feedback_type IN ('bug', 'suggestion', 'security', 'ux')),
  title TEXT NOT NULL,
  description TEXT,
  route TEXT,
  device_info JSONB,
  build_version TEXT,
  screenshot_url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  -- CHECK (status IN ('new', 'acknowledged', 'in_progress', 'resolved', 'wont_fix')),
  priority TEXT DEFAULT 'medium',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tester_feedback_user ON tester_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_tester_feedback_status ON tester_feedback(status);

ALTER TABLE tester_feedback DISABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. CREATE invite codes for testers
-- ============================================

INSERT INTO invite_codes (code, code_type, created_by, is_active, metadata)
VALUES
  ('TST-JOSS', 'tester', 'system', true, '{"intended_for": "joss.sparkes@gmail.com", "note": "Security tester, existing Welsh learner"}'::jsonb),
  ('TST-NOAH', 'tester', 'system', true, '{"intended_for": "noah@altun.cc", "note": "Full stack dev, security background"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
