-- REPLYING TO A LEARNER'S BUG REPORT, IN THE APP
-- ==============================================
--
-- Tom's ruling, 2026-09-16 22:49Z: "send a reply in the app". A learner who
-- takes the trouble to write a careful report should hear back inside the app
-- she wrote it from, not nowhere.
--
-- WHAT THIS IS NOT. It is NOT a new reply column on bug_reports carrying words
-- the player would have to learn to read. The in-app message primitive already
-- exists and is already in production: public.user_messages, the Library notice
-- card and /me/inbox (job #684), fanned out by admin_messages (job #821). A
-- reply to a bug report is exactly an admin message to one learner, so it is
-- sent as one and nothing new has to reach a learner's phone for her to read it.
--
-- WHAT THIS ADDS is the missing LINK, so a report knows it has been answered
-- and nobody answers it twice: the inbox row the reply went out as, when, and
-- who sent it. bug_reports stays what it was declared to be — a postbox with
-- RLS on and no policies, service-role only — so these columns need no policy
-- and no grant: they are read and written by the service key alone.
--
-- APPLIED 2026-09-16 by job #28 through the postgres role: three additive
-- columns on a service-role-only table, no policy, no grant, no data touched.

BEGIN;

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS reply_message_id uuid REFERENCES public.user_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replied_at       timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by       text;

COMMENT ON COLUMN public.bug_reports.reply_message_id IS
  'The user_messages row the reply went out as, or null if nobody has replied. The words the learner reads live on that row, never here: bug_reports is still a postbox and the player never reads it.';
COMMENT ON COLUMN public.bug_reports.replied_at IS
  'When the reply was sent. Null means unanswered; the reply tool refuses to answer an answered report unless told to resend.';
COMMENT ON COLUMN public.bug_reports.replied_by IS
  'Auth uid of whoever sent the reply — the sender_user_id on the admin_messages broadcast.';

COMMIT;
