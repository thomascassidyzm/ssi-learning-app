-- Allow entitlement codes to also grant dashboard (Popty) access
-- When redeemed, these set platform_role and dashboard_courses on the learner
ALTER TABLE entitlement_codes ADD COLUMN IF NOT EXISTS grants_platform_role TEXT;
ALTER TABLE entitlement_codes ADD COLUMN IF NOT EXISTS grants_dashboard_courses TEXT[];

-- Update the validation view to expose the new columns
CREATE OR REPLACE VIEW entitlement_code_validation AS
  SELECT id, code, access_type, granted_courses, duration_type,
         duration_days, label, max_uses, use_count, expires_at, is_active,
         grants_platform_role, grants_dashboard_courses
  FROM entitlement_codes;
GRANT SELECT ON entitlement_code_validation TO anon;

NOTIFY pgrst, 'reload schema';
