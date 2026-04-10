-- ============================================
-- School Admin Join Codes
-- ============================================
-- Adds admin_join_code to schools so existing school admins
-- can invite co-admins. Uses the same generate_join_code() function.
-- New code_type 'school_admin_join' distinguishes from 'school_admin'
-- which creates a new school.
-- ============================================

-- 1. Add admin_join_code column
ALTER TABLE schools ADD COLUMN IF NOT EXISTS admin_join_code TEXT UNIQUE;

-- 2. Update trigger to auto-generate admin_join_code on INSERT
CREATE OR REPLACE FUNCTION set_school_join_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER;
BEGIN
  -- Generate teacher_join_code if missing
  IF NEW.teacher_join_code IS NULL OR NEW.teacher_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.teacher_join_code := new_code;
        EXIT; -- success
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique teacher join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  -- Generate admin_join_code if missing
  IF NEW.admin_join_code IS NULL OR NEW.admin_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.admin_join_code := new_code;
        EXIT; -- success
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique admin join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill existing schools with admin_join_codes
DO $backfill$
DECLARE
  s RECORD;
  new_code TEXT;
  attempts INTEGER;
BEGIN
  FOR s IN SELECT id, admin_user_id FROM schools WHERE admin_join_code IS NULL LOOP
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        UPDATE schools SET admin_join_code = new_code WHERE id = s.id;
        EXIT; -- success
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique admin join code for school %', s.id;
        END IF;
      END;
    END LOOP;

    -- Create invite_codes row for the admin join code
    INSERT INTO invite_codes (code, code_type, grants_school_id, created_by, is_active)
    VALUES (new_code, 'school_admin_join', s.id, s.admin_user_id, true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $backfill$;

-- 4. Make NOT NULL now that all rows are filled
ALTER TABLE schools ALTER COLUMN admin_join_code SET NOT NULL;

-- 5. Add index
CREATE INDEX IF NOT EXISTS idx_schools_admin_join_code ON schools(admin_join_code);

-- 6. Update invite_codes code_type CHECK to include 'school_admin_join'
ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check
  CHECK (code_type IN ('ssi_admin', 'god', 'govt_admin', 'school_admin', 'school_admin_join', 'teacher', 'student', 'tester'));

-- 7. Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
