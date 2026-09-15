-- 20260915b_admin_messages_and_learner_threads — admin-to-learner messaging (job #821)
-- ===================================================================================
--
-- WHY. Tom, 2026-09-15 12:18Z: "reaching out to learners with the ability to let
-- them know about new features, other things that have gone live, new PODS and
-- so on… by course… once they message support then the channel becomes live".
--
-- THREE ADDITIVE PIECES, nothing moved or dropped:
--
-- 1. admin_messages — ONE row per broadcast: who sent it, to which audience
--    (one learner / one course / everyone), the title and body, and how many
--    inbox rows it fanned out to. Its id is minted by the composer BEFORE the
--    preview, so a retried send upserts the same broadcast and every
--    per-recipient user_messages row carries dedupe_key
--    admin_message:<broadcast id>:<recipient> — a retry never double-sends.
--    Service-role only; the composer is api/admin/messages/*.
--
-- 2. user_messages.source gains 'admin_message'. The learner reads it in the
--    inbox they already have (/me/inbox). No push, no email, no nagging count
--    beyond the quiet unread dot the inbox already draws (Tom's standing rule:
--    dog energy, never dentist energy).
--
-- 3. A learner's REPLY makes the channel live. support_threads gains a third
--    owner kind: learner_user_id (auth uid) + origin_message_id (the
--    user_messages row replied to) — ONE thread per learner-message pair, and
--    the one-owner check now says exactly one of school / group / learner. The
--    reply is an ordinary support_messages 'in' row, so it lands in the
--    support_inbox view and the watson-1 watcher cards it to Tom exactly as a
--    school admin's question is carded; his reply (tools/support/reply.cjs)
--    is an 'out' row, and the fan-out trigger below now knows a learner thread:
--    instead of minting a new inbox row it clears read_at on the ORIGIN message
--    so the learner's own inbox shows that message unread again, with the
--    reply inside it. One row per learner-message pair on both tables.
--
-- APPLIED 2026-09-15 by job #821 through the postgres role. Do not re-apply.

BEGIN;

-- ── 1. The broadcast record ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_messages (
    id               uuid PRIMARY KEY,
    sender_user_id   text NOT NULL,
    audience_kind    text NOT NULL CHECK (audience_kind IN ('one', 'course', 'all')),
    course_code      text,
    target_user_id   text,
    title            text NOT NULL,
    body             text NOT NULL,
    recipient_count  integer NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    sent_at          timestamptz
);

COMMENT ON TABLE public.admin_messages IS
  'One row per admin-to-learner broadcast (job #821). The id is minted by the composer before preview, so a retried send is idempotent: user_messages rows carry dedupe_key admin_message:<id>:<recipient>. Service-role only.';

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_messages FROM anon;
REVOKE ALL ON TABLE public.admin_messages FROM authenticated;
GRANT ALL ON TABLE public.admin_messages TO service_role;

-- ── 2. The inbox source ─────────────────────────────────────────────────────

ALTER TABLE public.user_messages DROP CONSTRAINT IF EXISTS user_messages_source_check;
ALTER TABLE public.user_messages ADD CONSTRAINT user_messages_source_check
  CHECK (source IN ('support_reply', 'class_play_copied', 'admin_message'));

-- ── 3. Learner-owned support threads ────────────────────────────────────────

ALTER TABLE public.support_threads ADD COLUMN IF NOT EXISTS learner_user_id   text;
ALTER TABLE public.support_threads ADD COLUMN IF NOT EXISTS origin_message_id uuid REFERENCES public.user_messages(id) ON DELETE CASCADE;

ALTER TABLE public.support_threads DROP CONSTRAINT IF EXISTS support_threads_one_owner;
ALTER TABLE public.support_threads ADD CONSTRAINT support_threads_one_owner CHECK (
     (school_id IS NOT NULL AND group_id IS NULL AND learner_user_id IS NULL)
  OR (school_id IS NULL AND group_id IS NOT NULL AND learner_user_id IS NULL)
  OR (school_id IS NULL AND group_id IS NULL AND learner_user_id IS NOT NULL AND origin_message_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS support_threads_learner_message_uniq
  ON public.support_threads (learner_user_id, origin_message_id) WHERE learner_user_id IS NOT NULL;

COMMENT ON COLUMN public.support_threads.learner_user_id IS
  'Third owner kind (job #821): a learner''s reply to an admin message. auth uid. One thread per (learner, origin_message_id).';
COMMENT ON COLUMN public.support_threads.origin_message_id IS
  'The user_messages row (source admin_message) this learner thread answers. Set only with learner_user_id.';

-- ── The fan-out trigger learns the learner thread ───────────────────────────

CREATE OR REPLACE FUNCTION public.user_messages_from_support_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

    -- A learner thread (job #821): the reply lives inside the origin message,
    -- so make that message unread again rather than minting a second row.
    IF t.learner_user_id IS NOT NULL THEN
      UPDATE public.user_messages
         SET read_at = NULL
       WHERE id = t.origin_message_id
         AND recipient_user_id = t.learner_user_id;
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

ALTER FUNCTION public.user_messages_from_support_reply() SET search_path TO 'public', 'pg_temp';
REVOKE ALL ON FUNCTION public.user_messages_from_support_reply() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
