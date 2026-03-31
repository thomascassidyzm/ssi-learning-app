-- Tester feedback table for bug reports, suggestions, and UX feedback
-- Submitted by users with platform_role = 'tester' or 'ssi_admin'

CREATE TABLE IF NOT EXISTS tester_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  display_name text,
  feedback_type text NOT NULL CHECK (feedback_type IN ('bug', 'suggestion', 'security', 'ux')),
  title text NOT NULL,
  description text,
  route text,
  device_info jsonb,
  build_version text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'wontfix')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying open feedback
CREATE INDEX IF NOT EXISTS idx_tester_feedback_status ON tester_feedback(status);
CREATE INDEX IF NOT EXISTS idx_tester_feedback_created ON tester_feedback(created_at DESC);
