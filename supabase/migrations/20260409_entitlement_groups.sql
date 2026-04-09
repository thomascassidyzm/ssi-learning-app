-- ============================================
-- Entitlement Groups & Cascade System
-- ============================================
-- Flexible hierarchy: nation → region → district → school → class
-- Entitlements cascade down the tree (intersect at each level)
-- ============================================

-- 1. GROUPS TABLE
-- A group can be anything: nation, region, district, programme, etc.
-- Parent-child relationship forms a tree.

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'region',
  parent_id UUID REFERENCES groups(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_groups_parent ON groups(parent_id);
CREATE INDEX idx_groups_type ON groups(type);

COMMENT ON TABLE groups IS 'Hierarchical grouping for entitlement cascade. Schools belong to one group.';
COMMENT ON COLUMN groups.type IS 'Descriptive type: nation, region, district, programme, etc. Not enforced as enum — purely for display/filtering.';

-- 2. ADD group_id TO SCHOOLS
-- Schools sit in one place in the tree. region_code kept for backwards compat.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);
CREATE INDEX IF NOT EXISTS idx_schools_group ON schools(group_id) WHERE group_id IS NOT NULL;

-- 3. MIGRATE EXISTING REGIONS INTO GROUPS
-- Each region becomes a group with type='region'.
-- We store the mapping so we can backfill schools.group_id.

DO $migrate$
DECLARE
  r RECORD;
  new_id UUID;
BEGIN
  FOR r IN SELECT code, name FROM regions LOOP
    INSERT INTO groups (name, type)
    VALUES (r.name, 'region')
    RETURNING id INTO new_id;

    -- Backfill schools that reference this region
    UPDATE schools SET group_id = new_id WHERE region_code = r.code;
  END LOOP;
END $migrate$;

-- 4. ENTITLEMENT GRANTS TABLE
-- Grants course access to a group, school, or class.
-- Exactly one target per row (CHECK constraint).

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

CREATE INDEX idx_entitlement_grants_group ON entitlement_grants(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_entitlement_grants_school ON entitlement_grants(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX idx_entitlement_grants_class ON entitlement_grants(class_id) WHERE class_id IS NOT NULL;

COMMENT ON TABLE entitlement_grants IS 'Course access grants at group/school/class level. Cascade: intersect downward, union across classes.';

-- 5. DISABLE RLS (matches existing pattern from 20260326100000_disable_all_rls.sql)

ALTER TABLE groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_grants DISABLE ROW LEVEL SECURITY;

-- 6. CASCADE RESOLUTION FUNCTION
-- For a given user, walk their class → school → group ancestry tree.
-- At each level, intersect grants (restrict only, never expand).
-- Union across all classes the student belongs to.

CREATE OR REPLACE FUNCTION get_cascade_courses(p_user_id TEXT)
RETURNS TEXT[] AS $fn$
DECLARE
  result TEXT[] := ARRAY[]::TEXT[];
  rec RECORD;
  ancestor_id UUID;
  level_courses TEXT[];
  effective TEXT[];
BEGIN
  -- For each class the user is a student in
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
    effective := NULL;  -- NULL = no restriction yet

    -- Walk up the group tree from the school's group
    IF rec.group_id IS NOT NULL THEN
      ancestor_id := rec.group_id;

      -- Collect ancestors bottom-up, then process top-down
      -- Use a CTE to get the full chain
      FOR level_courses IN
        WITH RECURSIVE ancestry AS (
          SELECT id, parent_id, 0 AS depth FROM groups WHERE id = ancestor_id
          UNION ALL
          SELECT g.id, g.parent_id, a.depth + 1
          FROM groups g JOIN ancestry a ON g.id = a.parent_id
        ),
        ordered_ancestors AS (
          SELECT id FROM ancestry ORDER BY depth DESC  -- top-down
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
            -- Intersect: can only subtract
            effective := ARRAY(
              SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
            );
          END IF;
        END IF;
        -- If no grant at this level, effective stays unchanged (inherit)
      END LOOP;
    END IF;

    -- School-level grant
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

    -- Class-level grant
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

    -- Union this class's effective courses into overall result
    IF effective IS NOT NULL THEN
      result := ARRAY(SELECT DISTINCT unnest(result || effective));
    END IF;
  END LOOP;

  RETURN result;
END;
$fn$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_cascade_courses(TEXT) IS 'Returns effective course codes for a user via entitlement cascade (group → school → class). Intersects downward, unions across classes.';
