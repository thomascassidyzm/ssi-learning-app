-- Migration: player_events log
-- Purpose: capture significant player UI events (taps, lap/commentary
-- start+cancel, round complete, audio_failed) so we can diagnose user
-- reports like "skip didn't work during listening" without needing the
-- learner to remember which sub-system was active.
--
-- Distinct from audio_plays (which is per-audio-fetch analytics) —
-- this is per-event diagnostics. Read-once-per-investigation,
-- write-bounded (a learner generates O(100) events per session).

CREATE TABLE IF NOT EXISTS player_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID,                    -- nullable for guest sessions
  course_code TEXT,                -- nullable (e.g. session_start before course resolved)
  session_id UUID,                 -- groups events from one mounted player
  event_type TEXT NOT NULL,        -- 'tap_skip', 'pod_lap_start', etc.
  payload JSONB,                   -- per-event_type context
  client_version TEXT,             -- bundle hash / git sha for triage
  device_type TEXT,                -- mobile / tablet / desktop
  ip_country TEXT
);

-- Most queries are "events for this user, recent-first"
CREATE INDEX IF NOT EXISTS idx_player_events_user_time
  ON player_events (user_id, occurred_at DESC);

-- Secondary: filter by event_type (e.g. "all skip events in last 24h")
CREATE INDEX IF NOT EXISTS idx_player_events_type_time
  ON player_events (event_type, occurred_at DESC);

-- Group events from a single session for timeline rendering
CREATE INDEX IF NOT EXISTS idx_player_events_session
  ON player_events (session_id, occurred_at);

COMMENT ON TABLE player_events IS 'Diagnostic event log for the learning player. Written via /api/player-events.';

-- RLS: write via service role only (the endpoint authenticates the user
-- via cookie before inserting). Reads scoped to admin role for now;
-- learners shouldn't need to see their own event log.
ALTER TABLE player_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can write player_events"
  ON player_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Admins can read all rows. Tighten later (per-school admin scoping)
-- when real schools onboarding is closer. Uses the existing
-- is_ssi_admin() helper which handles the auth.uid() (uuid) ↔
-- learners.user_id (text) cast — this table inherits the same
-- post-Clerk-migration type mismatch as everywhere else.
CREATE POLICY "Admins can read player_events"
  ON player_events FOR SELECT
  USING (public.is_ssi_admin());
