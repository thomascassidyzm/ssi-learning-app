-- ============================================================================
-- Extend the analytics demo-exclusion to also drop is_internal learners.
--
-- RULE (extends 20260616_analytics_demo_exclusion): every GLOBAL analytics
-- aggregate already excludes is_demo learners. Internal/QA/team accounts
-- (learners.is_internal — see 20260618_learners_is_internal.sql) are real
-- humans but not real ADOPTION, and they dominate raw volume, so they must be
-- excluded the same way.
--
-- METHOD — minimal, eyeballable diff over the CURRENT verbatim bodies:
--   * The demo logic resolves an id-set once per function:
--       v_demo_ids := array_agg(id) FROM learners WHERE is_demo = true;
--     and every learner-keyed predicate filters against v_demo_ids. We widen
--     that ONE line to  WHERE is_demo = true OR is_internal = true , so the
--     existing var (kept named v_demo_ids to avoid touching its usages) now
--     holds demo+internal ids and EVERY learner-keyed read inherits the
--     internal exclusion with no further change.
--   * Direct  learners  reads (COALESCE(is_demo,false)=false, with/without the
--     l. alias) get a sibling  AND COALESCE(is_internal,false)=false .
--   * sc.is_demo (demo *schools*, in analytics_class_coverage) is NOT a learner
--     flag and is left untouched; that function is unchanged and omitted here.
--
-- Signatures are unchanged. Bodies are otherwise byte-identical to schema.sql.
-- 14 functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_course_comparison() RETURNS TABLE(course_id text, enrolled integer, active_30d integer, avg_seeds numeric, avg_belt text, completion_pct numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  RETURN QUERY
  WITH enrollment_stats AS (
    SELECT
      ce.course_id,
      COUNT(*)::INT AS enrolled,
      AVG(COALESCE(ce.highest_completed_seed, 0)) AS avg_s,
      COUNT(*) FILTER (WHERE ce.highest_completed_seed >= 300)::INT AS completed
    FROM course_enrollments ce
    WHERE NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY ce.course_id
  ),
  active_stats AS (
    SELECT
      s.course_id,
      COUNT(DISTINCT s.learner_id)::INT AS active_cnt
    FROM sessions s
    WHERE s.started_at >= NOW() - INTERVAL '30 days'
      AND NOT COALESCE(s.learner_id = ANY(v_demo_ids), false)       -- demo: learner-keyed
    GROUP BY s.course_id
  )
  SELECT
    es.course_id,
    es.enrolled,
    COALESCE(a.active_cnt, 0)                  AS active_30d,
    ROUND(es.avg_s, 1)                          AS avg_seeds,
    _seed_to_belt(es.avg_s)                     AS avg_belt,
    CASE WHEN es.enrolled > 0
      THEN ROUND(es.completed::NUMERIC / es.enrolled * 100, 1)
      ELSE 0
    END                                          AS completion_pct
  FROM enrollment_stats es
  LEFT JOIN active_stats a ON a.course_id = es.course_id
  ORDER BY es.enrolled DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_course_value() RETURNS TABLE(course_code text, reach bigint, enrolled bigint, stickiness_hours numeric, retention_pct numeric, ltv_proxy numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  RETURN QUERY
  WITH

  -- ── 1. reach: distinct learners active last 30 days (via learner_speaking_opportunities) ──
  reach_cte AS (
    SELECT
      lso.course_code,
      COUNT(DISTINCT lso.learner_id) AS reach
    FROM learner_speaking_opportunities lso
    WHERE lso.day >= CURRENT_DATE - 30
      AND NOT COALESCE(lso.learner_id = ANY(v_demo_ids), false)     -- demo: learner-keyed
    GROUP BY lso.course_code
  ),

  -- ── 2. enrolled: all distinct learners ever enrolled per course ──
  enrolled_cte AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS enrolled
    FROM course_enrollments ce
    WHERE NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY ce.course_id
  ),

  -- ── 3. stickiness: per active learner, total practice hours in last 30d;
  --       then take the MEDIAN (percentile_cont 0.5) across active learners ──
  learner_hours_30d AS (
    SELECT
      lso.course_code,
      lso.learner_id,
      SUM(lso.play_seconds)::NUMERIC / 3600.0 AS hours_30d
    FROM learner_speaking_opportunities lso
    WHERE lso.day >= CURRENT_DATE - 30
      AND NOT COALESCE(lso.learner_id = ANY(v_demo_ids), false)     -- demo: learner-keyed
    GROUP BY lso.course_code, lso.learner_id
  ),
  stickiness_cte AS (
    SELECT
      lh.course_code,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lh.hours_30d), 2) AS stickiness_hours
    FROM learner_hours_30d lh
    GROUP BY lh.course_code
  ),

  -- ── 4. retention: learners active in BOTH [60-31 days ago] AND [30-0 days ago] ──
  --       divided by learners active in [60-31 days ago] (rolling 30d return rate).
  --       Using course_enrollments.last_practiced_at for cheapness; if 0 denominator → 0%.
  active_window_new AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS cnt
    FROM course_enrollments ce
    WHERE ce.last_practiced_at >= CURRENT_DATE - 30
      AND NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY ce.course_id
  ),
  active_window_old AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS cnt
    FROM course_enrollments ce
    WHERE ce.last_practiced_at >= CURRENT_DATE - 60
      AND ce.last_practiced_at <  CURRENT_DATE - 30
      AND NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY ce.course_id
  ),
  -- Learners who were in the old window AND returned in the new window
  returned AS (
    SELECT
      lso_old.course_code,
      COUNT(DISTINCT lso_old.learner_id) AS ret_cnt
    FROM (
      SELECT DISTINCT course_code, learner_id
      FROM learner_speaking_opportunities
      WHERE day >= CURRENT_DATE - 60
        AND day <  CURRENT_DATE - 30
        AND NOT COALESCE(learner_id = ANY(v_demo_ids), false)       -- demo: learner-keyed
    ) lso_old
    INNER JOIN (
      SELECT DISTINCT course_code, learner_id
      FROM learner_speaking_opportunities
      WHERE day >= CURRENT_DATE - 30
        AND NOT COALESCE(learner_id = ANY(v_demo_ids), false)       -- demo: learner-keyed
    ) lso_new
      ON lso_new.course_code = lso_old.course_code
     AND lso_new.learner_id  = lso_old.learner_id
    GROUP BY lso_old.course_code
  ),
  retention_cte AS (
    SELECT
      aw.course_code,
      CASE WHEN aw.cnt > 0
           THEN ROUND(COALESCE(r.ret_cnt, 0)::NUMERIC / aw.cnt * 100, 1)
           ELSE 0
      END AS retention_pct
    FROM active_window_old aw
    LEFT JOIN returned r ON r.course_code = aw.course_code
  ),

  -- ── 5. union all known courses from enrollment + activity ──
  all_courses AS (
    SELECT course_code FROM reach_cte
    UNION
    SELECT course_code FROM enrolled_cte
  )

  SELECT
    ac.course_code,
    COALESCE(rc.reach, 0)                                          AS reach,
    COALESCE(ec.enrolled, 0)                                       AS enrolled,
    COALESCE(sc.stickiness_hours, 0)                               AS stickiness_hours,
    COALESCE(ret.retention_pct, 0)                                 AS retention_pct,
    ROUND(
      COALESCE(rc.reach, 0)::NUMERIC
      * COALESCE(sc.stickiness_hours, 0)
      * COALESCE(ret.retention_pct, 0) / 100.0
    , 3)                                                           AS ltv_proxy
  FROM all_courses ac
  LEFT JOIN reach_cte     rc  ON rc.course_code  = ac.course_code
  LEFT JOIN enrolled_cte  ec  ON ec.course_code  = ac.course_code
  LEFT JOIN stickiness_cte sc ON sc.course_code  = ac.course_code
  LEFT JOIN retention_cte  ret ON ret.course_code = ac.course_code
  ORDER BY ltv_proxy DESC NULLS LAST;

