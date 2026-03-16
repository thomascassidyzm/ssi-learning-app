-- Add verified_emails to learners for multi-email identity
-- Any email a user successfully verifies via OTP gets stored here.
-- On sign-in, if the auth user UUID doesn't match a learner but the email
-- appears in another learner's verified_emails, the accounts merge.

ALTER TABLE learners
ADD COLUMN IF NOT EXISTS verified_emails TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: seed verified_emails from auth.users.email for existing learners
UPDATE learners l
SET verified_emails = ARRAY[u.email]
FROM auth.users u
WHERE l.user_id = u.id::text
  AND u.email IS NOT NULL
  AND l.verified_emails = '{}';

-- Index for fast email lookup during sign-in
CREATE INDEX IF NOT EXISTS idx_learners_verified_emails
ON learners USING GIN (verified_emails);

-- RLS: allow a user to claim a learner record if their auth email is in verified_emails.
-- This enables the email-linking flow: user signs in with a secondary email,
-- and ensureLearnerExists() updates the learner's user_id to the new auth UUID.
CREATE POLICY "Users can claim learner by verified email"
  ON learners FOR UPDATE TO authenticated
  USING (
    verified_emails @> ARRAY[(SELECT email FROM auth.users WHERE id = auth.uid())]::text[]
  )
  WITH CHECK (
    verified_emails @> ARRAY[(SELECT email FROM auth.users WHERE id = auth.uid())]::text[]
  );

-- Also allow SELECT so the email lookup query works even without god mode
CREATE POLICY "Users can find learner by verified email"
  ON learners FOR SELECT TO authenticated
  USING (
    verified_emails @> ARRAY[(SELECT email FROM auth.users WHERE id = auth.uid())]::text[]
  );
