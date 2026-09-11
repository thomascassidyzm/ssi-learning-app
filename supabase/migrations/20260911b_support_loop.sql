-- THE SUPPORT LOOP: point, answer, escalate — and every exchange feeds the Handbook
-- ==============================================================================
--
-- Tom, 2026-09-11: "this is the whole in-app support channel — which can either point to
-- answers, or answer, or escalate. Each time capturing the question and answer in the
-- searchable handbook page, with a new clip commissioned if it is a useful thing - probably
-- after 3+ people mention it."
--
-- Built by command-surface job #220 on top of 20260911_support_channel.sql. Four additions:
--
--   1. support_messages gains the RECORD of the loop's two decisions — which of the three
--      moves the sentinel made and why, and which model tier answered with every ladder rung
--      and its trigger — so "why did SSi point?" and "why did this cost a Fable call?" are
--      answerable from the row months later (spec §4, fourth principle, applied to money).
--   2. support_signals gains `askers`: the distinct people who hit a signal. ONE table, TWO
--      questions — population() still counts OTHER schools for the defect test; the clip
--      threshold counts PEOPLE, because Tom said "3+ people".
--   3. support_handbook_precedents — THE ACCRETION LAYER. Beside the compiled pack, never
--      inside it: spec §15's reason (a second corpus becomes the thing the agent quotes) is
--      honoured by keeping mechanics in the compiled pack only, and offering these as "this
--      was asked before, and here is what we said, on that date". A row is written only when
--      an answer was ACTUALLY SENT — Tom's word, or SSi's reply in autonomous mode.
--   4. support_settings — the clip threshold as a ROW, visible and adjustable
--      (node tools/support/gaps.cjs --set-threshold N), never a constant in a file.
--
-- The watcher DEGRADES GRACEFULLY without this migration: it records without the new columns,
-- counts schools instead of people, keeps the accretion layer off and reads the threshold
-- from the environment — each with one log line saying so.
--
-- UNAPPLIED. Never run against the shared project by a worker; dev, staging and production
-- share ONE Supabase project. Apply by hand, canary style, then ./supabase/snapshot-schema.sh.

BEGIN;

-- ── 1. The record of the move and the model tier ────────────────────────────

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS move          text CHECK (move IS NULL OR move IN ('point', 'answer', 'escalate')),
  ADD COLUMN IF NOT EXISTS move_reason   text,
  ADD COLUMN IF NOT EXISTS model_tier    text CHECK (model_tier IS NULL OR model_tier IN ('sonnet', 'opus', 'fable')),
  ADD COLUMN IF NOT EXISTS model_ladder  jsonb;

COMMENT ON COLUMN public.support_messages.move IS
  'Which of the three moves the sentinel made on an in row (point / answer / escalate), decided by explicit recorded rules, never by a model.';
COMMENT ON COLUMN public.support_messages.move_reason IS
  'The condition that decided the move, in words — e.g. "single how-to; confident hit teacher-remove (score 100) with 3 steps".';
COMMENT ON COLUMN public.support_messages.model_tier IS
  'The tier that composed the reply (null for a point, which costs no model call). On an out row: who wrote it.';
COMMENT ON COLUMN public.support_messages.model_ladder IS
  '{start, ceiling, rungs:[{from,to,trigger,evidence}], blocked?, admin_said_no?} — every climb with its mechanical trigger. Answers "why did this cost a Fable call?".';

-- ── 2. People, not just schools, on the counter ────────────────────────────

ALTER TABLE public.support_signals
  ADD COLUMN IF NOT EXISTS askers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.support_signals.askers IS
  'Distinct auth uids who raised this signal at this school. The clip threshold counts people across schools; population() still counts other schools.';

-- ── 3. The accretion layer ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_handbook_precedents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Handbook anchor the question was asked against, when there was one.
  anchor             text,
  -- The handbook-gap topic slug, when the pack had nothing (the clip list's key).
  topic              text,
  question           text NOT NULL,
  answer             text NOT NULL,
  -- author-stamp vocabulary again: 'human' = Tom's own words; 'agent' = SSi's reply,
  -- approved by Tom in draft-only mode or sent by the watcher in autonomous mode.
  answered_by        text NOT NULL CHECK (answered_by IN ('human', 'agent')),
  answered_by_name   text,
  school_id          uuid,
  asked_by_user_id   text,
  message_id         uuid REFERENCES public.support_messages(id) ON DELETE SET NULL,
  answer_message_id  uuid REFERENCES public.support_messages(id) ON DELETE SET NULL,
  model_tier         text,
  move               text,
  language           text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_handbook_precedents_anchor ON public.support_handbook_precedents (anchor, created_at DESC);
CREATE INDEX IF NOT EXISTS support_handbook_precedents_topic  ON public.support_handbook_precedents (topic, created_at DESC);

COMMENT ON TABLE public.support_handbook_precedents IS
  'Answered question-and-answer pairs, attributed and dated, BESIDE the compiled Handbook pack and never inside it. Context and precedent for the agent; never the authority on where a button is.';

-- ── 4. The threshold as a row ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.support_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);

INSERT INTO public.support_settings (key, value, updated_by)
  VALUES ('clip_threshold', '3'::jsonb, 'migration 20260911b — Tom''s "probably after 3+ people"')
  ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.support_settings IS
  'The support loop''s tunables. clip_threshold: how many distinct people must hit a handbook gap before it is on the clip list.';

-- ── Posture (RLS doctrine rule 7, declared at creation) ────────────────────
-- Both new tables: RLS on, zero policies, zero grants — SERVICE ROLE ONLY. The precedents
-- carry another school's question verbatim, which is a §10 leak if read cross-school; the
-- Handbook page will read them through a server endpoint that returns anchor, question,
-- answer, who and when — and never the school — once Tom has said admins may see other
-- admins' questions at all.

ALTER TABLE public.support_handbook_precedents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_settings            ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_handbook_precedents FROM anon, authenticated;
REVOKE ALL ON public.support_settings            FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
