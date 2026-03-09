-- Entitlement Codes: grant premium access via shareable codes
-- Parallel system to invite_codes (which handle roles).
-- Entitlement codes handle access rights.

-- What the admin creates
CREATE TABLE entitlement_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  access_type TEXT NOT NULL CHECK (access_type IN ('full', 'courses')),
  granted_courses TEXT[],              -- NULL for 'full', array for 'courses'
  duration_type TEXT NOT NULL CHECK (duration_type IN ('lifetime', 'time_limited')),
  duration_days INTEGER,               -- Required if time_limited
  label TEXT NOT NULL,                 -- "Welsh Govt 2026", "Press Pass"
  max_uses INTEGER,                    -- NULL = unlimited
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,              -- Code expiry (not entitlement expiry)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);

-- What gets created when redeemed
CREATE TABLE user_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  entitlement_code_id UUID NOT NULL REFERENCES entitlement_codes(id),
  access_type TEXT NOT NULL,
  granted_courses TEXT[],
  expires_at TIMESTAMPTZ,              -- NULL = lifetime
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(learner_id, entitlement_code_id)
);

-- Public view for pre-auth validation (same pattern as invite_code_validation)
CREATE OR REPLACE VIEW entitlement_code_validation AS
  SELECT id, code, access_type, granted_courses, duration_type,
         duration_days, label, max_uses, use_count, expires_at, is_active
  FROM entitlement_codes;
GRANT SELECT ON entitlement_code_validation TO anon;

-- RLS
ALTER TABLE entitlement_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "God users manage entitlement codes"
  ON entitlement_codes FOR ALL USING (is_god_user());

CREATE POLICY "Users read own entitlements"
  ON user_entitlements FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text));

CREATE POLICY "God users manage all entitlements"
  ON user_entitlements FOR ALL USING (is_god_user());
