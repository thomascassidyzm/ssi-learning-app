-- THE SUPPORT CHANNEL: a school talks to us inside the app
-- =========================================================
--
-- The transport is the database (Tom's ruling, 2026-09-10): "we can simply
-- use DB writing as a question — it comes straight here, and we can reply
-- straight to her as a DB row response". A question is a row a school admin
-- writes through the app's authenticated server; an answer is a row written
-- back by a service-key holder on watson-1. No bus, no socket, no relay, no
-- reply-in endpoint. Turn-taking IS the row shape: `direction`, `in_reply_to`,
-- and `answered_at` marks a turn as taken.
--
-- ADMINS ONLY (Tom, 2026-09-10 21:55Z): "the in-app support channel for admins
-- only - not individual teachers". A thread belongs to a SCHOOL (school admin)
-- or to an ORG (a group leader / govt_admin) — exactly one of the two keys is
-- set. The relationship carries NO state: no status, no priority, no SLA
-- (spec §11). State lives on the message.
--
-- WHY NOT tester_feedback: decided in spec §12 — it has no notion of a reply,
-- a thread, a school or a language, and its own widget hides itself on
-- /schools. Its column list is the specification for `envelope` and that is
-- the reuse that matters.
--
-- POSTURE (RLS doctrine rule 7, declared at creation):
--   support_threads / support_messages — RLS on; SELECT for the school's own
--     admins (is_school_admin_of) or the org's own leader
--     (is_govt_admin_over_group); NO write policy for anyone — every write goes
--     through a server endpoint (her side) or the service key (our side).
--     "Is this my row?" only; hierarchy authz lives in api/support/*.
--   support_signals — RLS on, no policies at all: service-role only. The one
--     read a school may make of it is the integer-only count endpoint.
--
-- UNAPPLIED. Never run against the shared project by a worker; dev, staging
-- and production share ONE Supabase project. Apply by hand, canary style.

BEGIN;

-- ── One thread per school (or per org), forever ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES public.groups(id)  ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  -- When someone from the school last OPENED the thread. Read by the unread
  -- dot and by the email doorbell (a reply unopened after a few hours). It is
  -- the only "seen" state and it lives here, not on messages.
  last_read_at     timestamptz,
  -- The language she wrote in most recently ('eng' / 'cym'); the agent answers
  -- in it and the doorbell email is worded in it.
  language         text,
  -- The things it would be rude to ask twice (spec §11). Written by the agent,
  -- visible to the school, correctable by them. Never numbers — those are
  -- fetched fresh on every message.
  standing_notes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT support_threads_one_owner CHECK (
    (school_id IS NOT NULL AND group_id IS NULL) OR (school_id IS NULL AND group_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS support_threads_school_uniq ON public.support_threads (school_id) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS support_threads_group_uniq  ON public.support_threads (group_id)  WHERE group_id  IS NOT NULL;

COMMENT ON TABLE public.support_threads IS
  'One support thread per school or per org, never closed. No status, no priority: state lives on support_messages.';

-- ── The exchange, turn by turn ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id             uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  body                  text NOT NULL,
  -- 'in'  = from the school to us; 'out' = from us to the school.
  direction             text NOT NULL CHECK (direction IN ('in', 'out')),
  -- author-stamp.js vocabulary (command-surface), deliberately: a thread that
  -- carries Tom's words and an agent's says which is which from the stamp,
  -- never from the prose. human · agent · worker · surface · unknown.
  author_source         text NOT NULL CHECK (author_source IN ('human', 'agent', 'worker', 'surface', 'unknown')),
  author_name           text,
  -- How the identity arrived: 'jwt' for a school admin through the app's
  -- server, 'login-header' for Tom's word through the surface, 'service-key'
  -- for the agent's own reply.
  author_via            text,
  -- The auth uid of the person who wrote an 'in' row; null for our side.
  author_user_id        text,
  -- The turn this row answers. An 'out' row answering an 'in' row points at it.
  in_reply_to           uuid REFERENCES public.support_messages(id) ON DELETE SET NULL,
  -- What the server knew the moment she pressed Send (spec §3): her resolved
  -- scope, the tile she tapped, the value it displayed AND the value the
  -- server computes underneath it. Assembled server-side, never from the
  -- client's claims about who she is.
  envelope              jsonb,
  -- 'tile-contradiction:<anchor>' / 'audio-failure:<device>;<build>' /
  -- 'handbook-gap:<anchor-or-topic>'. Everything else: null, no count, honest.
  signal_key            text,
  -- Escalation is a MATCHED TEST, never a judgement: which of the five fired,
  -- and on what (channel-ask.js's `evidence`, same reason — "why did this
  -- file?" is answerable months later from the row).
  escalated_at          timestamptz,
  escalation_test       text,
  escalation_evidence   text,
  -- Set when Tom's word arrives (his row, or a hold). Until then the thread
  -- shows "Waiting on Tom since …".
  escalation_resolved_at timestamptz,
  -- The reply the agent drafted in Tom's name, carried on the needs-you card.
  -- `yes` writes it as his row verbatim; a typed sentence replaces it.
  draft_reply           text,
  -- The watcher selects on THIS: an 'in' row with answered_at IS NULL is a
  -- turn not yet taken. Set when the agent's reply row is written.
  answered_at           timestamptz,
  -- Tom's dropped clause (2026-09-10): every answer is evidence about the
  -- Handbook. Which anchors the reply quoted, and whether the pack had an
  -- entry at all. A miss mints handbook-gap:* on support_signals.
  handbook_anchors      text[],
  handbook_hit          boolean,
  -- The email doorbell: set once the "you have a reply" mail has gone, so it
  -- never goes twice.
  doorbell_sent_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_thread_created ON public.support_messages (thread_id, created_at);
-- The watcher's one query: unanswered questions, oldest first.
CREATE INDEX IF NOT EXISTS support_messages_unanswered ON public.support_messages (created_at) WHERE direction = 'in' AND answered_at IS NULL;

COMMENT ON TABLE public.support_messages IS
  'A turn in a school''s support thread. direction in/out; author_* is the author-stamp vocabulary; answered_at is what the watcher selects on.';

-- ── The count: which schools carry the same signal ──────────────────────────

CREATE TABLE IF NOT EXISTS public.support_signals (
  signal_key     text NOT NULL,
  school_id      uuid NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  seen_count     integer NOT NULL DEFAULT 1,
  PRIMARY KEY (signal_key, school_id)
);

COMMENT ON TABLE public.support_signals IS
  'Per (signal, school): the population count behind "nine other schools show this". Read as integers only, never as identities.';

-- ── Posture ─────────────────────────────────────────────────────────────────

ALTER TABLE public.support_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_signals  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.support_threads  FROM anon, authenticated;
REVOKE ALL ON public.support_messages FROM anon, authenticated;
REVOKE ALL ON public.support_signals  FROM anon, authenticated;

-- Own-school / own-org read. No INSERT/UPDATE/DELETE policy: writes are the
-- server's (her side, through api/support/messages) or the service key's (ours).
GRANT SELECT ON public.support_threads  TO authenticated;
GRANT SELECT ON public.support_messages TO authenticated;

DROP POLICY IF EXISTS support_threads_own_read ON public.support_threads;
CREATE POLICY support_threads_own_read ON public.support_threads
  FOR SELECT TO authenticated
  USING (
    (school_id IS NOT NULL AND public.is_school_admin_of(school_id))
    OR (group_id IS NOT NULL AND public.is_govt_admin_over_group(group_id))
  );

DROP POLICY IF EXISTS support_messages_own_read ON public.support_messages;
CREATE POLICY support_messages_own_read ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_threads t
      WHERE t.id = support_messages.thread_id
        AND (
          (t.school_id IS NOT NULL AND public.is_school_admin_of(t.school_id))
          OR (t.group_id IS NOT NULL AND public.is_govt_admin_over_group(t.group_id))
        )
    )
  );

-- support_signals: RLS on, zero policies, zero grants — service role only.

NOTIFY pgrst, 'reload schema';

COMMIT;