END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_difficulty_turns(p_days integer DEFAULT 30, p_min_samples integer DEFAULT 5) RETURNS TABLE(learner_id uuid, learner_name text, lego_id text, course_code text, recent_latency_samples jsonb, last_seen_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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
    AND COALESCE(l.is_demo, false) = false AND COALESCE(l.is_internal, false) = false          -- exclude synthetic demo learners
    AND jsonb_array_length(COALESCE(m.recent_latency_samples, '[]'::jsonb)) >= p_min_samples
  ORDER BY m.last_seen_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_engagement() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_dau   BIGINT;
  v_wau   BIGINT;
  v_mau   BIGINT;
  v_avg_duration NUMERIC;
  v_avg_sessions_pw NUMERIC;
  v_freq_dist  JSONB;
  v_dur_dist   JSONB;
  v_belt_avg   JSONB;
  v_demo_ids   UUID[];                                              -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  -- DAU
  SELECT COUNT(DISTINCT learner_id) INTO v_dau
  FROM sessions WHERE started_at >= CURRENT_DATE
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- WAU
  SELECT COUNT(DISTINCT learner_id) INTO v_wau
  FROM sessions WHERE started_at >= NOW() - INTERVAL '7 days'
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- MAU
  SELECT COUNT(DISTINCT learner_id) INTO v_mau
  FROM sessions WHERE started_at >= NOW() - INTERVAL '30 days'
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- Average session duration (last 30 days)
  SELECT COALESCE(AVG(duration_seconds), 0) INTO v_avg_duration
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '30 days'
    AND duration_seconds > 0
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- Average sessions per user per week (last 28 days)
  SELECT CASE
    WHEN COUNT(DISTINCT learner_id) > 0
    THEN ROUND(COUNT(*)::NUMERIC / COUNT(DISTINCT learner_id) / 4, 2)
    ELSE 0
  END INTO v_avg_sessions_pw
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '28 days'
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- Session frequency distribution (sessions per week per user, last 28 days)
  WITH user_weekly AS (
    SELECT learner_id, ROUND(COUNT(*)::NUMERIC / 4, 0)::INT AS sessions_per_week
    FROM sessions
    WHERE started_at >= NOW() - INTERVAL '28 days'
      AND NOT COALESCE(learner_id = ANY(v_demo_ids), false)         -- demo: learner-keyed
    GROUP BY learner_id
  ),
  bucketed AS (
    SELECT
      CASE WHEN sessions_per_week >= 5 THEN '5+' ELSE sessions_per_week::TEXT END AS bucket,
      COUNT(*)::INT AS user_count
    FROM user_weekly
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_object_agg(bucket, user_count), '{}'::JSONB)
  INTO v_freq_dist
  FROM bucketed;

  -- Session duration distribution (last 30 days)
  WITH bucketed AS (
    SELECT
      CASE
        WHEN duration_seconds < 300  THEN '<5m'
        WHEN duration_seconds < 900  THEN '5-15m'
        WHEN duration_seconds < 1800 THEN '15-30m'
        ELSE '30m+'
      END AS label,
      COUNT(*)::INT AS cnt
    FROM sessions
    WHERE started_at >= NOW() - INTERVAL '30 days'
      AND duration_seconds > 0
      AND NOT COALESCE(learner_id = ANY(v_demo_ids), false)         -- demo: learner-keyed
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_object_agg(label, cnt), '{}'::JSONB)
  INTO v_dur_dist
  FROM bucketed;

  -- Average belt per course
  WITH course_avg AS (
    SELECT
      course_id,
      AVG(COALESCE(highest_completed_seed, 0)) AS avg_seed
    FROM course_enrollments
    WHERE NOT COALESCE(learner_id = ANY(v_demo_ids), false)         -- demo: learner-keyed
    GROUP BY course_id
  )
  SELECT COALESCE(
    jsonb_object_agg(course_id, _seed_to_belt(avg_seed)),
    '{}'::JSONB
  )
  INTO v_belt_avg
  FROM course_avg;

  RETURN jsonb_build_object(
    'dau',                          v_dau,
    'wau',                          v_wau,
    'mau',                          v_mau,
    'avg_session_duration_s',       ROUND(v_avg_duration, 1),
    'avg_sessions_per_user_per_week', v_avg_sessions_pw,
    'session_frequency_distribution', v_freq_dist,
    'session_duration_distribution',  v_dur_dist,
    'avg_belt_per_course',            v_belt_avg
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_entitlement_funnel() RETURNS TABLE(code text, label text, redemptions integer, started_session integer, retained_30d integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  RETURN QUERY
  SELECT
    ec.code,
    ec.label,
    COUNT(DISTINCT ue.id)::INT AS redemptions,
    COUNT(DISTINCT CASE
      WHEN EXISTS (
        SELECT 1 FROM sessions s WHERE s.learner_id = ue.learner_id
      ) THEN ue.learner_id
    END)::INT AS started_session,
    COUNT(DISTINCT CASE
      WHEN EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.learner_id = ue.learner_id
          AND s.started_at >= NOW() - INTERVAL '30 days'
      ) THEN ue.learner_id
    END)::INT AS retained_30d
  FROM entitlement_codes ec
  LEFT JOIN user_entitlements ue ON ue.entitlement_code_id = ec.id
    AND NOT COALESCE(ue.learner_id = ANY(v_demo_ids), false)        -- demo: learner-keyed (in ON to keep LEFT JOIN)
  GROUP BY ec.id, ec.code, ec.label
  ORDER BY redemptions DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_friction_extended(p_course_id text) RETURNS TABLE(seed_band text, band_min integer, band_max integer, skip_back_count bigint, audio_failed_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

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
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)            -- demo: learner-keyed
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
$_$;

CREATE OR REPLACE FUNCTION public.analytics_friction_map(p_course_id text) RETURNS TABLE(seed_number integer, stopped_here_count integer, spike_rate numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_max_seed INT;
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  -- Find the highest seed anyone has reached in this course
  SELECT COALESCE(MAX(highest_completed_seed), 0)
  INTO v_max_seed
  FROM course_enrollments
  WHERE course_id = p_course_id
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  RETURN QUERY
  WITH seed_series AS (
    SELECT generate_series(1, v_max_seed) AS sn
  ),
  stopped AS (
    -- Learners whose highest_completed_seed = this seed number (they quit here)
    SELECT
      ce.highest_completed_seed AS sn,
      COUNT(*)::INT AS cnt
    FROM course_enrollments ce
    WHERE ce.course_id = p_course_id
      AND ce.highest_completed_seed IS NOT NULL
      -- Only count learners who haven't practiced in 14+ days (likely stopped)
      AND (ce.last_practiced_at IS NULL OR ce.last_practiced_at < NOW() - INTERVAL '14 days')
      AND NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY ce.highest_completed_seed
  ),
  spikes AS (
    -- Count spike events bucketed by the learner's highest seed at the time
    -- Approximation: use the learner's current highest_completed_seed as context
    SELECT
      ce.highest_completed_seed AS sn,
      COUNT(se.db_id)::NUMERIC AS spike_count,
      GREATEST(COUNT(DISTINCT s.id), 1)::NUMERIC AS session_count
    FROM course_enrollments ce
    JOIN spike_events se ON se.learner_id = ce.learner_id AND se.course_id = ce.course_id
    JOIN sessions s ON s.learner_id = ce.learner_id AND s.course_id = ce.course_id
    WHERE ce.course_id = p_course_id
      AND ce.highest_completed_seed IS NOT NULL
      AND NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed (se/s inherit via join)
    GROUP BY ce.highest_completed_seed
  )
  SELECT
    ss.sn::INT                           AS seed_number,
    COALESCE(st.cnt, 0)                  AS stopped_here_count,
    COALESCE(ROUND(sp.spike_count / sp.session_count, 4), 0) AS spike_rate
  FROM seed_series ss
  LEFT JOIN stopped st ON st.sn = ss.sn
  LEFT JOIN spikes sp ON sp.sn = ss.sn
  ORDER BY ss.sn;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_growth(p_period text DEFAULT 'week'::text, p_count integer DEFAULT 12) RETURNS TABLE(period_start timestamp with time zone, new_users integer, enrollments_by_course jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_demo_ids UUID[];                                                 -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  RETURN QUERY
  WITH periods AS (
    SELECT generate_series(
      date_trunc(
        CASE WHEN p_period = 'month' THEN 'month' ELSE 'week' END,
        NOW()
      ) - (
        (p_count - 1) * CASE WHEN p_period = 'month' THEN INTERVAL '1 month' ELSE INTERVAL '1 week' END
      ),
      date_trunc(
        CASE WHEN p_period = 'month' THEN 'month' ELSE 'week' END,
        NOW()
      ),
      CASE WHEN p_period = 'month' THEN INTERVAL '1 month' ELSE INTERVAL '1 week' END
    ) AS p_start
  ),
  user_counts AS (
    SELECT
      date_trunc(
        CASE WHEN p_period = 'month' THEN 'month' ELSE 'week' END,
        l.created_at
      ) AS p_start,
      COUNT(*)::INT AS cnt
    FROM learners l
    WHERE COALESCE(l.is_demo, false) = false AND COALESCE(l.is_internal, false) = false                        -- demo: direct
    GROUP BY 1
  ),
  enrollment_counts AS (
    SELECT
      date_trunc(
        CASE WHEN p_period = 'month' THEN 'month' ELSE 'week' END,
        ce.enrolled_at
      ) AS p_start,
      ce.course_id,
      COUNT(*)::INT AS cnt
    FROM course_enrollments ce
    WHERE NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false)      -- demo: learner-keyed
    GROUP BY 1, 2
  ),
  enrollment_agg AS (
    SELECT
      ec.p_start,
      jsonb_object_agg(ec.course_id, ec.cnt) AS by_course
    FROM enrollment_counts ec
    GROUP BY 1
  )
  SELECT
    p.p_start                         AS period_start,
    COALESCE(uc.cnt, 0)               AS new_users,
    COALESCE(ea.by_course, '{}'::JSONB) AS enrollments_by_course
  FROM periods p
  LEFT JOIN user_counts uc ON uc.p_start = p.p_start
  LEFT JOIN enrollment_agg ea ON ea.p_start = p.p_start
  ORDER BY p.p_start;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_health(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
  SELECT array_agg(id) INTO v_demo_ids FROM learners WHERE is_demo = true OR is_internal = true;

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
$$;

CREATE OR REPLACE FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text DEFAULT NULL::text) RETURNS TABLE(course_code text, entity_value numeric, entity_legos integer, furthest_lego_id text, course_avg numeric, course_n integer, course_values numeric[], course_percentile integer, all_avg numeric, all_n integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_demo_ids   uuid[];                                       -- demo: id set
  v_course     text;
BEGIN
  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  -- ── resolve the course: explicit, else the learner's most-progressed one ──
  -- (the per-learner pace CTE is defined once below as `lpr` and reused; here we
  --  only need the learner's furthest course when none was passed.)
  IF p_course_id IS NOT NULL THEN
    v_course := p_course_id;
  ELSE
    WITH lego_order AS (
      SELECT cl.course_code, cl.lego_id,
        ROW_NUMBER() OVER (PARTITION BY cl.course_code ORDER BY cl.seed_number, cl.lego_index) AS ord
      FROM public.course_legos cl
    )
    SELECT ce.course_id INTO v_course
    FROM public.course_enrollments ce
    JOIN lego_order lo ON lo.course_code = ce.course_id AND lo.lego_id = ce.highest_completed_lego_id
    WHERE ce.learner_id = p_learner_id
      AND ce.highest_completed_lego_id IS NOT NULL
    ORDER BY lo.ord DESC NULLS LAST, ce.last_practiced_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  RETURN QUERY
  -- ── per-learner lifetime pace (LEGOs/week), every real learner × course ──
  -- One CTE feeds both cohorts and the entity.
  WITH lego_order AS (
    SELECT
      cl.course_code,
      cl.lego_id,
      ROW_NUMBER() OVER (
        PARTITION BY cl.course_code
        ORDER BY cl.seed_number, cl.lego_index
      ) AS ord
    FROM public.course_legos cl
  ),
  lpr AS (
    SELECT
      ce.learner_id,
      ce.course_id,
      ce.highest_completed_lego_id,
      lo.ord AS legos,
      ROUND(
        lo.ord / GREATEST(
          EXTRACT(EPOCH FROM (
            COALESCE(ce.last_practiced_at, now()) - ce.enrolled_at
          )) / 604800.0,
          1.0                                                -- floor span at 1 week
        )
      , 1)::numeric AS legos_per_week
    FROM public.course_enrollments ce
    JOIN lego_order lo
      ON lo.course_code = ce.course_id
     AND lo.lego_id     = ce.highest_completed_lego_id
    WHERE ce.highest_completed_lego_id IS NOT NULL
      AND ce.enrolled_at IS NOT NULL
      AND NOT COALESCE(ce.learner_id = ANY(v_demo_ids), false) -- demo: learner-keyed
      AND lo.ord IS NOT NULL
  ),
  me AS (
    SELECT t.* FROM lpr t
    WHERE t.learner_id = p_learner_id AND t.course_id = v_course
    LIMIT 1
  ),
  course_cohort AS (
    SELECT t.legos_per_week AS v FROM lpr t WHERE t.course_id = v_course
  ),
  course_agg AS (
    SELECT
      ROUND(AVG(v), 1)::numeric          AS avg_v,
      COUNT(*)::int                      AS n,
      ARRAY_AGG(v ORDER BY v)            AS vals
    FROM course_cohort
  ),
  all_agg AS (
    SELECT ROUND(AVG(legos_per_week), 1)::numeric AS avg_v, COUNT(*)::int AS n
    FROM lpr
  )
  SELECT
    v_course,
    COALESCE((SELECT legos_per_week FROM me), 0)::numeric,
    COALESCE((SELECT legos FROM me), 0)::int,
    (SELECT highest_completed_lego_id FROM me),
    COALESCE(ca.avg_v, 0)::numeric,
    COALESCE(ca.n, 0),
    COALESCE(ca.vals, ARRAY[]::numeric[]),
    -- percentile: share of the course cohort at-or-below this learner (0..100)
    CASE
      WHEN ca.n > 0 AND EXISTS (SELECT 1 FROM me)
      THEN ROUND(
        (SELECT COUNT(*) FROM course_cohort cc WHERE cc.v <= (SELECT legos_per_week FROM me))::numeric
        / ca.n * 100
      )::int
      ELSE 0
    END,
    COALESCE(aa.avg_v, 0)::numeric,
    COALESCE(aa.n, 0)
  FROM course_agg ca CROSS JOIN all_agg aa;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_overview() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_total_learners   BIGINT;
  v_mau              BIGINT;
  v_dau              BIGINT;
  v_total_hours      NUMERIC;
  v_learners_30d_ago BIGINT;
  v_demo_ids         UUID[];                                          -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  SELECT COUNT(*) INTO v_total_learners FROM learners
  WHERE COALESCE(is_demo, false) = false AND COALESCE(is_internal, false) = false;                            -- demo: direct

  -- MAU: distinct learners with a session in last 30 days
  SELECT COUNT(DISTINCT learner_id) INTO v_mau
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '30 days'
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- DAU: distinct learners with a session today
  SELECT COUNT(DISTINCT learner_id) INTO v_dau
  FROM sessions
  WHERE started_at >= CURRENT_DATE
    AND NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- Total practice hours across all enrollments
  SELECT COALESCE(SUM(total_practice_minutes), 0) / 60.0
  INTO v_total_hours
  FROM course_enrollments
  WHERE NOT COALESCE(learner_id = ANY(v_demo_ids), false);          -- demo: learner-keyed

  -- Learners that existed 30 days ago
  SELECT COUNT(*) INTO v_learners_30d_ago
  FROM learners
  WHERE created_at <= NOW() - INTERVAL '30 days'
    AND COALESCE(is_demo, false) = false AND COALESCE(is_internal, false) = false;                           -- demo: direct

  RETURN jsonb_build_object(
    'total_learners',    v_total_learners,
    'mau',               v_mau,
    'dau',               v_dau,
    'dau_mau_ratio',     CASE WHEN v_mau > 0 THEN ROUND(v_dau::NUMERIC / v_mau, 4) ELSE 0 END,
    'total_practice_hours', ROUND(v_total_hours, 1),
    'delta_vs_30d_ago',  v_total_learners - v_learners_30d_ago
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_retention_cohorts(p_weeks integer DEFAULT 12) RETURNS TABLE(cohort_week text, cohort_size integer, w1_pct numeric, w2_pct numeric, w4_pct numeric, w8_pct numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  RETURN QUERY
  WITH cohorts AS (
    -- Assign each learner to their signup week (Monday start)
    SELECT
      l.id AS learner_id,
      date_trunc('week', l.created_at)::DATE AS signup_week,
      l.created_at
    FROM learners l
    WHERE l.created_at <= NOW() - INTERVAL '56 days'  -- at least 8 weeks old
      AND COALESCE(l.is_demo, false) = false AND COALESCE(l.is_internal, false) = false          -- demo: direct (sessions inherit via cohort join)
  ),
  cohort_sizes AS (
    SELECT signup_week, COUNT(*)::INT AS sz
    FROM cohorts
    GROUP BY signup_week
  ),
  retention AS (
    SELECT
      c.signup_week,
      -- W1: session in days 1-7 after signup
      COUNT(DISTINCT CASE
        WHEN s.started_at BETWEEN c.created_at + INTERVAL '1 day'
                              AND c.created_at + INTERVAL '7 days'
        THEN c.learner_id
      END)::INT AS w1_retained,
      -- W2: session in days 8-14
      COUNT(DISTINCT CASE
        WHEN s.started_at BETWEEN c.created_at + INTERVAL '8 days'
                              AND c.created_at + INTERVAL '14 days'
        THEN c.learner_id
      END)::INT AS w2_retained,
      -- W4: session in days 22-28
      COUNT(DISTINCT CASE
        WHEN s.started_at BETWEEN c.created_at + INTERVAL '22 days'
                              AND c.created_at + INTERVAL '28 days'
        THEN c.learner_id
      END)::INT AS w4_retained,
      -- W8: session in days 50-56
      COUNT(DISTINCT CASE
        WHEN s.started_at BETWEEN c.created_at + INTERVAL '50 days'
                              AND c.created_at + INTERVAL '56 days'
        THEN c.learner_id
      END)::INT AS w8_retained
    FROM cohorts c
    LEFT JOIN sessions s ON s.learner_id = c.learner_id
    GROUP BY c.signup_week
  )
  SELECT
    TO_CHAR(cs.signup_week, 'YYYY-MM-DD') AS cohort_week,
    cs.sz                                  AS cohort_size,
    CASE WHEN cs.sz > 0 THEN ROUND(r.w1_retained::NUMERIC / cs.sz * 100, 1) ELSE 0 END AS w1_pct,
    CASE WHEN cs.sz > 0 THEN ROUND(r.w2_retained::NUMERIC / cs.sz * 100, 1) ELSE 0 END AS w2_pct,
    CASE WHEN cs.sz > 0 THEN ROUND(r.w4_retained::NUMERIC / cs.sz * 100, 1) ELSE 0 END AS w4_pct,
    CASE WHEN cs.sz > 0 THEN ROUND(r.w8_retained::NUMERIC / cs.sz * 100, 1) ELSE 0 END AS w8_pct
  FROM cohort_sizes cs
  JOIN retention r ON r.signup_week = cs.signup_week
  ORDER BY cs.signup_week DESC
  LIMIT p_weeks;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_retention_days_active(p_weeks integer DEFAULT 12) RETURNS TABLE(week_start date, avg_days_active numeric, w7_return_rate numeric, w30_return_rate numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  RETURN QUERY
  WITH week_series AS (
    SELECT generate_series(
      date_trunc('week', NOW())::DATE - ((p_weeks - 1) * INTERVAL '1 week'),
      date_trunc('week', NOW())::DATE,
      INTERVAL '1 week'
    )::DATE AS w_start
  ),
  -- Distinct active (learner, day) pairs per calendar week
  active_days AS (
    SELECT
      date_trunc('week', lso.day)::DATE AS w_start,
      lso.learner_id,
      COUNT(DISTINCT lso.day)::INT       AS days_in_week
    FROM learner_speaking_opportunities lso
    WHERE NOT COALESCE(lso.learner_id = ANY(v_demo_ids), false)     -- demo: learner-keyed
    GROUP BY 1, 2
  ),
  -- Learner count + avg_days per week
  weekly_agg AS (
    SELECT
      ad.w_start,
      COUNT(DISTINCT ad.learner_id)::INT          AS active_learners,
      ROUND(AVG(ad.days_in_week), 2)              AS avg_days
    FROM active_days ad
    GROUP BY 1
  ),
  -- 7-day return: learners active in week W who were also active in week W+1
  w7_return AS (
    SELECT
      a1.w_start,
      COUNT(DISTINCT a2.learner_id)::NUMERIC /
        NULLIF(COUNT(DISTINCT a1.learner_id), 0) * 100 AS return_pct
    FROM active_days a1
    LEFT JOIN active_days a2
      ON a2.learner_id = a1.learner_id
     AND a2.w_start    = a1.w_start + INTERVAL '1 week'
    GROUP BY 1
  ),
  -- 30-day return: learners active in week W who were active in any of the 4 weeks starting W+4
  w30_return AS (
    SELECT
      a1.w_start,
      COUNT(DISTINCT a2.learner_id)::NUMERIC /
        NULLIF(COUNT(DISTINCT a1.learner_id), 0) * 100 AS return_pct
    FROM active_days a1
    LEFT JOIN active_days a2
      ON a2.learner_id = a1.learner_id
     AND a2.w_start   >= a1.w_start + INTERVAL '4 weeks'
     AND a2.w_start   <= a1.w_start + INTERVAL '7 weeks'
    GROUP BY 1
  )
  SELECT
    ws.w_start                                       AS week_start,
    COALESCE(wa.avg_days,          0)                AS avg_days_active,
    ROUND(COALESCE(r7.return_pct,  0), 1)            AS w7_return_rate,
    ROUND(COALESCE(r30.return_pct, 0), 1)            AS w30_return_rate
  FROM week_series ws
  LEFT JOIN weekly_agg  wa  ON wa.w_start  = ws.w_start
  LEFT JOIN w7_return   r7  ON r7.w_start  = ws.w_start
  LEFT JOIN w30_return  r30 ON r30.w_start = ws.w_start
  ORDER BY ws.w_start;
END;
$$;

CREATE OR REPLACE FUNCTION public.analytics_trial_conversion() RETURNS TABLE(stage text, label text, learner_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  -- learner-to-first-event lookup reused across all stages
  v_demo_ids UUID[];                                                -- demo: id set
BEGIN
  IF NOT is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true OR is_internal = true; -- demo: resolve

  -- Build the funnel from player_events + subscriptions.
  -- The JOIN hazard: player_events.user_id is UUID; learners.user_id is TEXT.
  -- We work entirely inside player_events using its UUID user_id for dedup.
  RETURN QUERY
  WITH

  -- Stage 1: any authenticated learner who has ever fired an event
  stage1 AS (
    SELECT DISTINCT user_id
    FROM   player_events
    WHERE  user_id IS NOT NULL
      AND  NOT COALESCE(user_id = ANY(v_demo_ids), false)           -- demo: learner-keyed
  ),

  -- Per-learner first-event timestamp
  first_events AS (
    SELECT
      user_id,
      MIN(occurred_at) AS first_at
    FROM   player_events
    WHERE  user_id IS NOT NULL
      AND  NOT COALESCE(user_id = ANY(v_demo_ids), false)           -- demo: learner-keyed
    GROUP  BY user_id
  ),

  -- Stage 2: returned on a calendar day AFTER their first event
  stage2 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at::DATE > fe.first_at::DATE
  ),

  -- Stage 3: had any event >= (first_at + 4 days)
  stage3 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at >= fe.first_at + INTERVAL '4 days'
  ),

  -- Stage 4: had any event >= (first_at + 7 days)
  stage4 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at >= fe.first_at + INTERVAL '7 days'
  ),

  -- Stage 5: converted — subscriptions with a paid/active status.
  -- Joined on subscriptions.learner_id (UUID) which matches learners.id (UUID),
  -- then bridged to player_events.user_id via learners.user_id::uuid.
  -- The column learners.user_id is TEXT; cast to uuid for the join.
  stage5 AS (
    SELECT DISTINCT pe.user_id
    FROM   subscriptions  sub
    JOIN   learners        l   ON l.id = sub.learner_id
    JOIN   player_events   pe  ON pe.user_id = l.user_id::uuid
    WHERE  sub.status IN ('active', 'past_due', 'paused')
      AND  COALESCE(l.is_demo, false) = false AND COALESCE(l.is_internal, false) = false                       -- demo: direct
  )

  -- Return the five rows in funnel order
  SELECT 'trial_started'::TEXT,  'Trial started'::TEXT,  COUNT(*)::BIGINT FROM stage1
  UNION ALL
  SELECT 'day1_session'::TEXT,   'Day-1 session'::TEXT,  COUNT(*)::BIGINT FROM stage2
  UNION ALL
  SELECT 'day4_return'::TEXT,    'Day-4 return'::TEXT,   COUNT(*)::BIGINT FROM stage3
  UNION ALL
  SELECT 'day7_active'::TEXT,    'Day-7 active'::TEXT,   COUNT(*)::BIGINT FROM stage4
  UNION ALL
  SELECT 'converted'::TEXT,      'Converted'::TEXT,      COUNT(*)::BIGINT FROM stage5;

END;
$$;

COMMENT ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) IS 'Learner-scoped Rate-compare: one learner''s LEGOs/week (lifetime pace) vs the course-cohort average and the all-learners average, EXCLUDING is_demo AND is_internal learners. Source: course_enrollments.highest_completed_lego_id ordinal / weeks active. SECURITY DEFINER, authenticated. Returns anonymised cohort values; no other learner identity leaks. Never throws.';

NOTIFY pgrst, 'reload schema';
