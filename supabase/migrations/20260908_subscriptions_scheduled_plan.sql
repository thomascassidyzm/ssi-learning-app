-- SSi Family → Premium downgrade: the end-of-period change is held by US, not
-- by Paddle (job #376·F, D2; built by #383·F).
--
-- Paddle's scheduled_change carries only cancel, pause and resume — it cannot
-- schedule a price change for the period end. So change-plan writes what the
-- plan becomes and when, moves Paddle's price at once with do_not_bill, and
-- the row keeps plan_name='SSi Family' until the renewal webhook sees a billing
-- period that starts on or after scheduled_plan_at. Every member is covered
-- for exactly what was paid; nobody loses something already bought.
--
-- Additive and nullable: dev, staging and production share this database, and
-- code that predates these columns neither reads nor writes them. Both null =
-- no change scheduled. "Keep Family" (D9) clears them.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS scheduled_plan_name text,
  ADD COLUMN IF NOT EXISTS scheduled_plan_at timestamptz;

COMMENT ON COLUMN public.subscriptions.scheduled_plan_name IS
  'The plan_name this row flips to at scheduled_plan_at (null: no change scheduled). Written by api/subscription/change-plan; applied and cleared by the Paddle webhook.';
COMMENT ON COLUMN public.subscriptions.scheduled_plan_at IS
  'When scheduled_plan_name takes effect — the current_period_end at the time the owner confirmed. Members stay covered until then.';

NOTIFY pgrst, 'reload schema';
