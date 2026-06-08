-- ============================================================================
-- SECURITY FIX #1 (CRITICAL) — close the self-grant subscription hole
-- ============================================================================
-- THE HOLE: subscriptions has RLS enabled, but the "Users can insert own
-- subscription" policy's WITH CHECK only verifies row OWNERSHIP
-- (learner_id belongs to the caller) — it does NOT constrain `status` or
-- `current_period_end`. A logged-in user could therefore:
--   INSERT INTO subscriptions {learner_id: <self>, status:'active',
--                              current_period_end:'2099-01-01'}
-- and the learner_subscription_status view then reports is_subscribed=true,
-- which /api/subscription trusts — unlocking the paid catalogue for free,
-- with no Paddle payment ever happening.
--
-- WHY THIS IS SAFE TO REVOKE: every legitimate write to subscriptions happens
-- server-side with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS *and* grants:
--   - api/subscription/index.ts:62
--   - api/teacher/paddle-webhook.ts:106
--   - api/teacher/signup.ts:68
-- Verified 2026-06-08: no client (packages/player-vue, apps/) code ever
-- INSERTs/UPDATEs/DELETEs the subscriptions table. So removing client write
-- access cannot break any real flow.
--
-- Own-row SELECT is intentionally left intact ("Users can view own
-- subscription" policy + SELECT grant) in case any client read is added later.

-- 1. Drop the permissive self-insert policy.
DROP POLICY IF EXISTS "Users can insert own subscription" ON subscriptions;

-- 2. Defense in depth: revoke all client write privileges. With no INSERT
--    grant, even a future loosely-written policy cannot reopen this hole.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON subscriptions FROM anon, authenticated;

-- 3. Reload PostgREST so the policy/grant change takes effect immediately.
NOTIFY pgrst, 'reload schema';
