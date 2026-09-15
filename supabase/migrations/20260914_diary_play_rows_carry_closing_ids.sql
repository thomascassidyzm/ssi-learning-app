-- diary_play_rows — carry the audio id on every clip that CAN close a span.
--
-- Astra's cold check on job #609 (needs-you #714, 2026-09-14): on the same
-- 131,804 production rows the packed read lost 100 seconds across ten learner
-- diaries against the paged read processed by the same sessioniseAll. Cause:
-- the 30-second rule below dropped a start-logged clip's audio id whenever ANY
-- event followed within 30 s, on the reading that the successor bounds the
-- clip's end. It does — when the successor is a clip in the same mode (the
-- span runs on through it) or a stop tap (the span closes at the tap). It
-- does NOT when the successor is a play tap, a clip in the other mode or a
-- listening tick: spansFromDiary closes the open span at the LAST AUDIO-ENDED
-- POINT there, and with the id gone that point is the clip's start, so the
-- clip's whole length is lost. Measured live 2026-09-14 over the 30-day
-- production window: 104,037 unbounded clips, 261 ids carried, 19 dropped
-- that could matter (across nine learners). Carrying every id would add
-- ~4 MB to the packed payload; carrying these 19 adds nothing measurable.
--
-- So the rule is now: drop the id only when the next event, within 30 s, is
-- a stop tap or an audio_play in the same mode. Everything else about the
-- function is unchanged; the minute rule still lives only in
-- api/_utils/inAppTime.ts. Same signature, same shape: every deployed build
-- reads it as before.

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
           (e.payload->>'cycleType' = 'listening_mode') AS listening,
           lead(e.occurred_at) OVER w AS next_at,
           lead(e.event_type) OVER w AS next_type,
           lead(e.payload->>'cycleType' = 'listening_mode') OVER w AS next_listening
    FROM player_events e
    WHERE e.occurred_at >= p_since AND e.occurred_at < p_until
      AND e.learner_id IS NOT NULL
      AND e.event_type IN ('tap_play', 'tap_pause', 'audio_play', 'listening_tick')
      AND (p_env IS NULL OR e.env = p_env)
      AND (p_learner_ids IS NULL OR e.learner_id = ANY (p_learner_ids))
    WINDOW w AS (PARTITION BY e.learner_id ORDER BY e.occurred_at, e.id)
  ), packed AS (
    SELECT learner_id,
           jsonb_agg(jsonb_build_array(
             (extract(epoch FROM occurred_at) * 1000)::bigint,
             CASE event_type WHEN 'tap_play' THEN 'p' WHEN 'tap_pause' THEN 's' WHEN 'listening_tick' THEN 't' ELSE 'a' END,
             CASE WHEN listening THEN 1 ELSE 0 END,
             CASE WHEN payload->>'elapsedMs' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'elapsedMs')::numeric END,
             CASE WHEN payload->>'durationMs' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'durationMs')::numeric END,
             CASE WHEN payload->>'playbackSpeed' ~ '^[0-9]+(\.[0-9]+)?$' THEN (payload->>'playbackSpeed')::numeric END,
             CASE WHEN event_type = 'audio_play'
                   AND payload->>'elapsedMs' IS NULL AND payload->>'durationMs' IS NULL
                   AND NOT (
                     next_at IS NOT NULL AND next_at - occurred_at <= interval '30 seconds'
                     AND (next_type = 'tap_pause'
                          OR (next_type = 'audio_play' AND coalesce(next_listening, false) = coalesce(listening, false)))
                   )
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
  'Packed play-relevant diary rows for a window, per learner. Selection and packing only; the minute rule is api/_utils/inAppTime.ts. Carries the audio id on every clip that can close a span (job #621). service_role only.';

NOTIFY pgrst, 'reload schema';
