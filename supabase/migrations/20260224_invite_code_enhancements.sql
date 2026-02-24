-- Invite code enhancements for hierarchical signup system
-- Run in Supabase SQL Editor

-- Store display metadata for code redemption (org name, school name, etc.)
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Track which code a learner used at signup
ALTER TABLE learners ADD COLUMN IF NOT EXISTS invite_code_id UUID REFERENCES invite_codes(id);

-- Public view for code validation (doesn't expose created_by or internal fields)
CREATE OR REPLACE VIEW public.invite_code_validation AS
  SELECT id, code, code_type, grants_region, grants_school_id, grants_class_id,
         metadata, max_uses, use_count, expires_at, is_active
  FROM invite_codes;

-- Allow anonymous access for pre-auth code validation
GRANT SELECT ON public.invite_code_validation TO anon;
