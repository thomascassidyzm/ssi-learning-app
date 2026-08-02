-- Tutor rebate ledger — per-student-month line items (founder model 2026-08-02:
-- "£5 per completed student-month flows back to the tutor, paid 30 days AFTER
-- the completed month").
--
-- teacher_commissions stays the AGGREGATE (one row per teacher × calendar
-- month) that the payout cron releases; this table is the line-item ledger
-- underneath it so a tutor's statement can show WHICH student-months earned
-- what. Written by the Paddle webhook alongside each aggregate accrual /
-- reversal; the app tolerates this table being absent (pre-migration), so the
-- migration can be applied whenever convenient.
--
-- Posture (CLAUDE.md RLS doctrine rule 7): service-role only. RLS on with no
-- policies + explicit revokes — the tutor reads their statement through
-- GET /api/teacher/commissions (service role, own-teacher scoped), never
-- directly via PostgREST.

CREATE TABLE IF NOT EXISTS tutor_rebate_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  learner_id uuid,
  learner_display text,
  class_id uuid,
  subscription_id uuid,
  -- Paddle transaction id (accruals) or adjustment id (reversals/re-accruals).
  provider_ref text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('accrual', 'reversal', 'reaccrual')),
  -- First day of the service month this line concerns.
  service_month date NOT NULL,
  -- Signed: +500 accrual/reaccrual, -500 reversal.
  amount_pence integer NOT NULL,
  -- Mirrors the aggregate hold: completed service month + 30 days.
  hold_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: one line per provider event per type (webhook retries after a
-- partial failure must not double-write a line).
CREATE UNIQUE INDEX IF NOT EXISTS tutor_rebate_ledger_provider_ref_type
  ON tutor_rebate_ledger (provider_ref, entry_type);

CREATE INDEX IF NOT EXISTS tutor_rebate_ledger_teacher_month
  ON tutor_rebate_ledger (teacher_id, service_month DESC);

ALTER TABLE tutor_rebate_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: deny-by-default for anon/authenticated; service role bypasses.
REVOKE ALL ON tutor_rebate_ledger FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
