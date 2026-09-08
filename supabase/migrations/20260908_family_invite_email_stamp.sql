-- SSi Family: record that the invite email went, and when.
--
-- On 2026-09-07 an invited adult's row read "Invited" and nothing else, while
-- Resend had delivered the mail within a second. The owner had no way to see
-- that from the app, and no way to send it again. Two nullable columns, stamped
-- by api/family/invite.ts on every send, read back by GET /api/family so the
-- family screen can say "we emailed them at 23:52" and offer a resend.
--
-- Additive and nullable: dev, staging and production share this database, and
-- code that predates these columns neither reads nor writes them.
ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS invite_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_email_id text;

COMMENT ON COLUMN public.family_members.invite_emailed_at IS
  'When the family invite email was last handed to Resend (null: never sent, or a child seat).';
COMMENT ON COLUMN public.family_members.invite_email_id IS
  'Resend message id of the last invite email — the join key to its delivery events.';

NOTIFY pgrst, 'reload schema';
