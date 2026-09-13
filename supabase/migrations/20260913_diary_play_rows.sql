-- diary_play_rows — the PACKED READ behind the one minute definition
-- (api/_utils/inAppTime.ts), for Intelligence at Everyone scope (job #609,
-- Tom's ruling 2026-09-13: minutes are play-to-stop, tagged by mode).
--
-- A 30-day production window holds ~131k play-relevant diary rows; PostgREST
-- caps a response at 1,000 rows, so a request-path read of that window would
-- be 131 pages. This function returns the whole window as ONE jsonb value,
-- packed per learner, in ~0.7 s. It SELECTS and PACKS only — no rule lives
-- here. Every rule (what opens a span, what closes it, the guard, the mode
-- tag) is spansFromDiary in api/_utils/inAppTime.ts, and only there, so the
-- school surfaces and Intelligence can never disagree about a minute.
--
-- Shape: { "<learner_id>": [[t_ms, k, listening, elapsedMs, durationMs, playbackSpeed, audioId, course_code], ...], ... }
--   k: 'p' tap_play | 's' tap_pause | 'a' audio_play | 't' listening_tick
--   listening: 1 when payload.cycleType = 'listening_mode', else 0
--   audioId: only on a start-logged audio_play that carries neither elapsedMs
--            nor durationMs AND is followed by nothing within 30 s — the clips
--            that might close a span and need course_audio.duration_ms. Every
--            other clip's end is known from the row or bounded by its successor.
-- Numeric payload fields are cast only when they look like numbers: a client
-- can post any payload, and one bad string must not break the read.
--
-- service_role only: this is server-side analytics over every learner's diary.

CREATE OR REPLACE FUNCTION public.diary_play_rows(
  p_since timestamptz,
  p_until timestamptz,
  p_env text DEFAULT 'production',
  p_learner_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH ev AS (
    SELECT e.learner_id, e.occurred_at, e.event_type, e.course_code, e.payload,
           lead(e.occurred_at) OVER (PARTITION BY e.learner_id ORDER BY e.occurred_at, e.id) AS next_at
    FROM player_events e
    WHERE e.occurred_at >= p_since AND e.occurred_at < p_until
      AND e.learner_id IS NOT NULL
      AND e.event_type IN ('tap_play', 'tap_pause', 'audio_play', 'listening_tick')
      AND (p_env IS NULL OR e.env = p_env)
      AND (p_learner_ids IS NULL OR e.learner_id = ANY (p_learner_ids))
  ), packed AS (
    SELECT learner_id,
           jsonb_agg(jsonb_build_array(
             (extract(epoch FROM occurred_at) * 1000)::bigint,
             CASE event_type WHEN 'tap_play' THEN 'p' WHEN 'tap_pause' THEN 's' WHEN 'listening_tick' THEN 't' ELSE 'a' END,
             CASE WHEN payload->>'cycleType' = 'listening_mode' THEN 1 ELSE 0 END,
             CASE WHEN payload->>'elapsedMs' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'elapsedMs')::numeric END,
             CASE WHEN payload->>'durationMs' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'durationMs')::numeric END,
             CASE WHEN payload->>'playbackSpeed' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'playbackSpeed')::numeric END,
             CASE WHEN event_type = 'audio_play'
                   AND payload->>'elapsedMs' IS NULL AND payload->>'durationMs' IS NULL
                   AND (next_at IS NULL OR next_at - occurred_at > interval '30 seconds')
                  THEN substring(payload->>'url' FROM '/api/audio/([0-9a-fA-F-]{36})') END,
             course_code
           ) ORDER BY occurred_at) AS rows
    FROM ev
    GROUP BY learner_id
  )
  SELECT coalesce(jsonb_object_agg(learner_id, rows), '{}'::jsonb) FROM packed
$$;

REVOKE ALL ON FUNCTION public.diary_play_rows(timestamptz, timestamptz, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.diary_play_rows(timestamptz, timestamptz, text, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diary_play_rows(timestamptz, timestamptz, text, uuid[]) TO service_role;

COMMENT ON FUNCTION public.diary_play_rows(timestamptz, timestamptz, text, uuid[]) IS
  'Packed play-relevant diary rows for a window, per learner. Selection and packing only; the minute rule is api/_utils/inAppTime.ts. service_role only (job #609).';

NOTIFY pgrst, 'reload schema';
