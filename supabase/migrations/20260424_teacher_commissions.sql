-- Teacher commissions ledger
--
-- Tracks monthly accrued commission per teacher. The Paddle webhook handler
-- upserts a row per (teacher_id, period_start) on each student `transaction.paid`
-- event, incrementing accrued_pence by the teacher's take for that transaction.
--
-- Phase 3e (monthly Wise payout cron) reads this table to drive payouts:
-- close out the previous period, transition status accruing → pending_payout
-- → paid, and store the wise_transfer_id for reconciliation.
--
-- Audit trail of which transactions contributed is intentionally not stored
-- here — Paddle's transaction list is the source of truth for that. If we
-- ever need richer audit, add a `commission_attributions` table later.

CREATE TABLE IF NOT EXISTS teacher_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

  -- Calendar month the commission belongs to
  period_start DATE NOT NULL,    -- first day of month, e.g. 2026-04-01
  period_end DATE NOT NULL,      -- last day of month, e.g. 2026-04-30

  -- Running total updated on each student transaction.paid
  accrued_pence INTEGER NOT NULL DEFAULT 0
    CHECK (accrued_pence >= 0),

  -- Payout state
  status TEXT NOT NULL DEFAULT 'accruing'
    CHECK (status IN ('accruing', 'pending_payout', 'paid', 'failed')),
  paid_at TIMESTAMPTZ,
  wise_transfer_id TEXT,
  failure_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (teacher_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_teacher_commissions_teacher
  ON teacher_commissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_commissions_status_period
  ON teacher_commissions(status, period_end);

DROP TRIGGER IF EXISTS update_teacher_commissions_updated_at ON teacher_commissions;
CREATE TRIGGER update_teacher_commissions_updated_at
  BEFORE UPDATE ON teacher_commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE teacher_commissions IS
  'Monthly commission accrual ledger. Webhook handler upserts per (teacher_id, period_start) on student transaction.paid. Phase 3e cron reads this for Wise payouts.';

COMMENT ON COLUMN teacher_commissions.accrued_pence IS
  'Sum of teacher takes for student subscriptions billed in this period. Teacher take = round(0.7833 * locked_price_pence - 140), where locked_price_pence is preserved on teacher_referrals at attribution time.';

COMMENT ON COLUMN teacher_commissions.status IS
  'accruing = period still open, more transactions may arrive. pending_payout = period closed, awaiting Wise transfer. paid = Wise transfer succeeded. failed = transfer failed and needs investigation (failure_reason filled).';

-- ============================================
-- ALSO: make teacher_referrals.subscription_id uniquely indexed so the Paddle
-- webhook can upsert idempotently on subscription.{created,updated,canceled}
-- events. Partial — NULL means "not yet linked to a subscription."
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_referrals_subscription_unique
  ON teacher_referrals(subscription_id) WHERE subscription_id IS NOT NULL;
