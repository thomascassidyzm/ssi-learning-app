-- Analytics RPC Functions
-- 8 Supabase RPC functions for the admin analytics dashboard and learner journey stats.
-- Functions 1-7: SECURITY DEFINER with is_god_user() gate (admin-only).
-- Function 8 (learner_journey_stats): RLS-safe, uses auth.uid() for per-user data.
--
-- Run manually in Supabase SQL editor.

-- ============================================
-- BELT HELPER (internal)
-- Maps a seed count to a belt name.
-- ============================================

CREATE OR REPLACE FUNCTION _seed_to_belt(seed_count NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN seed_count >= 400 THEN 'Black'
    WHEN seed_count >= 280 THEN 'Brown'
    WHEN seed_count >= 150 THEN 'Purple'
    WHEN seed_count >= 80  THEN 'Blue'
    WHEN seed_count >= 40  THEN 'Green'
    WHEN seed_count >= 20  THEN 'Orange'
    WHEN seed_count >= 8   THEN 'Yellow'
    ELSE 'White'
  END;
$function$;


-- ============================================
-- 1. analytics_overview()
-- ============================================

CREATE OR REPLACE FUNCTION analytics_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_total_learners   BIGINT;
  v_mau              BIGINT;
  v_dau              BIGINT;
  v_total_hours      NUMERIC;
  v_learners_30d_ago BIGINT;
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  SELECT COUNT(*) INTO v_total_learners FROM learners;

  -- MAU: distinct learners with a session in last 30 days
  SELECT COUNT(DISTINCT learner_id) INTO v_mau
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '30 days';

  -- DAU: distinct learners with a session today
  SELECT COUNT(DISTINCT learner_id) INTO v_dau
  FROM sessions
  WHERE started_at >= CURRENT_DATE;

  -- Total practice hours across all enrollments
  SELECT COALESCE(SUM(total_practice_minutes), 0) / 60.0
  INTO v_total_hours
  FROM course_enrollments;

  -- Learners that existed 30 days ago
  SELECT COUNT(*) INTO v_learners_30d_ago
  FROM learners
  WHERE created_at <= NOW() - INTERVAL '30 days';

  RETURN jsonb_build_object(
    'total_learners',    v_total_learners,
    'mau',               v_mau,
    'dau',               v_dau,
    'dau_mau_ratio',     CASE WHEN v_mau > 0 THEN ROUND(v_dau::NUMERIC / v_mau, 4) ELSE 0 END,
    'total_practice_hours', ROUND(v_total_hours, 1),
    'delta_vs_30d_ago',  v_total_learners - v_learners_30d_ago
  );
END;
$function$;


-- ============================================
-- 2. analytics_growth(p_period, p_count)
-- ============================================

CREATE OR REPLACE FUNCTION analytics_growth(
  p_period TEXT DEFAULT 'week',
  p_count  INT  DEFAULT 12
)
RETURNS TABLE(
  period_start         TIMESTAMPTZ,
  new_users            INT,
  enrollments_by_course JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

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
$function$;


-- ============================================
-- 3. analytics_engagement()
-- ============================================

CREATE OR REPLACE FUNCTION analytics_engagement()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_dau   BIGINT;
  v_wau   BIGINT;
  v_mau   BIGINT;
  v_avg_duration NUMERIC;
  v_avg_sessions_pw NUMERIC;
  v_freq_dist  JSONB;
  v_dur_dist   JSONB;
  v_belt_avg   JSONB;
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  -- DAU
  SELECT COUNT(DISTINCT learner_id) INTO v_dau
  FROM sessions WHERE started_at >= CURRENT_DATE;

  -- WAU
  SELECT COUNT(DISTINCT learner_id) INTO v_wau
  FROM sessions WHERE started_at >= NOW() - INTERVAL '7 days';

  -- MAU
  SELECT COUNT(DISTINCT learner_id) INTO v_mau
  FROM sessions WHERE started_at >= NOW() - INTERVAL '30 days';

  -- Average session duration (last 30 days)
  SELECT COALESCE(AVG(duration_seconds), 0) INTO v_avg_duration
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '30 days'
    AND duration_seconds > 0;

  -- Average sessions per user per week (last 28 days)
  SELECT CASE
    WHEN COUNT(DISTINCT learner_id) > 0
    THEN ROUND(COUNT(*)::NUMERIC / COUNT(DISTINCT learner_id) / 4, 2)
    ELSE 0
  END INTO v_avg_sessions_pw
  FROM sessions
  WHERE started_at >= NOW() - INTERVAL '28 days';

  -- Session frequency distribution (sessions per week per user, last 28 days)
  WITH user_weekly AS (
    SELECT learner_id, ROUND(COUNT(*)::NUMERIC / 4, 0)::INT AS sessions_per_week
    FROM sessions
    WHERE started_at >= NOW() - INTERVAL '28 days'
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
$function$;


-- ============================================
-- 4. analytics_retention_cohorts(p_weeks)
-- ============================================

CREATE OR REPLACE FUNCTION analytics_retention_cohorts(p_weeks INT DEFAULT 12)
RETURNS TABLE(
  cohort_week TEXT,
  cohort_size INT,
  w1_pct      NUMERIC,
  w2_pct      NUMERIC,
  w4_pct      NUMERIC,
  w8_pct      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
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
$function$;


-- ============================================
-- 5. analytics_friction_map(p_course_id)
-- ============================================

CREATE OR REPLACE FUNCTION analytics_friction_map(p_course_id TEXT)
RETURNS TABLE(
  seed_number       INT,
  stopped_here_count INT,
  spike_rate         NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_max_seed INT;
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  -- Find the highest seed anyone has reached in this course
  SELECT COALESCE(MAX(highest_completed_seed), 0)
  INTO v_max_seed
  FROM course_enrollments
  WHERE course_id = p_course_id;

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
$function$;


-- ============================================
-- 6. analytics_course_comparison()
-- ============================================

CREATE OR REPLACE FUNCTION analytics_course_comparison()
RETURNS TABLE(
  course_id      TEXT,
  enrolled       INT,
  active_30d     INT,
  avg_seeds      NUMERIC,
  avg_belt       TEXT,
  completion_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  WITH enrollment_stats AS (
    SELECT
      ce.course_id,
      COUNT(*)::INT AS enrolled,
      AVG(COALESCE(ce.highest_completed_seed, 0)) AS avg_s,
      COUNT(*) FILTER (WHERE ce.highest_completed_seed >= 300)::INT AS completed
    FROM course_enrollments ce
    GROUP BY ce.course_id
  ),
  active_stats AS (
    SELECT
      s.course_id,
      COUNT(DISTINCT s.learner_id)::INT AS active_cnt
    FROM sessions s
    WHERE s.started_at >= NOW() - INTERVAL '30 days'
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
$function$;


-- ============================================
-- 7. analytics_entitlement_funnel()
-- ============================================

CREATE OR REPLACE FUNCTION analytics_entitlement_funnel()
RETURNS TABLE(
  code         TEXT,
  label        TEXT,
  redemptions  INT,
  started_session INT,
  retained_30d INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

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
  GROUP BY ec.id, ec.code, ec.label
  ORDER BY redemptions DESC;
END;
$function$;


-- ============================================
-- 8. learner_journey_stats(p_course_id)
-- RLS-safe: uses auth.uid(), NO SECURITY DEFINER
-- ============================================

CREATE OR REPLACE FUNCTION learner_journey_stats(p_course_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_learner_id       UUID;
  v_points           RECORD;
  v_next_threshold   INT;
  v_next_icon        TEXT;
  v_percentile       INT;
  v_weekly_minutes   JSONB;
  v_milestones       JSONB;
BEGIN
  -- Find the learner for the authenticated user
  SELECT id INTO v_learner_id
  FROM learners
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_learner_id IS NULL THEN
    RETURN jsonb_build_object('error', 'learner_not_found');
  END IF;

  -- Get learner points for this course
  SELECT
    lp.total_points,
    lp.evolution_score,
    lp.evolution_level,
    lp.evolution_name
  INTO v_points
  FROM learner_points lp
  WHERE lp.learner_id = v_learner_id
    AND lp.course_id = p_course_id;

  -- Default if no points record yet
  IF v_points IS NULL THEN
    v_points := ROW(0, 0, 1, 'First Words');
  END IF;

  -- Next evolution level threshold
  SELECT el.min_score, el.icon INTO v_next_threshold, v_next_icon
  FROM evolution_levels el
  WHERE el.level = v_points.evolution_level + 1;

  -- If already max level, use current level values
  IF v_next_threshold IS NULL THEN
    SELECT el.min_score, el.icon INTO v_next_threshold, v_next_icon
    FROM evolution_levels el
    WHERE el.level = v_points.evolution_level;
  END IF;

  -- Percentile from weekly leaderboard
  SELECT wl.top_percentile INTO v_percentile
  FROM weekly_leaderboard wl
  WHERE wl.learner_id = v_learner_id
    AND wl.course_id = p_course_id;

  -- Weekly minutes: array of 7 numbers for last 7 days (index 0 = 6 days ago, index 6 = today)
  WITH day_series AS (
    SELECT generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day'::INTERVAL)::DATE AS d
  ),
  daily_mins AS (
    SELECT
      ds.d,
      COALESCE(SUM(s.duration_seconds) / 60, 0)::INT AS mins
    FROM day_series ds
    LEFT JOIN sessions s
      ON s.learner_id = v_learner_id
      AND s.course_id = p_course_id
      AND s.started_at::DATE = ds.d
    GROUP BY ds.d
  )
  SELECT jsonb_agg(mins ORDER BY d)
  INTO v_weekly_minutes
  FROM daily_mins;

  -- Milestones
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'milestone_type', lm.milestone_type,
      'achieved_at',    lm.achieved_at,
      'display_text',   lm.display_text,
      'display_icon',   lm.display_icon,
      'metadata',       lm.metadata
    ) ORDER BY lm.achieved_at DESC
  ), '[]'::JSONB)
  INTO v_milestones
  FROM learner_milestones lm
  WHERE lm.learner_id = v_learner_id
    AND lm.course_id = p_course_id;

  RETURN jsonb_build_object(
    'evolution_score',        v_points.evolution_score,
    'evolution_level',        v_points.evolution_level,
    'evolution_name',         v_points.evolution_name,
    'evolution_icon',         v_next_icon,
    'next_level_threshold',   v_next_threshold,
    'percentile_this_week',   COALESCE(v_percentile, 0),
    'total_points',           v_points.total_points,
    'weekly_minutes',         COALESCE(v_weekly_minutes, '[]'::JSONB),
    'milestones',             v_milestones
  );
END;
$function$;
