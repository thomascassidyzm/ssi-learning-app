-- ============================================
-- Column security STEP 2: REVOKE sensitive columns
-- ============================================
-- Run this AFTER the code changes are deployed on Vercel.
-- Step 1 (functions) must already be in place.
--
-- If client code accidentally tries to read a revoked column,
-- Supabase returns: "permission denied for column <name>"
-- — loud and debuggable, NOT silent empty results.
--
-- Service role (dashboard, API routes) is unaffected.
--
-- Date: 2026-04-01

-- learners.verified_emails — email addresses (direct PII)
-- Client code now uses get_my_verified_emails() and find_learner_by_email() RPCs.
REVOKE SELECT (verified_emails) ON learners FROM anon, authenticated;

-- NOTE: subscriptions and audio_plays tables don't exist yet.
-- When they are created, add:
--   REVOKE SELECT (provider_subscription_id) ON subscriptions FROM anon, authenticated;
--   REVOKE SELECT (provider_customer_id) ON subscriptions FROM anon, authenticated;
--   REVOKE SELECT (ip_country) ON audio_plays FROM anon, authenticated;

-- ============================================
-- To add more protected columns later, just add more REVOKE lines.
-- To undo: GRANT SELECT (column_name) ON table TO anon, authenticated;
-- ============================================
