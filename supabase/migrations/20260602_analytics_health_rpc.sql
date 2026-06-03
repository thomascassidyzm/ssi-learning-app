-- Migration: analytics_health RPC
-- Purpose: platform health metrics for the Insight Engine health resolver.
--
-- Returns aggregated audio_failed rate by day + by device, cache hit rate,
-- client_version (build-sha) spread, and device_type spread — all from
-- player_events over the requested window.
--
-- Gated by is_god_user() (SECURITY DEFINER), anon-callable via the admin
-- Supabase client just like analytics_overview().
--
-- Parameters:
--   p_days   INT  DEFAULT 30  — look-back window in days
--
-- Returns JSONB with shape:
--   failure_trend        : [{day: 'YYYY-MM-DD', plays: INT, failures: INT, fail_rate: NUMERIC}]
--   failure_by_device    : [{device: TEXT, plays: INT, failures: INT, fail_rate: NUMERIC}]
--   failure_by_version   : [{version: TEXT, plays: INT, failures: INT, fail_rate: NUMERIC}]
--   cache_hit_rate       : NUMERIC (0-1, NULL when no data → 0)
--   build_sha_spread     : [{sha: TEXT, learners: INT}]   -- active-learner distribution
--   device_spread        : [{device: TEXT, learners: INT}]
--   total_plays          : BIGINT
--   total_failures       : BIGINT
--   overall_fail_rate    : NUMERIC
--
-- NOTE: player_events.user_id is UUID; we count distinct user_ids as a
-- proxy for "active learners" in the spread queries (guests = NULL, excluded).

CREATE OR REPLACE FUNCTION analytics_health(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_since           TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_total_plays     BIGINT;
  v_total_failures  BIGINT;
  v_overall_rate    NUMERIC;
  v_fail_trend      JSONB;
  v_fail_by_device  JSONB;
  v_fail_by_version JSONB;
  v_cache_hit_rate  NUMERIC;
  v_sha_spread      JSONB;
  v_device_spread   JSONB;
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  -- ── totals ──────────────────────────────────────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'audio_play'),
    COUNT(*) FILTER (WHERE event_type = 'audio_failed')
  INTO v_total_plays, v_total_failures
  FROM player_events
  WHERE occurred_at >= v_since;

  v_overall_rate := CASE
    WHEN COALESCE(v_total_plays, 0) > 0
    THEN ROUND(v_total_failures::NUMERIC / v_total_plays, 6)
    ELSE 0
  END;

  -- ── daily failure trend ──────────────────────────────────────────────────
  WITH day_series AS (
    SELECT generate_series(
      date_trunc('day', v_since)::DATE,
      CURRENT_DATE,
      '1 day'::INTERVAL
    )::DATE AS d
  ),
  daily AS (
    SELECT
      occurred_at::DATE AS d,
      COUNT(*) FILTER (WHERE event_type = 'audio_play')    AS plays,
      COUNT(*) FILTER (WHERE event_type = 'audio_failed')  AS failures
    FROM player_events
    WHERE occurred_at >= v_since
      AND event_type IN ('audio_play', 'audio_failed')
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',       TO_CHAR(ds.d, 'YYYY-MM-DD'),
        'plays',     COALESCE(dl.plays, 0),
        'failures',  COALESCE(dl.failures, 0),
        'fail_rate', CASE
          WHEN COALESCE(dl.plays, 0) > 0
          THEN ROUND(COALESCE(dl.failures, 0)::NUMERIC / dl.plays, 6)
          ELSE 0
        END
      ) ORDER BY ds.d
    ),
    '[]'::JSONB
  )
  INTO v_fail_trend
  FROM day_series ds
  LEFT JOIN daily dl USING (d);

  -- ── failure by device_type ───────────────────────────────────────────────
  WITH by_dev AS (
    SELECT
      COALESCE(device_type, 'unknown')                     AS device,
      COUNT(*) FILTER (WHERE event_type = 'audio_play')    AS plays,
      COUNT(*) FILTER (WHERE event_type = 'audio_failed')  AS failures
    FROM player_events
    WHERE occurred_at >= v_since
      AND event_type IN ('audio_play', 'audio_failed')
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'device',    device,
        'plays',     plays,
        'failures',  failures,
        'fail_rate', CASE WHEN plays > 0 THEN ROUND(failures::NUMERIC / plays, 6) ELSE 0 END
      ) ORDER BY failures DESC
    ),
    '[]'::JSONB
  )
  INTO v_fail_by_device
  FROM by_dev;

  -- ── failure by client_version (build-sha) ───────────────────────────────
  WITH by_ver AS (
    SELECT
      COALESCE(client_version, 'unknown')                  AS version,
      COUNT(*) FILTER (WHERE event_type = 'audio_play')    AS plays,
      COUNT(*) FILTER (WHERE event_type = 'audio_failed')  AS failures
    FROM player_events
    WHERE occurred_at >= v_since
      AND event_type IN ('audio_play', 'audio_failed')
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'version',  version,
        'plays',    plays,
        'failures', failures,
        'fail_rate', CASE WHEN plays > 0 THEN ROUND(failures::NUMERIC / plays, 6) ELSE 0 END
      ) ORDER BY failures DESC
    ),
    '[]'::JSONB
  )
  INTO v_fail_by_version
  FROM by_ver;

  -- ── cache hit rate (from audio_play payload.cacheHit boolean) ────────────
  SELECT CASE
    WHEN COUNT(*) > 0
    THEN ROUND(
      COUNT(*) FILTER (WHERE (payload->>'cacheHit')::boolean = true)::NUMERIC / COUNT(*),
      4
    )
    ELSE 0
  END
  INTO v_cache_hit_rate
  FROM player_events
  WHERE occurred_at >= v_since
    AND event_type = 'audio_play'
    AND payload ? 'cacheHit';

  -- ── build-sha spread (distinct authenticated learners per version, last p_days) ──
  WITH sha_learners AS (
    SELECT
      COALESCE(client_version, 'unknown') AS sha,
      COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS learners
    FROM player_events
    WHERE occurred_at >= v_since
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('sha', sha, 'learners', learners)
      ORDER BY learners DESC
    ),
    '[]'::JSONB
  )
  INTO v_sha_spread
  FROM sha_learners;

  -- ── device_type spread ───────────────────────────────────────────────────
  WITH dev_learners AS (
    SELECT
      COALESCE(device_type, 'unknown') AS device,
      COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS learners
    FROM player_events
    WHERE occurred_at >= v_since
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('device', device, 'learners', learners)
      ORDER BY learners DESC
    ),
    '[]'::JSONB
  )
  INTO v_device_spread
  FROM dev_learners;

  RETURN jsonb_build_object(
    'failure_trend',        v_fail_trend,
    'failure_by_device',    v_fail_by_device,
    'failure_by_version',   v_fail_by_version,
    'cache_hit_rate',       COALESCE(v_cache_hit_rate, 0),
    'build_sha_spread',     v_sha_spread,
    'device_spread',        v_device_spread,
    'total_plays',          COALESCE(v_total_plays, 0),
    'total_failures',       COALESCE(v_total_failures, 0),
    'overall_fail_rate',    v_overall_rate
  );
END;
$function$;

-- PostgREST schema reload so the new RPC is immediately callable.
NOTIFY pgrst, 'reload schema';
