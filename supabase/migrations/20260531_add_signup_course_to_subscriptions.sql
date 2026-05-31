-- Marketing attribution: capture the course a user was unlocking when they
-- converted to paid (the paywall course they hit at checkout). Written once at
-- subscription creation from Paddle customData.course (see
-- api/teacher/paddle-webhook.ts handlePremiumSubscription); the webhook only
-- writes it when present, so renewals/cancellations never overwrite it.
--
-- Nullable: existing subscriptions (which predate the capture) stay NULL.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS signup_course_code text;

COMMENT ON COLUMN subscriptions.signup_course_code IS
  'Course the user was unlocking when they subscribed (conversion attribution). Set from checkout customData.course; null for pre-capture subscriptions.';

NOTIFY pgrst, 'reload schema';
