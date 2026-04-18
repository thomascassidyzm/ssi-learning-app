-- Subscriptions Table for Payment Integration
-- Works with Clerk (auth) + LemonSqueezy (payment), swappable to Stripe later
--
-- Design:
-- - Provider-agnostic core fields (status, plan_id, period_end)
-- - Provider-specific fields for webhook reconciliation
-- - RLS: users read own subscription, service role writes from webhooks

-- ============================================
-- SUBSCRIPTIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,

  -- Provider-agnostic fields (what the app cares about)
  status TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN ('active', 'cancelled', 'past_due', 'none')),
  plan_id TEXT,
  plan_name TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,

  -- Provider-specific (for webhook reconciliation)
  provider TEXT NOT NULL DEFAULT 'lemonsqueezy',
  provider_subscription_id TEXT,
  provider_customer_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One subscription per learner
  UNIQUE(learner_id)
);

-- Index for webhook lookups by provider subscription ID
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_id
  ON subscriptions(provider, provider_subscription_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can view their own subscription
CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- Users can insert their own subscription (for initial creation)
CREATE POLICY "Users can insert own subscription"
  ON subscriptions FOR INSERT
  WITH CHECK (learner_id IN (SELECT id FROM learners WHERE user_id = (auth.jwt()->>'sub')));

-- NOTE: Updates are done by service role from webhook endpoint
-- We don't allow users to update their own subscription status directly

-- Allow service role full access (for webhooks)
-- The service role bypasses RLS, so no explicit policy needed

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER VIEW: Subscription status for learners
-- ============================================

CREATE OR REPLACE VIEW learner_subscription_status AS
SELECT
  l.id AS learner_id,
  l.user_id,
  COALESCE(s.status, 'none') AS subscription_status,
  s.plan_id,
  s.plan_name,
  s.current_period_end,
  s.cancel_at_period_end,
  CASE
    WHEN s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
    THEN TRUE
    ELSE FALSE
  END AS is_subscribed
FROM learners l
LEFT JOIN subscriptions s ON s.learner_id = l.id;

-- ============================================
-- DONE
-- ============================================

COMMENT ON TABLE subscriptions IS 'User subscription status. Updated by LemonSqueezy/Stripe webhooks. Provider-agnostic core fields allow easy provider swap.';
