-- 20260914e_user_messages — the in-app message inbox primitive (job #684)
-- =====================================================================
--
-- WHY
-- ---
-- Tom, 2026-09-14 (RBF): "we DO want to be able to send them in-app messages
-- about stuff like this." ONE message primitive per user: a source, a REAL
-- read state, and an optional one-tap action. Not a per-surface strip. The
-- first specimen is the teacher-play copy notice with one-tap undo (source
-- class_play_copied, action undo_class_play_copy); Schools Support replies
-- become one source into the same inbox (source support_reply) so the
-- avatar menu's Support link stops being a second inbox.
--
-- THE POLICY LINE (Tom's, not the brief's): "the bar for sending a learner
-- anything is whether it changes what they would do, or the inbox becomes
-- the tab nobody opens."
--
-- READ STATE IS REAL. "Delivered is not seen." read_at is stamped when the
-- person TAPS the message (POST /api/messages/read), or opens the content the
-- message points at (the Support thread), never because it was listed.
-- dismissed_at is the learner Library card's Dismiss only: a dismissed message
-- stays in the inbox and stays unread until tapped. action_taken_at is stamped
-- once by POST /api/messages/act and refuses a second run.
--
-- IDENTITY. recipient_user_id is the auth uid (learners.user_id, text) — the
-- CLAUDE.md canonical `column = auth.uid()::text` pattern, chosen over the
-- learner PK because every schools role and every learner has exactly one
-- auth uid, and the senders (the copy audit's actor, a support thread's admins,
-- a teacher resolved through learners.user_id) already hold it.
--
-- POSTURE (RLS doctrine rule 7, declared at creation; dev, staging and
-- production share this database so this is ADDITIVE ONLY):
--   RLS on. Own-row SELECT for authenticated. Own-row UPDATE for authenticated
--   restricted by column grant to read_at and dismissed_at only. No INSERT, no
--   DELETE for anon/authenticated: senders are service-role only
--   (api/_utils/userMessages.ts sendUserMessage). Every write the app makes
--   today goes through the server anyway; the client policies are the safety
--   floor, not the path.
--
-- SUPPORT AS A SOURCE — THE TRIGGER. A reply on a school's support thread is a
-- support_messages row with direction = 'out', written by the watcher on
-- watson-1 (command-surface tools/support/reply.cjs) with the service key —
-- never by this app's API. The single point at which the reply is KNOWN to
-- have landed is therefore the database itself, so the fan-out to the thread's
-- admins is an AFTER INSERT trigger here: instant (the menu badge used to be an
-- instant ?peek=1 and must not regress to an hourly cron), and independent of
-- which script wrote the row. Recipients mirror api/_utils/schoolScope.ts's two
-- admin spellings for a school thread (an active role_in_context = 'admin'
-- school tag, or schools.admin_user_id) and govt_admins.group_id for a group
-- thread. The trigger NEVER fails the reply insert: its body is wrapped so a
-- fan-out error is logged as a WARNING and the reply still lands. Dedupe key
-- support_reply:<message_id>:<recipient> keeps it idempotent per recipient.
--
-- APPLIED 2026-09-14 by job #684 through the postgres role. Do not re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_messages (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id  text NOT NULL,
    source             text NOT NULL CHECK (source IN ('support_reply', 'class_play_copied')),
    title              text NOT NULL,
    body               text NOT NULL,
    -- { kind, label, payload }. Kinds so far: undo_class_play_copy {audit_id, class_id}; open_support {thread_id, message_id}.
    action             jsonb,
    action_taken_at    timestamptz,
    read_at            timestamptz,
    dismissed_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    dedupe_key         text UNIQUE
);

COMMENT ON TABLE public.user_messages IS
  'The in-app message inbox: one row per message per recipient (auth uid). source names who sent it; read_at is stamped only when the person taps the message or opens what it points at, never on delivery; dismissed_at is the learner Library card only; action_taken_at is stamped once by POST /api/messages/act. Inserts are service-role only through api/_utils/userMessages.ts sendUserMessage, or the support_reply trigger below. Job #684, 2026-09-14.';
