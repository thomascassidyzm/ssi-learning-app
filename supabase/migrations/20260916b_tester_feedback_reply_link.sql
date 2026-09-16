-- THE SUPPORT INBOX SEES BOTH POSTBOXES
-- =====================================
--
-- Tom's addition, 2026-09-16 22:50Z: Tom, Kai and any ssi_admin must be able to
-- SEE every in-app report and reply from there. There are two postboxes, both
-- still live: public.bug_reports, which the player's "Report a bug" writes, and
-- public.tester_feedback, which the older tester panel mounted in App.vue
-- writes. The Support inbox reads both, so both need the same reply link that
-- 20260916_bug_report_replies.sql gave bug_reports.
--
-- The reply itself still goes out as a user_messages row — the inbox primitive
-- already in production — so nothing here carries words the player must read.
--
-- APPLIED 2026-09-16 by job #28 through the postgres role: three additive
-- columns, no policy, no grant, no data touched.

BEGIN;

ALTER TABLE public.tester_feedback
  ADD COLUMN IF NOT EXISTS reply_message_id uuid REFERENCES public.user_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replied_at       timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by       text;

COMMENT ON COLUMN public.tester_feedback.reply_message_id IS
  'The user_messages row the reply went out as, or null if nobody has replied. Same link as bug_reports; the words the learner reads live on that row.';
COMMENT ON COLUMN public.tester_feedback.replied_at IS
  'When the reply was sent. Null means unanswered, which is what sorts a row to the top of the admin Support inbox.';
COMMENT ON COLUMN public.tester_feedback.replied_by IS
  'Auth uid of whoever sent the reply.';

COMMIT;
