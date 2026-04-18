-- Audio Plays Analytics Table
-- Tracks every audio request through the proxy for engagement insights

CREATE TABLE IF NOT EXISTS audio_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  audio_id UUID NOT NULL,
  course_id TEXT,
  seed_id TEXT,
  audio_role TEXT,  -- 'known', 'target1', 'target2'
  played_at TIMESTAMPTZ DEFAULT NOW(),
  device_type TEXT,  -- 'mobile', 'tablet', 'desktop'
  is_offline BOOLEAN DEFAULT FALSE,
  ip_country TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audio_plays_user ON audio_plays (user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_plays_course ON audio_plays (course_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_plays_audio ON audio_plays (audio_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_plays_date ON audio_plays (played_at DESC);

-- RLS Policies
ALTER TABLE audio_plays ENABLE ROW LEVEL SECURITY;

-- Allow inserts from authenticated and anonymous users (via service role in API)
CREATE POLICY "Service role can insert audio plays"
  ON audio_plays
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Users can read their own audio plays
CREATE POLICY "Users can read own audio plays"
  ON audio_plays
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role can read all for analytics
CREATE POLICY "Service role can read all audio plays"
  ON audio_plays
  FOR SELECT
  TO service_role
  USING (true);

-- Comments for documentation
COMMENT ON TABLE audio_plays IS 'Analytics table tracking audio playback for engagement insights';
COMMENT ON COLUMN audio_plays.audio_role IS 'Which phase of the learning cycle: known, target1, or target2';
COMMENT ON COLUMN audio_plays.is_offline IS 'Whether this was played from cached content while offline';
COMMENT ON COLUMN audio_plays.ip_country IS 'Country code from Vercel headers for geographic analytics';
