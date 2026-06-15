-- ============================================================================
-- INSIGHT ENGINE — exclude is_demo from the live admin RPCs.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED (Tom applies migrations).
-- Companion: 20260610_feat_17_demo_data_separation.sql (the is_demo flags this
-- migration honours) + 20260614_analytics_class_coverage.sql (which bakes the
-- same exclusion in from the start).
--
-- WHY: the demo suite (scripts/demo-data/generate-demo-suite.cjs) writes
-- synthetic, is_demo-flagged learners and their telemetry into the SAME single
-- Supabase project the real admin Insight boards read. is_demo flags exist on
-- learners/schools, but the Insight RPCs added since feat_17 do NOT filter them —
-- so the next demo run would surface fabricated learners AS REAL on the un-?demo
-- /admin/insights boards (177 demo learners already outnumber 132 real), and the
-- synthetic plays (which never emit audio_failed) would deflate the REAL
-- audio-failure SAFETY metric. This migration closes that hole on the two RPCs
-- that are already live (the coverage RPC ships the exclusion in its own file).
--
-- NOTE the ?demo board path never hits these RPCs at all — it is served entirely
-- client-side from packages/player-vue/src/insight/data/demo.ts (in-memory). So
-- excluding is_demo here costs the demo preview nothing; it only cleans the REAL
-- view. With no real schools onboarded yet, analytics_class_coverage will read
-- empty until a real school logs sessions — which is the correct "all clear".
--
-- APPROACH: filter via the existing is_demo flags (NO new columns on the
-- telemetry tables) — the cheapest exclusion that's still auditable.
--   * difficulty_turns already JOINs learners → add one predicate.
--   * health reads player_events (whose user_id IS the learners PK, per CLAUDE.md)
--     in several places → resolve the demo-learner id set ONCE and exclude it,
--     NULL-safe so guest events (user_id NULL) and real learners are both kept.
-- ============================================================================

-- ── 1. analytics_difficulty_turns — drop demo learners ──────────────────────
CREATE OR REPLACE FUNCTION public.analytics_difficulty_turns(
  p_days integer DEFAULT 30,
  p_min_samples integer DEFAULT 5
)
RETURNS TABLE (
  learner_id uuid,
  learner_name text,
  lego_id text,
  course_code text,
  recent_latency_samples jsonb,
  last_seen_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_god_user() THEN
    RAISE EXCEPTION 'analytics_difficulty_turns: admin only';
  END IF;

  RETURN QUERY
  SELECT
    m.learner_id,
    l.display_name AS learner_name,
    m.lego_id,
    m.course_code,
    m.recent_latency_samples,
    m.last_seen_at
  FROM public.learner_lego_metrics m
  JOIN public.learners l ON l.id = m.learner_id
  WHERE m.last_seen_at >= now() - make_interval(days => p_days)
    AND COALESCE(l.is_demo, false) = false          -- exclude synthetic demo learners
    AND jsonb_array_length(COALESCE(m.recent_latency_samples, '[]'::jsonb)) >= p_min_samples
  ORDER BY m.last_seen_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_difficulty_turns(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.analytics_difficulty_turns(integer, integer) TO authenticated;


-- ── 2. analytics_health — drop demo learners' player_events ─────────────────
-- Re-creation of 20260602_analytics_health_rpc.sql with one addition: a
-- demo-learner id set (v_demo_ids) resolved once and excluded from every
-- player_events read via  NOT COALESCE(user_id = ANY(v_demo_ids), false)  —
-- which keeps rows where user_id is NULL (guests) or not a demo learner, and
-- behaves correctly when there are no demo learners (v_demo_ids = NULL).
CREATE OR REPLACE FUNCTION analytics_health(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_since           TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_demo_ids        UUID[];
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

  -- demo-learner ids (player_events.user_id holds the learners PK). NULL when none.
  SELECT array_agg(id) INTO v_demo_ids FROM learners WHERE is_demo = true;

  -- ── totals ──────────────────────────────────────────────────────────────
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'audio_play'),
    COUNT(*) FILTER (WHERE event_type = 'audio_failed')
  INTO v_total_plays, v_total_failures
  FROM player_events
  WHERE occurred_at >= v_since
    AND NOT COALESCE(user_id = ANY(v_demo_ids), false);

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
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
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
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
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
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
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
    AND payload ? 'cacheHit'
    AND NOT COALESCE(user_id = ANY(v_demo_ids), false);

  -- ── build-sha spread (distinct authenticated learners per version, last p_days) ──
  WITH sha_learners AS (
    SELECT
      COALESCE(client_version, 'unknown') AS sha,
      COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS learners
    FROM player_events
    WHERE occurred_at >= v_since
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
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
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
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

-- PostgREST schema reload so the replaced RPCs are immediately callable.
NOTIFY pgrst, 'reload schema';
