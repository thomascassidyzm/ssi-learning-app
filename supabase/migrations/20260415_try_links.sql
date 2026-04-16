-- ============================================
-- TRY LINKS — zero-friction course preview links
-- Share a link, visitor plays all courses immediately, no auth
-- Tracks visits for partner/affiliate attribution
-- ============================================

-- Try links table
CREATE TABLE IF NOT EXISTS try_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,                          -- e.g. "Duolingo partnership", "Aran's Twitter"
  created_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ,                       -- null = never expires
  ttl_days INTEGER DEFAULT 90,                  -- default 90-day TTL (used to compute expires_at on create)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Try link visits table
CREATE TABLE IF NOT EXISTS try_link_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  try_link_id UUID NOT NULL REFERENCES try_links(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ DEFAULT now(),
  ip_hash TEXT                                  -- SHA-256 of IP for unique visitor counting (not PII)
);

-- Index for fast visit counting
CREATE INDEX IF NOT EXISTS idx_try_link_visits_link_id ON try_link_visits(try_link_id);
CREATE INDEX IF NOT EXISTS idx_try_link_visits_visited_at ON try_link_visits(visited_at);

-- Index for code lookup (public validation)
CREATE INDEX IF NOT EXISTS idx_try_links_code ON try_links(code);
