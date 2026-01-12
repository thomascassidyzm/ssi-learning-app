-- Migration: Add algorithm_config table
-- Purpose: Admin-tweakable algorithm parameters
-- Philosophy: "Everything is a parameter"

CREATE TABLE IF NOT EXISTS algorithm_config (
  key TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_algorithm_config_updated ON algorithm_config (updated_at DESC);

COMMENT ON TABLE algorithm_config IS 'Admin-tweakable algorithm parameters for learning engine';
COMMENT ON COLUMN algorithm_config.key IS 'Unique identifier: turbo_boost, normal_mode, spaced_rep, etc.';
COMMENT ON COLUMN algorithm_config.config IS 'JSONB config object with all tweakable params';

-- Seed with default values
INSERT INTO algorithm_config (key, config, description, updated_by) VALUES
(
  'normal_mode',
  '{
    "playback_speed": 1.0,
    "pause_base_ms": 1500,
    "pause_multiplier": 1.0,
    "min_pause_ms": 3000,
    "max_pause_ms": 8000,
    "spaced_rep_fraction": 1.0,
    "debut_phrases_fraction": 1.0,
    "skip_voice2": false
  }'::jsonb,
  'Default learning mode - full pauses, full spaced rep, all practice phrases',
  'system'
),
(
  'turbo_boost',
  '{
    "playback_speed": 1.25,
    "pause_base_ms": 500,
    "pause_multiplier": 0.5,
    "min_pause_ms": 800,
    "max_pause_ms": 2000,
    "spaced_rep_fraction": 0.33,
    "debut_phrases_fraction": 0.5,
    "skip_voice2": false
  }'::jsonb,
  'Turbo mode - faster playback, shorter pauses, 1/3 spaced rep, half debut phrases',
  'system'
)
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE algorithm_config ENABLE ROW LEVEL SECURITY;

-- Everyone can read (learners need to fetch config)
CREATE POLICY "Anyone can read algorithm_config"
  ON algorithm_config FOR SELECT
  USING (true);

-- Only service role can write (admin operations)
CREATE POLICY "Service role can write algorithm_config"
  ON algorithm_config FOR ALL
  USING (auth.role() = 'service_role');
