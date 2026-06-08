-- analytics_friction_extended(p_course_id)
--
-- Extends the existing analytics_friction_map with two additional signals from player_events:
--   · skip_back_count  — phase_skip events with direction='back' (learner re-heard the unit)
--   · audio_failed_count — audio_failed events (client could not play a clip)
--
-- Both are bucketed into seed-bands matching the heatmap X-axis so the contentFriction
-- resolver can merge them with the friction_map rows without a per-seed join.
--
-- Seed-band logic mirrors the heatmap gallery config (S1-20, S21-40, etc., up to S101+).
-- player_events carries seedId in payload; we cast it to an int so we can band it.
-- Rows with a null/non-numeric seedId payload are ignored (audio_play rows have no seedId).
--
-- SECURITY DEFINER + is_god_user() gate, anon-callable like the other analytics_* RPCs.
-- DO NOT APPLY — leave for Tom to apply after review.

CREATE OR REPLACE FUNCTION analytics_friction_extended(p_course_id TEXT)
RETURNS TABLE(
  seed_band         TEXT,
  band_min          INT,
  band_max          INT,
  skip_back_count   BIGINT,
  audio_failed_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT
      event_type,
      -- Extract numeric seedId from payload; null if missing/non-numeric
      (payload->>'seedId') AS raw_seed
    FROM player_events
    WHERE course_code = p_course_id
      AND event_type IN ('phase_skip', 'audio_failed')
      -- only back-skips for phase_skip
      AND (
        event_type = 'audio_failed'
        OR (event_type = 'phase_skip' AND payload->>'direction' = 'back')
      )
  ),
  numbered AS (
    SELECT
      event_type,
      CASE
        WHEN raw_seed ~ '^[0-9]+$' THEN raw_seed::INT
        ELSE NULL
      END AS seed_num
    FROM raw
    WHERE raw_seed IS NOT NULL
  ),
  banded AS (
    SELECT
      event_type,
      CASE
        WHEN seed_num BETWEEN   1 AND  20 THEN 'S1–20'
        WHEN seed_num BETWEEN  21 AND  40 THEN 'S21–40'
        WHEN seed_num BETWEEN  41 AND  60 THEN 'S41–60'
        WHEN seed_num BETWEEN  61 AND  80 THEN 'S61–80'
        WHEN seed_num BETWEEN  81 AND 100 THEN 'S81–100'
        WHEN seed_num > 100               THEN 'S101+'
        ELSE NULL
      END AS band,
      CASE
        WHEN seed_num BETWEEN   1 AND  20 THEN  1
        WHEN seed_num BETWEEN  21 AND  40 THEN 21
        WHEN seed_num BETWEEN  41 AND  60 THEN 41
        WHEN seed_num BETWEEN  61 AND  80 THEN 61
        WHEN seed_num BETWEEN  81 AND 100 THEN 81
        WHEN seed_num > 100               THEN 101
        ELSE NULL
      END AS bmin,
      CASE
        WHEN seed_num BETWEEN   1 AND  20 THEN  20
        WHEN seed_num BETWEEN  21 AND  40 THEN  40
        WHEN seed_num BETWEEN  41 AND  60 THEN  60
        WHEN seed_num BETWEEN  61 AND  80 THEN  80
        WHEN seed_num BETWEEN  81 AND 100 THEN 100
        WHEN seed_num > 100               THEN 9999
        ELSE NULL
      END AS bmax
    FROM numbered
    WHERE seed_num IS NOT NULL
  ),
  all_bands AS (
    SELECT unnest(ARRAY['S1–20','S21–40','S41–60','S61–80','S81–100','S101+']) AS band,
           unnest(ARRAY[1,21,41,61,81,101])                                    AS bmin,
           unnest(ARRAY[20,40,60,80,100,9999])                                 AS bmax
  ),
  counts AS (
    SELECT
      band,
      bmin,
      bmax,
      COUNT(*) FILTER (WHERE event_type = 'phase_skip')    AS skips,
      COUNT(*) FILTER (WHERE event_type = 'audio_failed')  AS fails
    FROM banded
    GROUP BY band, bmin, bmax
  )
  SELECT
    ab.band                           AS seed_band,
    ab.bmin                           AS band_min,
    ab.bmax                           AS band_max,
    COALESCE(c.skips, 0)              AS skip_back_count,
    COALESCE(c.fails, 0)              AS audio_failed_count
  FROM all_bands ab
  LEFT JOIN counts c ON c.band = ab.band
  ORDER BY ab.bmin;
END;
$function$;

NOTIFY pgrst, 'reload schema';
