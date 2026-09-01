-- 20260901_content_edit_identity.sql
-- Editor identity on save (Tom's ruling, 2026-09-01).
--
-- WHY: the seed editor recorded nothing about WHO made an edit. Shuchita
-- proofread 423 eng_for_hin seeds in August 2026 and the system holds no record
-- that it was her — not in the save path, not in an audit log. That is tolerable
-- while every editor is a trusted colleague and intolerable the moment community
-- members edit their own courses through Popty.
--
-- SHAPE:
--   1. content_edit_events — append-only audit log, ONE ROW PER SAVE OPERATION
--      (not per content row: a 400-phrase decomposition is one event). The actor
--      columns are NOT NULL with non-blank CHECKs, so an event cannot physically
--      exist without an identity attached. This is the DB-level teeth.
--   2. last_edit_event_id on the three content tables — FK to the event that last
--      wrote the row. Stamped by the same choke point, riding along in the update
--      /insert payload the route was already sending, so it costs no extra write.
--      NULLABLE ON PURPOSE, and NULL has exactly one honest meaning: "no
--      attribution was captured for this row". It is NOT backfilled and never
--      will be — inventing per-row attribution for pre-existing edits would be
--      worse than the gap it papers over (Tom's ruling, point 3).
--
-- WHY NOT NOT-NULL ON THE CONTENT TABLES: legacy rows are unattributed and must
-- stay that way, and a NOT VALID CHECK would still fire on UPDATE and break every
-- writer not yet routed through the choke point (pipeline services, phase8, the
-- tools/ sweeps). The follow-up constraint lives in
-- 20260901_content_edit_identity_ENFORCE.sql, unapplied, to be run once a census
-- shows every writer stamps.
--
-- Additive only. No existing column, constraint, index or row is touched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.content_edit_events (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   timestamptz NOT NULL DEFAULT now(),

    course_code   text NOT NULL,
    surface       text NOT NULL,      -- e.g. 'course-builder:POST /course/:courseCode/edit-cascade'
    operation     text NOT NULL,      -- insert | update | delete | approve | flag | ...

    -- WHO. None of these can be null and none can be blank.
    actor_kind    text NOT NULL CHECK (actor_kind IN ('human', 'agent', 'service')),
    actor_id      text NOT NULL CHECK (btrim(actor_id) <> ''),
    actor_label   text NOT NULL CHECK (btrim(actor_label) <> ''),
    actor_verified boolean NOT NULL,
    actor_role    text,

    -- WHAT
    scope         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {seed_numbers, lego_ids, phrase_ids, rows}
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- before/after for small edits
    request_id    text
);

COMMENT ON TABLE public.content_edit_events IS
  'Append-only "who edited this course content" log, one row per save OPERATION. Written by services/shared/content-edit-log.cjs, which refuses to write without a resolved editor identity. Rows are never updated or deleted.';
COMMENT ON COLUMN public.content_edit_events.actor_kind IS
  'human = a Supabase-authenticated person; agent = a build/QA agent on loopback; service = a named pipeline or tools/ script.';
COMMENT ON COLUMN public.content_edit_events.actor_verified IS
  'TRUE only when the identity was derived from a Supabase JWT this service verified itself. FALSE means the caller ASSERTED an identity over trusted loopback (agents, service mesh) and it was taken on trust. Never read a FALSE as a verified person.';
COMMENT ON COLUMN public.content_edit_events.actor_id IS
  'Supabase auth user id for humans; agent pid/label for agents; script or service name for services. Stable machine key.';
COMMENT ON COLUMN public.content_edit_events.surface IS
  'Which editing surface wrote this — service and route template, so a surface that stops stamping is findable by absence.';

CREATE INDEX IF NOT EXISTS content_edit_events_course_time_idx
    ON public.content_edit_events (course_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS content_edit_events_actor_idx
    ON public.content_edit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS content_edit_events_scope_gin
    ON public.content_edit_events USING gin (scope jsonb_path_ops);

ALTER TABLE public.content_edit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'content_edit_events'
                   AND policyname = 'Service role can manage content_edit_events') THEN
    CREATE POLICY "Service role can manage content_edit_events"
      ON public.content_edit_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'content_edit_events'
                   AND policyname = 'Authenticated users can view content_edit_events') THEN
    CREATE POLICY "Authenticated users can view content_edit_events"
      ON public.content_edit_events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ─── Row-level pointer on the three content tables ────────────────────────

ALTER TABLE public.course_seeds
    ADD COLUMN IF NOT EXISTS last_edit_event_id uuid
    REFERENCES public.content_edit_events(id) ON DELETE SET NULL;
ALTER TABLE public.course_legos
    ADD COLUMN IF NOT EXISTS last_edit_event_id uuid
    REFERENCES public.content_edit_events(id) ON DELETE SET NULL;
ALTER TABLE public.course_practice_phrases
    ADD COLUMN IF NOT EXISTS last_edit_event_id uuid
    REFERENCES public.content_edit_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.course_seeds.last_edit_event_id IS
  'The content_edit_events row for the save that last wrote this seed. NULL means NO ATTRIBUTION WAS CAPTURED — it is never a claim about who edited it. Deliberately not backfilled: the 423 eng_for_hin seeds proofread in August 2026 are bounded by their edit dates to Kai''s team, and that inference belongs in a document, not in this column.';
COMMENT ON COLUMN public.course_legos.last_edit_event_id IS
  'The content_edit_events row for the save that last wrote this LEGO. NULL means no attribution was captured, never a claim about who edited it.';
COMMENT ON COLUMN public.course_practice_phrases.last_edit_event_id IS
  'The content_edit_events row for the save that last wrote this phrase. NULL means no attribution was captured, never a claim about who edited it.';

-- No index on last_edit_event_id: the reverse lookup ("which rows did this event
-- touch") is already answered by content_edit_events.scope, and building even a
-- partial index over the 1.6 GB course_practice_phrases would take a write lock
-- on a live table to serve a query nobody runs.

COMMIT;
