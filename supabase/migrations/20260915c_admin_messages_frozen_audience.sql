-- 20260915c_admin_messages_frozen_audience — a retried send is truly idempotent (job #847)
-- ======================================================================================
--
-- WHY. A cold verifier of job #821 found that a retried send under the same
-- broadcast id recalculated the recipient list and accepted a changed title or
-- body while keeping the original broadcast row: a learner who made progress
-- between the first send and the retry got the message, and the inbox rows
-- could carry different words from the broadcast record.
--
-- FIX. The broadcast row freezes its audience at first send: recipient_user_ids
-- holds every auth uid the send resolved. A retry with the same id reads that
-- list back and writes the same rows again (the dedupe_key still makes each a
-- no-op where it already landed), and a retry whose title, body or audience
-- differ from the frozen row is refused with a clear error.
--
-- Additive, nullable: rows written before this column reads null and the send
-- falls back to re-resolving, exactly as before.
--
-- APPLIED 2026-09-15 by job #847 through the postgres role. Do not re-apply.

BEGIN;

ALTER TABLE public.admin_messages
  ADD COLUMN IF NOT EXISTS recipient_user_ids text[];

COMMENT ON COLUMN public.admin_messages.recipient_user_ids IS
  'The audience frozen at first send (auth uids). A retry reuses this list rather than resolving the audience again (job #847). Null on broadcasts sent before the column existed.';

COMMIT;

NOTIFY pgrst, 'reload schema';