COMMENT ON COLUMN public.user_messages.recipient_user_id IS 'auth uid (learners.user_id). Own-row RLS via auth.uid()::text.';
COMMENT ON COLUMN public.user_messages.dedupe_key IS 'Sender-supplied idempotency key, e.g. class_play_copied:<audit_id> or support_reply:<message_id>:<recipient>. A repeat send with the same key is a no-op.';

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_unread
  ON public.user_messages (recipient_user_id, read_at, created_at DESC);

ALTER TABLE public.user_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_messages_own_select ON public.user_messages;
CREATE POLICY user_messages_own_select ON public.user_messages
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid()::text);

DROP POLICY IF EXISTS user_messages_own_update ON public.user_messages;
CREATE POLICY user_messages_own_update ON public.user_messages
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid()::text)
  WITH CHECK (recipient_user_id = auth.uid()::text);

REVOKE ALL ON TABLE public.user_messages FROM anon;
REVOKE ALL ON TABLE public.user_messages FROM authenticated;
GRANT SELECT ON TABLE public.user_messages TO authenticated;
GRANT UPDATE (read_at, dismissed_at) ON TABLE public.user_messages TO authenticated;
GRANT ALL ON TABLE public.user_messages TO service_role;

-- ── Support replies fan out to the thread's admins ──────────────────────────

CREATE OR REPLACE FUNCTION public.user_messages_from_support_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t          public.support_threads%ROWTYPE;
  rcpt       text;
  v_title    text;
  v_body     text;
  v_label    text;
BEGIN
  IF NEW.direction <> 'out' THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO t FROM public.support_threads WHERE id = NEW.thread_id;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    IF t.language = 'cym' THEN
      v_title := 'Ateb ar sgwrs Gymorth eich ysgol';
      v_label := 'Agor Cymorth';
    ELSE
      v_title := 'A reply on your school''s Support thread';
      v_label := 'Open Support';
    END IF;
    v_body := left(NEW.body, 280);
    IF length(NEW.body) > 280 THEN
      v_body := v_body || '…';
    END IF;

    FOR rcpt IN
      SELECT DISTINCT u FROM (
        SELECT ut.user_id AS u
          FROM public.user_tags ut
         WHERE t.school_id IS NOT NULL
           AND ut.tag_type = 'school'
           AND ut.tag_value = 'SCHOOL:' || t.school_id::text
           AND ut.role_in_context = 'admin'
           AND ut.removed_at IS NULL
        UNION
        SELECT s.admin_user_id
          FROM public.schools s
         WHERE t.school_id IS NOT NULL
           AND s.id = t.school_id
           AND s.admin_user_id IS NOT NULL
        UNION
        SELECT g.user_id
          FROM public.govt_admins g
         WHERE t.group_id IS NOT NULL
           AND g.group_id = t.group_id
      ) r
      WHERE u IS NOT NULL AND u <> ''
    LOOP
      INSERT INTO public.user_messages (recipient_user_id, source, title, body, action, dedupe_key)
      VALUES (
        rcpt,
        'support_reply',
        v_title,
        v_body,
        jsonb_build_object(
          'kind', 'open_support',
          'label', v_label,
          'payload', jsonb_build_object('thread_id', NEW.thread_id, 'message_id', NEW.id)
        ),
        'support_reply:' || NEW.id::text || ':' || rcpt
      )
      ON CONFLICT (dedupe_key) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'user_messages_from_support_reply: % (reply % not fanned out)', SQLERRM, NEW.id;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_messages_from_support_reply() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_user_messages_from_support_reply ON public.support_messages;
CREATE TRIGGER trg_user_messages_from_support_reply
  AFTER INSERT ON public.support_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.user_messages_from_support_reply();

NOTIFY pgrst, 'reload schema';

COMMIT;
