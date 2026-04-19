-- ============================================
-- Segregate demo data into a parallel group subtree
-- Date: 2026-04-19
-- ============================================
--
-- Problem: demo schools currently live in the real region groups
-- (Wales, Ireland, Japan, Brittany). When a real school from any of
-- those regions onboards, its govt admin would see demo schools mixed
-- with real ones — and aggregates would double-count.
--
-- Solution: move all demo data into a parallel "Demo" group subtree.
-- Real region groups become empty and ready to receive real schools.
-- The existing group-subtree scope that govt admins already use
-- (path LIKE group.path || '%') guarantees a real scope never
-- intersects a demo scope — no per-table is_demo filtering needed
-- in composables.
--
-- Structure after migration:
--   Demo                       (is_demo=true, root)
--     Demo / Wales             (4 demo Welsh schools)
--     Demo / Ireland           (1)
--     Demo / Japan             (5)
--     Demo / Brittany          (10)
--   Wales                      (real, empty — first real Welsh school lands here)
--   Ireland, Japan, Brittany   (real, empty)
--   Basque(FR/ES), Catalonia, Cornwall, Isle of Man, Scotland  (unchanged)
--   TOP LEVEL TEST             (unchanged — debris, safe to leave)
--
-- Idempotent: re-runnable without side effects. Path collisions are
-- avoided via path-lookup-before-insert; schools are moved by current
-- group_id, so a re-run is a no-op (they're already in demo groups).
-- ============================================

BEGIN;

-- 1. Flag for demo subtree roots/children. Scoped queries don't need
--    to check this; it's for global views and code-level tripwires.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_groups_is_demo ON groups(is_demo) WHERE is_demo = TRUE;
COMMENT ON COLUMN groups.is_demo IS
  'Marks a group (and its subtree) as demo/pitch data. Govt admins whose group_id falls inside a demo subtree see only demo content; real govt admins see only real content. Global/superadmin views filter is_demo=false by default.';

-- 2. Build the Demo subtree. The compute_group_path trigger auto-sets
--    path from name+parent on insert, so we look up by path before
--    inserting to stay idempotent.
DO $build_demo_tree$
DECLARE
  v_demo_root    UUID;
  v_demo_wales   UUID;
  v_demo_ireland UUID;
  v_demo_japan   UUID;
  v_demo_brittany UUID;
BEGIN
  -- Demo root
  SELECT id INTO v_demo_root FROM groups WHERE path = 'demo';
  IF v_demo_root IS NULL THEN
    INSERT INTO groups (name, type, parent_id, is_demo)
    VALUES ('Demo', 'group', NULL, TRUE)
    RETURNING id INTO v_demo_root;
  ELSE
    UPDATE groups SET is_demo = TRUE WHERE id = v_demo_root;
  END IF;

  -- Demo / Wales
  SELECT id INTO v_demo_wales FROM groups WHERE path = 'demo/wales';
  IF v_demo_wales IS NULL THEN
    INSERT INTO groups (name, type, parent_id, is_demo)
    VALUES ('Wales', 'region', v_demo_root, TRUE)
    RETURNING id INTO v_demo_wales;
  ELSE
    UPDATE groups SET is_demo = TRUE WHERE id = v_demo_wales;
  END IF;

  -- Demo / Ireland
  SELECT id INTO v_demo_ireland FROM groups WHERE path = 'demo/ireland';
  IF v_demo_ireland IS NULL THEN
    INSERT INTO groups (name, type, parent_id, is_demo)
    VALUES ('Ireland', 'region', v_demo_root, TRUE)
    RETURNING id INTO v_demo_ireland;
  ELSE
    UPDATE groups SET is_demo = TRUE WHERE id = v_demo_ireland;
  END IF;

  -- Demo / Japan
  SELECT id INTO v_demo_japan FROM groups WHERE path = 'demo/japan';
  IF v_demo_japan IS NULL THEN
    INSERT INTO groups (name, type, parent_id, is_demo)
    VALUES ('Japan', 'region', v_demo_root, TRUE)
    RETURNING id INTO v_demo_japan;
  ELSE
    UPDATE groups SET is_demo = TRUE WHERE id = v_demo_japan;
  END IF;

  -- Demo / Brittany
  SELECT id INTO v_demo_brittany FROM groups WHERE path = 'demo/brittany';
  IF v_demo_brittany IS NULL THEN
    INSERT INTO groups (name, type, parent_id, is_demo)
    VALUES ('Brittany', 'region', v_demo_root, TRUE)
    RETURNING id INTO v_demo_brittany;
  ELSE
    UPDATE groups SET is_demo = TRUE WHERE id = v_demo_brittany;
  END IF;

  -- 3. Move demo schools from real region groups to matching demo groups.
  --    Uses real group IDs from query A output (2026-04-19).
  UPDATE schools SET group_id = v_demo_wales
    WHERE group_id = '7e23e848-f41c-4524-b05c-fd5ad32d739b';  -- real Wales
  UPDATE schools SET group_id = v_demo_ireland
    WHERE group_id = 'ee263959-b328-4c50-aef3-b5707b5ec9c5';  -- real Ireland
  UPDATE schools SET group_id = v_demo_japan
    WHERE group_id = '2a6f383a-6d07-4214-9f79-286d8476b210';  -- real Japan
  UPDATE schools SET group_id = v_demo_brittany
    WHERE group_id = '3357804c-0d3d-48e8-9375-02353e882faf';  -- real Brittany

  -- 4. Re-point demo govt_admins so their scope follows the schools.
  UPDATE govt_admins SET group_id = v_demo_wales
    WHERE user_id = 'test_govt_gwilym';
  UPDATE govt_admins SET group_id = v_demo_ireland
    WHERE user_id = 'test_govt_eamon';
  UPDATE govt_admins SET group_id = v_demo_japan
    WHERE user_id = 'test_govt_tanaka';
  UPDATE govt_admins SET group_id = v_demo_brittany
    WHERE user_id = 'user_2bre_govt_admin_001';

  RAISE NOTICE 'Demo subtree built. Demo root=%, wales=%, ireland=%, japan=%, brittany=%',
    v_demo_root, v_demo_wales, v_demo_ireland, v_demo_japan, v_demo_brittany;
END $build_demo_tree$;

-- 5. Mark any future paths under the Demo subtree automatically as demo.
--    (Belt-and-suspenders: if someone inserts a child under the demo
--    root without setting is_demo, this trigger fills it in.)
CREATE OR REPLACE FUNCTION inherit_demo_flag()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_is_demo BOOLEAN;
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.is_demo = FALSE THEN
    SELECT is_demo INTO v_parent_is_demo FROM groups WHERE id = NEW.parent_id;
    IF v_parent_is_demo THEN
      NEW.is_demo := TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inherit_demo_flag ON groups;
CREATE TRIGGER trg_inherit_demo_flag
  BEFORE INSERT OR UPDATE OF parent_id, is_demo ON groups
  FOR EACH ROW EXECUTE FUNCTION inherit_demo_flag();

COMMIT;

-- ============================================
-- Post-migration verification (run manually to confirm):
--
-- SELECT g.path, g.is_demo, g.type,
--        (SELECT count(*) FROM schools WHERE group_id = g.id) AS school_count
-- FROM groups g
-- ORDER BY g.is_demo, g.path;
--
-- Expected:
--   is_demo=false rows: all real regions with school_count=0
--     (Wales/Ireland/Japan/Brittany, + Basque/Catalonia/Cornwall/Isle of Man/Scotland)
--   is_demo=true rows: Demo root + Demo/Wales(4) + Demo/Ireland(1)
--                      + Demo/Japan(5) + Demo/Brittany(10)
-- ============================================
