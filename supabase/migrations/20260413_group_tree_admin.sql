-- ============================================
-- GROUP TREE ADMIN MIGRATION
-- Moves govt_admin access from flat regions to hierarchical groups.
-- Adds materialized path for fast subtree queries.
-- Keeps region_code columns for backward compat during transition.
-- ============================================

-- 1. Add materialized path to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS path TEXT;
CREATE INDEX IF NOT EXISTS idx_groups_path ON groups USING btree (path text_pattern_ops);

-- 2. Populate path for existing groups (recursive, handles any depth)
WITH RECURSIVE group_paths AS (
  -- Root groups (no parent)
  SELECT id, parent_id, name,
    LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) AS path
  FROM groups
  WHERE parent_id IS NULL

  UNION ALL

  -- Child groups
  SELECT g.id, g.parent_id, g.name,
    gp.path || '/' || LOWER(REGEXP_REPLACE(g.name, '[^a-zA-Z0-9]+', '-', 'g'))
  FROM groups g
  JOIN group_paths gp ON g.parent_id = gp.id
)
UPDATE groups SET path = group_paths.path
FROM group_paths WHERE groups.id = group_paths.id;

-- 3. Trigger to auto-compute path on insert/update
CREATE OR REPLACE FUNCTION compute_group_path()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_path TEXT;
  v_slug TEXT;
BEGIN
  v_slug := LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'));

  IF NEW.parent_id IS NULL THEN
    NEW.path := v_slug;
  ELSE
    SELECT path INTO v_parent_path FROM groups WHERE id = NEW.parent_id;
    NEW.path := v_parent_path || '/' || v_slug;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_group_path ON groups;
CREATE TRIGGER trg_compute_group_path
  BEFORE INSERT OR UPDATE OF name, parent_id ON groups
  FOR EACH ROW EXECUTE FUNCTION compute_group_path();

-- 4. Helper: get all group IDs in a subtree (for use in queries)
CREATE OR REPLACE FUNCTION get_subtree_group_ids(p_group_id UUID)
RETURNS SETOF UUID AS $$
  SELECT id FROM groups
  WHERE path LIKE (SELECT path FROM groups WHERE id = p_group_id) || '%'
$$ LANGUAGE sql STABLE;

-- 5. Add group_id to govt_admins
ALTER TABLE govt_admins ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);

-- 6. Migrate existing govt_admins: match region_code → group by name
UPDATE govt_admins ga
SET group_id = g.id
FROM groups g
JOIN regions r ON LOWER(g.name) = LOWER(r.name)
WHERE ga.region_code = r.code
  AND ga.group_id IS NULL;

-- 7. Add grants_group_id to invite_codes
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS grants_group_id UUID REFERENCES groups(id);

-- 8. Migrate existing invite_codes with grants_region
UPDATE invite_codes ic
SET grants_group_id = g.id
FROM groups g
JOIN regions r ON LOWER(g.name) = LOWER(r.name)
WHERE ic.grants_region = r.code
  AND ic.grants_group_id IS NULL;

-- 9. Update school_summary view to include group_id
CREATE OR REPLACE VIEW school_summary AS
SELECT
  s.id,
  s.school_name,
  s.region_code,
  s.group_id,
  s.admin_user_id,
  COALESCE(tc.teacher_count, 0) AS teacher_count,
  COALESCE(cc.class_count, 0) AS class_count,
  COALESCE(sc.student_count, 0) AS student_count,
  COALESCE(ph.total_practice_hours, 0) AS total_practice_hours
FROM schools s
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS teacher_count
  FROM user_tags ut
  WHERE ut.tag_type = 'school'
    AND ut.tag_value = 'SCHOOL:' || s.id
    AND ut.role_in_context = 'teacher'
    AND ut.removed_at IS NULL
) tc ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS class_count
  FROM classes c
  WHERE c.school_id = s.id AND c.is_active = true
) cc ON true
LEFT JOIN LATERAL (
  SELECT COUNT(DISTINCT csp.learner_id) AS student_count
  FROM class_student_progress csp
  JOIN classes c ON c.id = csp.class_id
  WHERE c.school_id = s.id
) sc ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(csp.total_practice_seconds), 0) / 3600 AS total_practice_hours
  FROM class_student_progress csp
  JOIN classes c ON c.id = csp.class_id
  WHERE c.school_id = s.id
) ph ON true;

-- 10. Create group_summary view (replaces region_summary for group-tree queries)
CREATE OR REPLACE VIEW group_summary AS
SELECT
  g.id AS group_id,
  g.name AS group_name,
  g.path AS group_path,
  COUNT(DISTINCT s.id) AS school_count,
  COALESCE(SUM(ss.teacher_count), 0) AS teacher_count,
  COALESCE(SUM(ss.class_count), 0) AS class_count,
  COALESCE(SUM(ss.student_count), 0) AS student_count,
  COALESCE(SUM(ss.total_practice_hours), 0) AS total_practice_hours
FROM groups g
LEFT JOIN schools s ON s.group_id IN (SELECT get_subtree_group_ids(g.id))
LEFT JOIN school_summary ss ON ss.id = s.id
GROUP BY g.id, g.name, g.path;

-- Grant access to the new view
GRANT SELECT ON group_summary TO authenticated;

-- ============================================
-- NOTES:
-- - region_code columns NOT dropped — kept for backward compat
-- - regions table kept for language reference (primary_language etc.)
-- - Frontend should prefer group_id, fall back to region_code
-- - Path auto-updates via trigger on group name/parent changes
-- ============================================
