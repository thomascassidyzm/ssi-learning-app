-- 20260908_handbook_questions — the Handbook's ASK loop (job #386).
--
-- APPLIED LIVE 2026-09-08 inside a transaction with a posture canary
-- (tools/handbook/apply-handbook-questions.mjs), COMMIT only on green.
--
-- WHY
-- ---
-- The Handbook page answers what a school admin, head or teacher could not
-- work out. Until now nothing recorded what a reader wanted and could not
-- find, and nothing answered it back on the page. Tom, 2026-09-08: "with
-- asks captured in the DB and then answered on the page". A question is a
-- gap in the page; this table is where the gap is written down so it is
-- only ever asked once.
--
-- SHAPE — telemetry-shaped, following player_events, NOT tester_feedback
-- ------------------------------------------------------------------------
-- The browser never touches this table. One server route,
-- api/handbook-questions.ts, verifies the bearer token, stamps the asker's
-- auth uid into auth_user_id — named for the identity it holds, per the
-- repo's convention — and inserts with the service role. Own-row filtering
-- happens in that route, where it is tested; a platform admin answers
-- through the same route. Nothing identity-shaped is accepted from the
-- client.
--
-- ONE DATABASE serves dev, staging and production, so `env` is stamped
-- server-side from the request host, exactly as player_events does, and an
-- answerer can leave dev's questions alone.
--
-- POSTURE AT CREATION (RLS doctrine rule 7): RLS on, NO policies, anon and
-- authenticated revoked. Service role only. There is nothing for a browser
-- to read here directly and the route is the only door.

CREATE TABLE IF NOT EXISTS public.handbook_questions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- auth.uid()::text of the asker, stamped server-side. Never from the client.
  auth_user_id       text        NOT NULL,
  -- The school or group they belonged to when they asked. Text, not a foreign
  -- key: it is context for the answerer, never joined, and the node may be
  -- deleted long after the question was worth keeping.
  node_id            text,
  persona            text        NOT NULL,
  route              text        NOT NULL,
  env                text        NOT NULL DEFAULT 'dev',
  question           text        NOT NULL CHECK (char_length(question) BETWEEN 3 AND 600),
  -- The entry the page offered as "this might be it" before they asked anyway.
  deflected_entry_id text,
  status             text        NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'duplicate', 'answered', 'in_page', 'declined')),
  -- duplicate: this handbook entry already answers it.
  matched_entry_id   text,
  -- answered: what the asker was told, rendered on the page until an entry lands.
  answer             text,
  answered_at        timestamptz,
  -- 'human' or 'batch'; a human answer is the only kind that exists today.
  answered_by        text,
  -- in_page: the handbook entry this question became once compiled in.
  entry_id           text
);

COMMENT ON TABLE public.handbook_questions IS
  'Questions readers asked on the schools Handbook and could not find an answer to, '
  'with the answer written back. Service-role-only: RLS on, no policies; the only '
  'door is api/handbook-questions.ts, which stamps auth_user_id from the verified '
  'bearer token (job #386, 2026-09-08).';

CREATE INDEX IF NOT EXISTS handbook_questions_asker_idx
  ON public.handbook_questions (auth_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS handbook_questions_status_idx
  ON public.handbook_questions (status, created_at);

ALTER TABLE public.handbook_questions ENABLE ROW LEVEL SECURITY;
-- Explicit posture at creation, never Supabase's grant-open default.
REVOKE ALL ON TABLE public.handbook_questions FROM anon, authenticated;
GRANT ALL ON TABLE public.handbook_questions TO service_role;

NOTIFY pgrst, 'reload schema';
