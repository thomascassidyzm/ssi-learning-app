-- Roadmap Items Table
-- Internal admin table for project/roadmap management
-- Created: 2026-01-06

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE roadmap_area AS ENUM (
  'schools',
  'audio',
  'ux',
  'business',
  'infrastructure',
  'content'
);

CREATE TYPE roadmap_status AS ENUM (
  'planned',
  'in_progress',
  'done'
);

-- ============================================
-- ROADMAP ITEMS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  area roadmap_area NOT NULL,
  status roadmap_status NOT NULL DEFAULT 'planned',
  token_estimate INTEGER,
  dependencies UUID[] DEFAULT '{}',
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX idx_roadmap_items_area ON roadmap_items(area);
CREATE INDEX idx_roadmap_items_status ON roadmap_items(status);
CREATE INDEX idx_roadmap_items_sort_order ON roadmap_items(sort_order);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_roadmap_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER roadmap_items_updated_at
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW
  EXECUTE FUNCTION update_roadmap_items_updated_at();

-- Comments for documentation
COMMENT ON TABLE roadmap_items IS 'Internal roadmap/project management items for admin use';
COMMENT ON COLUMN roadmap_items.token_estimate IS 'Estimated tokens (effort) for this item';
COMMENT ON COLUMN roadmap_items.dependencies IS 'Array of roadmap_item UUIDs this item depends on';
COMMENT ON COLUMN roadmap_items.sort_order IS 'Manual ordering within lists/views';
