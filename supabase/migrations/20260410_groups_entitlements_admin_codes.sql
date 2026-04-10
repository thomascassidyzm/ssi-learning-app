-- ============================================
-- Combined migration: Groups + Entitlements + Admin Join Codes
-- Safe to run multiple times (fully idempotent)
-- ============================================

-- ============================================
-- PART 1: Groups & Entitlement Grants
-- ============================================

-- 1. Groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'region',
  parent_id UUID REFERENCES groups(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_parent ON groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_groups_type ON groups(type);

COMMENT ON TABLE groups IS 'Hierarchical grouping for entitlement cascade. Schools belong to one group.';
COMMENT ON COLUMN groups.type IS 'Descriptive type: nation, region, district, programme, etc.';

-- 2. Add group_id to schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);
CREATE INDEX IF NOT EXISTS idx_schools_group ON schools(group_id) WHERE group_id IS NOT NULL;

-- 3. Migrate existing regions into groups (skip if already done)
DO $migrate$
DECLARE
  r RECORD;
  new_id UUID;
  existing_count INTEGER;
BEGIN
  -- Skip if groups already has data (migration already ran)
  SELECT count(*) INTO existing_count FROM groups;
  IF existing_count > 0 THEN
    RAISE NOTICE 'Groups table already has % rows — skipping region migration', existing_count;
    RETURN;
  END IF;

  FOR r IN SELECT code, name FROM regions LOOP
    INSERT INTO groups (name, type)
    VALUES (r.name, 'region')
    RETURNING id INTO new_id;

    UPDATE schools SET group_id = new_id WHERE region_code = r.code;
  END LOOP;
  RAISE NOTICE 'Migrated regions into groups';
END $migrate$;

-- 4. Entitlement grants table
CREATE TABLE IF NOT EXISTS entitlement_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  granted_courses TEXT[] NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT one_target_level CHECK (
    (group_id IS NOT NULL)::int +
    (school_id IS NOT NULL)::int +
    (class_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_entitlement_grants_group ON entitlement_grants(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_school ON entitlement_grants(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_class ON entitlement_grants(class_id) WHERE class_id IS NOT NULL;

COMMENT ON TABLE entitlement_grants IS 'Course access grants at group/school/class level.';

-- 5. Disable RLS on new tables
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_grants DISABLE ROW LEVEL SECURITY;

-- 6. Cascade resolution function
CREATE OR REPLACE FUNCTION get_cascade_courses(p_user_id TEXT)
RETURNS TEXT[] AS $fn$
DECLARE
  result TEXT[] := ARRAY[]::TEXT[];
  rec RECORD;
  ancestor_id UUID;
  level_courses TEXT[];
  effective TEXT[];
BEGIN
  FOR rec IN
    SELECT c.id AS class_id, c.school_id, s.group_id
    FROM user_tags ut
    JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
    JOIN schools s ON c.school_id = s.id
    WHERE ut.user_id = p_user_id
      AND ut.tag_type = 'class'
      AND ut.role_in_context = 'student'
      AND ut.removed_at IS NULL
  LOOP
    effective := NULL;

    IF rec.group_id IS NOT NULL THEN
      ancestor_id := rec.group_id;

      FOR level_courses IN
        WITH RECURSIVE ancestry AS (
          SELECT id, parent_id, 0 AS depth FROM groups WHERE id = ancestor_id
          UNION ALL
          SELECT g.id, g.parent_id, a.depth + 1
          FROM groups g JOIN ancestry a ON g.id = a.parent_id
        ),
        ordered_ancestors AS (
          SELECT id FROM ancestry ORDER BY depth DESC
        )
        SELECT COALESCE(
          (SELECT array_agg(DISTINCT course)
           FROM entitlement_grants, unnest(granted_courses) AS course
           WHERE entitlement_grants.group_id = oa.id
             AND is_active = true
             AND (expires_at IS NULL OR expires_at > NOW())),
          ARRAY[]::TEXT[]
        ) AS courses
        FROM ordered_ancestors oa
      LOOP
        IF array_length(level_courses, 1) > 0 THEN
          IF effective IS NULL THEN
            effective := level_courses;
          ELSE
            effective := ARRAY(
              SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
            );
          END IF;
        END IF;
      END LOOP;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT course), ARRAY[]::TEXT[])
    INTO level_courses
    FROM entitlement_grants, unnest(granted_courses) AS course
    WHERE entitlement_grants.school_id = rec.school_id
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW());

    IF array_length(level_courses, 1) > 0 THEN
      IF effective IS NULL THEN
        effective := level_courses;
      ELSE
        effective := ARRAY(
          SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
        );
      END IF;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT course), ARRAY[]::TEXT[])
    INTO level_courses
    FROM entitlement_grants, unnest(granted_courses) AS course
    WHERE entitlement_grants.class_id = rec.class_id
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW());

    IF array_length(level_courses, 1) > 0 THEN
      IF effective IS NULL THEN
        effective := level_courses;
      ELSE
        effective := ARRAY(
          SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
        );
      END IF;
    END IF;

    IF effective IS NOT NULL THEN
      result := ARRAY(SELECT DISTINCT unnest(result || effective));
    END IF;
  END LOOP;

  RETURN result;
END;
$fn$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_cascade_courses(TEXT) IS 'Returns effective course codes for a user via entitlement cascade.';

-- ============================================
-- PART 2: School Admin Join Codes
-- ============================================

-- 7. Update CHECK constraint FIRST (before any inserts with new type)
ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check
  CHECK (code_type IN ('ssi_admin', 'god', 'govt_admin', 'school_admin', 'school_admin_join', 'teacher', 'student', 'tester'));

-- 8. Add admin_join_code column
ALTER TABLE schools ADD COLUMN IF NOT EXISTS admin_join_code TEXT UNIQUE;

-- 9. Update trigger to auto-generate both join codes on INSERT
CREATE OR REPLACE FUNCTION set_school_join_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER;
BEGIN
  IF NEW.teacher_join_code IS NULL OR NEW.teacher_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.teacher_join_code := new_code;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique teacher join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  IF NEW.admin_join_code IS NULL OR NEW.admin_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.admin_join_code := new_code;
        EXIT;
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

-- 10. Backfill existing schools with admin_join_codes
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
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique admin join code for school %', s.id;
        END IF;
      END;
    END LOOP;

    -- Create invite_codes row (skip if already exists)
    INSERT INTO invite_codes (code, code_type, grants_school_id, created_by, is_active)
    VALUES (new_code, 'school_admin_join', s.id, s.admin_user_id, true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $backfill$;

-- 11. Make NOT NULL now that all rows are filled
DO $set_not_null$
BEGIN
  ALTER TABLE schools ALTER COLUMN admin_join_code SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'admin_join_code NOT NULL already set or failed: %', SQLERRM;
END $set_not_null$;

-- 12. Add index
CREATE INDEX IF NOT EXISTS idx_schools_admin_join_code ON schools(admin_join_code);

-- ============================================
-- DONE
-- ============================================
NOTIFY pgrst, 'reload schema';
