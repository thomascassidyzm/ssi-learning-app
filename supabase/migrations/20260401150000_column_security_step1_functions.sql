-- ============================================
-- Column security STEP 1: Create helper functions
-- ============================================
-- Run this FIRST, before deploying code changes.
-- These functions exist alongside the old code harmlessly.
--
-- After code deploys, run step 2 (REVOKE) to lock the columns.
--
-- Date: 2026-04-01

-- Returns the current authenticated user's verified_emails.
-- Used by SettingsScreen to show "your emails" and by useAuth
-- to check if current login email is already in the list.
CREATE OR REPLACE FUNCTION get_my_verified_emails()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $get_my_verified_emails$
  SELECT COALESCE(verified_emails, ARRAY[]::TEXT[])
  FROM learners
  WHERE user_id = auth.uid()::TEXT
  LIMIT 1;
$get_my_verified_emails$;

-- Finds a learner by email (for multi-email identity linking).
-- Returns the learner's id and user_id if the email appears in
-- any learner's verified_emails. Returns NULL if not found.
-- SECURITY DEFINER so it can read the revoked column.
CREATE OR REPLACE FUNCTION find_learner_by_email(lookup_email TEXT)
RETURNS TABLE(
  id UUID,
  user_id TEXT,
  display_name TEXT,
  platform_role TEXT,
  educational_role TEXT,
  preferences JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $find_learner_by_email$
  SELECT l.id, l.user_id, l.display_name, l.platform_role,
         l.educational_role, l.preferences, l.created_at, l.updated_at
  FROM learners l
  WHERE lookup_email = ANY(l.verified_emails)
  LIMIT 1;
$find_learner_by_email$;
