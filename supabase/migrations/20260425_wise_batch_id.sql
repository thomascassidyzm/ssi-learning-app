-- Wise batch group ID for monthly payout reconciliation
--
-- The monthly cron (api/cron/teacher-payouts) creates one Wise batch group per
-- run and drops every eligible commission's transfer into it. Storing the batch
-- group ID alongside the per-row wise_transfer_id lets us:
--
--   - Group all rows in a single payout run (audit / dashboard view)
--   - Cross-check against Wise dashboard's batch funding step
--   - Re-issue or query the whole batch if any single transfer fails
--
-- Index is partial (NOT NULL only) because the column is empty for accruing rows.

ALTER TABLE teacher_commissions ADD COLUMN IF NOT EXISTS wise_batch_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_teacher_commissions_wise_batch
  ON teacher_commissions(wise_batch_group_id)
  WHERE wise_batch_group_id IS NOT NULL;

COMMENT ON COLUMN teacher_commissions.wise_batch_group_id IS
  'Wise batch group ID for the monthly payout run that included this commission.';
