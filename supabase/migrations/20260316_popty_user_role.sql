-- Add popty_user to platform_role CHECK constraint
-- popty_user = dashboard (Popty) access + automatic full course entitlement in learning app

-- Drop and recreate the constraint to include popty_user
ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_platform_role_check;
ALTER TABLE learners ADD CONSTRAINT learners_platform_role_check
  CHECK (platform_role IS NULL OR platform_role IN ('ssi_admin', 'popty_user'));

-- Auto-entitle popty_user: when platform_role is set to popty_user,
-- automatically grant full course access in the learning app
CREATE OR REPLACE FUNCTION auto_entitle_popty_user() RETURNS trigger AS $$
BEGIN
  IF NEW.platform_role IN ('popty_user', 'ssi_admin')
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_entitle_popty_user ON learners;
CREATE TRIGGER trg_auto_entitle_popty_user
  AFTER UPDATE OF platform_role ON learners
  FOR EACH ROW EXECUTE FUNCTION auto_entitle_popty_user();

NOTIFY pgrst, 'reload schema';
