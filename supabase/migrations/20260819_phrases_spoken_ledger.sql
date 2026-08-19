-- Phrases-spoken gets a server-side home
-- ======================================
-- Owner ruling 2026-08-19 (Activity-tiles diagnosis, recommendation 3): the
-- "Phrases spoken" tile is hidden unless mic/adaptation consent is on — and
-- WHEN IT IS ON it needs a server-side home, because localStorage + a 30-day
-- window + one course cannot carry a lifetime stat.
--
-- Before this migration the count lived ONLY in the browser, under
-- `ssi-session-history-<courseCode>`, filtered to the last 30 days, per course,
-- and banked only when endSession() ran — so closing the tab lost it entirely.
--
-- The home is the ledger that already has exactly the right shape:
-- learner_speaking_opportunities is per-learner, per-course, per-UTC-day, and
-- its write path already rides a delta/watermark flush wired to
-- visibilitychange AND beforeunload — i.e. it already survives tab-close,
-- which is precisely the failure mode being fixed. One new column joins the
-- existing row; no new table, no new rows.
--
-- WHY A SEPARATE FUNCTION rather than a 5th argument on
-- bump_speaking_opportunities (which was the first-choice shape):
-- adding `p_phrases_delta bigint DEFAULT 0` cannot be done with CREATE OR
-- REPLACE — a new parameter is a new signature, so it means DROP + CREATE. If
-- anything else then re-asserts the 4-arg signature, Postgres ends up holding
-- BOTH overloads and every existing 4-named-arg call becomes ambiguous
-- ("function is not unique") — an outage of the opportunities and play_seconds
-- writes, i.e. of the telemetry this column is a guest in. A separate function
-- touches no shared object: bump_speaking_opportunities is left byte-identical.
-- The cost is one extra RPC per flush, and only ever on a flush where speech
-- was actually detected — for a learner with adaptation consent off (the
-- default) it is zero additional writes, forever.
--
-- RLS: no policy or grant work is needed and none is done here. The table's
-- own-row policies ("Users can view/insert/update own speaking opportunities",
-- learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text))
-- are column-agnostic, and its grants are table-level, so the new column
-- inherits both. Verified live 2026-08-19 before writing this.

BEGIN;

ALTER TABLE public.learner_speaking_opportunities
  ADD COLUMN IF NOT EXISTS phrases_spoken bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.learner_speaking_opportunities.phrases_spoken IS
  'Cycles in which the VAD actually detected the learner speaking. Only ever non-zero when mic/adaptation consent is on; a row of 0 means "we were not listening", not "they said nothing". Summed lifetime across all courses by /api/me/phrases-spoken.';

-- SECURITY INVOKER (the default) with the same explicit ownership guard as
-- bump_speaking_opportunities: the caller may only ever write their OWN
-- learner's row, and RLS applies on top.
CREATE OR REPLACE FUNCTION public.bump_phrases_spoken(
  p_learner_id uuid,
  p_course_code text,
  p_phrases_delta bigint DEFAULT 0
) RETURNS void
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  IF p_phrases_delta <= 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM learners
    WHERE id = p_learner_id
      AND user_id = auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'unauthorized: learner_id does not belong to caller'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO learner_speaking_opportunities AS lso
    (learner_id, course_code, day, phrases_spoken)
  VALUES
    (p_learner_id, p_course_code, (now() AT TIME ZONE 'UTC')::date, p_phrases_delta)
  ON CONFLICT (learner_id, course_code, day) DO UPDATE
    SET
      phrases_spoken = lso.phrases_spoken + p_phrases_delta,
      updated_at     = now();
END;
$$;

COMMENT ON FUNCTION public.bump_phrases_spoken(uuid, text, bigint) IS
  'Add a phrases-spoken delta to the (learner, course, UTC today) row of learner_speaking_opportunities, creating it if absent. Deliberately separate from bump_speaking_opportunities so that function''s signature never has to change. Delta-based and idempotent-by-construction: the client holds a watermark and only ever sends what it has not already sent.';

-- Deny-by-default. REVOKE FROM PUBLIC alone is not enough: this project carries
-- ALTER DEFAULT PRIVILEGES that grant EXECUTE on new functions to anon as well,
-- so anon is revoked by name. A guest can never legitimately call this — the
-- client skips guest learner ids outright, and the ownership guard above would
-- reject them anyway (auth.uid() is null, so no learners row matches) — but a
-- signed-out caller should be stopped at the door, not inside the body.
REVOKE ALL ON FUNCTION public.bump_phrases_spoken(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_phrases_spoken(uuid, text, bigint) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
