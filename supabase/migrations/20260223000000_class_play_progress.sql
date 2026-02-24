-- Add LEGO-level progress tracking to classes
ALTER TABLE classes ADD COLUMN last_lego_id TEXT;  -- e.g., 'S0015L02'

-- Session history for reporting
CREATE TABLE class_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_user_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  start_lego_id TEXT NOT NULL,
  end_lego_id TEXT,
  cycles_completed INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_class_sessions_class ON class_sessions(class_id, started_at DESC);

-- God mode RLS (matches existing school table policies)
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_class_sessions" ON class_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_class_sessions" ON class_sessions FOR ALL TO anon USING (true);
