-- Supporters table: tracks Ko-fi donations and monthly supporters
-- Ko-fi webhook inserts/updates rows; frontend reads for supporters wall + badge

CREATE TABLE supporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email TEXT,
  kofi_transaction_id TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('one-off', 'monthly')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  first_supported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_supported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  learner_id UUID REFERENCES learners(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anyone can read supporters (for the wall), only service role can write (via webhook)
ALTER TABLE supporters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view supporters" ON supporters FOR SELECT USING (true);

-- Index for email matching when linking to learners
CREATE INDEX idx_supporters_email ON supporters (email) WHERE email IS NOT NULL;
