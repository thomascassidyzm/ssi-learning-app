-- Held-commission model: a tutor-student commission accrues HELD and only
-- becomes payable once the 30-day refund window has elapsed.
--
-- ADDITIVE + live-safe:
--   * hold_until is nullable and defaults to NULL, so existing inserts that
--     don't yet set it keep working.
--   * The payout cron and the dashboard treat a NULL hold_until (or a missing
--     column, pre-deploy) as "not yet released" and will NOT pay it early.
--   * We backfill existing 'accruing' rows to period_end + 30 days so earned
--     commission from the old monthly model is not stranded forever; the +30d
--     keeps a refund cushion on those legacy rows too.

-- NOTE: the companion migration 20260630_commission_hold_and_reversal.sql (the
-- webhook lane, the money authority) also adds hold_until and declares it
-- `timestamp with time zone`. Keep the type IDENTICAL here so whichever migration
-- the human applies first wins a consistent type and the other's IF NOT EXISTS
-- is a clean no-op. The payout cron / dashboard compare it against a 'YYYY-MM-DD'
-- string, which works for timestamptz via implicit cast.
ALTER TABLE public.teacher_commissions
  ADD COLUMN IF NOT EXISTS hold_until timestamp with time zone;

COMMENT ON COLUMN public.teacher_commissions.hold_until IS
  'Refund-window release date for this commission (paid_at + 30 days at accrual time). A row is only RELEASED — eligible for a Wise payout — once hold_until <= current_date. NULL = not yet released (fail-safe: never paid early).';

-- Un-strand legacy accruing rows: release 30 days after their period closed.
UPDATE public.teacher_commissions
   SET hold_until = period_end + INTERVAL '30 days'
 WHERE status = 'accruing'
   AND hold_until IS NULL;

-- Help the cron's "released, past window" scan. The cron releases rows in BOTH
-- 'held' (new webhook accruals) and 'accruing' (legacy/backfilled) states, so the
-- partial index must cover both.
CREATE INDEX IF NOT EXISTS idx_teacher_commissions_hold_until
  ON public.teacher_commissions (status, hold_until)
  WHERE status IN ('held', 'accruing');

NOTIFY pgrst, 'reload schema';
