-- THE 30-DAY GRACE (Tom, 2026-09-08), which supersedes #376·F D8 ("the
-- end-of-period window is the grace").
--
-- A family member's cover now runs to the end of the paid period PLUS 30 days,
-- per member. The cutoff is DERIVED, not stored a second time: the paid
-- period's end is already on the owner's row as scheduled_plan_at, and the
-- Paddle webhook now clears only scheduled_plan_NAME when it applies the
-- change, leaving the date behind as the record of when Family cover ended.
-- api/_utils/familyGrace.ts adds the 30 days, once, for the resolver, the API
-- responses, the app copy and the email alike.
--
-- COMMENTS ONLY. No column is added, no row is touched: the schema this
-- feature needs already exists and only its meaning has been sharpened.
COMMENT ON COLUMN public.subscriptions.scheduled_plan_name IS
  'The plan_name this row flips to at scheduled_plan_at (null: nothing pending). Written by api/subscription/change-plan; cleared by the Paddle webhook when the change is applied. This column ALONE says whether a change is pending.';
COMMENT ON COLUMN public.subscriptions.scheduled_plan_at IS
  'When the paid SSi Family period ends — the current_period_end at the time the owner confirmed the change to Premium. NOT cleared when the change is applied: after the flip it is the record of when Family cover ended, and family members keep full access until 30 days after it (api/_utils/familyGrace.ts).';

NOTIFY pgrst, 'reload schema';
