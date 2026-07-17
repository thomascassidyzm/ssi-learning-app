--
-- ============================================================================
-- SSi Learning App — CURRENT DATABASE SCHEMA  (canonical source of truth)
-- ============================================================================
-- Schema-only snapshot of the live Supabase Postgres `public` schema: every
-- table, function/RPC, RLS policy, grant, index and trigger exactly as it
-- exists in production right now. This file IS the record of current DB state.
--
-- Regenerate after ANY applied DB change:   ./supabase/snapshot-schema.sh
--   (runs `pg_dump --schema=public --schema-only` against the live DB)
--
-- The supabase/migrations/ directory is retained as HISTORY. Read current
-- state from THIS file, not by replaying migrations.
-- ============================================================================
--
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'SSi Learning App schema with schools system. Migration: 20260120100000_schools_system.sql';


--
-- Name: content_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.content_status AS ENUM (
    'draft',
    'beta',
    'released',
    'deprecated'
);


--
-- Name: TYPE content_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.content_status IS 'Lifecycle status: draft (in development), released (live), deprecated (superseded)';


--
-- Name: lego_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.lego_type AS ENUM (
    'A',
    'M'
);


--
-- Name: TYPE lego_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.lego_type IS 'LEGO classification: A (Atomic - single unit), M (Molecular - multi-word)';


--
-- Name: _seed_to_belt(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._seed_to_belt(seed_count numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
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
$$;


--
-- Name: accrue_teacher_commission(uuid, date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accrue_teacher_commission(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO teacher_commissions (teacher_id, period_start, period_end, accrued_pence, status)
  VALUES (p_teacher_id, p_period_start, p_period_end, GREATEST(p_pence, 0), 'accruing')
  ON CONFLICT (teacher_id, period_start) DO UPDATE
    SET accrued_pence = teacher_commissions.accrued_pence + EXCLUDED.accrued_pence,
        updated_at    = NOW();
$$;


--
-- Name: accrue_teacher_commission_held(uuid, date, date, integer, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO teacher_commissions (teacher_id, period_start, period_end, accrued_pence, status, hold_until)
  VALUES (p_teacher_id, p_period_start, p_period_end, GREATEST(p_pence, 0), 'held', p_hold_until)
  ON CONFLICT (teacher_id, period_start) DO UPDATE
    SET accrued_pence = teacher_commissions.accrued_pence + EXCLUDED.accrued_pence,
        -- keep the row 'held' only while it is still accruing/held; never
        -- resurrect a paid/pending/failed row's status.
        status = CASE
                   WHEN teacher_commissions.status IN ('accruing', 'held') THEN 'held'
                   ELSE teacher_commissions.status
                 END,
        hold_until = GREATEST(
          COALESCE(teacher_commissions.hold_until, EXCLUDED.hold_until),
          EXCLUDED.hold_until
        ),
        updated_at = NOW();
$$;


--
-- Name: activate_brief_version(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_brief_version(p_known_code text, p_target_code text, p_version text) RETURNS TABLE(success boolean, previous_active_version text, new_active_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_previous_version TEXT;
  v_new_id UUID;
BEGIN
  -- Get current active version
  SELECT version INTO v_previous_version
  FROM language_briefs
  WHERE known_code = p_known_code
    AND target_code = p_target_code
    AND is_active = true;

  -- Deactivate all versions for this pair
  UPDATE language_briefs
  SET is_active = false
  WHERE known_code = p_known_code AND target_code = p_target_code;

  -- Activate the requested version
  UPDATE language_briefs
  SET is_active = true
  WHERE known_code = p_known_code
    AND target_code = p_target_code
    AND version = p_version
  RETURNING id INTO v_new_id;

  -- Return result
  RETURN QUERY SELECT
    v_new_id IS NOT NULL AS success,
    v_previous_version AS previous_active_version,
    v_new_id AS new_active_id;
END;
$$;


--
-- Name: activate_prompt_version(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_prompt_version(p_phase_code text, p_version text) RETURNS TABLE(success boolean, previous_active_version text, new_active_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_previous_version TEXT;
  v_new_id UUID;
BEGIN
  -- Get current active version
  SELECT version INTO v_previous_version
  FROM phase_prompts
  WHERE phase_code = p_phase_code AND is_active = true;

  -- Deactivate all versions for this phase
  UPDATE phase_prompts
  SET is_active = false
  WHERE phase_code = p_phase_code;

  -- Activate the requested version
  UPDATE phase_prompts
  SET is_active = true
  WHERE phase_code = p_phase_code AND version = p_version
  RETURNING id INTO v_new_id;

  -- Return result
  RETURN QUERY SELECT
    v_new_id IS NOT NULL AS success,
    v_previous_version AS previous_active_version,
    v_new_id AS new_active_id;
END;
$$;


--
-- Name: admin_practice_minutes(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) RETURNS TABLE(learner_id uuid, practice_minutes integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.learner_id,
         round(sum(s.duration_seconds) / 60.0)::int as practice_minutes
  from sessions s
  where s.learner_id = any(p_learner_ids)
  group by s.learner_id;
$$;


--
-- Name: admin_practice_minutes_by_course(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(course_code text, practice_minutes integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.course_id as course_code,
         round(sum(s.duration_seconds) / 60.0)::int as practice_minutes
  from sessions s
  where (p_learner_ids is null or s.learner_id = any(p_learner_ids))
  group by s.course_id;
$$;


--
-- Name: admin_user_course_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_user_course_stats(p_learner_id uuid) RETURNS TABLE(course_code text, seeds_touched bigint, legos_seen bigint, total_plays bigint, cycles bigint, active_minutes bigint, active_seconds bigint, active_days bigint, highest_completed_lego_id text, last_active timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  RETURN QUERY
  WITH plays AS (
    SELECT pe.course_code,
           COUNT(DISTINCT pe.payload->>'seedId') AS seeds_touched,
           COUNT(DISTINCT pe.payload->>'legoId') AS legos_seen,
           COUNT(*)                              AS total_plays,
           MAX(pe.occurred_at)                   AS last_play
    FROM public.player_events pe
    WHERE pe.user_id = p_learner_id
      AND pe.event_type = 'audio_play'
      AND pe.course_code IS NOT NULL
    GROUP BY pe.course_code
  ),
  opps AS (
    SELECT lso.course_code,
           SUM(lso.opportunities)   AS cycles,
           SUM(lso.play_seconds)/60 AS active_minutes,
           SUM(lso.play_seconds)    AS active_seconds,
           COUNT(DISTINCT lso.day)  AS active_days,
           MAX(lso.day)             AS last_day
    FROM public.learner_speaking_opportunities lso
    WHERE lso.learner_id = p_learner_id
    GROUP BY lso.course_code
  ),
  enr AS (
    SELECT ce.course_id AS course_code,
           ce.highest_completed_lego_id,
           ce.last_practiced_at
    FROM public.course_enrollments ce
    WHERE ce.learner_id = p_learner_id
  ),
  keys AS (
    SELECT course_code FROM plays
    UNION SELECT course_code FROM opps
    UNION SELECT course_code FROM enr
  )
  SELECT k.course_code,
         COALESCE(p.seeds_touched, 0),
         COALESCE(p.legos_seen, 0),
         COALESCE(p.total_plays, 0),
         COALESCE(o.cycles, 0),
         COALESCE(o.active_minutes, 0),
         COALESCE(o.active_seconds, 0),
         COALESCE(o.active_days, 0),
         e.highest_completed_lego_id,
         -- GREATEST skips NULLs; o.last_day::timestamptz (no +1) is midnight UTC
         -- of the actual last active day, so a real same-day occurred_at wins.
         GREATEST(p.last_play, e.last_practiced_at, o.last_day::timestamptz) AS last_active
  FROM keys k
  LEFT JOIN plays p ON p.course_code = k.course_code
  LEFT JOIN opps  o ON o.course_code = k.course_code
  LEFT JOIN enr   e ON e.course_code = k.course_code
  ORDER BY GREATEST(
    COALESCE(p.last_play, 'epoch'::timestamptz),
    COALESCE(e.last_practiced_at, 'epoch'::timestamptz),
    COALESCE(o.last_day::timestamptz, 'epoch'::timestamptz)
  ) DESC;
END;
$$;


--
-- Name: admin_user_navigation(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_user_navigation(p_learner_id uuid, p_days integer DEFAULT 90) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => p_days);
  v_fwd bigint; v_back bigint; v_replay bigint;
  v_turbo bigint; v_pause bigint; v_play bigint;
  v_skip_events text[] := ARRAY['tap_skip','lego_skip','phase_skip','belt_skip'];
BEGIN
  IF NOT public.is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE event_type = ANY(v_skip_events) AND payload->>'direction' = 'forward'),
    COUNT(*) FILTER (WHERE event_type = ANY(v_skip_events) AND payload->>'direction' = 'back'),
    COUNT(*) FILTER (WHERE event_type = 'phase_skip'     AND payload->>'direction' = 'replay'),
    COUNT(*) FILTER (WHERE event_type = 'turbo_toggle'),
    COUNT(*) FILTER (WHERE event_type = 'tap_pause'),
    COUNT(*) FILTER (WHERE event_type = 'tap_play')
  INTO v_fwd, v_back, v_replay, v_turbo, v_pause, v_play
  FROM public.player_events
  WHERE user_id = p_learner_id
    AND occurred_at >= v_since;

  RETURN jsonb_build_object(
    'forward', v_fwd, 'back', v_back, 'replay', v_replay,
    'turbo', v_turbo, 'pause', v_pause, 'play', v_play,
    'flow_score', CASE WHEN (v_fwd + v_back) > 0
                       THEN round(v_fwd::numeric / (v_fwd + v_back), 3)
                       ELSE NULL END
  );
END;
$$;


--
-- Name: analytics_class_coverage(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_class_coverage(p_days integer DEFAULT 90) RETURNS TABLE(class_id uuid, class_name text, course_code text, furthest_lego_id text, legos_advanced integer, active_minutes numeric, active_weeks numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_god_user() THEN
    RAISE EXCEPTION 'analytics_class_coverage: admin only';
  END IF;

  RETURN QUERY
  WITH lego_order AS (
    -- canonical position of every lego within its course (1-based, dense by design
    -- since lego_id is unique per course). This is the ground truth for "how many
    -- legos lie between two positions" — the thing legos_advanced must measure.
    SELECT
      cl.course_code,
      cl.lego_id,
      ROW_NUMBER() OVER (
        PARTITION BY cl.course_code
        ORDER BY cl.seed_number, cl.lego_index
      ) AS ord
    FROM public.course_legos cl
  ),
  sess AS (
    -- the window's sessions, scoped to non-demo classes, carrying the class's course
    SELECT
      s.class_id,
      c.course_code,
      s.start_lego_id,
      s.end_lego_id,
      s.duration_seconds,
      s.started_at
    FROM public.class_sessions s
    JOIN public.classes c ON c.id = s.class_id
    LEFT JOIN public.schools sc ON sc.id = c.school_id
    WHERE s.started_at >= now() - make_interval(days => p_days)
      AND COALESCE(sc.is_demo, false) = false      -- drop demo schools; keep NULL-school (ACT)
  ),
  windowed AS (
    -- map each session's start/end lego_id to its canonical ordinal (per course)
    SELECT
      se.class_id,
      se.course_code,
      se.duration_seconds,
      se.started_at,
      lo_s.ord AS start_ord,
      lo_e.ord AS end_ord
    FROM sess se
    LEFT JOIN lego_order lo_s
      ON lo_s.course_code = se.course_code AND lo_s.lego_id = se.start_lego_id
    LEFT JOIN lego_order lo_e
      ON lo_e.course_code = se.course_code AND lo_e.lego_id = se.end_lego_id
  ),
  agg AS (
    SELECT
      w.class_id,
      w.course_code,
      MAX(GREATEST(COALESCE(w.end_ord, 0), COALESCE(w.start_ord, 0))) AS furthest_ord,
      MIN(COALESCE(w.start_ord, w.end_ord))                           AS earliest_ord,
      SUM(w.duration_seconds)                                         AS total_seconds,
      MIN(w.started_at)                                               AS first_at,
      MAX(w.started_at)                                               AS last_at
    FROM windowed w
    GROUP BY w.class_id, w.course_code
  )
  SELECT
    a.class_id,
    c.class_name,
    c.course_code,
    fl.lego_id                                                         AS furthest_lego_id,
    -- true count of legos advanced: furthest ordinal minus earliest start ordinal,
    -- floored at 0 (a class that only ever replayed the same lego covers 0 ground).
    GREATEST(COALESCE(a.furthest_ord, 0) - COALESCE(a.earliest_ord, a.furthest_ord), 0)::int AS legos_advanced,
    ROUND(COALESCE(a.total_seconds, 0) / 60.0, 1)                      AS active_minutes,
    -- wall-clock span of activity in weeks, floored at one day so single-session
    -- classes don't divide by ~0 (the TS resolver also floors, belt-and-braces).
    GREATEST(EXTRACT(EPOCH FROM (a.last_at - a.first_at)) / 604800.0, 1.0 / 7.0)::numeric AS active_weeks
  FROM agg a
  JOIN public.classes c ON c.id = a.class_id
  LEFT JOIN lego_order fl
    ON fl.course_code = a.course_code AND fl.ord = NULLIF(a.furthest_ord, 0)
  ORDER BY legos_advanced DESC;
END;
$$;


--
-- Name: analytics_class_sessions_scoped(uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_class_sessions_scoped(p_class_ids uuid[], p_days integer DEFAULT 90) RETURNS TABLE(class_id uuid, course_code text, start_lego_id text, end_lego_id text, start_ord integer, end_ord integer, duration_seconds integer, started_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH lego_order AS (
    -- canonical position of every lego within its course (1-based) — same
    -- ground truth analytics_class_coverage uses for "legos advanced".
    SELECT
      cl.course_code,
      cl.lego_id,
      ROW_NUMBER() OVER (
        PARTITION BY cl.course_code
        ORDER BY cl.seed_number, cl.lego_index
      ) AS ord
    FROM public.course_legos cl
  ),
  sess AS (
    SELECT
      s.class_id,
      c.course_code,
      s.start_lego_id,
      s.end_lego_id,
      s.duration_seconds,
      s.started_at
    FROM public.class_sessions s
    JOIN public.classes c ON c.id = s.class_id
    LEFT JOIN public.schools sc ON sc.id = c.school_id
    WHERE s.class_id = ANY(p_class_ids)
      AND s.started_at >= now() - make_interval(days => GREATEST(p_days, 1))
      AND COALESCE(sc.is_demo, false) = false   -- drop demo schools; keep NULL-school (ACT)
  )
  SELECT
    se.class_id,
    se.course_code,
    se.start_lego_id,
    se.end_lego_id,
    lo_s.ord::integer AS start_ord,   -- ROW_NUMBER() is bigint; cast to match RETURNS TABLE
    lo_e.ord::integer AS end_ord,
    se.duration_seconds,
    se.started_at
  FROM sess se
  LEFT JOIN lego_order lo_s
    ON lo_s.course_code = se.course_code AND lo_s.lego_id = se.start_lego_id
  LEFT JOIN lego_order lo_e
    ON lo_e.course_code = se.course_code AND lo_e.lego_id = se.end_lego_id;
END;
$$;


--
-- Name: analytics_course_comparison(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_course_comparison() RETURNS TABLE(course_id text, enrolled integer, active_30d integer, avg_seeds numeric, avg_belt text, completion_pct numeric)
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


--
-- Name: analytics_course_value(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_course_value() RETURNS TABLE(course_code text, reach bigint, enrolled bigint, stickiness_hours numeric, retention_pct numeric, ltv_proxy numeric)
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


--
-- Name: analytics_difficulty_turns(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_difficulty_turns(p_days integer DEFAULT 30, p_min_samples integer DEFAULT 5) RETURNS TABLE(learner_id uuid, learner_name text, lego_id text, course_code text, recent_latency_samples jsonb, last_seen_at timestamp with time zone)
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


--
-- Name: analytics_engagement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_engagement() RETURNS jsonb
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


--
-- Name: analytics_entitlement_funnel(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_entitlement_funnel() RETURNS TABLE(code text, label text, redemptions integer, started_session integer, retained_30d integer)
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


--
-- Name: analytics_friction_extended(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_friction_extended(p_course_id text) RETURNS TABLE(seed_band text, band_min integer, band_max integer, skip_back_count bigint, audio_failed_count bigint)
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


--
-- Name: analytics_friction_map(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_friction_map(p_course_id text) RETURNS TABLE(seed_number integer, stopped_here_count integer, spike_rate numeric)
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


--
-- Name: analytics_growth(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_growth(p_period text DEFAULT 'week'::text, p_count integer DEFAULT 12) RETURNS TABLE(period_start timestamp with time zone, new_users integer, enrollments_by_course jsonb)
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


--
-- Name: analytics_health(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_health(p_days integer DEFAULT 30) RETURNS jsonb
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


--
-- Name: analytics_learner_progress_rate(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text DEFAULT NULL::text) RETURNS TABLE(course_code text, entity_value numeric, entity_legos integer, furthest_lego_id text, course_avg numeric, course_n integer, course_values numeric[], course_percentile integer, all_avg numeric, all_n integer)
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


--
-- Name: FUNCTION analytics_learner_progress_rate(p_learner_id uuid, p_course_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) IS 'Learner-scoped Rate-compare: one learner''s LEGOs/week (lifetime pace) vs the course-cohort average and the all-learners average, EXCLUDING is_demo AND is_internal learners. Source: course_enrollments.highest_completed_lego_id ordinal / weeks active. SECURITY DEFINER, authenticated. Returns anonymised cohort values; no other learner identity leaks. Never throws.';


--
-- Name: analytics_overview(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_overview() RETURNS jsonb
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


--
-- Name: analytics_retention_cohorts(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_retention_cohorts(p_weeks integer DEFAULT 12) RETURNS TABLE(cohort_week text, cohort_size integer, w1_pct numeric, w2_pct numeric, w4_pct numeric, w8_pct numeric)
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


--
-- Name: analytics_retention_days_active(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_retention_days_active(p_weeks integer DEFAULT 12) RETURNS TABLE(week_start date, avg_days_active numeric, w7_return_rate numeric, w30_return_rate numeric)
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


--
-- Name: FUNCTION analytics_retention_days_active(p_weeks integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_retention_days_active(p_weeks integer) IS 'Admin-only time-series: avg days-active per learner/week + 7d and 30d return rates. Source: learner_speaking_opportunities. SECURITY DEFINER, is_god_user() gated.';


--
-- Name: analytics_trial_conversion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.analytics_trial_conversion() RETURNS TABLE(stage text, label text, learner_count bigint)
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


--
-- Name: FUNCTION analytics_trial_conversion(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.analytics_trial_conversion() IS 'Five-stage trial→paid funnel: trial_started → day1_session → day4_return → day7_active → converted. Source: player_events + subscriptions. SECURITY DEFINER, is_god_user() gated. Returns well-formed zero rows when subscriptions is empty.';


--
-- Name: audio_normalize_text(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audio_normalize_text() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.text_normalized := normalize_text(NEW.text);
  RETURN NEW;
END;
$$;


--
-- Name: audit_content_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_content_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  pk_val TEXT;
  old_json JSONB;
  new_json JSONB;
  k TEXT;
  has_overwrite BOOLEAN := false;
  -- auto-maintained bookkeeping columns bump on every UPDATE; they are not
  -- editorial content, so changes to them alone must not trigger an audit.
  ignore_cols TEXT[] := ARRAY['version','updated_at','created_at'];
BEGIN
  old_json := to_jsonb(OLD);

  -- Only audit a change that OVERWRITES pre-existing (non-null) editorial data,
  -- or a DELETE. A pure first-fill (changed columns went from NULL/absent to a
  -- value, as in automated course builds writing content for the first time)
  -- carries no rollback value and is skipped.
  IF TG_OP = 'UPDATE' THEN
    new_json := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_json) LOOP
      IF NOT (k = ANY(ignore_cols))
         AND (old_json->k) IS DISTINCT FROM (new_json->k)
         AND (old_json->k) IS NOT NULL
         AND jsonb_typeof(old_json->k) <> 'null' THEN
        has_overwrite := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT has_overwrite THEN
      RETURN NULL;
    END IF;
  END IF;

  pk_val := COALESCE(
    old_json->>'id', old_json->>'course_code', old_json->>'lego_id',
    old_json->>'seed_id', old_json->>'voice_id'
  );

  INSERT INTO content_audit_log (
    table_name, change_type, primary_key, old_row, changed_by_uid
  ) VALUES (
    TG_TABLE_NAME, TG_OP, pk_val, old_json, auth.uid()
  );

  RETURN NULL;
END;
$$;


--
-- Name: audit_log_prune(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_log_prune(retention_days integer DEFAULT 7) RETURNS TABLE(deleted_count bigint, deleted_through timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    SET statement_timeout TO '5min'
    AS $$
DECLARE
  cutoff       timestamptz := now() - make_interval(days => retention_days);
  total        bigint := 0;
  batch_count  bigint;
  batch_size   constant int := 10000;
BEGIN
  -- Loop batched DELETE so each iteration stays short enough to keep WAL
  -- happy and not block other writes. Exit as soon as a batch returns no
  -- rows (we've reached the retention boundary).
  LOOP
    DELETE FROM content_audit_log
    WHERE id IN (
      SELECT id FROM content_audit_log
      WHERE changed_at < cutoff
      LIMIT batch_size
    );
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    total := total + batch_count;
    EXIT WHEN batch_count = 0;
  END LOOP;

  RAISE LOG '[audit_log_prune] retention_days=% cutoff=% deleted=%', retention_days, cutoff, total;
  RETURN QUERY SELECT total, cutoff;
END;
$$;


--
-- Name: FUNCTION audit_log_prune(retention_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_log_prune(retention_days integer) IS 'Batched delete of content_audit_log rows older than retention_days. Called daily by pg_cron job audit-log-daily-prune.';


--
-- Name: auto_entitle_popty_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_entitle_popty_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.platform_role IN ('popty_user', 'ssi_admin', 'tester')
     AND (OLD.platform_role IS DISTINCT FROM NEW.platform_role) THEN
    -- Check if they already have a full entitlement (avoid duplicates)
    IF NOT EXISTS (
      SELECT 1 FROM user_entitlements
      WHERE learner_id = NEW.id
        AND access_type = 'full'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      INSERT INTO user_entitlements (learner_id, access_type, expires_at)
      VALUES (NEW.id, 'full', NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: bulk_update_syllables(uuid[], integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_update_syllables(p_ids uuid[], p_syllables integer[]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
  DECLARE
    rows_updated INTEGER;
  BEGIN
    IF array_length(p_ids, 1) != array_length(p_syllables, 1) THEN
      RAISE EXCEPTION 'Array lengths must match';
    END IF;

    UPDATE course_practice_phrases AS cpp
    SET target_syllable_count = data.syllables
    FROM (
      SELECT
        unnest(p_ids) AS id,
        unnest(p_syllables) AS syllables
    ) AS data
    WHERE cpp.id = data.id;

    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated;
  END;
  $$;


--
-- Name: bump_course_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_course_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_course_code text;
  v_should_bump boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_course_code := OLD.course_code;
    v_should_bump := true;
  ELSIF TG_OP = 'INSERT' THEN
    v_course_code := NEW.course_code;
    v_should_bump := true;
  ELSE  -- UPDATE
    v_course_code := NEW.course_code;
    v_should_bump :=
         NEW.target_text  IS DISTINCT FROM OLD.target_text
      OR NEW.known_text   IS DISTINCT FROM OLD.known_text
      OR NEW.seed_number  IS DISTINCT FROM OLD.seed_number
      OR NEW.lego_index   IS DISTINCT FROM OLD.lego_index
      OR NEW.components   IS DISTINCT FROM OLD.components;
  END IF;

  IF v_should_bump AND v_course_code IS NOT NULL THEN
    UPDATE courses
    SET version = version + 1
    WHERE course_code = v_course_code;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: FUNCTION bump_course_version(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.bump_course_version() IS 'Increments courses.version for the affected course_code whenever course_legos sees a meaningful mutation. Used as cache-busting key for the round-map and decomposition-staleness checks.';


--
-- Name: bump_speaking_opportunities(uuid, text, bigint, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint DEFAULT 0, p_seconds_delta bigint DEFAULT 0) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM learners
    WHERE id = p_learner_id
      AND user_id = auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'unauthorized: learner_id does not belong to caller'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO learner_speaking_opportunities AS lso
    (learner_id, course_code, day, opportunities, play_seconds)
  VALUES
    (p_learner_id, p_course_code, (now() AT TIME ZONE 'UTC')::date,
     GREATEST(p_opps_delta, 0), GREATEST(p_seconds_delta, 0))
  ON CONFLICT (learner_id, course_code, day) DO UPDATE
    SET
      opportunities = lso.opportunities + GREATEST(p_opps_delta, 0),
      play_seconds  = lso.play_seconds  + GREATEST(p_seconds_delta, 0),
      updated_at    = now();
END;
$$;


--
-- Name: FUNCTION bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint) IS 'Upsert one row of (learner, course, UTC today) and add the supplied deltas. Called per cycle (opps_delta=1) and periodically for play time (seconds_delta).';


--
-- Name: calculate_consistency_multiplier(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_consistency_multiplier(sessions_10d integer, sessions_30d integer, p_course_id text DEFAULT NULL::text) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  cfg gamification_config;
  mult_10d NUMERIC := 1.0;
  mult_30d NUMERIC := 1.0;
BEGIN
  cfg := get_gamification_config(p_course_id);

  -- 10-day multiplier
  IF sessions_10d >= cfg.consistency_10d_threshold_high THEN
    mult_10d := cfg.consistency_10d_multiplier_high;
  ELSIF sessions_10d >= cfg.consistency_10d_threshold_med THEN
    mult_10d := cfg.consistency_10d_multiplier_med;
  ELSIF sessions_10d >= cfg.consistency_10d_threshold_low THEN
    mult_10d := cfg.consistency_10d_multiplier_low;
  END IF;

  -- 30-day multiplier (stacks)
  IF sessions_30d >= cfg.consistency_30d_threshold_high THEN
    mult_30d := cfg.consistency_30d_multiplier_high;
  ELSIF sessions_30d >= cfg.consistency_30d_threshold_med THEN
    mult_30d := cfg.consistency_30d_multiplier_med;
  ELSIF sessions_30d >= cfg.consistency_30d_threshold_low THEN
    mult_30d := cfg.consistency_30d_multiplier_low;
  END IF;

  RETURN mult_10d * mult_30d;
END;
$$;


--
-- Name: can_view_learner_data(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_learner_data(p_learner_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p_learner_id = public.current_learner_id()
      OR public.is_god_user()
      OR public.is_ssi_admin()
      OR EXISTS (SELECT 1 FROM public.govt_admins g
                 WHERE g.user_id = (auth.uid())::text)
      OR EXISTS (
           SELECT 1
           FROM public.learners l
           JOIN public.user_tags ut
             ON ut.user_id = l.user_id AND ut.removed_at IS NULL
           WHERE l.id = p_learner_id
             AND (
               EXISTS (SELECT 1 FROM public.schools s
                       WHERE ut.tag_value = 'SCHOOL:' || s.id::text
                         AND s.admin_user_id = (auth.uid())::text)
               OR EXISTS (SELECT 1 FROM public.classes c
                          LEFT JOIN public.schools s2 ON s2.id = c.school_id
                          WHERE ut.tag_value = 'CLASS:' || c.id::text
                            AND (c.teacher_user_id = (auth.uid())::text
                                 OR s2.admin_user_id = (auth.uid())::text))
             )
         )
      OR EXISTS (
           SELECT 1 FROM public.classes c
           LEFT JOIN public.schools s3 ON s3.id = c.school_id
           WHERE c.class_learner_id = p_learner_id
             AND (
               c.teacher_user_id = (auth.uid())::text
               OR s3.admin_user_id = (auth.uid())::text
               OR EXISTS (SELECT 1 FROM public.class_teachers ct
                          WHERE ct.class_id = c.id AND ct.teacher_user_id = (auth.uid())::text)
             )
         )
$$;


--
-- Name: check_pass_1_complete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_pass_1_complete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.pass = 'pass_2' AND NEW.status = 'pending' THEN
    IF NOT EXISTS (
      SELECT 1 FROM build_jobs
      WHERE course_code = NEW.course_code
        AND pass = 'pass_1'
        AND status = 'complete'
    ) THEN
      RAISE EXCEPTION 'Cannot start pass_2: pass_1 not complete for course %', NEW.course_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: claim_entitlement_code_use(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_entitlement_code_use(p_id uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE entitlement_codes
     SET use_count = use_count + 1
   WHERE id = p_id
     AND is_active
     AND (max_uses IS NULL OR use_count < max_uses)
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id;
$$;


--
-- Name: claim_invite_code_use(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_invite_code_use(p_id uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE invite_codes
     SET use_count = use_count + 1
   WHERE id = p_id
     AND is_active
     AND (max_uses IS NULL OR use_count < max_uses)
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id;
$$;


--
-- Name: claim_learner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_learner(p_learner_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE old_uid text; my_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'claim_learner: permission denied (not authenticated)';
  END IF;
  my_email := lower(coalesce(auth.jwt()->>'email',''));
  IF my_email = '' THEN
    RAISE EXCEPTION 'claim_learner: permission denied (no email claim)';
  END IF;
  SELECT user_id INTO old_uid FROM public.learners
   WHERE id = p_learner_id
     AND my_email IN (SELECT lower(e)
                      FROM unnest(coalesce(verified_emails, ARRAY[]::text[])) e);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_learner: permission denied (email not verified on learner)';
  END IF;
  UPDATE public.learners SET user_id = (auth.uid())::text WHERE id = p_learner_id;
  RETURN old_uid;
END;
$$;


--
-- Name: compute_group_path(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_group_path() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  DECLARE
    v_parent_path TEXT;
    v_slug TEXT;
  BEGIN
    v_slug := LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'));
    IF NEW.parent_id IS NULL THEN
      NEW.path := v_slug;
    ELSE
      SELECT path INTO v_parent_path FROM groups WHERE id = NEW.parent_id;
      NEW.path := v_parent_path || '/' || v_slug;
    END IF;
    RETURN NEW;
  END;
  $$;


--
-- Name: course_navigation_friction(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.course_navigation_friction(p_course_code text, p_days integer DEFAULT 90) RETURNS TABLE(seed text, back bigint, replay bigint, forward bigint, friction_ratio numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_demo_ids uuid[];
BEGIN
  IF NOT public.is_ssi_admin() THEN
    RAISE EXCEPTION 'Forbidden: admin required';
  END IF;

  SELECT array_agg(id) INTO v_demo_ids FROM public.learners WHERE is_demo = true;

  RETURN QUERY
  WITH nav AS (
    SELECT substring(COALESCE(payload->>'legoId', payload->>'fromLegoId') FROM '^(S[0-9]+)') AS seed,
           payload->>'direction' AS dir
    FROM public.player_events
    WHERE course_code = p_course_code
      AND occurred_at >= now() - make_interval(days => p_days)
      AND event_type IN ('tap_skip','lego_skip','phase_skip')
      AND COALESCE(payload->>'legoId', payload->>'fromLegoId') IS NOT NULL
      AND NOT COALESCE(user_id = ANY(v_demo_ids), false)
  )
  SELECT nav.seed,
         COUNT(*) FILTER (WHERE dir = 'back')    AS back,
         COUNT(*) FILTER (WHERE dir = 'replay')  AS replay,
         COUNT(*) FILTER (WHERE dir = 'forward') AS forward,
         CASE WHEN COUNT(*) FILTER (WHERE dir = 'forward') > 0
              THEN round(
                (COUNT(*) FILTER (WHERE dir IN ('back','replay')))::numeric
                / COUNT(*) FILTER (WHERE dir = 'forward'), 3)
              ELSE NULL END                       AS friction_ratio
  FROM nav
  WHERE nav.seed IS NOT NULL
  GROUP BY nav.seed
  ORDER BY (COUNT(*) FILTER (WHERE dir = 'back')
            + COUNT(*) FILTER (WHERE dir = 'replay')) DESC;
END;
$$;


--
-- Name: current_learner_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_learner_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from public.learners where user_id = auth.uid()::text limit 1
$$;


--
-- Name: FUNCTION current_learner_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_learner_id() IS 'THE identity bridge: auth.uid() -> learners.id. The only place the auth-uid/learner-PK mapping (and its ::text cast) may live. Own-row policies on learner-data tables use learner_id = current_learner_id(). learners.user_id is unique-indexed (learners_user_id_key).';


--
-- Name: decrement_voice_sample_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_voice_sample_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE voices
  SET sample_count = sample_count - 1
  WHERE voice_id = OLD.voice_id;
  RETURN OLD;
END;
$$;


--
-- Name: find_learner_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_learner_by_email(lookup_email text) RETURNS TABLE(id uuid, user_id text, display_name text, platform_role text, educational_role text, preferences jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    SELECT l.id, l.user_id, l.display_name,
  l.platform_role,
           l.educational_role, l.preferences,
  l.created_at, l.updated_at
    FROM learners l
    WHERE lookup_email = ANY(l.verified_emails)
    LIMIT 1;
  $$;


--
-- Name: find_or_create_audio(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text) RETURNS TABLE(audio_id uuid, s3_key text, needs_generation boolean)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_text_id UUID;
  v_audio_id UUID;
  v_s3_key TEXT;
BEGIN
  -- Step 1: Find or create text
  v_text_id := find_or_create_text(p_content, p_language);

  -- Step 2: Find or create audio entry
  INSERT INTO audio_files (text_id, voice_id, cadence)
  VALUES (v_text_id, p_voice_id, p_cadence)
  ON CONFLICT (text_id, voice_id, cadence) DO NOTHING;

  -- Step 3: Get the audio entry (either new or existing)
  SELECT af.id, af.s3_key INTO v_audio_id, v_s3_key
  FROM audio_files af
  WHERE af.text_id = v_text_id
    AND af.voice_id = p_voice_id
    AND af.cadence = p_cadence;

  -- Return result
  RETURN QUERY SELECT v_audio_id, v_s3_key, (v_s3_key IS NULL);
END;
$$;


--
-- Name: FUNCTION find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text) IS 'Idempotent: returns audio_id and whether generation is needed';


--
-- Name: find_or_create_text(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_text(p_content text, p_language text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Try to insert, on conflict return existing
  INSERT INTO texts (content, language)
  VALUES (p_content, p_language)
  ON CONFLICT (content_normalized, language)
  DO UPDATE SET content = EXCLUDED.content  -- No-op, just to return row
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: FUNCTION find_or_create_text(p_content text, p_language text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.find_or_create_text(p_content text, p_language text) IS 'Idempotent: returns existing text_id or creates new one';


--
-- Name: generate_join_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_join_code() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- No I, O (confusable)
  numbers TEXT := '0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  -- 3 letters
  FOR i IN 1..3 LOOP
    result := result || substr(letters, floor(random() * 24 + 1)::int, 1);
  END LOOP;

  result := result || '-';

  -- 3 numbers
  FOR i IN 1..3 LOOP
    result := result || substr(numbers, floor(random() * 10 + 1)::int, 1);
  END LOOP;

  RETURN result;
END;
$$;


--
-- Name: get_active_brief(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_brief(p_known_code text, p_target_code text) RETURNS TABLE(id uuid, known_code text, target_code text, version text, brief_content jsonb, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    lb.id,
    lb.known_code,
    lb.target_code,
    lb.version,
    lb.brief_content,
    lb.updated_at
  FROM language_briefs lb
  WHERE lb.known_code = p_known_code
    AND lb.target_code = p_target_code
    AND lb.is_active = true;
END;
$$;


--
-- Name: get_active_prompt(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_prompt(p_phase_code text) RETURNS TABLE(id uuid, phase_code text, version text, title text, prompt_content text, metadata jsonb, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.phase_code,
    pp.version,
    pp.title,
    pp.prompt_content,
    pp.metadata,
    pp.updated_at
  FROM phase_prompts pp
  WHERE pp.phase_code = p_phase_code AND pp.is_active = true;
END;
$$;


--
-- Name: get_all_course_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_all_course_stats() RETURNS TABLE(course_code text, seeds bigint, completed_seeds bigint, legos bigint, phrases bigint)
    LANGUAGE sql STABLE
    AS $$
    SELECT
      c.course_code,
      COALESCE(s.cnt, 0) AS seeds,
      COALESCE(cs.cnt, 0) AS completed_seeds,
      COALESCE(l.cnt, 0) AS legos,
      COALESCE(p.cnt, 0) AS phrases
    FROM courses c
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt FROM course_seeds WHERE
  course_seeds.course_code = c.course_code
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT seed_number) AS cnt FROM
  course_legos WHERE course_legos.course_code = c.course_code
    ) cs ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt FROM course_legos WHERE
  course_legos.course_code = c.course_code
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt FROM course_practice_phrases WHERE
   course_practice_phrases.course_code = c.course_code
    ) p ON true;
  $$;


--
-- Name: get_audio_counts(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_audio_counts(p_course_code text, p_release_target integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'phrases', (SELECT jsonb_build_object(
      'total', count(*),
      'missing_known', count(*) FILTER (WHERE known_audio_id IS NULL),
      'missing_target1', count(*) FILTER (WHERE target1_audio_id IS NULL),
      'missing_target2', count(*) FILTER (WHERE target2_audio_id IS NULL)
    ) FROM course_practice_phrases WHERE course_code = p_course_code AND seed_number <= p_release_target),
    'legos', (SELECT jsonb_build_object(
      'total', count(*),
      'total_new', count(*) FILTER (WHERE is_new),
      'missing_known', count(*) FILTER (WHERE known_audio_id IS NULL),
      'missing_target1', count(*) FILTER (WHERE target1_audio_id IS NULL),
      'missing_presentation', count(*) FILTER (WHERE is_new AND presentation_audio_id IS NULL)
    ) FROM course_legos WHERE course_code = p_course_code AND seed_number <= p_release_target),
    'seeds', (SELECT jsonb_build_object(
      'total', count(*),
      'missing_known', count(*) FILTER (WHERE known_audio_id IS NULL),
      'missing_target1', count(*) FILTER (WHERE target1_audio_id IS NULL),
      'missing_target2', count(*) FILTER (WHERE target2_audio_id IS NULL)
    ) FROM course_seeds WHERE course_code = p_course_code AND seed_number <= p_release_target AND status = 'released')
  ) INTO v_result;
  RETURN v_result;
END;
$$;


--
-- Name: get_available_prompts(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_prompts(p_course_code text, p_known_lego_ids text[]) RETURNS TABLE(id uuid, prompt_target_text text, prompt_known_text text, expected_target_text text, prompt_type text, difficulty_score integer, prompt_audio_uuid uuid, comprehensibility_pct numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.prompt_target_text,
    pp.prompt_known_text,
    pp.expected_target_text,
    pp.prompt_type,
    pp.difficulty_score,
    pp.prompt_audio_uuid,
    -- Calculate what % of prompt LEGOs the learner knows
    (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
    / array_length(pp.prompt_lego_ids, 1) * 100 AS comprehensibility_pct
  FROM practice_prompts pp
  WHERE pp.course_code = p_course_code
    AND pp.is_active = true
    -- All prompt LEGOs must be known (100% comprehensibility)
    AND pp.prompt_lego_ids <@ p_known_lego_ids
  ORDER BY pp.difficulty_score ASC, random();
END;
$$;


--
-- Name: get_cascade_courses(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cascade_courses(p_user_id text) RETURNS text[]
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  result TEXT[] := ARRAY[]::TEXT[];
  rec RECORD;
  ancestor_id UUID;
  level_courses TEXT[];
  effective TEXT[];
BEGIN
  FOR rec IN
    SELECT c.id AS class_id, c.school_id, s.group_id
    FROM user_tags ut
    JOIN classes c ON ut.tag_value = 'CLASS:' || c.id::text
    JOIN schools s ON c.school_id = s.id
    WHERE ut.user_id = p_user_id
      AND ut.tag_type = 'class'
      AND ut.role_in_context = 'student'
      AND ut.removed_at IS NULL
  LOOP
    effective := NULL;

    IF rec.group_id IS NOT NULL THEN
      ancestor_id := rec.group_id;

      FOR level_courses IN
        WITH RECURSIVE ancestry AS (
          SELECT id, parent_id, 0 AS depth FROM groups WHERE id = ancestor_id
          UNION ALL
          SELECT g.id, g.parent_id, a.depth + 1
          FROM groups g JOIN ancestry a ON g.id = a.parent_id
        ),
        ordered_ancestors AS (
          SELECT id FROM ancestry ORDER BY depth DESC
        )
        SELECT COALESCE(
          (SELECT array_agg(DISTINCT course)
           FROM entitlement_grants, unnest(granted_courses) AS course
           WHERE entitlement_grants.group_id = oa.id
             AND is_active = true
             AND (expires_at IS NULL OR expires_at > NOW())),
          ARRAY[]::TEXT[]
        ) AS courses
        FROM ordered_ancestors oa
      LOOP
        IF array_length(level_courses, 1) > 0 THEN
          IF effective IS NULL THEN
            effective := level_courses;
          ELSE
            effective := ARRAY(
              SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
            );
          END IF;
        END IF;
      END LOOP;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT course), ARRAY[]::TEXT[])
    INTO level_courses
    FROM entitlement_grants, unnest(granted_courses) AS course
    WHERE entitlement_grants.school_id = rec.school_id
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW());

    IF array_length(level_courses, 1) > 0 THEN
      IF effective IS NULL THEN
        effective := level_courses;
      ELSE
        effective := ARRAY(
          SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
        );
      END IF;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT course), ARRAY[]::TEXT[])
    INTO level_courses
    FROM entitlement_grants, unnest(granted_courses) AS course
    WHERE entitlement_grants.class_id = rec.class_id
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW());

    IF array_length(level_courses, 1) > 0 THEN
      IF effective IS NULL THEN
        effective := level_courses;
      ELSE
        effective := ARRAY(
          SELECT unnest(effective) INTERSECT SELECT unnest(level_courses)
        );
      END IF;
    END IF;

    IF effective IS NOT NULL THEN
      result := ARRAY(SELECT DISTINCT unnest(result || effective));
    END IF;
  END LOOP;

  RETURN result;
END;
$$;


--
-- Name: FUNCTION get_cascade_courses(p_user_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_cascade_courses(p_user_id text) IS 'Returns effective course codes for a user via entitlement cascade.';


--
-- Name: get_community_contribution(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_community_contribution(p_target_lang text) RETURNS TABLE(window_key text, minutes bigint, phrases bigint, speakers bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with rows as (
    select o.day, o.play_seconds, o.opportunities, o.learner_id
    from learner_speaking_opportunities o
    where split_part(o.course_code, '_for_', 1) = p_target_lang
      and not exists (select 1 from learners ld where ld.id = o.learner_id and ld.is_demo)
  ),
  utc_today as (select (now() at time zone 'utc')::date as d)
  select 'today'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day = utc_today.d
  union all
  select 'days7'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day >= utc_today.d - 7
  union all
  select 'days30'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day >= utc_today.d - 30;
$$;


--
-- Name: get_course_audio_summary(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_course_audio_summary(p_course_code text) RETURNS TABLE(role text, origin text, count bigint, voice_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.role,
    ca.origin,
    COUNT(*)::BIGINT as count,
    COUNT(DISTINCT ca.voice_id)::BIGINT as voice_count
  FROM course_audio ca
  WHERE ca.course_code = p_course_code
  GROUP BY ca.role, ca.origin
  ORDER BY ca.role, ca.origin;
END;
$$;


--
-- Name: get_course_cycles_window(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
WITH
  course AS (
    SELECT c.course_code, c.version
    FROM courses c
    WHERE c.course_code = p_course_code
    LIMIT 1
  ),
  start_round AS (
    SELECT r.round_index
    FROM course_round_index r
    WHERE r.course_code = p_course_code
      AND r.lego_id = p_from_lego_id
    LIMIT 1
  ),
  rounds AS (
    SELECT r.round_index, r.lego_id, r.seed_number, r.lego_index
    FROM course_round_index r
    WHERE r.course_code = p_course_code
      AND r.round_index >= (SELECT round_index FROM start_round)
    ORDER BY r.round_index ASC
    LIMIT p_round_limit
  ),
  legos AS (
    SELECT
      l.seed_number, l.lego_index, l.lego_id, l.type,
      l.known_text, l.target_text, l.target_text_roman, l.components,
      l.is_new,
      l.known_audio_id, l.target1_audio_id, l.target2_audio_id, l.presentation_audio_id,
      l.target1_duration_ms, l.target2_duration_ms
    FROM course_legos l
    JOIN rounds r ON r.lego_id = l.lego_id
    WHERE l.course_code = p_course_code
  ),
  phrases AS (
    SELECT
      p.seed_number, p.lego_index, p.position, p.phrase_role,
      p.known_text, p.target_text, p.target_text_roman,
      p.decomposition,
      p.display_tiling,
      p.known_audio_id, p.target1_audio_id, p.target2_audio_id,
      p.target1_duration_ms, p.target2_duration_ms
    FROM course_practice_phrases p
    WHERE p.course_code = p_course_code
      AND (p.seed_number, p.lego_index) IN (SELECT r.seed_number, r.lego_index FROM rounds r)
    ORDER BY p.position ASC NULLS LAST
  )
SELECT jsonb_build_object(
  'course',  (SELECT to_jsonb(c) FROM course c),
  'rounds',  (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.round_index), '[]'::jsonb) FROM rounds r),
  'legos',   (SELECT coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) FROM legos l),
  'phrases', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.position NULLS LAST), '[]'::jsonb) FROM phrases p)
);
$$;


--
-- Name: FUNCTION get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) IS 'Single-roundtrip data source for the instant-playback cycles endpoint. Returns {course, rounds, legos, phrases} as jsonb (phrases include display_tiling). Read-only.';


--
-- Name: get_documentation(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_documentation(p_slug text) RETURNS TABLE(id uuid, slug text, title text, subtitle text, category text, display_order integer, content_type text, content jsonb, markdown_content text, version text, badge_text text, badge_color text, icon_name text, is_published boolean, is_featured boolean, created_at timestamp with time zone, updated_at timestamp with time zone, sections jsonb)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    d.id, d.slug, d.title, d.subtitle, d.category, d.display_order,
    d.content_type, d.content, d.markdown_content, d.version,
    d.badge_text, d.badge_color, d.icon_name, d.is_published, d.is_featured,
    d.created_at, d.updated_at,
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.display_order)
         FROM documentation_sections s
        WHERE s.document_id = d.id),
      '[]'::jsonb
    ) AS sections
  FROM documentation_content d
  WHERE d.slug = p_slug;
$$;


--
-- Name: get_documentation_list(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_documentation_list(p_category text DEFAULT NULL::text) RETURNS TABLE(id uuid, slug text, title text, subtitle text, category text, display_order integer, badge_text text, badge_color text, icon_name text, is_featured boolean, updated_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    d.id, d.slug, d.title, d.subtitle, d.category, d.display_order,
    d.badge_text, d.badge_color, d.icon_name, d.is_featured, d.updated_at
  FROM documentation_content d
  WHERE d.is_published = TRUE
    AND (p_category IS NULL OR d.category = p_category)
  ORDER BY d.display_order, d.title;
$$;


--
-- Name: get_evolution_level(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_evolution_level(score integer) RETURNS TABLE(level smallint, name text, icon text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT el.level, el.name, el.icon
  FROM evolution_levels el
  WHERE el.min_score <= score
  ORDER BY el.min_score DESC
  LIMIT 1;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: gamification_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gamification_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id text,
    base_points_audio_detected integer DEFAULT 1 NOT NULL,
    latency_bonus_flow_state integer DEFAULT 3 NOT NULL,
    latency_bonus_faster integer DEFAULT 2 NOT NULL,
    latency_bonus_baseline integer DEFAULT 1 NOT NULL,
    latency_bonus_slower integer DEFAULT 0 NOT NULL,
    duration_match_within_10_pct integer DEFAULT 2 NOT NULL,
    duration_match_within_20_pct integer DEFAULT 1 NOT NULL,
    duration_match_beyond_20_pct integer DEFAULT 0 NOT NULL,
    skip_bonus_confident integer DEFAULT 3 NOT NULL,
    revisit_bonus_honest integer DEFAULT 2 NOT NULL,
    consistency_10d_threshold_high integer DEFAULT 7 NOT NULL,
    consistency_10d_threshold_med integer DEFAULT 5 NOT NULL,
    consistency_10d_threshold_low integer DEFAULT 3 NOT NULL,
    consistency_10d_multiplier_high numeric(3,2) DEFAULT 1.5 NOT NULL,
    consistency_10d_multiplier_med numeric(3,2) DEFAULT 1.3 NOT NULL,
    consistency_10d_multiplier_low numeric(3,2) DEFAULT 1.1 NOT NULL,
    consistency_30d_threshold_high integer DEFAULT 25 NOT NULL,
    consistency_30d_threshold_med integer DEFAULT 20 NOT NULL,
    consistency_30d_threshold_low integer DEFAULT 15 NOT NULL,
    consistency_30d_multiplier_high numeric(3,2) DEFAULT 2.0 NOT NULL,
    consistency_30d_multiplier_med numeric(3,2) DEFAULT 1.5 NOT NULL,
    consistency_30d_multiplier_low numeric(3,2) DEFAULT 1.2 NOT NULL,
    bonus_7_of_10_days integer DEFAULT 100 NOT NULL,
    bonus_25_of_30_days_multiplier numeric(3,2) DEFAULT 2.0 NOT NULL,
    bonus_return_3_days integer DEFAULT 50 NOT NULL,
    bonus_return_7_days integer DEFAULT 100 NOT NULL,
    return_threshold_consolidating integer DEFAULT 3 NOT NULL,
    return_threshold_deep integer DEFAULT 7 NOT NULL,
    return_threshold_long integer DEFAULT 30 NOT NULL,
    pomodoro_first_nudge_minutes integer DEFAULT 25 NOT NULL,
    pomodoro_second_nudge_minutes integer DEFAULT 35 NOT NULL,
    pomodoro_third_nudge_minutes integer DEFAULT 45 NOT NULL,
    pomodoro_offer_listening_minutes integer DEFAULT 60 NOT NULL,
    seed_bank_threshold_days integer DEFAULT 60 NOT NULL,
    session_early_production_pct integer DEFAULT 90 NOT NULL,
    session_mid_production_pct integer DEFAULT 70 NOT NULL,
    session_late_production_pct integer DEFAULT 50 NOT NULL,
    session_early_threshold integer DEFAULT 50 NOT NULL,
    session_mid_threshold integer DEFAULT 150 NOT NULL,
    leaderboard_top_n integer DEFAULT 5 NOT NULL,
    leaderboard_period_days integer DEFAULT 7 NOT NULL,
    return_message_ready text DEFAULT 'Ready when you are.'::text NOT NULL,
    return_message_consolidating text DEFAULT 'Your brain has been consolidating. Let''s see what stuck!'::text NOT NULL,
    return_message_deep text DEFAULT 'Deep consolidation complete. You might surprise yourself.'::text NOT NULL,
    return_message_long text DEFAULT 'Welcome back. Your brain remembers more than you think.'::text NOT NULL,
    pomodoro_message_first text DEFAULT 'Your brain has been working hard. Good moment to pause.'::text NOT NULL,
    pomodoro_message_second text DEFAULT 'Research shows learning in chunks works better.'::text NOT NULL,
    pomodoro_message_third text DEFAULT 'You''ve been amazing today. Time for your brain to rest?'::text NOT NULL,
    pomodoro_message_listening text DEFAULT 'Would you like to switch to listening mode?'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_gamification_config(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_gamification_config(p_course_id text) RETURNS public.gamification_config
    LANGUAGE plpgsql
    AS $$
DECLARE
  result gamification_config;
BEGIN
  -- Try course-specific first
  SELECT * INTO result FROM gamification_config WHERE course_id = p_course_id;

  -- Fall back to global
  IF NOT FOUND THEN
    SELECT * INTO result FROM gamification_config WHERE course_id IS NULL;
  END IF;

  RETURN result;
END;
$$;


--
-- Name: get_i_plus_one_prompts(text, text[], numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_i_plus_one_prompts(p_course_code text, p_known_lego_ids text[], p_min_comprehensibility numeric DEFAULT 80.0) RETURNS TABLE(id uuid, prompt_target_text text, prompt_known_text text, expected_target_text text, prompt_type text, difficulty_score integer, prompt_audio_uuid uuid, comprehensibility_pct numeric, unknown_lego_ids text[])
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pp.id,
    pp.prompt_target_text,
    pp.prompt_known_text,
    pp.expected_target_text,
    pp.prompt_type,
    pp.difficulty_score,
    pp.prompt_audio_uuid,
    -- Calculate comprehensibility percentage
    (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
    / array_length(pp.prompt_lego_ids, 1) * 100 AS comprehensibility_pct,
    -- Return which LEGOs are unknown
    (SELECT ARRAY_AGG(lid) FROM unnest(pp.prompt_lego_ids) lid WHERE NOT lid = ANY(p_known_lego_ids)) AS unknown_lego_ids
  FROM practice_prompts pp
  WHERE pp.course_code = p_course_code
    AND pp.is_active = true
    -- At least X% of prompt LEGOs must be known
    AND (SELECT COUNT(*)::NUMERIC FROM unnest(pp.prompt_lego_ids) lid WHERE lid = ANY(p_known_lego_ids))
        / array_length(pp.prompt_lego_ids, 1) * 100 >= p_min_comprehensibility
  ORDER BY comprehensibility_pct DESC, pp.difficulty_score ASC;
END;
$$;


--
-- Name: insight_discoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insight_discoveries (
    id bigint NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    window_days integer,
    source text DEFAULT 'real'::text NOT NULL,
    digest jsonb,
    findings jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_latest_insight_discovery(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_latest_insight_discovery(p_source text DEFAULT 'real'::text) RETURNS SETOF public.insight_discoveries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  SELECT *
  FROM insight_discoveries
  WHERE source = p_source
  ORDER BY generated_at DESC
  LIMIT 1;
END;
$$;


--
-- Name: get_missing_audio(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_missing_audio(p_course_code text, p_needed jsonb) RETURNS TABLE(text text, language text, role text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    n->>'text' as text,
    n->>'language' as language,
    n->>'role' as role
  FROM jsonb_array_elements(p_needed) n
  WHERE NOT EXISTS (
    SELECT 1 FROM course_audio ca
    WHERE ca.course_code = p_course_code
      AND ca.text_normalized = normalize_text(n->>'text')
      AND ca.language = n->>'language'
      AND ca.role = n->>'role'
  );
END;
$$;


--
-- Name: get_my_verified_emails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_verified_emails() RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
    SELECT COALESCE(verified_emails,
  ARRAY[]::TEXT[])
    FROM learners
    WHERE user_id = auth.uid()::TEXT
    LIMIT 1;
  $$;


--
-- Name: get_pomodoro_message(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pomodoro_message(minutes_elapsed integer, p_course_id text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  cfg gamification_config;
BEGIN
  cfg := get_gamification_config(p_course_id);

  IF minutes_elapsed >= cfg.pomodoro_offer_listening_minutes THEN
    RETURN cfg.pomodoro_message_listening;
  ELSIF minutes_elapsed >= cfg.pomodoro_third_nudge_minutes THEN
    RETURN cfg.pomodoro_message_third;
  ELSIF minutes_elapsed >= cfg.pomodoro_second_nudge_minutes THEN
    RETURN cfg.pomodoro_message_second;
  ELSIF minutes_elapsed >= cfg.pomodoro_first_nudge_minutes THEN
    RETURN cfg.pomodoro_message_first;
  ELSE
    RETURN NULL;  -- No nudge yet
  END IF;
END;
$$;


--
-- Name: get_qa_flags_by_type(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_qa_flags_by_type(p_course_code text) RETURNS TABLE(check_type text, flag_count bigint, open_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.check_type,
    COUNT(*)::BIGINT AS flag_count,
    COUNT(*) FILTER (WHERE f.status = 'open')::BIGINT AS open_count
  FROM course_qa_flags f
  WHERE f.course_code = p_course_code
  GROUP BY f.check_type
  ORDER BY flag_count DESC;
END;
$$;


--
-- Name: get_qa_summary(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_qa_summary(p_course_code text) RETURNS TABLE(total_flags bigint, error_count bigint, warning_count bigint, info_count bigint, open_count bigint, resolved_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_flags,
    COUNT(*) FILTER (WHERE severity = 'error')::BIGINT AS error_count,
    COUNT(*) FILTER (WHERE severity = 'warning')::BIGINT AS warning_count,
    COUNT(*) FILTER (WHERE severity = 'info')::BIGINT AS info_count,
    COUNT(*) FILTER (WHERE status = 'open')::BIGINT AS open_count,
    COUNT(*) FILTER (WHERE status = 'resolved')::BIGINT AS resolved_count
  FROM course_qa_flags
  WHERE course_code = p_course_code;
END;
$$;


--
-- Name: get_return_message(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_return_message(days_away integer, p_course_id text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  cfg gamification_config;
BEGIN
  cfg := get_gamification_config(p_course_id);

  IF days_away IS NULL OR days_away <= 1 THEN
    RETURN cfg.return_message_ready;
  ELSIF days_away <= cfg.return_threshold_consolidating THEN
    RETURN cfg.return_message_consolidating;
  ELSIF days_away <= cfg.return_threshold_deep THEN
    RETURN cfg.return_message_deep;
  ELSE
    RETURN cfg.return_message_long;
  END IF;
END;
$$;


--
-- Name: get_staff_with_emails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_staff_with_emails() RETURNS TABLE(user_id text, display_name text, educational_role text, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT l.user_id, l.display_name, l.educational_role, l.verified_emails[1] AS email
  FROM learners l
  WHERE l.educational_role IN ('teacher', 'school_admin', 'govt_admin')
    AND public.is_ssi_admin()          -- non-admin callers get zero rows
  ORDER BY l.display_name;
$$;


--
-- Name: FUNCTION get_staff_with_emails(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_staff_with_emails() IS 'Returns staff members with their primary email. SECURITY DEFINER bypasses verified_emails column revoke.';


--
-- Name: get_subtree_group_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_subtree_group_ids(p_group_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE
    AS $$
    SELECT id FROM groups
    WHERE path LIKE (SELECT path FROM groups WHERE id = p_group_id) || '%'
  $$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.learners (user_id, display_name, verified_emails)
  VALUES (
    NEW.id::text,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN NEW.email IS NULL OR NEW.email = '' THEN '{}'::text[] ELSE ARRAY[lower(NEW.email)] END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION handle_new_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_user() IS 'Creates learners row when a new auth.users row is inserted. SECURITY DEFINER bypasses the REVOKE INSERT on learners that blocks the role-escalation exploit. Restored 2026-05-21 (dropped by the non-shipped 20251219120000 migration).';


--
-- Name: increment_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.version = OLD.version + 1;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION increment_version(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_version() IS 'Auto-increments version and updates timestamp on row UPDATE';


--
-- Name: increment_voice_sample_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_voice_sample_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE voices
  SET sample_count = sample_count + 1,
      last_used_at = NOW()
  WHERE voice_id = NEW.voice_id;
  RETURN NEW;
END;
$$;


--
-- Name: inherit_group_test_flags(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.inherit_group_test_flags() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  group_is_test BOOLEAN;
  group_is_demo BOOLEAN;
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_test, is_demo INTO group_is_test, group_is_demo
  FROM public.groups WHERE id = NEW.group_id;

  NEW.is_test := COALESCE(NEW.is_test, FALSE) OR COALESCE(group_is_test, FALSE);
  NEW.is_demo := COALESCE(NEW.is_demo, FALSE) OR COALESCE(group_is_demo, FALSE);
  RETURN NEW;
END;
$$;


--
-- Name: is_class_teacher(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tags ut
    WHERE ut.tag_type = 'class'
      AND ut.role_in_context = 'teacher'
      AND ut.removed_at IS NULL
      AND ut.tag_value = 'CLASS:' || p_class_id::text
      AND ut.user_id = p_uid
  );
$$;


--
-- Name: FUNCTION is_class_teacher(p_class_id uuid, p_uid text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) IS 'True if p_uid holds an active class/teacher tag for p_class_id. The membership predicate that replaces classes.teacher_user_id ownership checks in app reads and (as its own migration) in RLS.';


--
-- Name: is_god_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_god_user() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.is_ssi_admin();   -- DEPRECATED: 'god' collapsed into 'ssi_admin' (2026-06-16)
$$;


--
-- Name: is_ssi_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_ssi_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learners
    WHERE user_id = (auth.uid()::text)
    AND platform_role = 'ssi_admin'
  );
$$;


--
-- Name: FUNCTION is_ssi_admin(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_ssi_admin() IS 'TRUE if the JWT-bearing user is an SSi admin (learners.platform_role=ssi_admin). Used in RLS policies for admin override.';


--
-- Name: learner_journey_stats(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.learner_journey_stats(p_course_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
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
$$;


--
-- Name: link_all_audio_ids(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_all_audio_ids(p_course_code text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
  DECLARE
    v_course RECORD;
    v_linked_legos_known INT := 0;
    v_linked_legos_t1 INT := 0;
    v_linked_legos_t2 INT := 0;
    v_linked_phrases_known INT := 0;
    v_linked_phrases_t1 INT := 0;
    v_linked_phrases_t2 INT := 0;
    v_linked_seeds_known INT := 0;
    v_linked_seeds_t1 INT := 0;
    v_linked_seeds_t2 INT := 0;
  BEGIN
    SELECT * INTO v_course FROM courses WHERE
  course_code = p_course_code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Course not found: %',
  p_course_code;
    END IF;

    UPDATE course_legos cl SET known_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cl.course_code
        AND ca.text_normalized =
  normalize_text(cl.known_text)
        AND ca.role IN ('known', 'source')
      LIMIT 1
    )
    WHERE cl.course_code = p_course_code AND
  cl.known_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_legos_known = ROW_COUNT;

    UPDATE course_legos cl SET target1_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cl.course_code
        AND ca.text_normalized =
  normalize_text(cl.target_text)
        AND ca.role = 'target1'
      LIMIT 1
    )
    WHERE cl.course_code = p_course_code AND
  cl.target1_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_legos_t1 = ROW_COUNT;

    UPDATE course_legos cl SET target2_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cl.course_code
        AND ca.text_normalized =
  normalize_text(cl.target_text)
        AND ca.role = 'target2'
      LIMIT 1
    )
    WHERE cl.course_code = p_course_code AND
  cl.target2_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_legos_t2 = ROW_COUNT;

    UPDATE course_practice_phrases cpp SET
  known_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cpp.course_code
        AND ca.text_normalized =
  normalize_text(cpp.known_text)
        AND ca.role IN ('known', 'source')
      LIMIT 1
    )
    WHERE cpp.course_code = p_course_code AND
  cpp.known_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_phrases_known = ROW_COUNT;

    UPDATE course_practice_phrases cpp SET
  target1_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cpp.course_code
        AND ca.text_normalized =
  normalize_text(cpp.target_text)
        AND ca.role = 'target1'
      LIMIT 1
    )
    WHERE cpp.course_code = p_course_code AND
  cpp.target1_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_phrases_t1 = ROW_COUNT;

    UPDATE course_practice_phrases cpp SET
  target2_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cpp.course_code
        AND ca.text_normalized =
  normalize_text(cpp.target_text)
        AND ca.role = 'target2'
      LIMIT 1
    )
    WHERE cpp.course_code = p_course_code AND
  cpp.target2_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_phrases_t2 = ROW_COUNT;

    UPDATE course_seeds cs SET known_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cs.course_code
        AND ca.text_normalized =
  normalize_text(cs.known_text)
        AND ca.role IN ('known', 'source')
      LIMIT 1
    )
    WHERE cs.course_code = p_course_code AND
  cs.known_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_seeds_known = ROW_COUNT;

    UPDATE course_seeds cs SET target1_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cs.course_code
        AND ca.text_normalized =
  normalize_text(cs.target_text)
        AND ca.role = 'target1'
      LIMIT 1
    )
    WHERE cs.course_code = p_course_code AND
  cs.target1_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_seeds_t1 = ROW_COUNT;

    UPDATE course_seeds cs SET target2_audio_id = (
      SELECT ca.id FROM course_audio ca
      WHERE ca.course_code = cs.course_code
        AND ca.text_normalized =
  normalize_text(cs.target_text)
        AND ca.role = 'target2'
      LIMIT 1
    )
    WHERE cs.course_code = p_course_code AND
  cs.target2_audio_id IS NULL;
    GET DIAGNOSTICS v_linked_seeds_t2 = ROW_COUNT;

    RETURN jsonb_build_object(
      'course_code', p_course_code,
      'legos', jsonb_build_object('known',
  v_linked_legos_known, 'target1', v_linked_legos_t1,
  'target2', v_linked_legos_t2),
      'phrases', jsonb_build_object('known',
  v_linked_phrases_known, 'target1',
  v_linked_phrases_t1, 'target2', v_linked_phrases_t2),
      'seeds', jsonb_build_object('known',
  v_linked_seeds_known, 'target1', v_linked_seeds_t1,
  'target2', v_linked_seeds_t2)
    );
  END;
  $$;


--
-- Name: link_audio_to_content(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_audio_to_content() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.role = 'known' THEN
    UPDATE course_legos SET known_audio_id = NEW.id
      WHERE course_code = NEW.course_code
        AND known_audio_id IS NULL
        AND lower(trim(known_text)) = NEW.text_normalized;
    UPDATE course_practice_phrases SET known_audio_id = NEW.id
      WHERE course_code = NEW.course_code
        AND known_audio_id IS NULL
        AND lower(trim(known_text)) = NEW.text_normalized;

  ELSIF NEW.role = 'target1' THEN
    UPDATE course_legos
      SET target1_audio_id = NEW.id, target1_duration_ms = NEW.duration_ms
      WHERE course_code = NEW.course_code
        AND target1_audio_id IS NULL
        AND lower(trim(target_text)) = NEW.text_normalized;
    UPDATE course_practice_phrases
      SET target1_audio_id = NEW.id, target1_duration_ms = NEW.duration_ms
      WHERE course_code = NEW.course_code
        AND target1_audio_id IS NULL
        AND lower(trim(target_text)) = NEW.text_normalized;

  ELSIF NEW.role = 'target2' THEN
    UPDATE course_legos
      SET target2_audio_id = NEW.id, target2_duration_ms = NEW.duration_ms
      WHERE course_code = NEW.course_code
        AND target2_audio_id IS NULL
        AND lower(trim(target_text)) = NEW.text_normalized;
    UPDATE course_practice_phrases
      SET target2_audio_id = NEW.id, target2_duration_ms = NEW.duration_ms
      WHERE course_code = NEW.course_code
        AND target2_audio_id IS NULL
        AND lower(trim(target_text)) = NEW.text_normalized;

  ELSIF NEW.role = 'presentation' THEN
    UPDATE course_legos SET presentation_audio_id = NEW.id
      WHERE course_code = NEW.course_code
        AND presentation_audio_id IS NULL
        AND lower(trim(target_text)) = NEW.text_normalized;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: normalize_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_text(input_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN rtrim(lower(trim(input_text)), '.?!¿¡。？！');
END;
$$;


--
-- Name: null_lego_audio_on_text_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.null_lego_audio_on_text_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.known_text IS DISTINCT FROM OLD.known_text THEN
    NEW.known_audio_id := NULL;
    NEW.presentation_audio_id := NULL;
  END IF;
  IF NEW.target_text IS DISTINCT FROM OLD.target_text THEN
    NEW.target1_audio_id := NULL;
    NEW.target2_audio_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: null_phrase_audio_on_text_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.null_phrase_audio_on_text_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.known_text IS DISTINCT FROM OLD.known_text THEN
    NEW.known_audio_id := NULL;
  END IF;
  IF NEW.target_text IS DISTINCT FROM OLD.target_text THEN
    NEW.target1_audio_id := NULL;
    NEW.target2_audio_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: pull_audio_duration_on_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pull_audio_duration_on_link() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_duration INTEGER;
BEGIN
  -- target1: fill duration when audio_id is set on INSERT, or relinked on UPDATE.
  IF NEW.target1_audio_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.target1_audio_id IS DISTINCT FROM OLD.target1_audio_id) THEN
    SELECT duration_ms INTO v_duration
    FROM course_audio
    WHERE id = NEW.target1_audio_id;

    -- Only overwrite if course_audio has a meaningful value. If course_audio
    -- itself doesn't yet have duration_ms (rare), leave the cache as-is so the
    -- upstream trigger can populate it later when course_audio is updated.
    IF v_duration IS NOT NULL AND v_duration > 0 THEN
      NEW.target1_duration_ms := v_duration;
    END IF;
  END IF;

  -- target2: same pattern.
  IF NEW.target2_audio_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.target2_audio_id IS DISTINCT FROM OLD.target2_audio_id) THEN
    SELECT duration_ms INTO v_duration
    FROM course_audio
    WHERE id = NEW.target2_audio_id;

    IF v_duration IS NOT NULL AND v_duration > 0 THEN
      NEW.target2_duration_ms := v_duration;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION pull_audio_duration_on_link(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.pull_audio_duration_on_link() IS 'When target1_audio_id or target2_audio_id is set or changed on course_practice_phrases or course_legos, pull the canonical duration_ms from course_audio into the cache column. Pair: sync_audio_duration_to_dependents().';


--
-- Name: ratchet_highest_completed_round(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ratchet_highest_completed_round() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  prev_high_round INTEGER;
  prev_high_lego TEXT;
  explicit_round_reset BOOLEAN;
  explicit_lego_reset BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    prev_high_round := NULL;
    prev_high_lego := NULL;
    explicit_round_reset := FALSE;
    explicit_lego_reset := FALSE;
  ELSE
    prev_high_round := OLD.highest_completed_round_index;
    prev_high_lego  := OLD.highest_completed_lego_id;
    -- Captured before any assignment below touches NEW.highest_*.
    explicit_round_reset := (NEW.highest_completed_round_index IS NULL);
    explicit_lego_reset  := (NEW.highest_completed_lego_id IS NULL);
  END IF;

  -- round_index: lift if the cursor moved forward, or honor an explicit reset.
  IF explicit_round_reset THEN
    NEW.highest_completed_round_index := NULL;
  ELSIF NEW.last_completed_round_index IS NOT NULL AND
     (prev_high_round IS NULL OR NEW.last_completed_round_index > prev_high_round) THEN
    NEW.highest_completed_round_index := NEW.last_completed_round_index;
  ELSE
    NEW.highest_completed_round_index := prev_high_round;
  END IF;

  -- lego_id: lift INDEPENDENTLY of round_index, or honor an explicit reset.
  -- Lexicographic on the zero-padded SNNNNLNN format. A "backwards"
  -- lego_id cursor write (e.g. an infinite-play round whose primaryLegoKey
  -- is an earlier LEGO) no longer drags the ceiling down with it.
  IF explicit_lego_reset THEN
    NEW.highest_completed_lego_id := NULL;
  ELSIF NEW.last_completed_lego_id IS NOT NULL AND
     (prev_high_lego IS NULL OR NEW.last_completed_lego_id > prev_high_lego) THEN
    NEW.highest_completed_lego_id := NEW.last_completed_lego_id;
  ELSE
    NEW.highest_completed_lego_id := prev_high_lego;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: record_lego_pairings(uuid, text, text[], integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_lego_pairings(_learner_id uuid, _course_code text, _pairs text[], _counts integer[] DEFAULT NULL::integer[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF _pairs IS NULL OR array_length(_pairs, 1) IS NULL THEN
    RETURN;
  END IF;

  WITH input AS (
    SELECT
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][1] ELSE _pairs[idx][2] END AS lego_a,
      CASE WHEN _pairs[idx][1] < _pairs[idx][2] THEN _pairs[idx][2] ELSE _pairs[idx][1] END AS lego_b,
      COALESCE(_counts[idx], 1) AS cnt
    FROM generate_series(1, array_length(_pairs, 1)) AS g(idx)
    WHERE _pairs[idx][1] IS NOT NULL
      AND _pairs[idx][2] IS NOT NULL
      AND _pairs[idx][1] <> _pairs[idx][2]
  ),
  -- Sum counts for pairs that canonicalise identically within this call
  -- (replaces the old DISTINCT; a single INSERT can't update a row twice).
  agg AS (
    SELECT lego_a, lego_b, SUM(cnt)::int AS cnt FROM input GROUP BY lego_a, lego_b
  )
  INSERT INTO learner_lego_pairings AS p
    (learner_id, course_code, lego_a, lego_b, fire_count, first_fired_at, last_fired_at)
  SELECT _learner_id, _course_code, lego_a, lego_b, cnt, now(), now()
  FROM agg
  ON CONFLICT (learner_id, course_code, lego_a, lego_b) DO UPDATE
    SET fire_count    = p.fire_count + EXCLUDED.fire_count,
        last_fired_at = now();
END;
$$;


--
-- Name: relink_user_tags(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.relink_user_tags(old_user_id text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'relink_user_tags: permission denied (not authenticated)';
  END IF;
  IF old_user_id IS NULL OR old_user_id = (auth.uid())::text THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.learners WHERE user_id = old_user_id) THEN
    RAISE EXCEPTION 'relink_user_tags: permission denied (old identity still active)';
  END IF;
  UPDATE public.user_tags SET user_id = (auth.uid())::text
  WHERE user_id = old_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;


--
-- Name: reverse_teacher_commission(uuid, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row teacher_commissions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM teacher_commissions
   WHERE teacher_id = p_teacher_id AND period_start = p_period_start
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- nothing accrued for this period; nothing to reverse
  END IF;

  IF v_row.status IN ('accruing', 'held') THEN
    UPDATE teacher_commissions
       SET accrued_pence = GREATEST(accrued_pence - GREATEST(p_pence, 0), 0),
           status = CASE
                      WHEN GREATEST(accrued_pence - GREATEST(p_pence, 0), 0) = 0 THEN 'reversed'
                      ELSE status
                    END,
           updated_at = NOW()
     WHERE id = v_row.id;
  ELSE
    -- already paid out / pending payout: carry as a clawback against future net.
    UPDATE teacher_commissions
       SET clawback_pence = clawback_pence + GREATEST(p_pence, 0),
           updated_at = NOW()
     WHERE id = v_row.id;
  END IF;
END;
$$;


--
-- Name: rls_status(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_status(table_names text[] DEFAULT NULL::text[]) RETURNS TABLE(table_name text, rls_enabled boolean, force_rls boolean, num_policies integer, policies jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls,
    COUNT(p.polname)::integer AS num_policies,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', p.polname,
          'cmd',  CASE p.polcmd
                    WHEN 'r' THEN 'SELECT'
                    WHEN 'a' THEN 'INSERT'
                    WHEN 'w' THEN 'UPDATE'
                    WHEN 'd' THEN 'DELETE'
                    WHEN '*' THEN 'ALL'
                  END,
          'permissive', p.polpermissive,
          'roles', (SELECT array_agg(rolname::text)
                    FROM pg_roles r
                    WHERE r.oid = ANY(p.polroles))
        ) ORDER BY p.polname
      ) FILTER (WHERE p.polname IS NOT NULL),
      '[]'::jsonb
    ) AS policies
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE c.relkind = 'r'
    AND c.relnamespace = 'public'::regnamespace
    AND (table_names IS NULL OR c.relname = ANY(table_names))
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
  ORDER BY c.relname;
$$;


--
-- Name: FUNCTION rls_status(table_names text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.rls_status(table_names text[]) IS 'Returns RLS state + policy summary for each public-schema table. SECURITY DEFINER. Callable by service_role only.';


--
-- Name: set_beta_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_beta_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- New App: set timestamp when entering beta
  IF NEW.new_app_status = 'beta' AND (OLD.new_app_status IS NULL OR OLD.new_app_status != 'beta') THEN
    NEW.new_app_beta_started_at = NOW();
  END IF;

  -- New App: clear timestamp when leaving beta
  IF NEW.new_app_status != 'beta' AND OLD.new_app_status = 'beta' THEN
    NEW.new_app_beta_started_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: set_class_join_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_class_join_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER := 0;
BEGIN
  IF NEW.student_join_code IS NULL OR NEW.student_join_code = '' THEN
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.student_join_code := new_code;
        RETURN NEW;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_school_join_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_school_join_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  new_code TEXT;
  attempts INTEGER;
BEGIN
  IF NEW.teacher_join_code IS NULL OR NEW.teacher_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.teacher_join_code := new_code;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique teacher join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  IF NEW.admin_join_code IS NULL OR NEW.admin_join_code = '' THEN
    attempts := 0;
    LOOP
      new_code := generate_join_code();
      BEGIN
        NEW.admin_join_code := new_code;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 10 THEN
          RAISE EXCEPTION 'Could not generate unique admin join code after 10 attempts';
        END IF;
      END;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: sync_audio_duration_to_dependents(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_audio_duration_to_dependents() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Skip if there's no meaningful duration to propagate.
  IF NEW.duration_ms IS NULL OR NEW.duration_ms = 0 THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire if duration_ms actually changed.
  IF TG_OP = 'UPDATE' AND NEW.duration_ms IS NOT DISTINCT FROM OLD.duration_ms THEN
    RETURN NEW;
  END IF;

  -- Propagate to course_practice_phrases (target1 + target2 slots)
  UPDATE course_practice_phrases
  SET target1_duration_ms = NEW.duration_ms
  WHERE target1_audio_id = NEW.id
    AND target1_duration_ms IS DISTINCT FROM NEW.duration_ms;

  UPDATE course_practice_phrases
  SET target2_duration_ms = NEW.duration_ms
  WHERE target2_audio_id = NEW.id
    AND target2_duration_ms IS DISTINCT FROM NEW.duration_ms;

  -- Propagate to course_legos (target1 + target2 slots)
  UPDATE course_legos
  SET target1_duration_ms = NEW.duration_ms
  WHERE target1_audio_id = NEW.id
    AND target1_duration_ms IS DISTINCT FROM NEW.duration_ms;

  UPDATE course_legos
  SET target2_duration_ms = NEW.duration_ms
  WHERE target2_audio_id = NEW.id
    AND target2_duration_ms IS DISTINCT FROM NEW.duration_ms;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION sync_audio_duration_to_dependents(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_audio_duration_to_dependents() IS 'When course_audio.duration_ms is set or changed, propagate to the cache columns on course_practice_phrases and course_legos. Pair: pull_audio_duration_on_link().';


--
-- Name: sync_learner_email_from_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_learner_email_from_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  l_id UUID;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO l_id FROM learners WHERE user_id = NEW.id::text;
  IF l_id IS NULL THEN
    RETURN NEW; -- learner not yet created; sync_email_on_learner_insert handles backfill
  END IF;

  -- Demote any other primary first to keep the invariant
  UPDATE learner_emails
  SET is_primary = FALSE, updated_at = NOW()
  WHERE learner_id = l_id AND is_primary AND email != NEW.email;

  -- Upsert as primary
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  VALUES (l_id, NEW.email, TRUE, NEW.email_confirmed_at IS NOT NULL, 'auth_user')
  ON CONFLICT (learner_id, email) DO UPDATE
  SET is_primary = TRUE,
      verified = NEW.email_confirmed_at IS NOT NULL,
      updated_at = NOW();

  RETURN NEW;
END;
$$;


--
-- Name: sync_learner_email_from_identity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_learner_email_from_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  l_id UUID;
  identity_email TEXT;
BEGIN
  identity_email := NEW.identity_data->>'email';
  IF identity_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO l_id FROM learners WHERE user_id = NEW.user_id::text;
  IF l_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  VALUES (l_id, identity_email, FALSE, TRUE, NEW.provider)
  ON CONFLICT (learner_id, email) DO UPDATE
  SET verified = TRUE,
      source = COALESCE(learner_emails.source, NEW.provider),
      updated_at = NOW();

  RETURN NEW;
END;
$$;


--
-- Name: sync_learner_emails_on_learner_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_learner_emails_on_learner_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
  -- Pull primary email from auth.users
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  SELECT NEW.id, u.email, TRUE, u.email_confirmed_at IS NOT NULL, 'auth_user'
  FROM auth.users u
  WHERE u.id::text = NEW.user_id AND u.email IS NOT NULL
  ON CONFLICT (learner_id, email) DO NOTHING;

  -- Pull all identity emails (may overlap with primary; ON CONFLICT skips dupes)
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  SELECT NEW.id, i.identity_data->>'email', FALSE, TRUE, i.provider
  FROM auth.identities i
  WHERE i.user_id::text = NEW.user_id
    AND i.identity_data->>'email' IS NOT NULL
  ON CONFLICT (learner_id, email) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: test_learner_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_learner_ids() RETURNS TABLE(learner_id uuid)
    LANGUAGE sql STABLE
    AS $$
  SELECT l.id
  FROM learners l
  WHERE l.is_demo
     OR l.is_internal
     OR l.is_class_entity
     OR EXISTS (SELECT 1 FROM unnest(l.verified_emails) e WHERE e ILIKE 'thomas.cassidy+%')
     OR (l.user_id IS NOT NULL AND l.user_id IN (
           SELECT admin_user_id FROM schools WHERE is_test AND admin_user_id IS NOT NULL
         ))
     OR (l.user_id IS NOT NULL AND l.user_id IN (
           SELECT c.teacher_user_id FROM classes c JOIN schools s ON c.school_id = s.id
           WHERE s.is_test AND c.teacher_user_id IS NOT NULL
         ))
     OR EXISTS (
          SELECT 1 FROM user_tags ut
          WHERE ut.user_id = l.user_id AND ut.removed_at IS NULL AND ut.tag_type = 'school'
            AND ut.tag_value IN (SELECT 'SCHOOL:' || id::text FROM schools WHERE is_test)
        )
     OR EXISTS (
          SELECT 1 FROM user_tags ut
          WHERE ut.user_id = l.user_id AND ut.removed_at IS NULL AND ut.tag_type = 'class'
            AND ut.tag_value IN (
              SELECT 'CLASS:' || c.id::text FROM classes c JOIN schools s ON c.school_id = s.id WHERE s.is_test
            )
        );
$$;


--
-- Name: FUNCTION test_learner_ids(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.test_learner_ids() IS 'Canonical test/internal/non-human learner set for analytics + board metrics. Superset of is_demo/is_internal; also excludes is_class_entity (a class''s own learner identity — see 20260716b_class_learner_entity.sql) and any school/class attachment to an is_test school. service_role only (used server-side; SECURITY DEFINER callers like update_daily_contributions run as owner and bypass the grant).';


--
-- Name: tg_release_notes_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_release_notes_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: touch_canonical_pod_scenarios(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_canonical_pod_scenarios() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;


--
-- Name: touch_listening_pods_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_listening_pods_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_daily_contributions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_daily_contributions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Recompute the whole row for (language, date) from sessions, EXCLUDING
  -- test/internal learners. SUM seconds first, divide by 60 after.
  INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
  SELECT
    v_target_lang,
    v_date,
    COALESCE(SUM(s.items_practiced), 0),
    COALESCE(SUM(s.duration_seconds), 0) / 60,
    COUNT(DISTINCT s.learner_id)
  FROM sessions s
  WHERE SPLIT_PART(s.course_id, '_for_', 1) = v_target_lang
    AND s.started_at::date = v_date
    AND NOT EXISTS (SELECT 1 FROM public.test_learner_ids() t WHERE t.learner_id = s.learner_id)
  ON CONFLICT (target_language, contribution_date)
  DO UPDATE SET
    phrases_count = EXCLUDED.phrases_count,
    minutes_practiced = EXCLUDED.minutes_practiced,
    unique_speakers = EXCLUDED.unique_speakers,
    updated_at = NOW();

  RETURN NEW;
END;
$$;


--
-- Name: update_language_briefs_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_language_briefs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_phase_prompts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_phase_prompts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: algorithm_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.algorithm_config (
    key text NOT NULL,
    config jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by text,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: TABLE algorithm_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.algorithm_config IS 'Admin-tweakable algorithm parameters for learning engine';


--
-- Name: COLUMN algorithm_config.key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.algorithm_config.key IS 'Unique identifier: turbo_boost, normal_mode, spaced_rep, etc.';


--
-- Name: COLUMN algorithm_config.config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.algorithm_config.config IS 'JSONB config object with all tweakable params';


--
-- Name: apml_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apml_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_path text NOT NULL,
    version text NOT NULL,
    title text,
    content text NOT NULL,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE apml_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.apml_documents IS 'APML specification documents with version history';


--
-- Name: COLUMN apml_documents.document_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apml_documents.document_path IS 'Path like core/cik-lego-principles-v1';


--
-- Name: COLUMN apml_documents.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apml_documents.version IS 'Document version';


--
-- Name: COLUMN apml_documents.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apml_documents.content IS 'Full APML document content';


--
-- Name: COLUMN apml_documents.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apml_documents.is_active IS 'Whether this version is currently active';


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audio_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_flags (
    id integer NOT NULL,
    audio_uuid text NOT NULL,
    course_code text NOT NULL,
    status text DEFAULT 'flagged'::text NOT NULL,
    reason text,
    flagged_by text DEFAULT 'qa'::text,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    regen_count integer DEFAULT 0
);


--
-- Name: audio_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audio_flags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audio_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audio_flags_id_seq OWNED BY public.audio_flags.id;


--
-- Name: audio_pass_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_pass_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    reason text NOT NULL,
    requested_by text,
    status text DEFAULT 'pending'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fulfilled_at timestamp with time zone,
    fulfilled_by text
);


--
-- Name: board_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    label text NOT NULL,
    report_month text NOT NULL,
    payload jsonb NOT NULL,
    share_code text NOT NULL,
    revoked_at timestamp with time zone,
    created_by text NOT NULL
);


--
-- Name: TABLE board_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.board_snapshots IS 'Frozen, fully-resolved board reports for external sharing. Service-role-only (RLS on, no policies) — every access goes through api/admin/board-snapshot.ts (mint/list/revoke, admin-gated) or api/board/snapshot/[code].ts (public single-row lookup by share_code).';


--
-- Name: COLUMN board_snapshots.payload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_snapshots.payload IS 'Self-contained resolved document: authored markdown + resolved metric values/methods/as-of timestamps at freeze time. The share route renders only this — never a live query.';


--
-- Name: COLUMN board_snapshots.share_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_snapshots.share_code IS '128-bit random, URL-safe. Not sequential, not derived from label — capability-by-unguessability, same trust model as try_links.code.';


--
-- Name: COLUMN board_snapshots.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.board_snapshots.created_by IS 'auth uid (learners.user_id) of the admin who minted this snapshot.';


--
-- Name: build_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    pass text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    current_seed integer,
    seeds_completed integer DEFAULT 0,
    total_seeds integer NOT NULL,
    analysis_complete boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    last_heartbeat timestamp with time zone,
    completed_at timestamp with time zone,
    requested_by text,
    stop_requested boolean DEFAULT false,
    error_message text,
    resume_from_seed integer,
    respawn_count integer DEFAULT 0,
    last_respawn_at timestamp with time zone,
    agent_count integer DEFAULT 1,
    batch_start_seed integer DEFAULT 0,
    terminal text DEFAULT 'iTerm2'::text,
    last_progress_at timestamp with time zone,
    machine_name text,
    build_mode text DEFAULT 'parallel'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT build_jobs_pass_check CHECK ((pass = ANY (ARRAY['translate'::text, 'build-team'::text, 'final-pass'::text, 'gender-prep'::text, 'decompose'::text, 'backfill-phrases'::text]))),
    CONSTRAINT build_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'stalled'::text, 'stopped'::text, 'complete'::text, 'failed'::text])))
);


--
-- Name: TABLE build_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.build_jobs IS 'Coordinates course builds between Dashboard and Course-Builder';


--
-- Name: COLUMN build_jobs.pass; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.pass IS 'pass_1 = translate 668 seeds + analysis, pass_2 = decompose to LEGOs/phrases';


--
-- Name: COLUMN build_jobs.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.status IS 'pending -> running -> complete/stopped/stalled/failed';


--
-- Name: COLUMN build_jobs.total_seeds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.total_seeds IS '668 for pass_1, configurable course_size for pass_2';


--
-- Name: COLUMN build_jobs.analysis_complete; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.analysis_complete IS 'Pass 1 only: set true when language analysis doc generated';


--
-- Name: COLUMN build_jobs.stop_requested; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.stop_requested IS 'Dashboard sets true to signal agent to stop gracefully';


--
-- Name: COLUMN build_jobs.resume_from_seed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.resume_from_seed IS 'When resuming stopped/stalled job, start from this seed';


--
-- Name: COLUMN build_jobs.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.build_jobs.metadata IS 'Job metadata including activity_log (last 20 seed submissions), errors, etc.';


--
-- Name: build_lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.build_lessons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    language_family text NOT NULL,
    lesson_type text NOT NULL,
    trigger text,
    lesson text NOT NULL,
    example_wrong text,
    example_right text,
    active boolean DEFAULT true,
    superseded_by uuid,
    discovered_in_course text,
    discovered_at_seed integer
);


--
-- Name: canonical_pod_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_pod_scenarios (
    id text NOT NULL,
    pod_slug text NOT NULL,
    scene_number integer NOT NULL,
    scene_label text,
    scene_title text,
    scene_subtitle text,
    difficulty text,
    sentence_number integer NOT NULL,
    global_order integer NOT NULL,
    speaker text,
    english_text text NOT NULL,
    author_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    variant_key text
);


--
-- Name: canonical_seed_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_seed_translations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seed_number integer NOT NULL,
    language_code text NOT NULL,
    translated_text text NOT NULL,
    source_course text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE canonical_seed_translations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.canonical_seed_translations IS 'Translations of canonical seeds into various languages, bootstrapped from existing courses';


--
-- Name: canonical_seeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_seeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seed_number integer NOT NULL,
    seed_id text NOT NULL,
    canonical_id text NOT NULL,
    source_text text NOT NULL,
    release_batch integer DEFAULT 1,
    difficulty_tier integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: checkpoint_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    checkpoint_seed integer NOT NULL,
    approved_at timestamp with time zone DEFAULT now(),
    approved_by text,
    qa_report jsonb
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    teacher_user_id text,
    class_name text NOT NULL,
    course_code text NOT NULL,
    student_join_code text NOT NULL,
    current_seed integer DEFAULT 1 NOT NULL,
    helix_state jsonb DEFAULT '{"threads": {"1": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}, "2": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}, "3": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}}, "active_thread": 1}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_lego_id text,
    class_learner_id uuid
);


--
-- Name: TABLE classes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.classes IS 'Class records. current_seed and helix_state track Class Play position.';


--
-- Name: COLUMN classes.teacher_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.classes.teacher_user_id IS 'Lead-teacher pointer (denormalised convenience). NOT the source of truth for teacher↔class — that is user_tags(tag_type=''class'', role_in_context=''teacher''). Nullable since 2026-06-13 (first-class-class). Read teachers via class_teachers / is_class_teacher().';


--
-- Name: learners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    display_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    preferences jsonb DEFAULT '{"volume": 1.0, "turbo_mode_enabled": false, "encouragements_enabled": true, "session_duration_minutes": 15}'::jsonb NOT NULL,
    educational_role text,
    platform_role text,
    invite_code_id uuid,
    verified_emails text[] DEFAULT '{}'::text[] NOT NULL,
    dashboard_courses text[],
    welcome_played_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    is_internal boolean DEFAULT false NOT NULL,
    is_class_entity boolean DEFAULT false NOT NULL,
    needs_verification boolean DEFAULT false NOT NULL,
    CONSTRAINT learners_educational_role_check CHECK ((educational_role = ANY (ARRAY['student'::text, 'teacher'::text, 'school_admin'::text, 'govt_admin'::text, 'tutor'::text]))),
    CONSTRAINT learners_platform_role_check CHECK (((platform_role IS NULL) OR (platform_role = ANY (ARRAY['ssi_admin'::text, 'popty_user'::text, 'tester'::text]))))
);


--
-- Name: TABLE learners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learners IS 'Learner profiles. user_id stores Clerk user ID (string). Created by app on first sign-in.';


--
-- Name: COLUMN learners.educational_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learners.educational_role IS 'Role in school context: student, teacher, school_admin, govt_admin. NULL = individual learner.';


--
-- Name: COLUMN learners.platform_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learners.platform_role IS 'Platform-level role. Only ssi_admin for Tom/Aran.';


--
-- Name: COLUMN learners.is_internal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learners.is_internal IS 'Real human internal/QA/team account (not synthetic — see is_demo). Excluded from analytics aggregates so adoption metrics reflect external users only.';


--
-- Name: COLUMN learners.is_class_entity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learners.is_class_entity IS 'This learner row is a CLASS''s own learner identity (owner ruling 2026-07-16), not a human. Never signed in; user_id holds a synthetic class-learner:<classId> value. Excluded from real-learner counts (test_learner_ids()) — neither test data nor a countable human.';


--
-- Name: COLUMN learners.needs_verification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learners.needs_verification IS 'True for possession-onboarded accounts (api/auth/possession-redeem.ts) that have never completed an email-receipt round-trip (api/email/verify.ts). Do NOT derive this from auth.users.email_confirmed_at -- that column is set by the possession flows own magic-link mint and does not prove receipt. Name matches docs/onboarding/onboarding-series-draft.md signal needs_verification.';


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id text,
    school_name text NOT NULL,
    region_code text,
    teacher_join_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    invite_code_id uuid,
    group_id uuid,
    admin_join_code text NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    platform_status text DEFAULT 'trial'::text NOT NULL,
    trial_course_code text,
    trial_kind text,
    platform_expires_at timestamp with time zone,
    teacher_seats integer DEFAULT 1 NOT NULL,
    provider_subscription_id text,
    provider_customer_id text,
    name_confirmed boolean DEFAULT true NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT schools_platform_status_check CHECK ((platform_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'expired'::text, 'cancelled'::text]))),
    CONSTRAINT schools_trial_kind_check CHECK (((trial_kind IS NULL) OR (trial_kind = ANY (ARRAY['premium_1mo'::text, 'free_1yr'::text]))))
);


--
-- Name: TABLE schools; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schools IS 'School records. admin_user_id is the Clerk ID of the school admin.';


--
-- Name: COLUMN schools.platform_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schools.platform_status IS 'Platform-subscription lifecycle: trial|active|past_due|expired|cancelled. The dashboard gate = active OR (trial AND platform_expires_at > now). App FAILS OPEN when this is NULL/absent.';


--
-- Name: COLUMN schools.trial_course_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schools.trial_course_code IS 'The ONE language the school may trial. A second different course requires checkout.';


--
-- Name: COLUMN schools.trial_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schools.trial_kind IS 'premium_1mo (premium course → 30d) | free_1yr (free course → 365d; schools pay for the platform even on free courses, so still time-limited).';


--
-- Name: COLUMN schools.teacher_seats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schools.teacher_seats IS 'Paid teacher seats = Paddle quantity on the per-seat price (£15/teacher/mo).';


--
-- Name: COLUMN schools.is_test; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.schools.is_test IS 'Not a genuine paying/pilot customer — soak-test/E2E/owner-test school. Superset of is_demo (seeded demo data). Board metrics (schools.total) exclude is_test, never is_demo alone.';


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer DEFAULT 0 NOT NULL,
    items_practiced integer DEFAULT 0 NOT NULL,
    spikes_detected integer DEFAULT 0 NOT NULL,
    final_rolling_average numeric(10,4) DEFAULT 0 NOT NULL,
    points_earned integer DEFAULT 0 NOT NULL,
    bonus_messages jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: COLUMN sessions.points_earned; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sessions.points_earned IS 'Points earned this session (shown to user, formula hidden)';


--
-- Name: COLUMN sessions.bonus_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sessions.bonus_messages IS 'Array of bonus messages to show user (e.g., "✨ Consistency bonus activated")';


--
-- Name: user_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    tag_type text NOT NULL,
    tag_value text NOT NULL,
    role_in_context text NOT NULL,
    added_by text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT user_tags_role_in_context_check CHECK ((role_in_context = ANY (ARRAY['admin'::text, 'teacher'::text, 'student'::text]))),
    CONSTRAINT user_tags_tag_type_check CHECK ((tag_type = ANY (ARRAY['school'::text, 'class'::text])))
);


--
-- Name: TABLE user_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_tags IS 'Soft connections between users and schools/classes. removed_at enables soft delete.';


--
-- Name: class_activity_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.class_activity_stats WITH (security_invoker='on') AS
 SELECT c.id AS class_id,
    c.class_name,
    c.school_id,
    c.course_code,
    s_school.region_code,
    COALESCE(sum(sess.items_practiced), (0)::bigint) AS total_cycles,
    count(DISTINCT sess.id) AS total_sessions,
    COALESCE(sum(sess.duration_seconds), (0)::bigint) AS total_practice_seconds,
    count(DISTINCT l.id) AS active_students,
        CASE
            WHEN (count(DISTINCT sess.id) > 0) THEN round(((sum(sess.items_practiced))::numeric / (count(DISTINCT sess.id))::numeric), 1)
            ELSE (0)::numeric
        END AS avg_cycles_per_session,
    count(DISTINCT
        CASE
            WHEN (sess.started_at >= (now() - '7 days'::interval)) THEN date(sess.started_at)
            ELSE NULL::date
        END) AS active_days_last_7
   FROM ((((public.classes c
     JOIN public.schools s_school ON ((s_school.id = c.school_id)))
     LEFT JOIN public.user_tags ut ON (((ut.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut.tag_type = 'class'::text) AND (ut.role_in_context = 'student'::text) AND (ut.removed_at IS NULL))))
     LEFT JOIN public.learners l ON ((l.user_id = ut.user_id)))
     LEFT JOIN public.sessions sess ON (((sess.learner_id = l.id) AND (sess.course_id = c.course_code))))
  WHERE (c.is_active = true)
  GROUP BY c.id, c.class_name, c.school_id, c.course_code, s_school.region_code;


--
-- Name: VIEW class_activity_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.class_activity_stats IS 'Class-level speaking opportunity metrics. Core metric: total_cycles = completed 4-phase learning cycles.';


--
-- Name: class_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    teacher_user_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    start_lego_id text NOT NULL,
    end_lego_id text,
    cycles_completed integer DEFAULT 0 NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL
);


--
-- Name: lego_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lego_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    lego_id text NOT NULL,
    course_id text NOT NULL,
    thread_id smallint NOT NULL,
    fibonacci_position smallint DEFAULT 0 NOT NULL,
    skip_number integer DEFAULT 0 NOT NULL,
    reps_completed smallint DEFAULT 0 NOT NULL,
    is_retired boolean DEFAULT false NOT NULL,
    last_practiced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    introduction_played boolean DEFAULT false NOT NULL,
    introduction_index smallint DEFAULT 0 NOT NULL,
    introduction_complete boolean DEFAULT false NOT NULL,
    eternal_urn jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT lego_progress_thread_id_check CHECK (((thread_id >= 1) AND (thread_id <= 3)))
);


--
-- Name: COLUMN lego_progress.introduction_played; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lego_progress.introduction_played IS 'Has the LEGO introduction audio been played?';


--
-- Name: COLUMN lego_progress.introduction_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lego_progress.introduction_index IS 'Position in introduction sequence (0=first component)';


--
-- Name: COLUMN lego_progress.introduction_complete; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lego_progress.introduction_complete IS 'Has full introduction sequence been completed?';


--
-- Name: COLUMN lego_progress.eternal_urn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.lego_progress.eternal_urn IS 'Remaining phrase IDs in random urn for spaced rep selection';


--
-- Name: seed_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    seed_id text NOT NULL,
    course_id text NOT NULL,
    thread_id smallint NOT NULL,
    is_introduced boolean DEFAULT false NOT NULL,
    introduced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seed_progress_thread_id_check CHECK (((thread_id >= 1) AND (thread_id <= 3)))
);


--
-- Name: class_student_progress; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.class_student_progress WITH (security_invoker='on') AS
 SELECT c.id AS class_id,
    c.class_name,
    c.course_code,
    c.school_id,
    c.teacher_user_id,
    ut.user_id AS student_user_id,
    l.id AS learner_id,
    l.display_name AS student_name,
    COALESCE(( SELECT count(*) AS count
           FROM public.seed_progress sp
          WHERE ((sp.learner_id = l.id) AND (sp.course_id = c.course_code) AND (sp.is_introduced = true))), (0)::bigint) AS seeds_completed,
    COALESCE(( SELECT count(*) AS count
           FROM public.lego_progress lp
          WHERE ((lp.learner_id = l.id) AND (lp.course_id = c.course_code) AND (lp.is_retired = true))), (0)::bigint) AS legos_mastered,
    COALESCE(( SELECT sum(s.duration_seconds) AS sum
           FROM public.sessions s
          WHERE ((s.learner_id = l.id) AND (s.course_id = c.course_code))), (0)::bigint) AS total_practice_seconds,
    ( SELECT max(s.ended_at) AS max
           FROM public.sessions s
          WHERE ((s.learner_id = l.id) AND (s.course_id = c.course_code))) AS last_active_at,
    ut.added_at AS joined_class_at
   FROM ((public.classes c
     JOIN public.user_tags ut ON (((ut.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut.tag_type = 'class'::text) AND (ut.removed_at IS NULL) AND (ut.role_in_context = 'student'::text))))
     JOIN public.learners l ON ((l.user_id = ut.user_id)));


--
-- Name: VIEW class_student_progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.class_student_progress IS 'Student progress within classes. Used by teacher dashboard.';


--
-- Name: class_teachers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.class_teachers WITH (security_invoker='on') AS
 SELECT c.id AS class_id,
    ut.user_id AS teacher_user_id,
    ut.added_at,
    ut.added_by,
    (NOT (c.teacher_user_id IS DISTINCT FROM ut.user_id)) AS is_lead
   FROM (public.user_tags ut
     JOIN public.classes c ON ((ut.tag_value = ('CLASS:'::text || (c.id)::text))))
  WHERE ((ut.tag_type = 'class'::text) AND (ut.role_in_context = 'teacher'::text) AND (ut.removed_at IS NULL));


--
-- Name: VIEW class_teachers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.class_teachers IS 'Active teacher↔class relationships (the source of truth), lead flagged. Replaces reads of classes.teacher_user_id for "who teaches this class". is_lead depends on the lead pointer and changes when that column is eventually dropped.';


--
-- Name: content_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_audit_log (
    id bigint NOT NULL,
    table_name text NOT NULL,
    change_type text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by_role text DEFAULT CURRENT_USER NOT NULL,
    changed_by_uid uuid,
    primary_key text,
    old_row jsonb NOT NULL,
    CONSTRAINT content_audit_log_change_type_check CHECK ((change_type = ANY (ARRAY['UPDATE'::text, 'DELETE'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_cost_limit='2000');


--
-- Name: TABLE content_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.content_audit_log IS 'Append-only history of UPDATE/DELETE on at-risk content tables. Used for granular rollback when an agent or human corrupts content. See migration 20260510 for restore patterns.';


--
-- Name: content_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: content_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_audit_log_id_seq OWNED BY public.content_audit_log.id;


--
-- Name: content_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audio_id uuid,
    course_code text NOT NULL,
    feedback_type text NOT NULL,
    user_id text,
    comment text,
    session_context jsonb,
    resolved_at timestamp with time zone,
    resolved_by text,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE content_feedback; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.content_feedback IS 'User-submitted feedback on audio/content - aggregated by threshold to surface issues';


--
-- Name: COLUMN content_feedback.feedback_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.content_feedback.feedback_type IS 'translation, audio_quality, pronunciation, too_fast, confusing, other';


--
-- Name: COLUMN content_feedback.session_context; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.content_feedback.session_context IS 'JSON context: seed_id, cycle_index, lego_id, device, app_version';


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id text NOT NULL,
    user_id text,
    subject text DEFAULT 'mathematics'::text NOT NULL,
    topic text,
    exam_context jsonb,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    message_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: course_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_audio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    text text NOT NULL,
    text_normalized text NOT NULL,
    language text NOT NULL,
    role text NOT NULL,
    voice_id text NOT NULL,
    origin text NOT NULL,
    s3_key text NOT NULL,
    duration_ms integer,
    file_size_bytes integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lego_id text,
    text_stripped text GENERATED ALWAYS AS (lower(TRIM(BOTH FROM regexp_replace(text_normalized, '[。？！、，.!?,;:()（）「」『』\[\]…—–¿¡\-]+'::text, ''::text, 'g'::text)))) STORED,
    word_boundaries jsonb,
    sequence integer,
    CONSTRAINT course_audio_origin_check CHECK ((origin = ANY (ARRAY['tts'::text, 'human'::text]))),
    CONSTRAINT course_audio_role_check CHECK ((role = ANY (ARRAY['known'::text, 'target1'::text, 'target2'::text, 'presentation'::text, 'welcome'::text, 'encouragement'::text, 'instruction'::text, 'bookend_listen_intro'::text, 'bookend_listen_outro'::text, 'pod_explainer'::text, 'pod_fine_known'::text, 'pod_take_g'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02');


--
-- Name: TABLE course_audio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_audio IS 'Course-specific audio (known, target1, target2, presentation roles)';


--
-- Name: COLUMN course_audio.origin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio.origin IS 'tts = regenerable, human = precious';


--
-- Name: COLUMN course_audio.s3_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio.s3_key IS 'Path in ssi-audio-stage bucket';


--
-- Name: COLUMN course_audio.lego_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio.lego_id IS 'For presentation audio: the LEGO this introduces (e.g., S0001L01). NULL for other roles.';


--
-- Name: course_audio_envelope; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_audio_envelope (
    audio_id uuid NOT NULL,
    duration_ms integer NOT NULL,
    peak_count integer NOT NULL,
    peak_to_mean_ratio real NOT NULL,
    mean_peak_width_ms real NOT NULL,
    extractor_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE course_audio_envelope; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_audio_envelope IS 'Precomputed volume-envelope metadata (duration, peak count, peak shape) for model-voice (course_audio role=target1) clips — adaptation-v2 stage-2 signal.';


--
-- Name: COLUMN course_audio_envelope.peak_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio_envelope.peak_count IS 'Syllable-scale energy peaks, 20ms-grid RMS envelope, prominence >= 25% of (max-mean), min separation 120ms.';


--
-- Name: COLUMN course_audio_envelope.peak_to_mean_ratio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio_envelope.peak_to_mean_ratio IS 'max linear RMS / mean linear RMS over the whole clip.';


--
-- Name: COLUMN course_audio_envelope.mean_peak_width_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio_envelope.mean_peak_width_ms IS 'Mean full-width-at-half-prominence across detected peaks.';


--
-- Name: COLUMN course_audio_envelope.extractor_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_audio_envelope.extractor_version IS 'Gates comparability against learner-side EnvelopeMetadata of the same version.';


--
-- Name: course_audio_inventory; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_audio_inventory WITH (security_invoker='on') AS
 SELECT course_code,
    role,
    origin,
    count(*) AS count,
    count(DISTINCT voice_id) AS voice_count
   FROM public.course_audio
  GROUP BY course_code, role, origin
  ORDER BY course_code, role, origin;


--
-- Name: VIEW course_audio_inventory; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.course_audio_inventory IS 'Quick summary of audio per course/role';


--
-- Name: course_audio_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_audio_usage (
    course_code text NOT NULL,
    audio_uuid text NOT NULL,
    used_in text,
    seed_id text,
    lego_id text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: course_checkpoint_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_checkpoint_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    checkpoint_seed integer NOT NULL,
    review_mode text DEFAULT 'human'::text NOT NULL,
    min_quality_score numeric(3,2) DEFAULT 7.0,
    max_drift_rate numeric(4,2) DEFAULT 0.20,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT course_checkpoint_config_review_mode_check CHECK ((review_mode = ANY (ARRAY['human'::text, 'auto'::text, 'auto_with_flag'::text])))
);


--
-- Name: course_checkpoint_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_checkpoint_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    checkpoint_seed integer NOT NULL,
    gate_1_quality_avg numeric(3,2),
    gate_2_use_avg numeric(3,2),
    gate_2_build_avg numeric(3,2),
    gate_3_vocab_violations integer DEFAULT 0,
    gate_4_drift_rate numeric(4,2),
    status text DEFAULT 'pending'::text NOT NULL,
    review_mode_used text,
    approved_by text,
    rejection_reason text,
    qa_report jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT course_checkpoint_results_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'pending_human'::text, 'approved'::text, 'rejected'::text, 'flagged'::text])))
);


--
-- Name: course_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    last_practiced_at timestamp with time zone,
    total_practice_minutes integer DEFAULT 0 NOT NULL,
    helix_state jsonb DEFAULT '{"threads": {"1": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}, "2": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}, "3": {"seedOrder": [], "currentSeedId": null, "currentLegoIndex": 0}}, "active_thread": 1, "injected_content": {}}'::jsonb NOT NULL,
    welcome_played boolean DEFAULT false,
    last_completed_lego_id text,
    last_completed_round_index integer,
    highest_completed_seed integer,
    pod_activation_round integer,
    completed_pod_rounds integer DEFAULT 0 NOT NULL,
    highest_completed_round_index integer,
    highest_completed_lego_id text,
    current_cycle_index integer DEFAULT 0 NOT NULL,
    current_mode text DEFAULT 'main'::text NOT NULL,
    infplay_round_index integer DEFAULT 0 NOT NULL,
    CONSTRAINT course_enrollments_current_mode_check CHECK ((current_mode = ANY (ARRAY['main'::text, 'infplay'::text])))
);


--
-- Name: COLUMN course_enrollments.welcome_played; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.welcome_played IS 'True if learner has heard (or skipped) the welcome audio';


--
-- Name: COLUMN course_enrollments.pod_activation_round; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.pod_activation_round IS 'Per-learner pin for Listening Pods (Layer 2) activation round. Set once on first session after pods appear in this course. NULL = use default (R6).';


--
-- Name: COLUMN course_enrollments.completed_pod_rounds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.completed_pod_rounds IS 'Independent counter for Listening Pods (Layer 2). Increments by 1 each time a pod lap plays to completion. Skipped laps leave it unchanged so the same content plays next session. Course-reset path should set this back to 0 (and pod_activation_round back to NULL).';


--
-- Name: COLUMN course_enrollments.current_cycle_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.current_cycle_index IS 'Cycle index within the in-progress round to resume from on reload. 0 = start of round.';


--
-- Name: COLUMN course_enrollments.current_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.current_mode IS 'Playback mode. main = normal course progression (intros, spaced rep, USE). infplay = past-course-end review-only mode (no intros, spaced rep + random USE). Set automatically by resolveStartLegoId when the learner hits course end; reset to main when they back-belt-skip out.';


--
-- Name: COLUMN course_enrollments.infplay_round_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_enrollments.infplay_round_index IS 'Rounds elapsed since entering INF PLAY mode. Resets to 1 on entry, increments per round_complete while in INF PLAY, reset to 0 on mode=main. Used for the 89-round spaced-rep drain math (rounds 1-89 still have fib offsets vs main-loop content) and for the visible "INF round N" display.';


--
-- Name: course_export_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_export_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    manifest_generated boolean DEFAULT false,
    s3_verified boolean DEFAULT false,
    manifest_published boolean DEFAULT false,
    audio_deployed boolean DEFAULT false,
    manifest_generated_at timestamp with time zone,
    s3_verified_at timestamp with time zone,
    manifest_published_at timestamp with time zone,
    audio_deployed_at timestamp with time zone,
    manifest_version text,
    manifest_hash text,
    manifest_status text,
    manifest_seed_count integer,
    manifest_lego_count integer,
    manifest_audio_count integer,
    s3_verification jsonb,
    publish_course_configs_path text,
    publish_apidev_filename text,
    deploy_plan jsonb,
    deploy_executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pending_manifest_path text,
    generated_on_machine text,
    CONSTRAINT course_export_states_manifest_status_check CHECK ((manifest_status = ANY (ARRAY['alpha'::text, 'beta'::text, 'release'::text])))
);


--
-- Name: course_gender_expansions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_gender_expansions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    original_text text NOT NULL,
    language text NOT NULL,
    expanded_f text,
    expanded_m text,
    processed_at timestamp with time zone DEFAULT now(),
    text_side text DEFAULT 'target'::text NOT NULL
);


--
-- Name: course_lego_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_lego_positions (
    course_code text NOT NULL,
    lego_id text NOT NULL,
    x real NOT NULL,
    y real NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: course_legos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_legos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    seed_number integer NOT NULL,
    lego_index integer NOT NULL,
    lego_id text GENERATED ALWAYS AS (((('S'::text || lpad((seed_number)::text, 4, '0'::text)) || 'L'::text) || lpad((lego_index)::text, 2, '0'::text))) STORED,
    type public.lego_type NOT NULL,
    is_new boolean NOT NULL,
    known_text text,
    target_text text NOT NULL,
    components jsonb,
    status public.content_status DEFAULT 'draft'::public.content_status NOT NULL,
    release_batch integer,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    known_audio_id uuid,
    target1_audio_id uuid,
    target2_audio_id uuid,
    presentation_audio_id text,
    target1_duration_ms integer,
    target2_duration_ms integer,
    target_text_roman text,
    target_lego_id text,
    CONSTRAINT course_legos_lego_index_check CHECK (((lego_index > 0) AND (lego_index < 100))),
    CONSTRAINT course_legos_seed_number_check CHECK ((seed_number > 0))
);


--
-- Name: TABLE course_legos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_legos IS 'Learning units extracted from seeds';


--
-- Name: COLUMN course_legos.lego_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.lego_index IS 'Position within seed (1-99)';


--
-- Name: COLUMN course_legos.lego_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.lego_id IS 'Human-readable identifier (e.g., S0001L01)';


--
-- Name: COLUMN course_legos.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.type IS 'A = Atomic (single word), M = Molecular (multi-word phrase)';


--
-- Name: COLUMN course_legos.is_new; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.is_new IS 'true if this LEGO is being introduced for the first time in this seed';


--
-- Name: COLUMN course_legos.components; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.components IS 'For M-type only: atomic breakdown as JSONB array of {known, target} pairs';


--
-- Name: COLUMN course_legos.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.version IS 'Increments on each edit for delta sync';


--
-- Name: COLUMN course_legos.known_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.known_audio_id IS 'Direct audio UUID for known language prompt';


--
-- Name: COLUMN course_legos.target1_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.target1_audio_id IS 'Direct audio UUID for target language voice 1';


--
-- Name: COLUMN course_legos.target2_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.target2_audio_id IS 'Direct audio UUID for target language voice 2';


--
-- Name: COLUMN course_legos.presentation_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.presentation_audio_id IS 'Audio UUID for LEGO introduction ("The Spanish for X is..."). Only populated for is_new=true LEGOs. Same lookup pattern as known_audio_id, target1_audio_id, target2_audio_id.';


--
-- Name: COLUMN course_legos.target1_duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.target1_duration_ms IS 'Duration of target1 audio in milliseconds';


--
-- Name: COLUMN course_legos.target2_duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_legos.target2_duration_ms IS 'Duration of target2 audio in milliseconds';


--
-- Name: course_practice_phrases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_practice_phrases (
    id text NOT NULL,
    course_code text NOT NULL,
    seed_number integer NOT NULL,
    lego_index integer NOT NULL,
    "position" integer NOT NULL,
    known_text text,
    target_text text NOT NULL,
    word_count integer NOT NULL,
    lego_count integer NOT NULL,
    difficulty text,
    register text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.content_status DEFAULT 'draft'::public.content_status NOT NULL,
    release_batch integer,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_syllable_count integer,
    phrase_role text DEFAULT 'practice'::text NOT NULL,
    connected_lego_ids text[] DEFAULT '{}'::text[],
    lego_position text,
    known_audio_id uuid,
    target1_audio_id uuid,
    target2_audio_id uuid,
    qa_checked timestamp with time zone,
    target1_duration_ms integer,
    target2_duration_ms integer,
    lego_id text,
    target_text_roman text,
    target_phrase_id text,
    presentation_audio_id uuid,
    introduce boolean DEFAULT true NOT NULL,
    decomposition jsonb,
    decomposition_course_version integer,
    display_tiling jsonb,
    display_tiling_version integer,
    CONSTRAINT course_practice_phrases_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT course_practice_phrases_lego_index_check CHECK (((lego_index > 0) AND (lego_index < 100))),
    CONSTRAINT course_practice_phrases_lego_position_check CHECK ((lego_position = ANY (ARRAY['start'::text, 'middle'::text, 'end'::text]))),
    CONSTRAINT course_practice_phrases_phrase_role_check CHECK ((phrase_role = ANY (ARRAY['component'::text, 'practice'::text, 'build'::text, 'use'::text, 'eternal_eligible'::text]))),
    CONSTRAINT course_practice_phrases_position_check CHECK (("position" >= 0)),
    CONSTRAINT course_practice_phrases_register_check CHECK ((register = ANY (ARRAY['casual'::text, 'formal'::text]))),
    CONSTRAINT course_practice_phrases_seed_number_check CHECK ((seed_number > 0))
);


--
-- Name: TABLE course_practice_phrases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_practice_phrases IS 'Practice sentences for each LEGO, organized by position';


--
-- Name: COLUMN course_practice_phrases."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases."position" IS '0=component, 1=debut, 2-7=practice, 8+=eternal';


--
-- Name: COLUMN course_practice_phrases.word_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.word_count IS 'Number of words in phrase - used for runtime phrase_type classification';


--
-- Name: COLUMN course_practice_phrases.lego_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.lego_count IS 'Number of LEGOs used in phrase - used for runtime phrase_type classification';


--
-- Name: COLUMN course_practice_phrases.difficulty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.difficulty IS 'Learner difficulty rating (optional)';


--
-- Name: COLUMN course_practice_phrases.register; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.register IS 'Language register (optional)';


--
-- Name: COLUMN course_practice_phrases.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.metadata IS 'JSONB for future extensions without schema changes';


--
-- Name: COLUMN course_practice_phrases.phrase_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.phrase_role IS 'Explicit phrase category: component (M-type parts), practice (debut build-up), eternal_eligible (spaced rep)';


--
-- Name: COLUMN course_practice_phrases.connected_lego_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.connected_lego_ids IS 'Other LEGO IDs that appear in this phrase. Used for coverage-based selection.';


--
-- Name: COLUMN course_practice_phrases.lego_position; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.lego_position IS 'Where the primary LEGO appears in target_text: start, middle, or end. Used for variety in selection.';


--
-- Name: COLUMN course_practice_phrases.known_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.known_audio_id IS 'Direct audio UUID for known language prompt';


--
-- Name: COLUMN course_practice_phrases.target1_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.target1_audio_id IS 'Direct audio UUID for target language voice 1';


--
-- Name: COLUMN course_practice_phrases.target2_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.target2_audio_id IS 'Direct audio UUID for target language voice 2';


--
-- Name: COLUMN course_practice_phrases.qa_checked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.qa_checked IS 'Timestamp when phrase was last checked by QA monitor';


--
-- Name: COLUMN course_practice_phrases.target1_duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.target1_duration_ms IS 'Duration of target1 audio in milliseconds';


--
-- Name: COLUMN course_practice_phrases.target2_duration_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.target2_duration_ms IS 'Duration of target2 audio in milliseconds';


--
-- Name: COLUMN course_practice_phrases.introduce; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.introduce IS 'When false, component exists for tiling validation but is not presented to the learner';


--
-- Name: COLUMN course_practice_phrases.decomposition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.decomposition IS 'Ordered array of LEGO/ghost blocks: [{legoId, target, known, isGhost}]. Concatenated targets must equal target_text. NULL = not yet computed (runtime falls back to alignment).';


--
-- Name: COLUMN course_practice_phrases.decomposition_course_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.decomposition_course_version IS 'Snapshot of courses.version at decomposition time. If less than courses.version, this phrase decomposition is stale and a recompute should be considered.';


--
-- Name: COLUMN course_practice_phrases.display_tiling; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.display_tiling IS 'Ordered array of display tiles: [{n: native, r: roman, salient: bool}]. Concatenated n == target_text; concatenated r (spaces ignored) == target_text_roman. Display-only (native-primary + romanisation ruby); does not affect audio. NULL = not computed (runtime falls back to its own segmentation).';


--
-- Name: COLUMN course_practice_phrases.display_tiling_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_practice_phrases.display_tiling_version IS 'Snapshot of courses.version at display-tiling compute time. If less than courses.version the tiling may be stale (salient LEGO changed) and a recompute should be considered.';


--
-- Name: target_phrases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_phrases (
    id text NOT NULL,
    target_lang text NOT NULL,
    seed_number integer NOT NULL,
    lego_index integer NOT NULL,
    "position" integer NOT NULL,
    target_text text NOT NULL,
    word_count integer,
    phrase_role text NOT NULL,
    connected_lego_ids text[],
    lego_position text,
    metadata jsonb,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT target_phrases_phrase_role_check CHECK ((phrase_role = ANY (ARRAY['component'::text, 'build'::text, 'use'::text])))
);


--
-- Name: course_phrases_unified; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_phrases_unified WITH (security_invoker='on') AS
 SELECT cpp.id,
    cpp.course_code,
    cpp.seed_number,
    cpp.lego_index,
    cpp."position",
    cpp.known_text,
    COALESCE(tp.target_text, cpp.target_text) AS target_text,
    COALESCE(tp.word_count, cpp.word_count) AS word_count,
    cpp.phrase_role,
    COALESCE(tp.connected_lego_ids, cpp.connected_lego_ids) AS connected_lego_ids,
    COALESCE(tp.lego_position, cpp.lego_position) AS lego_position,
    COALESCE(tp.metadata, cpp.metadata) AS metadata,
    cpp.status,
    cpp.target_phrase_id
   FROM (public.course_practice_phrases cpp
     LEFT JOIN public.target_phrases tp ON ((cpp.target_phrase_id = tp.id)));


--
-- Name: course_practice_phrases_with_type; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_practice_phrases_with_type WITH (security_invoker='on') AS
 SELECT id,
    course_code,
    seed_number,
    lego_index,
    "position",
    known_text,
    target_text,
    word_count,
    lego_count,
    difficulty,
    register,
    metadata,
    status,
    release_batch,
    version,
    updated_at,
    created_at,
    target_syllable_count,
    phrase_role,
    connected_lego_ids,
    lego_position,
    known_audio_id,
    target1_audio_id,
    target2_audio_id,
    qa_checked,
    target1_duration_ms,
    target2_duration_ms,
    lego_id,
        CASE
            WHEN ("position" = 0) THEN 'component'::text
            WHEN ("position" = 1) THEN 'lego'::text
            WHEN (("position" >= 2) AND ("position" <= 7)) THEN 'debut'::text
            ELSE 'eternal'::text
        END AS phrase_type
   FROM public.course_practice_phrases;


--
-- Name: course_progress; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_progress WITH (security_invoker='on') AS
 SELECT e.learner_id,
    e.course_id,
    e.enrolled_at,
    e.last_practiced_at,
    e.total_practice_minutes,
    count(DISTINCT lp.lego_id) AS legos_seen,
    count(DISTINCT
        CASE
            WHEN lp.is_retired THEN lp.lego_id
            ELSE NULL::text
        END) AS legos_retired,
    count(DISTINCT sp.seed_id) AS seeds_introduced
   FROM ((public.course_enrollments e
     LEFT JOIN public.lego_progress lp ON (((lp.learner_id = e.learner_id) AND (lp.course_id = e.course_id))))
     LEFT JOIN public.seed_progress sp ON (((sp.learner_id = e.learner_id) AND (sp.course_id = e.course_id) AND (sp.is_introduced = true))))
  GROUP BY e.learner_id, e.course_id, e.enrolled_at, e.last_practiced_at, e.total_practice_minutes;


--
-- Name: course_qa_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_qa_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    phrase_id text,
    seed_number integer,
    lego_id text,
    check_type text NOT NULL,
    severity text DEFAULT 'warning'::text NOT NULL,
    issue text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text,
    resolution_notes text,
    flagged_at timestamp with time zone DEFAULT now(),
    CONSTRAINT course_qa_flags_check_type_check CHECK ((check_type = ANY (ARRAY['grammar'::text, 'semantic'::text, 'naturalness'::text, 'lego_frequency'::text, 'lego_spread'::text, 'variety'::text, 'vocabulary'::text]))),
    CONSTRAINT course_qa_flags_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text, 'info'::text]))),
    CONSTRAINT course_qa_flags_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text, 'false_positive'::text])))
);


--
-- Name: TABLE course_qa_flags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_qa_flags IS 'QA issues flagged by monitor agent for human review';


--
-- Name: COLUMN course_qa_flags.phrase_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_qa_flags.phrase_id IS 'NULL for cross-seed issues like frequency/variety';


--
-- Name: COLUMN course_qa_flags.check_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_qa_flags.check_type IS 'Type of check that found the issue';


--
-- Name: COLUMN course_qa_flags.severity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_qa_flags.severity IS 'error = must fix, warning = should review, info = pattern noticed';


--
-- Name: COLUMN course_qa_flags.details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_qa_flags.details IS 'JSON with additional context (examples, counts, patterns)';


--
-- Name: course_round_index; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.course_round_index AS
 SELECT course_code,
    (row_number() OVER (PARTITION BY course_code ORDER BY seed_number, lego_index))::integer AS round_index,
    lego_id,
    seed_number,
    lego_index
   FROM public.course_legos
  WHERE ((is_new = true) AND (lego_id IS NOT NULL))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW course_round_index; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.course_round_index IS 'R -> LEGO map for instant-playback. One row per fresh-introduction LEGO per course, ordered by (seed_number, lego_index). Refresh via REFRESH MATERIALIZED VIEW CONCURRENTLY course_round_index after course_legos mutations. Cache-busting key is courses.version.';


--
-- Name: course_seed_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_seed_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    seed_number integer NOT NULL,
    known_text text NOT NULL,
    target_text text NOT NULL,
    submission_data jsonb NOT NULL,
    validation_status text DEFAULT 'valid'::text,
    validation_notes jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    review_status text DEFAULT 'pending'::text,
    reviewer_notes text,
    reviewed_at timestamp with time zone,
    attempt_number integer DEFAULT 1,
    CONSTRAINT course_seed_drafts_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'collision'::text, 'rework'::text, 'decomposed'::text, 'pending_review'::text])))
);


--
-- Name: course_seeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_seeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    seed_number integer NOT NULL,
    seed_id text GENERATED ALWAYS AS (('S'::text || lpad((seed_number)::text, 4, '0'::text))) STORED,
    known_text text,
    target_text text NOT NULL,
    status public.content_status DEFAULT 'draft'::public.content_status NOT NULL,
    release_batch integer,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    known_audio_id uuid,
    target1_audio_id uuid,
    target2_audio_id uuid,
    decomposed_at timestamp with time zone,
    approved_at timestamp with time zone,
    target_text_roman text,
    flagged_at timestamp with time zone,
    CONSTRAINT course_seeds_seed_number_check CHECK ((seed_number > 0))
);


--
-- Name: TABLE course_seeds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.course_seeds IS 'Full sentences - source material for learning';


--
-- Name: COLUMN course_seeds.seed_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_seeds.seed_number IS 'Position in learning sequence (1-668+)';


--
-- Name: COLUMN course_seeds.seed_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_seeds.seed_id IS 'Human-readable identifier (e.g., S0001)';


--
-- Name: COLUMN course_seeds.release_batch; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_seeds.release_batch IS 'Staged rollout batch number (1, 2, 3...)';


--
-- Name: COLUMN course_seeds.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_seeds.version IS 'Increments on each edit for delta sync';


--
-- Name: course_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_stats WITH (security_invoker='on') AS
 SELECT course_code,
    (max(round_index))::bigint AS lego_count
   FROM public.course_round_index
  GROUP BY course_code;


--
-- Name: course_voice_breakdown; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.course_voice_breakdown WITH (security_invoker='on') AS
 SELECT course_code,
    role,
    voice_id,
    origin,
    count(*) AS count
   FROM public.course_audio
  GROUP BY course_code, role, voice_id, origin
  ORDER BY course_code, role, (count(*)) DESC;


--
-- Name: VIEW course_voice_breakdown; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.course_voice_breakdown IS 'Voice usage breakdown per course/role';


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    course_code text NOT NULL,
    display_name text NOT NULL,
    known_lang text NOT NULL,
    target_lang text NOT NULL,
    voice_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    course_type text DEFAULT 'official'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    creator_email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    seed_count integer,
    translation_analysis jsonb,
    new_app_status text DEFAULT 'not_available'::text NOT NULL,
    legacy_app_status text DEFAULT 'not_available'::text NOT NULL,
    new_app_beta_started_at timestamp with time zone,
    legacy_app_beta_started_at timestamp with time zone,
    export_ready boolean DEFAULT false NOT NULL,
    quality_rules jsonb,
    content_version text DEFAULT '0.0.0'::text,
    visibility text DEFAULT 'hidden'::text NOT NULL,
    pricing_tier text DEFAULT 'premium'::text NOT NULL,
    is_community boolean DEFAULT false NOT NULL,
    released_at timestamp with time zone,
    featured_order integer,
    learner_display_name text,
    variant_label text,
    needs_gender_prep boolean,
    gender_prep_check_notes text,
    gender_prep_checked_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT chk_course_code_format CHECK (((course_code ~ '^[a-z]{3}(_[a-z0-9]+)?_for_[a-z]{3}$'::text) OR (course_code = 'eng_template'::text))),
    CONSTRAINT courses_course_type_check CHECK ((course_type = ANY (ARRAY['official'::text, 'template'::text]))),
    CONSTRAINT courses_legacy_app_status_check CHECK ((legacy_app_status = ANY (ARRAY['not_available'::text, 'draft'::text, 'beta'::text, 'released'::text]))),
    CONSTRAINT courses_new_app_status_check CHECK ((new_app_status = ANY (ARRAY['not_available'::text, 'draft'::text, 'beta'::text, 'live'::text]))),
    CONSTRAINT courses_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'beta'::text, 'released'::text]))),
    CONSTRAINT valid_pricing_tier CHECK ((pricing_tier = ANY (ARRAY['free'::text, 'premium'::text, 'community'::text])))
);


--
-- Name: TABLE courses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.courses IS 'Course metadata and voice configuration';


--
-- Name: COLUMN courses.new_app_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.new_app_status IS 'Deployment status for new community app: not_available → draft → beta → live';


--
-- Name: COLUMN courses.legacy_app_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.legacy_app_status IS 'Deployment status for legacy app: not_available → submitted → testing → live (locked until new_app_status is beta or live)';


--
-- Name: COLUMN courses.new_app_beta_started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.new_app_beta_started_at IS 'Timestamp when new_app_status was set to beta (auto-set, auto-cleared)';


--
-- Name: COLUMN courses.legacy_app_beta_started_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.legacy_app_beta_started_at IS 'Timestamp when legacy_app_status was set to beta (auto-set, auto-cleared)';


--
-- Name: COLUMN courses.export_ready; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.export_ready IS 'Set by Phase 9 when course passes
  all export validations (audio complete, shared audio exists, etc.)';


--
-- Name: COLUMN courses.visibility; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.visibility IS 'Course visibility: public (all users), hidden (admin only), beta (visible with beta badge)';


--
-- Name: COLUMN courses.pricing_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.pricing_tier IS 'Pricing tier: free (always free), premium (paid after Yellow Belt), community (always free, community-created)';


--
-- Name: COLUMN courses.is_community; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.is_community IS 'Whether this is a community-created course (always free)';


--
-- Name: COLUMN courses.released_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.released_at IS 'Timestamp when course was made public';


--
-- Name: COLUMN courses.featured_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.featured_order IS 'Display order in course selector (lower = first)';


--
-- Name: COLUMN courses.variant_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.variant_label IS 'Short regional variant name (e.g. Northern, Southern, Brazilian). NULL if no variants exist for this language.';


--
-- Name: COLUMN courses.needs_gender_prep; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.needs_gender_prep IS 'Per-course override for gender-prep eligibility. NULL = use hardcoded GENDERED_LANGUAGES fallback. TRUE = course needs gender-prep regardless of language. FALSE = skip even if language is in fallback list.';


--
-- Name: COLUMN courses.gender_prep_check_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.gender_prep_check_notes IS 'Haiku''s reasoning when needs_gender_prep was set automatically (yes/no examples).';


--
-- Name: COLUMN courses.gender_prep_checked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.gender_prep_checked_at IS 'When the Haiku detector last ran for this course.';


--
-- Name: daily_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_language text NOT NULL,
    contribution_date date DEFAULT CURRENT_DATE NOT NULL,
    phrases_count integer DEFAULT 0 NOT NULL,
    minutes_practiced integer DEFAULT 0 NOT NULL,
    unique_speakers integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE daily_contributions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.daily_contributions IS 'Aggregate language contribution stats - "Welsh Spoken Today"';


--
-- Name: dashboard_invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_invite_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    role text DEFAULT 'recorder'::text NOT NULL,
    courses jsonb DEFAULT '[]'::jsonb NOT NULL,
    label text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    max_uses integer DEFAULT 1 NOT NULL,
    use_count integer DEFAULT 0 NOT NULL,
    redemptions jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT dashboard_invite_codes_role_check CHECK ((role = ANY (ARRAY['recorder'::text, 'editor'::text, 'admin'::text])))
);


--
-- Name: dashboard_login_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_login_codes (
    code text NOT NULL,
    email text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dashboard_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_sessions (
    session_id text NOT NULL,
    email text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_users (
    email text NOT NULL,
    name text,
    role text DEFAULT 'recorder'::text NOT NULL,
    courses jsonb DEFAULT '"*"'::jsonb NOT NULL,
    voice_id text,
    invited_by text,
    invited_at timestamp with time zone DEFAULT now(),
    updated_by text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dashboard_users_role_check CHECK ((role = ANY (ARRAY['recorder'::text, 'editor'::text, 'admin'::text])))
);


--
-- Name: demo_orgs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demo_orgs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    prospect_name text NOT NULL,
    org_shape text NOT NULL,
    course_code text NOT NULL,
    group_id uuid,
    school_id uuid,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    expired_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT demo_orgs_org_shape_check CHECK ((org_shape = ANY (ARRAY['single_school'::text, 'group'::text, 'government_region'::text]))),
    CONSTRAINT demo_orgs_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text])))
);


--
-- Name: TABLE demo_orgs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.demo_orgs IS 'Sales-showcase demo orgs created via /admin/demo-schools. Service-role-only (RLS on, no policies) — every access goes through api/admin/demo-schools.ts (admin-gated) or api/cron/expire-demo-schools.ts (CRON_SECRET-gated).';


--
-- Name: COLUMN demo_orgs.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.demo_orgs.metadata IS 'Snapshot at creation: { orgName, staff: [{role, name, email, learnerId}], counts: {schools, teachers, classes, learners} }. The result card reads this, not a live join.';


--
-- Name: demographic_cycle_averages; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.demographic_cycle_averages WITH (security_invoker='on') AS
 SELECT 'school'::text AS level,
    (cas.school_id)::text AS group_id,
    round(avg(cas.total_cycles), 0) AS avg_total_cycles,
    round(avg(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
    count(*) AS class_count
   FROM public.class_activity_stats cas
  GROUP BY cas.school_id
UNION ALL
 SELECT 'region'::text AS level,
    cas.region_code AS group_id,
    round(avg(cas.total_cycles), 0) AS avg_total_cycles,
    round(avg(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
    count(*) AS class_count
   FROM public.class_activity_stats cas
  WHERE (cas.region_code IS NOT NULL)
  GROUP BY cas.region_code
UNION ALL
 SELECT 'course'::text AS level,
    cas.course_code AS group_id,
    round(avg(cas.total_cycles), 0) AS avg_total_cycles,
    round(avg(cas.avg_cycles_per_session), 1) AS avg_cycles_per_session,
    count(*) AS class_count
   FROM public.class_activity_stats cas
  GROUP BY cas.course_code;


--
-- Name: VIEW demographic_cycle_averages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.demographic_cycle_averages IS 'Comparison benchmarks for class reporting. Never exposes individual student data.';


--
-- Name: documentation_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentation_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    title text,
    subtitle text,
    category text DEFAULT 'reference'::text,
    display_order integer DEFAULT 0,
    content_type text DEFAULT 'structured'::text,
    content jsonb,
    markdown_content text,
    version text DEFAULT '1.0'::text,
    badge_text text,
    badge_color text,
    icon_name text,
    is_published boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: documentation_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentation_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    section_key text NOT NULL,
    title text,
    anchor text,
    content jsonb,
    content_html text,
    display_order integer DEFAULT 0,
    style_variant text DEFAULT 'default'::text,
    border_color text,
    is_collapsible boolean DEFAULT false,
    default_collapsed boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    email_normalized text GENERATED ALWAYS AS (lower(TRIM(BOTH FROM email))) STORED,
    access_type text DEFAULT 'full'::text NOT NULL,
    granted_courses text[],
    duration_type text DEFAULT 'lifetime'::text,
    duration_days integer,
    grants_platform_role text,
    grants_dashboard_courses text[],
    label text,
    is_active boolean DEFAULT true,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    redeemed_at timestamp with time zone,
    redeemed_by_learner_id uuid
);


--
-- Name: entitlement_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    access_type text NOT NULL,
    granted_courses text[],
    duration_type text NOT NULL,
    duration_days integer,
    label text NOT NULL,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    grants_platform_role text,
    grants_dashboard_courses text[],
    code_normalized text GENERATED ALWAYS AS (upper(regexp_replace(code, '[^A-Za-z0-9]'::text, ''::text, 'g'::text))) STORED,
    CONSTRAINT entitlement_codes_access_type_check CHECK ((access_type = ANY (ARRAY['full'::text, 'courses'::text]))),
    CONSTRAINT entitlement_codes_duration_type_check CHECK ((duration_type = ANY (ARRAY['lifetime'::text, 'time_limited'::text])))
);


--
-- Name: entitlement_code_validation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.entitlement_code_validation WITH (security_invoker='on') AS
 SELECT id,
    code,
    access_type,
    granted_courses,
    duration_type,
    duration_days,
    label,
    max_uses,
    use_count,
    expires_at,
    is_active,
    code_normalized
   FROM public.entitlement_codes;


--
-- Name: entitlement_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlement_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid,
    school_id uuid,
    class_id uuid,
    granted_courses text[] NOT NULL,
    granted_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT one_target_level CHECK ((((((group_id IS NOT NULL))::integer + ((school_id IS NOT NULL))::integer) + ((class_id IS NOT NULL))::integer) = 1))
);


--
-- Name: TABLE entitlement_grants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.entitlement_grants IS 'Course access grants at group/school/class level.';


--
-- Name: evolution_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evolution_levels (
    level smallint NOT NULL,
    name text NOT NULL,
    description text,
    min_score integer NOT NULL,
    icon text
);


--
-- Name: TABLE evolution_levels; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.evolution_levels IS 'Reference table for evolution level thresholds and names';


--
-- Name: family_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.family_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_learner_id uuid NOT NULL,
    member_learner_id uuid,
    invited_email text,
    is_child_account boolean DEFAULT false NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT family_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'removed'::text])))
);


--
-- Name: TABLE family_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.family_members IS 'SSi Family plan membership (FAMILY-PLAN-SPEC.md). The umbrella IS the payer''s subscriptions row (plan_name = ''SSi Family''); this table is the only new data surface. RLS ON, no policies — service-role-only, all access via /api/family/* endpoints (CLAUDE.md rule 7 posture + the "hierarchy authz = endpoints" doctrine). Removal is a stamp (removed_at + status=''removed''), never a delete.';


--
-- Name: feedback_aggregated; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.feedback_aggregated WITH (security_invoker='on') AS
 SELECT audio_id,
    course_code,
    feedback_type,
    count(*) AS flag_count,
    count(DISTINCT user_id) AS unique_users,
    min(created_at) AS first_flagged,
    max(created_at) AS last_flagged,
    array_agg(DISTINCT comment) FILTER (WHERE (comment IS NOT NULL)) AS comments
   FROM public.content_feedback
  WHERE (resolved_at IS NULL)
  GROUP BY audio_id, course_code, feedback_type;


--
-- Name: VIEW feedback_aggregated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.feedback_aggregated IS 'Aggregated unresolved feedback - use with threshold filter';


--
-- Name: govt_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.govt_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    region_code text,
    organization_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text NOT NULL,
    invite_code_id uuid,
    group_id uuid
);


--
-- Name: TABLE govt_admins; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.govt_admins IS 'Government/regional language authority administrators';


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'region'::text NOT NULL,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    path text,
    is_demo boolean DEFAULT false NOT NULL,
    name_confirmed boolean DEFAULT false NOT NULL,
    is_test boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE groups; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.groups IS 'Hierarchical grouping for entitlement cascade. Schools belong to one group.';


--
-- Name: COLUMN groups.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.groups.type IS 'Descriptive type: nation, region, district, programme, etc.';


--
-- Name: COLUMN groups.is_test; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.groups.is_test IS 'Not a genuine paying/pilot customer — soak-test/E2E/owner-test group. Superset of is_demo.';


--
-- Name: school_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.school_summary WITH (security_invoker='on') AS
 SELECT s.id AS school_id,
    s.school_name,
    s.region_code,
    s.group_id,
    s.admin_user_id,
    COALESCE(tc.teacher_count, (0)::bigint) AS teacher_count,
    COALESCE(cc.class_count, (0)::bigint) AS class_count,
    COALESCE(sc.student_count, (0)::bigint) AS student_count,
    COALESCE(ph.total_practice_hours, (0)::numeric) AS total_practice_hours,
    s.name_confirmed,
    s.teacher_join_code,
    s.admin_join_code,
    s.created_at,
    ((s.admin_user_id IS NOT NULL) OR at.has_admin_tag) AS has_admin
   FROM (((((public.schools s
     LEFT JOIN LATERAL ( SELECT count(*) AS teacher_count
           FROM public.user_tags ut
          WHERE ((ut.tag_type = 'school'::text) AND (ut.tag_value = ('SCHOOL:'::text || s.id)) AND (ut.role_in_context = 'teacher'::text) AND (ut.removed_at IS NULL))) tc ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS class_count
           FROM public.classes c
          WHERE ((c.school_id = s.id) AND (c.is_active = true))) cc ON (true))
     LEFT JOIN LATERAL ( SELECT count(DISTINCT csp.learner_id) AS student_count
           FROM (public.class_student_progress csp
             JOIN public.classes c ON ((c.id = csp.class_id)))
          WHERE (c.school_id = s.id)) sc ON (true))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(csp.total_practice_seconds), (0)::numeric) / (3600)::numeric) AS total_practice_hours
           FROM (public.class_student_progress csp
             JOIN public.classes c ON ((c.id = csp.class_id)))
          WHERE (c.school_id = s.id)) ph ON (true))
     LEFT JOIN LATERAL ( SELECT (EXISTS ( SELECT 1
                   FROM public.user_tags ut2
                  WHERE ((ut2.tag_type = 'school'::text) AND (ut2.tag_value = ('SCHOOL:'::text || s.id)) AND (ut2.role_in_context = 'admin'::text) AND (ut2.removed_at IS NULL)))) AS has_admin_tag) at ON (true));


--
-- Name: group_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.group_summary WITH (security_invoker='on') AS
 SELECT g.id AS group_id,
    g.name AS group_name,
    g.path AS group_path,
    count(DISTINCT s.id) AS school_count,
    COALESCE(sum(ss.teacher_count), (0)::numeric) AS teacher_count,
    COALESCE(sum(ss.class_count), (0)::numeric) AS class_count,
    COALESCE(sum(ss.student_count), (0)::numeric) AS student_count,
    COALESCE(sum(ss.total_practice_hours), (0)::numeric) AS total_practice_hours,
    g.name_confirmed
   FROM ((public.groups g
     LEFT JOIN public.schools s ON ((s.group_id IN ( SELECT public.get_subtree_group_ids(g.id) AS get_subtree_group_ids))))
     LEFT JOIN public.school_summary ss ON ((ss.school_id = s.id)))
  GROUP BY g.id, g.name, g.path, g.name_confirmed;


--
-- Name: insight_discoveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.insight_discoveries ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.insight_discoveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    code_type text NOT NULL,
    created_by text NOT NULL,
    grants_region text,
    grants_school_id uuid,
    grants_class_id uuid,
    expires_at timestamp with time zone,
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    grants_group_id uuid,
    code_normalized text GENERATED ALWAYS AS (upper(regexp_replace(code, '[^A-Za-z0-9]'::text, ''::text, 'g'::text))) STORED,
    CONSTRAINT invite_codes_code_type_check CHECK ((code_type = ANY (ARRAY['ssi_admin'::text, 'govt_admin'::text, 'school_admin'::text, 'school_admin_join'::text, 'teacher'::text, 'student'::text, 'tester'::text])))
);


--
-- Name: TABLE invite_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invite_codes IS 'Unified invite codes for all role types. Format: ABC-123';


--
-- Name: invite_code_validation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.invite_code_validation WITH (security_invoker='on') AS
 SELECT id,
    code,
    code_type,
    grants_region,
    grants_school_id,
    grants_class_id,
    metadata,
    max_uses,
    use_count,
    expires_at,
    is_active,
    code_normalized,
    grants_group_id
   FROM public.invite_codes;


--
-- Name: language_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.language_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    known_code text NOT NULL,
    target_code text NOT NULL,
    version text NOT NULL,
    brief_content jsonb NOT NULL,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE language_briefs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.language_briefs IS 'CIK-enhanced language pair briefs with version history';


--
-- Name: COLUMN language_briefs.known_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.language_briefs.known_code IS 'ISO 639-3 code for known language';


--
-- Name: COLUMN language_briefs.target_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.language_briefs.target_code IS 'ISO 639-3 code for target language';


--
-- Name: COLUMN language_briefs.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.language_briefs.version IS 'Brief version, e.g., v1.0-cik';


--
-- Name: COLUMN language_briefs.brief_content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.language_briefs.brief_content IS 'Full brief JSON following Phase 0 output schema';


--
-- Name: COLUMN language_briefs.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.language_briefs.is_active IS 'Whether this version is currently active (only one per pair)';


--
-- Name: language_pair_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.language_pair_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    known_code character varying(10) NOT NULL,
    target_code character varying(10) NOT NULL,
    brief jsonb NOT NULL,
    generated_by character varying(50),
    prompt_version character varying(20),
    generated_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE language_pair_briefs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.language_pair_briefs IS 'Stores language pair intelligence briefs for Phase 0';


--
-- Name: learner_consistency; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.learner_consistency WITH (security_invoker='on') AS
 SELECT learner_id,
    course_id,
    count(*) FILTER (WHERE (started_at >= (now() - '10 days'::interval))) AS sessions_10d,
    count(*) FILTER (WHERE (started_at >= (now() - '30 days'::interval))) AS sessions_30d,
    EXTRACT(day FROM (now() - max(started_at))) AS days_since_last,
    (
        CASE
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '10 days'::interval))) >= 7) THEN 1.5
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '10 days'::interval))) >= 5) THEN 1.3
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '10 days'::interval))) >= 3) THEN 1.1
            ELSE 1.0
        END *
        CASE
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '30 days'::interval))) >= 25) THEN 2.0
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '30 days'::interval))) >= 20) THEN 1.5
            WHEN (count(*) FILTER (WHERE (started_at >= (now() - '30 days'::interval))) >= 15) THEN 1.2
            ELSE 1.0
        END) AS consistency_multiplier
   FROM public.sessions
  GROUP BY learner_id, course_id;


--
-- Name: learner_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    email text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE learner_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_emails IS 'All emails associated with a learner. Synced from auth.users + auth.identities via triggers.';


--
-- Name: learner_l1_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_l1_state (
    learner_id uuid NOT NULL,
    course_code text NOT NULL,
    lego_id text NOT NULL,
    fire_count integer DEFAULT 0 NOT NULL,
    last_fired_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE learner_l1_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_l1_state IS 'Per-learner per-seed Layer 1 listening fire count, keyed by the seed''s completing lego_id. Used by generateLearningScript to compound the Stage 1→4 playlist progression across sessions.';


--
-- Name: COLUMN learner_l1_state.lego_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_l1_state.lego_id IS 'Completing LEGO of the seed (highest lego_index). Encodes seed identity per the codebase "always use LEGO number" convention.';


--
-- Name: COLUMN learner_l1_state.fire_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_l1_state.fire_count IS 'Total L1 fires for this seed across all sessions. Drives layer1StageFor(fireCount) → stage 1..4.';


--
-- Name: learner_lego_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_lego_metrics (
    learner_id uuid NOT NULL,
    lego_id text NOT NULL,
    course_code text NOT NULL,
    mastery_state text DEFAULT 'acquisition'::text NOT NULL,
    consecutive_smooth integer DEFAULT 0 NOT NULL,
    consecutive_fast integer DEFAULT 0 NOT NULL,
    n_samples integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mean_latency_ms real,
    mean_exec_score real,
    skip_back_count integer DEFAULT 0 NOT NULL,
    skip_forward_count integer DEFAULT 0 NOT NULL,
    next_due_at timestamp with time zone,
    device_class_mix jsonb DEFAULT '{}'::jsonb NOT NULL,
    recent_latency_samples jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence_series jsonb DEFAULT '{"x": [], "values": []}'::jsonb NOT NULL,
    CONSTRAINT learner_lego_metrics_mastery_state_check CHECK ((mastery_state = ANY (ARRAY['acquisition'::text, 'consolidating'::text, 'confident'::text, 'mastered'::text])))
);


--
-- Name: TABLE learner_lego_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_lego_metrics IS 'Per-LEGO mastery state for adaptive pause timing. Sparse; only LEGOs the learner has practiced.';


--
-- Name: COLUMN learner_lego_metrics.mastery_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.mastery_state IS 'acquisition -> consolidating -> confident -> mastered. Drives pause multiplier.';


--
-- Name: COLUMN learner_lego_metrics.consecutive_smooth; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.consecutive_smooth IS 'Smooth responses since last reset. Advances state at threshold (default 3).';


--
-- Name: COLUMN learner_lego_metrics.consecutive_fast; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.consecutive_fast IS 'Fast responses since last reset. Fast-tracks state at threshold (default 5).';


--
-- Name: COLUMN learner_lego_metrics.mean_latency_ms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.mean_latency_ms IS 'Rolling recency-weighted normalized response latency (ms). The difficulty-bearing series curvature reads.';


--
-- Name: COLUMN learner_lego_metrics.mean_exec_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.mean_exec_score IS 'Rolling execution score in [0,1]. Behavioural proxy now (B2), prosody later. NULL until execution data exists.';


--
-- Name: COLUMN learner_lego_metrics.skip_back_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.skip_back_count IS 'Count of phase_skip direction=back for this (learner, lego) — low-confidence / re-hear signal.';


--
-- Name: COLUMN learner_lego_metrics.skip_forward_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.skip_forward_count IS 'Count of phase_skip direction=forward — confidence signal.';


--
-- Name: COLUMN learner_lego_metrics.next_due_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.next_due_at IS 'Spaced-repetition next-due timestamp (Fibonacci schedule). Deferral return trigger.';


--
-- Name: COLUMN learner_lego_metrics.device_class_mix; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.device_class_mix IS 'Counts by device_class: {class_play, homework, tutor_session}. Keeps aggregate class audio from polluting individual scores.';


--
-- Name: COLUMN learner_lego_metrics.recent_latency_samples; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.recent_latency_samples IS 'Bounded time-ordered series (oldest→newest) of normalized latency for this (learner, lego) — the difficulty-bearing series the curvature/B4 sensors read. Capped ~20 by the writer. Added 2026-06-13 (metrics B4 rollup, Option 2).';


--
-- Name: COLUMN learner_lego_metrics.evidence_series; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_metrics.evidence_series IS 'Adaptation v2 (WP-0/WP-4): the shared EvidenceAggregator''s merged series for this (learner, lego) — { values: number[], x: number[] }, oldest→newest, ring-capped ~20. Superset of recent_latency_samples (which stays as the pre-v2 latency-only signal). Added 2026-07-14.';


--
-- Name: learner_lego_pairings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_lego_pairings (
    learner_id uuid NOT NULL,
    course_code text NOT NULL,
    lego_a text NOT NULL,
    lego_b text NOT NULL,
    fire_count integer DEFAULT 1 NOT NULL,
    first_fired_at timestamp with time zone DEFAULT now() NOT NULL,
    last_fired_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learner_lego_pairings_check CHECK ((lego_a < lego_b))
);


--
-- Name: TABLE learner_lego_pairings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_lego_pairings IS 'Per-learner per-course co-firing counts for the v2 brain view timelapse. Forward-only — not backfilled from history.';


--
-- Name: COLUMN learner_lego_pairings.fire_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_lego_pairings.fire_count IS 'Total cycles in which both legos appeared together. Drives synapse thickness via log(fire_count + 1).';


--
-- Name: learner_meta_commentary_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_meta_commentary_state (
    learner_id uuid NOT NULL,
    instructions_complete boolean DEFAULT false NOT NULL,
    instruction_index integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: learner_milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    milestone_type text NOT NULL,
    achieved_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_text text,
    display_icon text
);


--
-- Name: TABLE learner_milestones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_milestones IS 'Journey timeline - transformation evidence';


--
-- Name: learner_pod_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_pod_state (
    learner_id uuid NOT NULL,
    course_code text NOT NULL,
    sentence_id text NOT NULL,
    exposures integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE learner_pod_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_pod_state IS 'Per-learner per-pod-sentence exposure counter shared by BOTH pod doors (main-flow pod laps + Listening Mode Drill). exposures = completed exposures; main flow serves view exposures+1, drill serves fusion rung = exposures. Forward-only; derived main-flow alive remains the inheritance floor.';


--
-- Name: COLUMN learner_pod_state.sentence_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_pod_state.sentence_id IS 'listening_pod_sentences.id, or `${id}:s${index}` for a June-split per-sentence unit — the client-side per-sentence id convention.';


--
-- Name: learner_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    total_points integer DEFAULT 0 NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    evolution_score integer DEFAULT 0 NOT NULL,
    evolution_level smallint DEFAULT 1 NOT NULL,
    evolution_name text DEFAULT 'First Words'::text NOT NULL,
    sessions_last_10_days smallint DEFAULT 0 NOT NULL,
    sessions_last_30_days smallint DEFAULT 0 NOT NULL,
    current_consistency_multiplier numeric(3,2) DEFAULT 1.0 NOT NULL,
    last_session_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE learner_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_points IS 'Accumulated points and evolution progress per learner+course';


--
-- Name: COLUMN learner_points.evolution_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_points.evolution_score IS 'Hidden formula result - f(consistency, latency, prosody, frequency)';


--
-- Name: COLUMN learner_points.current_consistency_multiplier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.learner_points.current_consistency_multiplier IS 'Cached multiplier from sessions in last 10/30 days';


--
-- Name: learner_practice_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_practice_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    session_id uuid,
    practiced_at timestamp with time zone DEFAULT now(),
    response_audio_uuid uuid,
    response_transcript text,
    was_correct boolean,
    confidence_score numeric(3,2),
    response_time_ms integer,
    self_rating integer,
    device_type text,
    CONSTRAINT valid_self_rating CHECK (((self_rating IS NULL) OR ((self_rating >= 1) AND (self_rating <= 5))))
);


--
-- Name: learner_speaking_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_speaking_opportunities (
    learner_id uuid NOT NULL,
    course_code text NOT NULL,
    day date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date NOT NULL,
    opportunities bigint DEFAULT 0 NOT NULL,
    play_seconds bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE learner_speaking_opportunities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.learner_speaking_opportunities IS 'Per-learner per-course per-UTC-day count of speaking opportunities (cycles) and accumulated player play_seconds. Replaces sessions.items_practiced/duration_seconds for user-side contribution stats.';


--
-- Name: learner_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.learner_stats WITH (security_invoker='on') AS
 SELECT l.id AS learner_id,
    l.user_id,
    count(DISTINCT e.course_id) AS courses_enrolled,
    sum(e.total_practice_minutes) AS total_practice_minutes,
    count(DISTINCT s.id) AS total_sessions,
    sum(s.items_practiced) AS total_items_practiced,
    max(s.started_at) AS last_session_at
   FROM ((public.learners l
     LEFT JOIN public.course_enrollments e ON ((e.learner_id = l.id)))
     LEFT JOIN public.sessions s ON ((s.learner_id = l.id)))
  GROUP BY l.id, l.user_id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    status text DEFAULT 'none'::text NOT NULL,
    plan_id text,
    plan_name text,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    provider text DEFAULT 'lemonsqueezy'::text NOT NULL,
    provider_subscription_id text,
    provider_customer_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    signup_course_code text,
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'past_due'::text, 'none'::text])))
);


--
-- Name: TABLE subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscriptions IS 'User subscription status. Updated by LemonSqueezy/Stripe webhooks. Provider-agnostic core fields allow easy provider swap.';


--
-- Name: COLUMN subscriptions.signup_course_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.signup_course_code IS 'Course the user was unlocking when they subscribed (conversion attribution). Set from checkout customData.course; null for pre-capture subscriptions.';


--
-- Name: learner_subscription_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.learner_subscription_status WITH (security_invoker='on') AS
 SELECT l.id AS learner_id,
    l.user_id,
    COALESCE(s.status, 'none'::text) AS subscription_status,
    s.plan_id,
    s.plan_name,
    s.current_period_end,
    s.cancel_at_period_end,
        CASE
            WHEN ((s.status = 'active'::text) AND ((s.current_period_end IS NULL) OR (s.current_period_end > now()))) THEN true
            ELSE false
        END AS is_subscribed
   FROM (public.learners l
     LEFT JOIN public.subscriptions s ON ((s.learner_id = l.id)));


--
-- Name: lego_introductions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lego_introductions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    lego_id text NOT NULL,
    audio_uuid uuid,
    duration_ms integer,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    presentation_audio_id uuid
);


--
-- Name: TABLE lego_introductions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lego_introductions IS 'Introduction audio for new LEGOs';


--
-- Name: listening_pod_sentences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listening_pod_sentences (
    id text NOT NULL,
    pod_id text NOT NULL,
    scene_number integer NOT NULL,
    sentence_number integer NOT NULL,
    global_order integer NOT NULL,
    speaker text NOT NULL,
    target_text text NOT NULL,
    known_text text NOT NULL,
    target_audio_id uuid,
    known_audio_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    beat_label text,
    glue_to_next boolean DEFAULT false NOT NULL,
    explainer_decomposition jsonb,
    explainer_text text,
    explainer_audio_id uuid,
    atom_map jsonb,
    note_audio_id uuid,
    sentence_audio_ids uuid[],
    sentence_known_audio_ids uuid[],
    atom_map_fine jsonb,
    window_known_map jsonb,
    takeg_audio_ids uuid[]
);


--
-- Name: TABLE listening_pod_sentences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.listening_pod_sentences IS 'Individual sentences within a pod; audio IDs link to course_audio';


--
-- Name: COLUMN listening_pod_sentences.global_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.global_order IS '1-indexed ordering across the pod (drives stage injection sequencing at round-end)';


--
-- Name: COLUMN listening_pod_sentences.speaker; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.speaker IS 'Speaker name; resolves to a voice via the parent pod.speakers JSONB at generation time';


--
-- Name: COLUMN listening_pod_sentences.glue_to_next; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.glue_to_next IS 'When true, the next sentence in global_order belongs to the same natural utterance and the player should use a tight (or zero at stage 7) gap rather than the standard inter-utterance pause.';


--
-- Name: COLUMN listening_pod_sentences.explainer_decomposition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.explainer_decomposition IS 'Ordered array of LEGO-sized chunks pairing target language fragments to their known-language glosses: [{chunk_target, chunk_known}, ...]. Editable structured form; explainer_text is the narration string derived from this for TTS.';


--
-- Name: COLUMN listening_pod_sentences.explainer_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.explainer_text IS 'Mixed-language narration string fed to xAI multilingual TTS. Pattern: "<chunk_target> means <chunk_known>, ..." with the connector localised per learner-language. NULL = no explainer authored yet; player falls back to 4-file Stage-1 sequence.';


--
-- Name: COLUMN listening_pod_sentences.explainer_audio_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.explainer_audio_id IS 'UUID of the rendered xAI multilingual TTS audio in course_audio. Plays in Stage 1 only, between known and the two target replays. NULL = audio not yet generated.';


--
-- Name: COLUMN listening_pod_sentences.atom_map; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.atom_map IS 'Atom-Fusion position layer: ordered atom/passthrough/note entries citing pod_legos by lego_key, with this clause''s target offsets. See docs/architecture/atom-fusion-introduction.md.';


--
-- Name: COLUMN listening_pod_sentences.atom_map_fine; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.atom_map_fine IS 'DRAFT Aran-granularity unit map (prosodic breath-groups) — Pod Lab preview only; atom_map stays live until the fusion-ladder model ships. Seams here define future Take G gap points.';


--
-- Name: COLUMN listening_pod_sentences.window_known_map; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.window_known_map IS 'DRAFT authored known-language translations for fusion windows (contiguous fine-unit spans), sibling of atom_map_fine: [{g,start,end,known}] flat unit indices; regenerated when seams change.';


--
-- Name: COLUMN listening_pod_sentences.takeg_audio_ids; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pod_sentences.takeg_audio_ids IS 'Take G gapped per-sentence renders, aligned to the ladder''s GLUED sentence groups (leading interjections glued forward); null element = single-unit group (its unit is the real sentence take). Unit ms spans in atom_map_fine index into these clips.';


--
-- Name: listening_pods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.listening_pods (
    id text NOT NULL,
    course_code text NOT NULL,
    pod_type text NOT NULL,
    slug text NOT NULL,
    pod_order integer,
    title text,
    scene text,
    difficulty text,
    speakers jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_file text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT listening_pods_difficulty_check CHECK ((difficulty = ANY (ARRAY['beginner'::text, 'beginner-intermediate'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT listening_pods_pod_type_check CHECK ((pod_type = ANY (ARRAY['core'::text, 'choice'::text])))
);


--
-- Name: TABLE listening_pods; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.listening_pods IS 'Layer 2 listening pods (Pod 0 core + choice pods) per Aran listening-layers methodology';


--
-- Name: COLUMN listening_pods.pod_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pods.pod_type IS 'core = everyone does it (Pod 0); choice = learner picks one after Pod 0';


--
-- Name: COLUMN listening_pods.speakers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pods.speakers IS 'Speaker name → { voice_id, provider, gender } mapping. "_default" key for unmapped speakers.';


--
-- Name: COLUMN listening_pods.source_file; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.listening_pods.source_file IS 'Markdown file this pod was last synced from (provenance, for re-sync)';


--
-- Name: offline_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offline_leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    course_code text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_validated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_trial boolean DEFAULT true NOT NULL,
    subscription_id text,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_key text NOT NULL,
    title text NOT NULL,
    channel text NOT NULL,
    subject text,
    preheader text,
    body text NOT NULL,
    trigger_description text NOT NULL,
    notes text,
    sort_order integer NOT NULL,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT onboarding_messages_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in_app'::text])))
);


--
-- Name: TABLE onboarding_messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.onboarding_messages IS 'Live-editable source for the onboarding message series. Service-role-only (RLS on, no policies) — every access goes through api/admin/onboarding-messages.ts (admin-gated). The send system (cron, not yet built) reads this table directly; this IS the copy, not a mirror of it.';


--
-- Name: COLUMN onboarding_messages.message_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.onboarding_messages.message_key IS 'Stable slug used by the (future) send system to look up a message, e.g. verify_email, welcome_day1. Never reused across messages.';


--
-- Name: COLUMN onboarding_messages.body; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.onboarding_messages.body IS 'Markdown. Editor is a textarea + preview — no WYSIWYG dependency.';


--
-- Name: COLUMN onboarding_messages.notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.onboarding_messages.notes IS 'Design-note asides carried over from the source draft (docs/onboarding/onboarding-series-draft.md) — rationale for future editors, never sent to learners.';


--
-- Name: COLUMN onboarding_messages.active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.onboarding_messages.active IS 'Whether the send system should consider this message live. Defaults false — nothing sends until the sender/cron pipeline exists regardless of this flag.';


--
-- Name: COLUMN onboarding_messages.updated_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.onboarding_messages.updated_by IS 'auth uid (learners.user_id) of the admin who last saved this row.';


--
-- Name: orchestrator_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestrator_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    direction text NOT NULL,
    checkpoint text,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    response text,
    response_action text,
    created_at timestamp with time zone DEFAULT now(),
    responded_at timestamp with time zone,
    CONSTRAINT orchestrator_messages_direction_check CHECK ((direction = ANY (ARRAY['agent_to_human'::text, 'human_to_agent'::text]))),
    CONSTRAINT orchestrator_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'read'::text, 'responded'::text])))
);


--
-- Name: phase_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phase_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phase_code text NOT NULL,
    version text NOT NULL,
    title text,
    prompt_content text NOT NULL,
    is_active boolean DEFAULT false,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT phase_prompts_phase_code_check CHECK ((phase_code = ANY (ARRAY['phase0'::text, 'phase1'::text, 'phase2'::text, 'phase3'::text])))
);


--
-- Name: TABLE phase_prompts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.phase_prompts IS 'Canonical prompts for Phase 0/1/2/3 agents with version history';


--
-- Name: COLUMN phase_prompts.phase_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phase_prompts.phase_code IS 'Which phase this prompt is for (phase0, phase1, phase2, phase3)';


--
-- Name: COLUMN phase_prompts.version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phase_prompts.version IS 'Semantic version, e.g., v9.3-cik';


--
-- Name: COLUMN phase_prompts.prompt_content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phase_prompts.prompt_content IS 'Full markdown prompt content';


--
-- Name: COLUMN phase_prompts.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phase_prompts.is_active IS 'Whether this version is currently active (only one per phase)';


--
-- Name: COLUMN phase_prompts.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.phase_prompts.metadata IS 'Additional config, notes, changelog';


--
-- Name: player_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_events (
    id bigint NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    course_code text,
    session_id uuid,
    event_type text NOT NULL,
    payload jsonb,
    client_version text,
    device_type text,
    ip_country text,
    env text,
    learner_id uuid
);


--
-- Name: TABLE player_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.player_events IS 'Diagnostic event log for the learning player. Written via /api/player-events.';


--
-- Name: COLUMN player_events.env; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.player_events.env IS 'Deployment environment the event came from, derived server-side from the request host: production | staging | dev. NULL = unknown (rows predating this column).';


--
-- Name: player_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.player_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: player_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.player_events_id_seq OWNED BY public.player_events.id;


--
-- Name: pod_legos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pod_legos (
    id text NOT NULL,
    course_code text NOT NULL,
    lego_key text NOT NULL,
    target text NOT NULL,
    known text NOT NULL,
    first_seen_order integer NOT NULL,
    first_seen_sentence text,
    occurrence_count integer DEFAULT 1 NOT NULL,
    is_name boolean DEFAULT false NOT NULL,
    zut_alternates jsonb DEFAULT '[]'::jsonb NOT NULL,
    explainer_audio_id uuid,
    needs_review boolean DEFAULT false NOT NULL,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pod_legos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pod_legos IS 'Canonical pod-LEGO inventory (identity layer) for the Atom-Fusion explainer. One row per recurring known<->target unit per course; owns the canonical per-atom explainer audio. See docs/architecture/atom-fusion-introduction.md.';


--
-- Name: possession_mint_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.possession_mint_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invite_code_id uuid,
    email text,
    ip_hash text,
    outcome text NOT NULL,
    auth_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    error_detail text
);


--
-- Name: practice_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    prompt_target_text text NOT NULL,
    prompt_known_text text,
    prompt_lego_ids text[] NOT NULL,
    expected_lego_id text,
    expected_phrase_id text,
    expected_target_text text NOT NULL,
    alternative_responses jsonb,
    prompt_audio_uuid uuid,
    prompt_type text DEFAULT 'open'::text,
    question_word text,
    difficulty_score integer DEFAULT 1,
    min_legos_required integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    CONSTRAINT has_lego_ids CHECK ((array_length(prompt_lego_ids, 1) > 0)),
    CONSTRAINT valid_prompt CHECK ((prompt_target_text <> ''::text)),
    CONSTRAINT valid_response CHECK ((expected_target_text <> ''::text))
);


--
-- Name: presentation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presentation_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template text NOT NULL,
    known_lang text,
    target_lang text,
    priority integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: processed_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_id text NOT NULL,
    event_type text,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE processed_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.processed_webhook_events IS 'Webhook idempotency ledger. Handlers INSERT (provider, event_id) before side effects; a 23505 on UNIQUE(provider,event_id) = already processed = skip. Degrades: if absent, handlers fail open.';


--
-- Name: raw_seed_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raw_seed_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_code text NOT NULL,
    agent_id text,
    batch_id text,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text,
    error text,
    processed_by text,
    created_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone,
    CONSTRAINT raw_seed_uploads_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: recording_provenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recording_provenance (
    audio_uuid text NOT NULL,
    recorded_by text NOT NULL,
    speaker_native_language text,
    speaker_proficiency text,
    speaker_age_range text,
    speaker_dialect text,
    speaker_region text,
    recorded_at timestamp with time zone NOT NULL,
    recording_location text,
    recording_device text,
    recording_environment text,
    speaker_consent boolean DEFAULT true,
    consent_form_ref text,
    usage_rights text,
    quality_notes text,
    retake_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    code text NOT NULL,
    name text NOT NULL,
    country_code text NOT NULL,
    primary_language text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE regions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.regions IS 'Geographic regions for government language authorities';


--
-- Name: region_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.region_summary WITH (security_invoker='on') AS
 SELECT code AS region_code,
    name AS region_name,
    country_code,
    primary_language,
    ( SELECT count(*) AS count
           FROM public.schools s
          WHERE (s.region_code = r.code)) AS school_count,
    ( SELECT count(DISTINCT ut.user_id) AS count
           FROM (public.schools s
             JOIN public.user_tags ut ON (((ut.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (ut.tag_type = 'school'::text) AND (ut.role_in_context = 'teacher'::text) AND (ut.removed_at IS NULL))))
          WHERE (s.region_code = r.code)) AS teacher_count,
    ( SELECT count(DISTINCT ut2.user_id) AS count
           FROM ((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut2 ON (((ut2.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut2.tag_type = 'class'::text) AND (ut2.role_in_context = 'student'::text) AND (ut2.removed_at IS NULL))))
          WHERE (s.region_code = r.code)) AS student_count,
    ( SELECT COALESCE(((sum(sess.duration_seconds))::numeric / 3600.0), (0)::numeric) AS "coalesce"
           FROM ((((public.schools s
             JOIN public.classes c ON ((c.school_id = s.id)))
             JOIN public.user_tags ut ON (((ut.tag_value = ('CLASS:'::text || (c.id)::text)) AND (ut.tag_type = 'class'::text) AND (ut.role_in_context = 'student'::text) AND (ut.removed_at IS NULL))))
             JOIN public.learners l ON ((l.user_id = ut.user_id)))
             JOIN public.sessions sess ON (((sess.learner_id = l.id) AND (sess.course_id = c.course_code))))
          WHERE (s.region_code = r.code)) AS total_practice_hours
   FROM public.regions r;


--
-- Name: VIEW region_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.region_summary IS 'Aggregated regional statistics. Used by govt admin dashboard. NO individual data exposed.';


--
-- Name: release_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    released_at timestamp with time zone DEFAULT now() NOT NULL,
    headline text,
    bullets text[] DEFAULT '{}'::text[] NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: response_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_metrics (
    db_id uuid DEFAULT gen_random_uuid() NOT NULL,
    id text NOT NULL,
    session_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    lego_id text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    response_latency_ms integer NOT NULL,
    phrase_length integer NOT NULL,
    normalized_latency numeric(10,4) NOT NULL,
    thread_id smallint NOT NULL,
    triggered_spike boolean DEFAULT false NOT NULL,
    mode text NOT NULL
);


--
-- Name: role_change_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_change_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id text,
    target_learner_id uuid,
    target_user_id text,
    field text NOT NULL,
    old_value text,
    new_value text,
    source text NOT NULL,
    code_used text,
    detail jsonb
);


--
-- Name: sample_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_flags (
    id integer NOT NULL,
    audio_uuid text NOT NULL,
    course_code text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    flagged_by text,
    flagged_at timestamp with time zone,
    context jsonb,
    history jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT valid_status CHECK ((status = ANY (ARRAY['pending'::text, 'flagged_text_edit'::text, 'flagged_regen_tts'::text, 'flagged_human_needed'::text, 'in_pipeline'::text, 'tts_complete'::text, 'tts_failed'::text, 'in_recording'::text, 'recorded'::text, 'needs_review'::text, 'approved'::text, 'rejected'::text, 'complete'::text])))
);


--
-- Name: sample_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sample_flags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sample_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sample_flags_id_seq OWNED BY public.sample_flags.id;


--
-- Name: seed_cycles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.seed_cycles WITH (security_invoker='on') AS
 SELECT s.id,
    ('S'::text || lpad((s.seed_number)::text, 4, '0'::text)) AS seed_id,
    s.course_code,
    s.seed_number,
    s.status,
    s.version,
    s.known_text,
    s.target_text,
    (ka.id)::text AS known_audio_uuid,
    ka.s3_key AS known_s3_key,
    ka.duration_ms AS known_duration_ms,
    (t1.id)::text AS target1_audio_uuid,
    t1.s3_key AS target1_s3_key,
    t1.duration_ms AS target1_duration_ms,
    (t2.id)::text AS target2_audio_uuid,
    t2.s3_key AS target2_s3_key,
    t2.duration_ms AS target2_duration_ms
   FROM ((((public.course_seeds s
     JOIN public.courses c ON ((c.course_code = s.course_code)))
     LEFT JOIN public.course_audio ka ON (((ka.course_code = s.course_code) AND (ka.text_normalized = lower(TRIM(BOTH FROM s.known_text))) AND (ka.language = c.known_lang) AND (ka.role = 'known'::text))))
     LEFT JOIN public.course_audio t1 ON (((t1.course_code = s.course_code) AND (t1.text_normalized = lower(TRIM(BOTH FROM s.target_text))) AND (t1.language = c.target_lang) AND (t1.role = 'target1'::text))))
     LEFT JOIN public.course_audio t2 ON (((t2.course_code = s.course_code) AND (t2.text_normalized = lower(TRIM(BOTH FROM s.target_text))) AND (t2.language = c.target_lang) AND (t2.role = 'target2'::text))));


--
-- Name: VIEW seed_cycles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.seed_cycles IS 'v13: Seed items with audio from course_audio. Fixed to use courses.course_code.';


--
-- Name: seed_with_legos; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.seed_with_legos WITH (security_invoker='on') AS
 SELECT s.id AS seed_uuid,
    s.course_code,
    s.seed_id,
    s.seed_number,
    s.known_text AS seed_known,
    s.target_text AS seed_target,
    s.status AS seed_status,
    s.version AS seed_version,
    l.id AS lego_uuid,
    l.lego_id,
    l.lego_index,
    l.known_text AS lego_known,
    l.target_text AS lego_target,
    l.type AS lego_type,
    l.is_new,
    l.components,
    l.status AS lego_status,
    l.version AS lego_version
   FROM (public.course_seeds s
     LEFT JOIN public.course_legos l ON (((l.course_code = s.course_code) AND (l.seed_number = s.seed_number))))
  WHERE (s.status = 'released'::public.content_status)
  ORDER BY s.seed_number, l.lego_index;


--
-- Name: VIEW seed_with_legos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.seed_with_legos IS 'Seeds with their LEGOs - useful for manifest generation and data export';


--
-- Name: shared_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_audio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    text_normalized text NOT NULL,
    language text NOT NULL,
    audio_type text NOT NULL,
    voice_id text NOT NULL,
    origin text NOT NULL,
    s3_key text NOT NULL,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sequence integer,
    CONSTRAINT shared_audio_audio_type_check CHECK ((audio_type = ANY (ARRAY['encouragement'::text, 'instruction'::text, 'paywall'::text, 'bookend_listen_intro'::text, 'bookend_listen_outro'::text]))),
    CONSTRAINT shared_audio_origin_check CHECK ((origin = ANY (ARRAY['tts'::text, 'human'::text])))
);


--
-- Name: TABLE shared_audio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shared_audio IS 'Shared audio (encouragements, instructions) - reused across courses';


--
-- Name: spike_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spike_events (
    db_id uuid DEFAULT gen_random_uuid() NOT NULL,
    id text NOT NULL,
    session_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    course_id text NOT NULL,
    lego_id text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    latency numeric(10,4) NOT NULL,
    rolling_average numeric(10,4) NOT NULL,
    spike_ratio numeric(10,4) NOT NULL,
    response text NOT NULL,
    thread_id smallint NOT NULL,
    CONSTRAINT spike_events_response_check CHECK ((response = ANY (ARRAY['repeat'::text, 'breakdown'::text])))
);


--
-- Name: target_audio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_audio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_lang text NOT NULL,
    text text NOT NULL,
    text_normalized text NOT NULL,
    role text NOT NULL,
    voice_id text NOT NULL,
    origin text NOT NULL,
    s3_key text NOT NULL,
    duration_ms integer,
    file_size_bytes integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT target_audio_origin_check CHECK ((origin = ANY (ARRAY['tts'::text, 'human'::text]))),
    CONSTRAINT target_audio_role_check CHECK ((role = ANY (ARRAY['target1'::text, 'target2'::text])))
);


--
-- Name: target_legos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_legos (
    id text NOT NULL,
    target_lang text NOT NULL,
    seed_number integer NOT NULL,
    lego_index integer NOT NULL,
    type text NOT NULL,
    target_text text NOT NULL,
    components jsonb,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT target_legos_type_check CHECK ((type = ANY (ARRAY['A'::text, 'M'::text])))
);


--
-- Name: target_seed_texts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_seed_texts (
    target_lang text NOT NULL,
    seed_number integer NOT NULL,
    target_text text NOT NULL,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: teacher_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_commissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    accrued_pence integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'accruing'::text NOT NULL,
    paid_at timestamp with time zone,
    wise_transfer_id text,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wise_batch_group_id text,
    hold_until timestamp with time zone,
    clawback_pence integer DEFAULT 0 NOT NULL,
    CONSTRAINT teacher_commissions_accrued_pence_check CHECK ((accrued_pence >= 0)),
    CONSTRAINT teacher_commissions_status_check CHECK ((status = ANY (ARRAY['accruing'::text, 'held'::text, 'pending_payout'::text, 'paid'::text, 'failed'::text, 'reversed'::text])))
);


--
-- Name: TABLE teacher_commissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.teacher_commissions IS 'Monthly commission accrual ledger. Webhook handler upserts per (teacher_id, period_start) on student transaction.paid. Phase 3e cron reads this for Wise payouts.';


--
-- Name: COLUMN teacher_commissions.accrued_pence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_commissions.accrued_pence IS 'Sum of teacher takes for student subscriptions billed in this period. Teacher take = round(0.7833 * locked_price_pence - 140), where locked_price_pence is preserved on teacher_referrals at attribution time.';


--
-- Name: COLUMN teacher_commissions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_commissions.status IS 'accruing = period still open, more transactions may arrive. pending_payout = period closed, awaiting Wise transfer. paid = Wise transfer succeeded. failed = transfer failed and needs investigation (failure_reason filled).';


--
-- Name: COLUMN teacher_commissions.wise_batch_group_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_commissions.wise_batch_group_id IS 'Wise batch group ID for the monthly payout run that included this commission.';


--
-- Name: COLUMN teacher_commissions.hold_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_commissions.hold_until IS 'Refund-window release date for this commission (paid_at + 30 days at accrual time). A row is only RELEASED — eligible for a Wise payout — once hold_until <= current_date. NULL = not yet released (fail-safe: never paid early).';


--
-- Name: COLUMN teacher_commissions.clawback_pence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_commissions.clawback_pence IS 'Pence to subtract at payout time for reversals (refund/chargeback) that arrived AFTER the commission was already paid out. Net payable = accrued_pence - clawback_pence.';


--
-- Name: teacher_referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    student_learner_id uuid NOT NULL,
    source text DEFAULT 'signup_link'::text NOT NULL,
    locked_price_pence integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    subscription_id uuid,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_referrals_source_check CHECK ((source = ANY (ARRAY['signup_link'::text, 'manual_link'::text, 'admin'::text]))),
    CONSTRAINT teacher_referrals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'cancelled'::text, 'lapsed'::text])))
);


--
-- Name: TABLE teacher_referrals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.teacher_referrals IS 'Student-to-class attribution for the teacher offer. locked_price_pence captures the teacher''s price at attribution so future price changes affect new sign-ups only. Teacher is derived via classes.teacher_user_id.';


--
-- Name: COLUMN teacher_referrals.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teacher_referrals.status IS 'pending = student visited /with/{class_code} but not yet subscribed. active = student has a paying subscription. cancelled/lapsed = ended; row retained for history.';


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    referral_active boolean DEFAULT true NOT NULL,
    display_name text NOT NULL,
    photo_url text,
    bio text,
    country text,
    teaching_languages text[] DEFAULT '{}'::text[] NOT NULL,
    own_subscription_id uuid,
    payout_recipient_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    platform_status text,
    platform_expires_at timestamp with time zone,
    CONSTRAINT teachers_platform_status_check CHECK (((platform_status IS NULL) OR (platform_status = ANY (ARRAY['trial'::text, 'active'::text, 'past_due'::text, 'expired'::text, 'cancelled'::text]))))
);


--
-- Name: TABLE teachers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.teachers IS 'Private-tutor / affiliate teachers. One row per learner who signs up to the teacher offer. Referral codes live on classes.student_join_code, not here.';


--
-- Name: COLUMN teachers.referral_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teachers.referral_active IS 'False when the teacher cancels their own subscription. Existing referrals continue to earn; new sign-ups via class links are blocked.';


--
-- Name: COLUMN teachers.verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teachers.verified IS 'Dormant in v1. Flip to TRUE to display a "Trained SSi Facilitator" badge once the certification track is live.';


--
-- Name: COLUMN teachers.platform_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teachers.platform_status IS 'Tutor platform-subscription lifecycle (NULL = legacy/no trial set; app fails open). 1-month trial then £15/mo.';


--
-- Name: COLUMN teachers.platform_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.teachers.platform_expires_at IS 'Tutor dashboard gate: active OR (trial AND platform_expires_at > now). NULL fails open.';


--
-- Name: tester_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tester_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    display_name text,
    feedback_type text DEFAULT 'bug'::text NOT NULL,
    title text NOT NULL,
    description text,
    route text,
    device_info jsonb,
    build_version text,
    screenshot_url text,
    status text DEFAULT 'new'::text NOT NULL,
    priority text DEFAULT 'medium'::text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trial_burns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trial_burns (
    email text NOT NULL,
    track text NOT NULL,
    burned_at timestamp with time zone DEFAULT now() NOT NULL,
    school_id uuid,
    CONSTRAINT trial_burns_track_check CHECK ((track = ANY (ARRAY['school'::text, 'tutor'::text])))
);


--
-- Name: TABLE trial_burns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trial_burns IS 'One platform trial per (email, track) forever. INSERT before granting; 23505 = already burned = deny. Keyed on email so it survives learner-row deletion/recreation and trial expiry.';


--
-- Name: try_link_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.try_link_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    try_link_id uuid NOT NULL,
    visited_at timestamp with time zone DEFAULT now(),
    ip_hash text
);


--
-- Name: try_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.try_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone,
    ttl_days integer DEFAULT 90,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learner_id uuid NOT NULL,
    entitlement_code_id uuid,
    access_type text NOT NULL,
    granted_courses text[],
    expires_at timestamp with time zone,
    redeemed_at timestamp with time zone DEFAULT now() NOT NULL,
    email_access_grant_id uuid
);


--
-- Name: voices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voices (
    voice_id text NOT NULL,
    type text NOT NULL,
    tts_engine text,
    tts_voice_name text,
    tts_locale text,
    human_name text,
    human_email text,
    languages text[] NOT NULL,
    sample_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    display_name text,
    provider_id text,
    typical_roles text[],
    model text,
    notes text
);


--
-- Name: weekly_leaderboard; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.weekly_leaderboard WITH (security_invoker='on') AS
 WITH weekly_stats AS (
         SELECT s.learner_id,
            s.course_id,
            sum(s.points_earned) AS weekly_points,
            count(*) AS session_count
           FROM public.sessions s
          WHERE (s.started_at >= date_trunc('week'::text, CURRENT_TIMESTAMP))
          GROUP BY s.learner_id, s.course_id
        ), ranked AS (
         SELECT ws.learner_id,
            ws.course_id,
            ws.weekly_points,
            ws.session_count,
            l.display_name,
            row_number() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points DESC) AS rank,
            percent_rank() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points) AS percentile
           FROM (weekly_stats ws
             JOIN public.learners l ON ((l.id = ws.learner_id)))
          WHERE (NOT l.is_demo)
        )
 SELECT learner_id,
    display_name,
    course_id,
    weekly_points,
    session_count,
    rank,
    (round((((1)::double precision - percentile) * (100)::double precision)))::integer AS top_percentile
   FROM ranked;


--
-- Name: audio_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_flags ALTER COLUMN id SET DEFAULT nextval('public.audio_flags_id_seq'::regclass);


--
-- Name: content_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_audit_log ALTER COLUMN id SET DEFAULT nextval('public.content_audit_log_id_seq'::regclass);


--
-- Name: player_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_events ALTER COLUMN id SET DEFAULT nextval('public.player_events_id_seq'::regclass);


--
-- Name: sample_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_flags ALTER COLUMN id SET DEFAULT nextval('public.sample_flags_id_seq'::regclass);


--
-- Name: algorithm_config algorithm_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.algorithm_config
    ADD CONSTRAINT algorithm_config_pkey PRIMARY KEY (key);


--
-- Name: apml_documents apml_documents_document_path_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apml_documents
    ADD CONSTRAINT apml_documents_document_path_version_key UNIQUE (document_path, version);


--
-- Name: apml_documents apml_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apml_documents
    ADD CONSTRAINT apml_documents_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: audio_flags audio_flags_audio_uuid_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_flags
    ADD CONSTRAINT audio_flags_audio_uuid_course_code_key UNIQUE (audio_uuid, course_code);


--
-- Name: audio_flags audio_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_flags
    ADD CONSTRAINT audio_flags_pkey PRIMARY KEY (id);


--
-- Name: audio_pass_requests audio_pass_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_pass_requests
    ADD CONSTRAINT audio_pass_requests_pkey PRIMARY KEY (id);


--
-- Name: board_snapshots board_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_snapshots
    ADD CONSTRAINT board_snapshots_pkey PRIMARY KEY (id);


--
-- Name: board_snapshots board_snapshots_share_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_snapshots
    ADD CONSTRAINT board_snapshots_share_code_key UNIQUE (share_code);


--
-- Name: build_jobs build_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_jobs
    ADD CONSTRAINT build_jobs_pkey PRIMARY KEY (id);


--
-- Name: build_lessons build_lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_lessons
    ADD CONSTRAINT build_lessons_pkey PRIMARY KEY (id);


--
-- Name: canonical_pod_scenarios canonical_pod_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_pod_scenarios
    ADD CONSTRAINT canonical_pod_scenarios_pkey PRIMARY KEY (id);


--
-- Name: canonical_pod_scenarios canonical_pod_scenarios_pod_slug_global_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_pod_scenarios
    ADD CONSTRAINT canonical_pod_scenarios_pod_slug_global_order_key UNIQUE (pod_slug, global_order);


--
-- Name: canonical_pod_scenarios canonical_pod_scenarios_pod_slug_scene_sent_variant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_pod_scenarios
    ADD CONSTRAINT canonical_pod_scenarios_pod_slug_scene_sent_variant_key UNIQUE (pod_slug, scene_number, sentence_number, variant_key);


--
-- Name: canonical_seed_translations canonical_seed_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seed_translations
    ADD CONSTRAINT canonical_seed_translations_pkey PRIMARY KEY (id);


--
-- Name: canonical_seed_translations canonical_seed_translations_seed_number_language_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seed_translations
    ADD CONSTRAINT canonical_seed_translations_seed_number_language_code_key UNIQUE (seed_number, language_code);


--
-- Name: canonical_seeds canonical_seeds_canonical_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seeds
    ADD CONSTRAINT canonical_seeds_canonical_id_key UNIQUE (canonical_id);


--
-- Name: canonical_seeds canonical_seeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seeds
    ADD CONSTRAINT canonical_seeds_pkey PRIMARY KEY (id);


--
-- Name: canonical_seeds canonical_seeds_seed_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seeds
    ADD CONSTRAINT canonical_seeds_seed_id_key UNIQUE (seed_id);


--
-- Name: canonical_seeds canonical_seeds_seed_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_seeds
    ADD CONSTRAINT canonical_seeds_seed_number_key UNIQUE (seed_number);


--
-- Name: checkpoint_approvals checkpoint_approvals_course_code_checkpoint_seed_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_approvals
    ADD CONSTRAINT checkpoint_approvals_course_code_checkpoint_seed_key UNIQUE (course_code, checkpoint_seed);


--
-- Name: checkpoint_approvals checkpoint_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_approvals
    ADD CONSTRAINT checkpoint_approvals_pkey PRIMARY KEY (id);


--
-- Name: class_sessions class_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: classes classes_student_join_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_student_join_code_key UNIQUE (student_join_code);


--
-- Name: content_audit_log content_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_audit_log
    ADD CONSTRAINT content_audit_log_pkey PRIMARY KEY (id);


--
-- Name: content_feedback content_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_feedback
    ADD CONSTRAINT content_feedback_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: course_audio_envelope course_audio_envelope_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio_envelope
    ADD CONSTRAINT course_audio_envelope_pkey PRIMARY KEY (audio_id);


--
-- Name: course_audio course_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio
    ADD CONSTRAINT course_audio_pkey PRIMARY KEY (id);


--
-- Name: course_audio_usage course_audio_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio_usage
    ADD CONSTRAINT course_audio_usage_pkey PRIMARY KEY (course_code, audio_uuid);


--
-- Name: course_checkpoint_config course_checkpoint_config_course_code_checkpoint_seed_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_checkpoint_config
    ADD CONSTRAINT course_checkpoint_config_course_code_checkpoint_seed_key UNIQUE (course_code, checkpoint_seed);


--
-- Name: course_checkpoint_config course_checkpoint_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_checkpoint_config
    ADD CONSTRAINT course_checkpoint_config_pkey PRIMARY KEY (id);


--
-- Name: course_checkpoint_results course_checkpoint_results_course_code_checkpoint_seed_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_checkpoint_results
    ADD CONSTRAINT course_checkpoint_results_course_code_checkpoint_seed_key UNIQUE (course_code, checkpoint_seed);


--
-- Name: course_checkpoint_results course_checkpoint_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_checkpoint_results
    ADD CONSTRAINT course_checkpoint_results_pkey PRIMARY KEY (id);


--
-- Name: course_enrollments course_enrollments_learner_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_learner_id_course_id_key UNIQUE (learner_id, course_id);


--
-- Name: course_enrollments course_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_pkey PRIMARY KEY (id);


--
-- Name: course_export_states course_export_states_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_export_states
    ADD CONSTRAINT course_export_states_course_code_key UNIQUE (course_code);


--
-- Name: course_export_states course_export_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_export_states
    ADD CONSTRAINT course_export_states_pkey PRIMARY KEY (id);


--
-- Name: course_gender_expansions course_gender_expansions_course_code_original_text_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_gender_expansions
    ADD CONSTRAINT course_gender_expansions_course_code_original_text_language_key UNIQUE (course_code, original_text, language);


--
-- Name: course_gender_expansions course_gender_expansions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_gender_expansions
    ADD CONSTRAINT course_gender_expansions_pkey PRIMARY KEY (id);


--
-- Name: course_gender_expansions course_gender_expansions_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_gender_expansions
    ADD CONSTRAINT course_gender_expansions_unique UNIQUE (course_code, original_text, text_side);


--
-- Name: course_lego_positions course_lego_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lego_positions
    ADD CONSTRAINT course_lego_positions_pkey PRIMARY KEY (course_code, lego_id);


--
-- Name: course_legos course_legos_course_code_seed_number_lego_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_course_code_seed_number_lego_index_key UNIQUE (course_code, seed_number, lego_index);


--
-- Name: course_legos course_legos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_pkey PRIMARY KEY (id);


--
-- Name: course_practice_phrases course_practice_phrases_course_code_seed_number_lego_index__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_course_code_seed_number_lego_index__key UNIQUE (course_code, seed_number, lego_index, "position");


--
-- Name: course_practice_phrases course_practice_phrases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_pkey PRIMARY KEY (id);


--
-- Name: course_qa_flags course_qa_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_qa_flags
    ADD CONSTRAINT course_qa_flags_pkey PRIMARY KEY (id);


--
-- Name: course_seed_drafts course_seed_drafts_course_code_seed_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seed_drafts
    ADD CONSTRAINT course_seed_drafts_course_code_seed_number_key UNIQUE (course_code, seed_number);


--
-- Name: course_seed_drafts course_seed_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seed_drafts
    ADD CONSTRAINT course_seed_drafts_pkey PRIMARY KEY (id);


--
-- Name: course_seeds course_seeds_course_code_seed_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT course_seeds_course_code_seed_number_key UNIQUE (course_code, seed_number);


--
-- Name: course_seeds course_seeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT course_seeds_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (course_code);


--
-- Name: daily_contributions daily_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_contributions
    ADD CONSTRAINT daily_contributions_pkey PRIMARY KEY (id);


--
-- Name: daily_contributions daily_contributions_target_language_contribution_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_contributions
    ADD CONSTRAINT daily_contributions_target_language_contribution_date_key UNIQUE (target_language, contribution_date);


--
-- Name: dashboard_invite_codes dashboard_invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_invite_codes
    ADD CONSTRAINT dashboard_invite_codes_code_key UNIQUE (code);


--
-- Name: dashboard_invite_codes dashboard_invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_invite_codes
    ADD CONSTRAINT dashboard_invite_codes_pkey PRIMARY KEY (id);


--
-- Name: dashboard_login_codes dashboard_login_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_login_codes
    ADD CONSTRAINT dashboard_login_codes_pkey PRIMARY KEY (code);


--
-- Name: dashboard_sessions dashboard_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_sessions
    ADD CONSTRAINT dashboard_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (email);


--
-- Name: demo_orgs demo_orgs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_orgs
    ADD CONSTRAINT demo_orgs_pkey PRIMARY KEY (id);


--
-- Name: documentation_content documentation_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentation_content
    ADD CONSTRAINT documentation_content_pkey PRIMARY KEY (id);


--
-- Name: documentation_content documentation_content_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentation_content
    ADD CONSTRAINT documentation_content_slug_key UNIQUE (slug);


--
-- Name: documentation_sections documentation_sections_document_id_section_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentation_sections
    ADD CONSTRAINT documentation_sections_document_id_section_key_key UNIQUE (document_id, section_key);


--
-- Name: documentation_sections documentation_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentation_sections
    ADD CONSTRAINT documentation_sections_pkey PRIMARY KEY (id);


--
-- Name: email_access_grants email_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_access_grants
    ADD CONSTRAINT email_access_grants_pkey PRIMARY KEY (id);


--
-- Name: entitlement_codes entitlement_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_codes
    ADD CONSTRAINT entitlement_codes_code_key UNIQUE (code);


--
-- Name: entitlement_codes entitlement_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_codes
    ADD CONSTRAINT entitlement_codes_pkey PRIMARY KEY (id);


--
-- Name: entitlement_grants entitlement_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_pkey PRIMARY KEY (id);


--
-- Name: evolution_levels evolution_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evolution_levels
    ADD CONSTRAINT evolution_levels_pkey PRIMARY KEY (level);


--
-- Name: family_members family_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_pkey PRIMARY KEY (id);


--
-- Name: gamification_config gamification_config_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_config
    ADD CONSTRAINT gamification_config_course_id_key UNIQUE (course_id);


--
-- Name: gamification_config gamification_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_config
    ADD CONSTRAINT gamification_config_pkey PRIMARY KEY (id);


--
-- Name: govt_admins govt_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.govt_admins
    ADD CONSTRAINT govt_admins_pkey PRIMARY KEY (id);


--
-- Name: govt_admins govt_admins_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.govt_admins
    ADD CONSTRAINT govt_admins_user_id_key UNIQUE (user_id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: insight_discoveries insight_discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_discoveries
    ADD CONSTRAINT insight_discoveries_pkey PRIMARY KEY (id);


--
-- Name: invite_codes invite_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_key UNIQUE (code);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);


--
-- Name: language_briefs language_briefs_known_code_target_code_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language_briefs
    ADD CONSTRAINT language_briefs_known_code_target_code_version_key UNIQUE (known_code, target_code, version);


--
-- Name: language_briefs language_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language_briefs
    ADD CONSTRAINT language_briefs_pkey PRIMARY KEY (id);


--
-- Name: language_pair_briefs language_pair_briefs_known_code_target_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language_pair_briefs
    ADD CONSTRAINT language_pair_briefs_known_code_target_code_key UNIQUE (known_code, target_code);


--
-- Name: language_pair_briefs language_pair_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.language_pair_briefs
    ADD CONSTRAINT language_pair_briefs_pkey PRIMARY KEY (id);


--
-- Name: learner_emails learner_emails_learner_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_emails
    ADD CONSTRAINT learner_emails_learner_id_email_key UNIQUE (learner_id, email);


--
-- Name: learner_emails learner_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_emails
    ADD CONSTRAINT learner_emails_pkey PRIMARY KEY (id);


--
-- Name: learner_l1_state learner_l1_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_l1_state
    ADD CONSTRAINT learner_l1_state_pkey PRIMARY KEY (learner_id, course_code, lego_id);


--
-- Name: learner_lego_metrics learner_lego_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_lego_metrics
    ADD CONSTRAINT learner_lego_metrics_pkey PRIMARY KEY (learner_id, lego_id);


--
-- Name: learner_lego_pairings learner_lego_pairings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_lego_pairings
    ADD CONSTRAINT learner_lego_pairings_pkey PRIMARY KEY (learner_id, course_code, lego_a, lego_b);


--
-- Name: learner_meta_commentary_state learner_meta_commentary_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_meta_commentary_state
    ADD CONSTRAINT learner_meta_commentary_state_pkey PRIMARY KEY (learner_id);


--
-- Name: learner_milestones learner_milestones_learner_id_course_id_milestone_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_milestones
    ADD CONSTRAINT learner_milestones_learner_id_course_id_milestone_type_key UNIQUE (learner_id, course_id, milestone_type);


--
-- Name: learner_milestones learner_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_milestones
    ADD CONSTRAINT learner_milestones_pkey PRIMARY KEY (id);


--
-- Name: learner_pod_state learner_pod_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_pod_state
    ADD CONSTRAINT learner_pod_state_pkey PRIMARY KEY (learner_id, course_code, sentence_id);


--
-- Name: learner_points learner_points_learner_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_points
    ADD CONSTRAINT learner_points_learner_id_course_id_key UNIQUE (learner_id, course_id);


--
-- Name: learner_points learner_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_points
    ADD CONSTRAINT learner_points_pkey PRIMARY KEY (id);


--
-- Name: learner_practice_history learner_practice_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_practice_history
    ADD CONSTRAINT learner_practice_history_pkey PRIMARY KEY (id);


--
-- Name: learner_speaking_opportunities learner_speaking_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_speaking_opportunities
    ADD CONSTRAINT learner_speaking_opportunities_pkey PRIMARY KEY (learner_id, course_code, day);


--
-- Name: learners learners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT learners_pkey PRIMARY KEY (id);


--
-- Name: learners learners_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT learners_user_id_key UNIQUE (user_id);


--
-- Name: lego_introductions lego_introductions_course_code_lego_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_introductions
    ADD CONSTRAINT lego_introductions_course_code_lego_id_key UNIQUE (course_code, lego_id);


--
-- Name: lego_introductions lego_introductions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_introductions
    ADD CONSTRAINT lego_introductions_pkey PRIMARY KEY (id);


--
-- Name: lego_progress lego_progress_learner_id_lego_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_progress
    ADD CONSTRAINT lego_progress_learner_id_lego_id_course_id_key UNIQUE (learner_id, lego_id, course_id);


--
-- Name: lego_progress lego_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_progress
    ADD CONSTRAINT lego_progress_pkey PRIMARY KEY (id);


--
-- Name: listening_pod_sentences listening_pod_sentences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_pkey PRIMARY KEY (id);


--
-- Name: listening_pod_sentences listening_pod_sentences_pod_id_global_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_pod_id_global_order_key UNIQUE (pod_id, global_order);


--
-- Name: listening_pod_sentences listening_pod_sentences_pod_id_scene_number_sentence_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_pod_id_scene_number_sentence_number_key UNIQUE (pod_id, scene_number, sentence_number);


--
-- Name: listening_pods listening_pods_course_code_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pods
    ADD CONSTRAINT listening_pods_course_code_slug_key UNIQUE (course_code, slug);


--
-- Name: listening_pods listening_pods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pods
    ADD CONSTRAINT listening_pods_pkey PRIMARY KEY (id);


--
-- Name: offline_leases offline_leases_learner_id_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_leases
    ADD CONSTRAINT offline_leases_learner_id_course_code_key UNIQUE (learner_id, course_code);


--
-- Name: offline_leases offline_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_leases
    ADD CONSTRAINT offline_leases_pkey PRIMARY KEY (id);


--
-- Name: onboarding_messages onboarding_messages_message_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_messages
    ADD CONSTRAINT onboarding_messages_message_key_key UNIQUE (message_key);


--
-- Name: onboarding_messages onboarding_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_messages
    ADD CONSTRAINT onboarding_messages_pkey PRIMARY KEY (id);


--
-- Name: orchestrator_messages orchestrator_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_messages
    ADD CONSTRAINT orchestrator_messages_pkey PRIMARY KEY (id);


--
-- Name: phase_prompts phase_prompts_phase_code_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase_prompts
    ADD CONSTRAINT phase_prompts_phase_code_version_key UNIQUE (phase_code, version);


--
-- Name: phase_prompts phase_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase_prompts
    ADD CONSTRAINT phase_prompts_pkey PRIMARY KEY (id);


--
-- Name: player_events player_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_events
    ADD CONSTRAINT player_events_pkey PRIMARY KEY (id);


--
-- Name: pod_legos pod_legos_course_code_lego_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pod_legos
    ADD CONSTRAINT pod_legos_course_code_lego_key_key UNIQUE (course_code, lego_key);


--
-- Name: pod_legos pod_legos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pod_legos
    ADD CONSTRAINT pod_legos_pkey PRIMARY KEY (id);


--
-- Name: possession_mint_attempts possession_mint_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.possession_mint_attempts
    ADD CONSTRAINT possession_mint_attempts_pkey PRIMARY KEY (id);


--
-- Name: practice_prompts practice_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_prompts
    ADD CONSTRAINT practice_prompts_pkey PRIMARY KEY (id);


--
-- Name: presentation_templates presentation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentation_templates
    ADD CONSTRAINT presentation_templates_pkey PRIMARY KEY (id);


--
-- Name: processed_webhook_events processed_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: processed_webhook_events processed_webhook_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_webhook_events
    ADD CONSTRAINT processed_webhook_events_provider_event_id_key UNIQUE (provider, event_id);


--
-- Name: raw_seed_uploads raw_seed_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raw_seed_uploads
    ADD CONSTRAINT raw_seed_uploads_pkey PRIMARY KEY (id);


--
-- Name: recording_provenance recording_provenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recording_provenance
    ADD CONSTRAINT recording_provenance_pkey PRIMARY KEY (audio_uuid);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (code);


--
-- Name: release_notes release_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_pkey PRIMARY KEY (id);


--
-- Name: response_metrics response_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_metrics
    ADD CONSTRAINT response_metrics_pkey PRIMARY KEY (db_id);


--
-- Name: role_change_audit role_change_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_change_audit
    ADD CONSTRAINT role_change_audit_pkey PRIMARY KEY (id);


--
-- Name: sample_flags sample_flags_audio_uuid_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_flags
    ADD CONSTRAINT sample_flags_audio_uuid_course_code_key UNIQUE (audio_uuid, course_code);


--
-- Name: sample_flags sample_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_flags
    ADD CONSTRAINT sample_flags_pkey PRIMARY KEY (id);


--
-- Name: schools schools_admin_join_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_admin_join_code_key UNIQUE (admin_join_code);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: schools schools_teacher_join_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_teacher_join_code_key UNIQUE (teacher_join_code);


--
-- Name: seed_progress seed_progress_learner_id_seed_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_progress
    ADD CONSTRAINT seed_progress_learner_id_seed_id_course_id_key UNIQUE (learner_id, seed_id, course_id);


--
-- Name: seed_progress seed_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_progress
    ADD CONSTRAINT seed_progress_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: shared_audio shared_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_audio
    ADD CONSTRAINT shared_audio_pkey PRIMARY KEY (id);


--
-- Name: spike_events spike_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spike_events
    ADD CONSTRAINT spike_events_pkey PRIMARY KEY (db_id);


--
-- Name: subscriptions subscriptions_learner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_learner_id_key UNIQUE (learner_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: target_audio target_audio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_audio
    ADD CONSTRAINT target_audio_pkey PRIMARY KEY (id);


--
-- Name: target_audio target_audio_target_lang_text_normalized_role_voice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_audio
    ADD CONSTRAINT target_audio_target_lang_text_normalized_role_voice_id_key UNIQUE (target_lang, text_normalized, role, voice_id);


--
-- Name: target_legos target_legos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_legos
    ADD CONSTRAINT target_legos_pkey PRIMARY KEY (id);


--
-- Name: target_legos target_legos_target_lang_seed_number_lego_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_legos
    ADD CONSTRAINT target_legos_target_lang_seed_number_lego_index_key UNIQUE (target_lang, seed_number, lego_index);


--
-- Name: target_phrases target_phrases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_phrases
    ADD CONSTRAINT target_phrases_pkey PRIMARY KEY (id);


--
-- Name: target_phrases target_phrases_target_lang_seed_number_lego_index_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_phrases
    ADD CONSTRAINT target_phrases_target_lang_seed_number_lego_index_position_key UNIQUE (target_lang, seed_number, lego_index, "position");


--
-- Name: target_seed_texts target_seed_texts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_seed_texts
    ADD CONSTRAINT target_seed_texts_pkey PRIMARY KEY (target_lang, seed_number);


--
-- Name: teacher_commissions teacher_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_commissions
    ADD CONSTRAINT teacher_commissions_pkey PRIMARY KEY (id);


--
-- Name: teacher_commissions teacher_commissions_teacher_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_commissions
    ADD CONSTRAINT teacher_commissions_teacher_id_period_start_key UNIQUE (teacher_id, period_start);


--
-- Name: teacher_referrals teacher_referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_referrals
    ADD CONSTRAINT teacher_referrals_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_learner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_learner_id_key UNIQUE (learner_id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: tester_feedback tester_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tester_feedback
    ADD CONSTRAINT tester_feedback_pkey PRIMARY KEY (id);


--
-- Name: trial_burns trial_burns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_burns
    ADD CONSTRAINT trial_burns_pkey PRIMARY KEY (email, track);


--
-- Name: try_link_visits try_link_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.try_link_visits
    ADD CONSTRAINT try_link_visits_pkey PRIMARY KEY (id);


--
-- Name: try_links try_links_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.try_links
    ADD CONSTRAINT try_links_code_key UNIQUE (code);


--
-- Name: try_links try_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.try_links
    ADD CONSTRAINT try_links_pkey PRIMARY KEY (id);


--
-- Name: user_tags unique_active_tag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags
    ADD CONSTRAINT unique_active_tag UNIQUE (user_id, tag_type, tag_value);


--
-- Name: course_audio unique_course_audio_per_voice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio
    ADD CONSTRAINT unique_course_audio_per_voice UNIQUE (course_code, text_normalized, language, role, voice_id);


--
-- Name: course_qa_flags unique_phrase_flag; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_qa_flags
    ADD CONSTRAINT unique_phrase_flag UNIQUE (phrase_id, check_type) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: shared_audio unique_shared_audio; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_audio
    ADD CONSTRAINT unique_shared_audio UNIQUE (text_normalized, language, audio_type);


--
-- Name: user_entitlements user_entitlements_learner_id_entitlement_code_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_entitlements
    ADD CONSTRAINT user_entitlements_learner_id_entitlement_code_id_key UNIQUE (learner_id, entitlement_code_id);


--
-- Name: user_entitlements user_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_entitlements
    ADD CONSTRAINT user_entitlements_pkey PRIMARY KEY (id);


--
-- Name: user_tags user_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_tags
    ADD CONSTRAINT user_tags_pkey PRIMARY KEY (id);


--
-- Name: voices voices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voices
    ADD CONSTRAINT voices_pkey PRIMARY KEY (voice_id);


--
-- Name: audio_pass_requests_one_pending_per_course; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX audio_pass_requests_one_pending_per_course ON public.audio_pass_requests USING btree (course_code) WHERE (status = 'pending'::text);


--
-- Name: audio_pass_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_pass_requests_status_idx ON public.audio_pass_requests USING btree (status, created_at);


--
-- Name: family_members_invite_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX family_members_invite_dedupe ON public.family_members USING btree (owner_learner_id, invited_email) WHERE ((removed_at IS NULL) AND (invited_email IS NOT NULL));


--
-- Name: family_members_one_family; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX family_members_one_family ON public.family_members USING btree (member_learner_id) WHERE ((removed_at IS NULL) AND (member_learner_id IS NOT NULL));


--
-- Name: family_members_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX family_members_owner_idx ON public.family_members USING btree (owner_learner_id);


--
-- Name: idx_algorithm_config_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_algorithm_config_updated ON public.algorithm_config USING btree (updated_at DESC);


--
-- Name: idx_apml_documents_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apml_documents_is_active ON public.apml_documents USING btree (is_active);


--
-- Name: idx_apml_documents_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apml_documents_path ON public.apml_documents USING btree (document_path);


--
-- Name: idx_apml_documents_path_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apml_documents_path_active ON public.apml_documents USING btree (document_path, is_active);


--
-- Name: idx_audio_flags_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audio_flags_course ON public.audio_flags USING btree (course_code, status);


--
-- Name: idx_audio_flags_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audio_flags_uuid ON public.audio_flags USING btree (audio_uuid);


--
-- Name: idx_board_snapshots_share_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_snapshots_share_code ON public.board_snapshots USING btree (share_code);


--
-- Name: idx_build_jobs_course_pass; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_build_jobs_course_pass ON public.build_jobs USING btree (course_code, pass);


--
-- Name: idx_build_jobs_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_build_jobs_one_active ON public.build_jobs USING btree (course_code, pass) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));


--
-- Name: idx_build_jobs_stall_check; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_build_jobs_stall_check ON public.build_jobs USING btree (last_heartbeat) WHERE (status = 'running'::text);


--
-- Name: idx_build_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_build_jobs_status ON public.build_jobs USING btree (status);


--
-- Name: idx_build_lessons_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_build_lessons_family ON public.build_lessons USING btree (language_family) WHERE (active = true);


--
-- Name: idx_canonical_pod_scenarios_pod_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canonical_pod_scenarios_pod_slug ON public.canonical_pod_scenarios USING btree (pod_slug, global_order);


--
-- Name: idx_canonical_seed_translations_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canonical_seed_translations_lang ON public.canonical_seed_translations USING btree (language_code);


--
-- Name: idx_canonical_seed_translations_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canonical_seed_translations_seed ON public.canonical_seed_translations USING btree (seed_number);


--
-- Name: idx_canonical_seeds_seed_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canonical_seeds_seed_number ON public.canonical_seeds USING btree (seed_number);


--
-- Name: idx_checkpoint_config_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkpoint_config_course ON public.course_checkpoint_config USING btree (course_code);


--
-- Name: idx_checkpoint_results_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkpoint_results_course ON public.course_checkpoint_results USING btree (course_code);


--
-- Name: idx_class_sessions_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_sessions_class ON public.class_sessions USING btree (class_id, started_at DESC);


--
-- Name: idx_classes_class_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_class_learner ON public.classes USING btree (class_learner_id);


--
-- Name: idx_classes_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_course ON public.classes USING btree (course_code);


--
-- Name: idx_classes_join_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_join_code ON public.classes USING btree (student_join_code);


--
-- Name: idx_classes_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_school ON public.classes USING btree (school_id);


--
-- Name: idx_classes_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_teacher ON public.classes USING btree (teacher_user_id);


--
-- Name: idx_content_audit_log_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_audit_log_changed_at ON public.content_audit_log USING btree (changed_at DESC);


--
-- Name: idx_content_audit_log_course_audio_delete; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_audit_log_course_audio_delete ON public.content_audit_log USING btree (changed_at DESC) WHERE ((table_name = 'course_audio'::text) AND (change_type = 'DELETE'::text));


--
-- Name: idx_content_audit_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_audit_pk ON public.content_audit_log USING btree (table_name, primary_key, changed_at DESC);


--
-- Name: idx_content_audit_table_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_audit_table_time ON public.content_audit_log USING btree (table_name, changed_at DESC);


--
-- Name: idx_contributions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contributions_date ON public.daily_contributions USING btree (contribution_date DESC);


--
-- Name: idx_contributions_lang_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contributions_lang_date ON public.daily_contributions USING btree (target_language, contribution_date DESC);


--
-- Name: idx_conversations_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_updated ON public.conversations USING btree (updated_at DESC);


--
-- Name: idx_conversations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user ON public.conversations USING btree (user_id);


--
-- Name: idx_course_audio_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_course ON public.course_audio USING btree (course_code);


--
-- Name: idx_course_audio_lego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_lego ON public.course_audio USING btree (course_code, lego_id) WHERE (lego_id IS NOT NULL);


--
-- Name: idx_course_audio_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_origin ON public.course_audio USING btree (origin);


--
-- Name: idx_course_audio_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_role ON public.course_audio USING btree (course_code, role);


--
-- Name: idx_course_audio_role_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_role_sequence ON public.course_audio USING btree (course_code, role, sequence) WHERE (role = ANY (ARRAY['instruction'::text, 'encouragement'::text]));


--
-- Name: idx_course_audio_text; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_text ON public.course_audio USING btree (text_normalized, language);


--
-- Name: idx_course_audio_text_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_audio_text_lookup ON public.course_audio USING btree (course_code, text_normalized, role);


--
-- Name: idx_course_legos_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_audio ON public.course_legos USING btree (known_audio_id, target1_audio_id, target2_audio_id);


--
-- Name: idx_course_legos_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_course ON public.course_legos USING btree (course_code);


--
-- Name: idx_course_legos_is_new; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_is_new ON public.course_legos USING btree (course_code, is_new) WHERE (is_new = true);


--
-- Name: idx_course_legos_known_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_known_audio ON public.course_legos USING btree (known_audio_id) WHERE (known_audio_id IS NOT NULL);


--
-- Name: idx_course_legos_lego_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_lego_id ON public.course_legos USING btree (lego_id);


--
-- Name: idx_course_legos_presentation_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_presentation_audio ON public.course_legos USING btree (presentation_audio_id) WHERE (presentation_audio_id IS NOT NULL);


--
-- Name: idx_course_legos_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_seed ON public.course_legos USING btree (course_code, seed_number);


--
-- Name: idx_course_legos_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_sync ON public.course_legos USING btree (course_code, updated_at);


--
-- Name: idx_course_legos_target1_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_target1_audio ON public.course_legos USING btree (target1_audio_id) WHERE (target1_audio_id IS NOT NULL);


--
-- Name: idx_course_legos_target2_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_target2_audio ON public.course_legos USING btree (target2_audio_id) WHERE (target2_audio_id IS NOT NULL);


--
-- Name: idx_course_legos_target_lego_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_target_lego_id ON public.course_legos USING btree (target_lego_id);


--
-- Name: idx_course_legos_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_legos_type ON public.course_legos USING btree (type);


--
-- Name: idx_course_phrases_target_phrase_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_phrases_target_phrase_id ON public.course_practice_phrases USING btree (target_phrase_id);


--
-- Name: idx_course_practice_phrases_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_course ON public.course_practice_phrases USING btree (course_code);


--
-- Name: idx_course_practice_phrases_decomp_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_decomp_version ON public.course_practice_phrases USING btree (course_code, decomposition_course_version) WHERE (decomposition_course_version IS NOT NULL);


--
-- Name: idx_course_practice_phrases_lego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_lego ON public.course_practice_phrases USING btree (course_code, seed_number, lego_index);


--
-- Name: idx_course_practice_phrases_lego_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_lego_id ON public.course_practice_phrases USING btree (course_code, lego_id);


--
-- Name: idx_course_practice_phrases_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_sync ON public.course_practice_phrases USING btree (course_code, updated_at);


--
-- Name: idx_course_practice_phrases_tiling_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_practice_phrases_tiling_version ON public.course_practice_phrases USING btree (course_code, display_tiling_version) WHERE (display_tiling_version IS NOT NULL);


--
-- Name: idx_course_round_index_lego; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_course_round_index_lego ON public.course_round_index USING btree (course_code, lego_id);


--
-- Name: idx_course_round_index_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_course_round_index_pk ON public.course_round_index USING btree (course_code, round_index);


--
-- Name: idx_course_seed_drafts_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seed_drafts_course ON public.course_seed_drafts USING btree (course_code);


--
-- Name: idx_course_seed_drafts_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seed_drafts_review ON public.course_seed_drafts USING btree (course_code, review_status) WHERE (review_status = 'pending_review'::text);


--
-- Name: idx_course_seed_drafts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seed_drafts_status ON public.course_seed_drafts USING btree (course_code, validation_status);


--
-- Name: idx_course_seeds_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_course ON public.course_seeds USING btree (course_code);


--
-- Name: idx_course_seeds_known_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_known_audio ON public.course_seeds USING btree (known_audio_id) WHERE (known_audio_id IS NOT NULL);


--
-- Name: idx_course_seeds_release_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_release_batch ON public.course_seeds USING btree (release_batch) WHERE (release_batch IS NOT NULL);


--
-- Name: idx_course_seeds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_status ON public.course_seeds USING btree (course_code, status);


--
-- Name: idx_course_seeds_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_sync ON public.course_seeds USING btree (course_code, updated_at);


--
-- Name: idx_course_seeds_target1_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_target1_audio ON public.course_seeds USING btree (target1_audio_id) WHERE (target1_audio_id IS NOT NULL);


--
-- Name: idx_course_seeds_target2_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_seeds_target2_audio ON public.course_seeds USING btree (target2_audio_id) WHERE (target2_audio_id IS NOT NULL);


--
-- Name: idx_courses_is_community; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_is_community ON public.courses USING btree (is_community);


--
-- Name: idx_courses_pricing_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_pricing_tier ON public.courses USING btree (pricing_tier);


--
-- Name: idx_courses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_status ON public.courses USING btree (status);


--
-- Name: idx_courses_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_type ON public.courses USING btree (course_type);


--
-- Name: idx_courses_visibility; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_visibility ON public.courses USING btree (visibility);


--
-- Name: idx_dashboard_login_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_login_codes_email ON public.dashboard_login_codes USING btree (email);


--
-- Name: idx_dashboard_login_codes_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_login_codes_expires ON public.dashboard_login_codes USING btree (expires_at);


--
-- Name: idx_dashboard_sessions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_sessions_email ON public.dashboard_sessions USING btree (email);


--
-- Name: idx_dashboard_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_sessions_expires ON public.dashboard_sessions USING btree (expires_at);


--
-- Name: idx_demo_orgs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_demo_orgs_status ON public.demo_orgs USING btree (status, expires_at);


--
-- Name: idx_documentation_sections_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentation_sections_document_id ON public.documentation_sections USING btree (document_id, display_order);


--
-- Name: idx_email_access_grants_email_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_access_grants_email_normalized ON public.email_access_grants USING btree (email_normalized);


--
-- Name: idx_enrollments_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_course ON public.course_enrollments USING btree (course_id);


--
-- Name: idx_enrollments_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_learner ON public.course_enrollments USING btree (learner_id);


--
-- Name: idx_entitlement_codes_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlement_codes_normalized ON public.entitlement_codes USING btree (code_normalized);


--
-- Name: idx_entitlement_grants_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlement_grants_class ON public.entitlement_grants USING btree (class_id) WHERE (class_id IS NOT NULL);


--
-- Name: idx_entitlement_grants_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlement_grants_group ON public.entitlement_grants USING btree (group_id) WHERE (group_id IS NOT NULL);


--
-- Name: idx_entitlement_grants_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlement_grants_school ON public.entitlement_grants USING btree (school_id) WHERE (school_id IS NOT NULL);


--
-- Name: idx_export_states_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_states_course ON public.course_export_states USING btree (course_code);


--
-- Name: idx_feedback_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_audio ON public.content_feedback USING btree (audio_id, feedback_type) WHERE (resolved_at IS NULL);


--
-- Name: idx_feedback_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_course ON public.content_feedback USING btree (course_code) WHERE (resolved_at IS NULL);


--
-- Name: idx_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_created ON public.content_feedback USING btree (created_at DESC);


--
-- Name: idx_feedback_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_type ON public.content_feedback USING btree (feedback_type) WHERE (resolved_at IS NULL);


--
-- Name: idx_flags_by_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flags_by_audio ON public.sample_flags USING btree (audio_uuid);


--
-- Name: idx_flags_by_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flags_by_status ON public.sample_flags USING btree (course_code, status);


--
-- Name: idx_gender_expansions_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gender_expansions_course ON public.course_gender_expansions USING btree (course_code);


--
-- Name: idx_gender_expansions_course_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gender_expansions_course_lookup ON public.course_gender_expansions USING btree (course_code, language);


--
-- Name: idx_gender_expansions_course_side; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gender_expansions_course_side ON public.course_gender_expansions USING btree (course_code, text_side);


--
-- Name: idx_govt_admins_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_govt_admins_region ON public.govt_admins USING btree (region_code);


--
-- Name: idx_govt_admins_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_govt_admins_user ON public.govt_admins USING btree (user_id);


--
-- Name: idx_groups_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_parent ON public.groups USING btree (parent_id);


--
-- Name: idx_groups_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_path ON public.groups USING btree (path text_pattern_ops);


--
-- Name: idx_groups_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_type ON public.groups USING btree (type);


--
-- Name: idx_insight_discoveries_source_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insight_discoveries_source_generated ON public.insight_discoveries USING btree (source, generated_at DESC);


--
-- Name: idx_invite_codes_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_class ON public.invite_codes USING btree (grants_class_id) WHERE (grants_class_id IS NOT NULL);


--
-- Name: idx_invite_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_code ON public.invite_codes USING btree (code);


--
-- Name: idx_invite_codes_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_normalized ON public.invite_codes USING btree (code_normalized);


--
-- Name: idx_invite_codes_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_school ON public.invite_codes USING btree (grants_school_id) WHERE (grants_school_id IS NOT NULL);


--
-- Name: idx_invite_codes_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_codes_type ON public.invite_codes USING btree (code_type);


--
-- Name: idx_language_briefs_codes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_language_briefs_codes ON public.language_briefs USING btree (known_code, target_code);


--
-- Name: idx_language_briefs_codes_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_language_briefs_codes_active ON public.language_briefs USING btree (known_code, target_code, is_active);


--
-- Name: idx_language_briefs_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_language_briefs_is_active ON public.language_briefs USING btree (is_active);


--
-- Name: idx_language_pair_briefs_codes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_language_pair_briefs_codes ON public.language_pair_briefs USING btree (known_code, target_code);


--
-- Name: idx_learner_emails_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_emails_email_lower ON public.learner_emails USING btree (lower(email));


--
-- Name: idx_learner_emails_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_emails_learner ON public.learner_emails USING btree (learner_id);


--
-- Name: idx_learner_emails_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_emails_primary ON public.learner_emails USING btree (learner_id) WHERE is_primary;


--
-- Name: idx_learner_l1_state_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_l1_state_learner_course ON public.learner_l1_state USING btree (learner_id, course_code);


--
-- Name: idx_learner_lego_metrics_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_lego_metrics_learner_course ON public.learner_lego_metrics USING btree (learner_id, course_code);


--
-- Name: idx_learner_pod_state_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_pod_state_learner_course ON public.learner_pod_state USING btree (learner_id, course_code);


--
-- Name: idx_learner_points_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_points_course ON public.learner_points USING btree (course_id);


--
-- Name: idx_learner_points_evolution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_points_evolution ON public.learner_points USING btree (course_id, evolution_score DESC);


--
-- Name: idx_learner_points_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_points_learner ON public.learner_points USING btree (learner_id);


--
-- Name: idx_learners_verified_emails; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_verified_emails ON public.learners USING gin (verified_emails);


--
-- Name: idx_lego_introductions_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lego_introductions_course ON public.lego_introductions USING btree (course_code);


--
-- Name: idx_lego_introductions_lego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lego_introductions_lego ON public.lego_introductions USING btree (course_code, lego_id);


--
-- Name: idx_lego_introductions_presentation_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lego_introductions_presentation_audio ON public.lego_introductions USING btree (presentation_audio_id) WHERE (presentation_audio_id IS NOT NULL);


--
-- Name: idx_lego_progress_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lego_progress_learner_course ON public.lego_progress USING btree (learner_id, course_id);


--
-- Name: idx_lego_progress_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lego_progress_thread ON public.lego_progress USING btree (learner_id, course_id, thread_id);


--
-- Name: idx_listening_pod_sentences_known_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pod_sentences_known_audio ON public.listening_pod_sentences USING btree (known_audio_id);


--
-- Name: idx_listening_pod_sentences_needs_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pod_sentences_needs_audio ON public.listening_pod_sentences USING btree (pod_id) WHERE ((target_audio_id IS NULL) OR (known_audio_id IS NULL));


--
-- Name: idx_listening_pod_sentences_pod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pod_sentences_pod ON public.listening_pod_sentences USING btree (pod_id);


--
-- Name: idx_listening_pod_sentences_pod_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pod_sentences_pod_order ON public.listening_pod_sentences USING btree (pod_id, global_order);


--
-- Name: idx_listening_pod_sentences_target_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pod_sentences_target_audio ON public.listening_pod_sentences USING btree (target_audio_id);


--
-- Name: idx_listening_pods_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pods_course ON public.listening_pods USING btree (course_code);


--
-- Name: idx_listening_pods_course_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_listening_pods_course_type ON public.listening_pods USING btree (course_code, pod_type);


--
-- Name: idx_metrics_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_learner ON public.response_metrics USING btree (learner_id);


--
-- Name: idx_metrics_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_session ON public.response_metrics USING btree (session_id);


--
-- Name: idx_metrics_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metrics_timestamp ON public.response_metrics USING btree (learner_id, "timestamp" DESC);


--
-- Name: idx_milestones_achieved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_achieved ON public.learner_milestones USING btree (learner_id, achieved_at DESC);


--
-- Name: idx_milestones_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_learner ON public.learner_milestones USING btree (learner_id);


--
-- Name: idx_milestones_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_learner_course ON public.learner_milestones USING btree (learner_id, course_id);


--
-- Name: idx_onboarding_messages_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_messages_sort_order ON public.onboarding_messages USING btree (sort_order);


--
-- Name: idx_orch_msg_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orch_msg_course ON public.orchestrator_messages USING btree (course_code, created_at DESC);


--
-- Name: idx_pairings_first_fired; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pairings_first_fired ON public.learner_lego_pairings USING btree (learner_id, course_code, first_fired_at);


--
-- Name: idx_pairings_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pairings_learner_course ON public.learner_lego_pairings USING btree (learner_id, course_code);


--
-- Name: idx_phase_prompts_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase_prompts_is_active ON public.phase_prompts USING btree (is_active);


--
-- Name: idx_phase_prompts_phase_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase_prompts_phase_active ON public.phase_prompts USING btree (phase_code, is_active);


--
-- Name: idx_phase_prompts_phase_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phase_prompts_phase_code ON public.phase_prompts USING btree (phase_code);


--
-- Name: idx_player_events_learner_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_events_learner_time ON public.player_events USING btree (learner_id, occurred_at DESC);


--
-- Name: idx_player_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_events_session ON public.player_events USING btree (session_id, occurred_at);


--
-- Name: idx_player_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_events_type_time ON public.player_events USING btree (event_type, occurred_at DESC);


--
-- Name: idx_player_events_user_session_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_events_user_session_time ON public.player_events USING btree (user_id, session_id, occurred_at);


--
-- Name: idx_player_events_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_player_events_user_time ON public.player_events USING btree (user_id, occurred_at DESC);


--
-- Name: idx_possession_mint_attempts_code_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_possession_mint_attempts_code_time ON public.possession_mint_attempts USING btree (invite_code_id, created_at DESC);


--
-- Name: idx_possession_mint_attempts_ip_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_possession_mint_attempts_ip_time ON public.possession_mint_attempts USING btree (ip_hash, created_at DESC);


--
-- Name: idx_practice_history_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_history_learner ON public.learner_practice_history USING btree (learner_id);


--
-- Name: idx_practice_history_prompt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_history_prompt ON public.learner_practice_history USING btree (prompt_id);


--
-- Name: idx_practice_phrases_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_audio ON public.course_practice_phrases USING btree (known_audio_id, target1_audio_id, target2_audio_id);


--
-- Name: idx_practice_phrases_known_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_known_audio ON public.course_practice_phrases USING btree (known_audio_id) WHERE (known_audio_id IS NOT NULL);


--
-- Name: idx_practice_phrases_qa_unchecked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_qa_unchecked ON public.course_practice_phrases USING btree (course_code, created_at) WHERE (qa_checked IS NULL);


--
-- Name: idx_practice_phrases_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_role ON public.course_practice_phrases USING btree (course_code, seed_number, lego_index, phrase_role);


--
-- Name: idx_practice_phrases_target1_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_target1_audio ON public.course_practice_phrases USING btree (target1_audio_id) WHERE (target1_audio_id IS NOT NULL);


--
-- Name: idx_practice_phrases_target2_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_phrases_target2_audio ON public.course_practice_phrases USING btree (target2_audio_id) WHERE (target2_audio_id IS NOT NULL);


--
-- Name: idx_practice_prompts_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_prompts_course ON public.practice_prompts USING btree (course_code);


--
-- Name: idx_practice_prompts_legos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_practice_prompts_legos ON public.practice_prompts USING gin (prompt_lego_ids);


--
-- Name: idx_processed_webhook_events_processed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_processed_webhook_events_processed_at ON public.processed_webhook_events USING btree (processed_at);


--
-- Name: idx_qa_flags_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_course ON public.course_qa_flags USING btree (course_code);


--
-- Name: idx_qa_flags_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_open ON public.course_qa_flags USING btree (course_code, severity) WHERE (status = 'open'::text);


--
-- Name: idx_qa_flags_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_seed ON public.course_qa_flags USING btree (seed_number);


--
-- Name: idx_qa_flags_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_severity ON public.course_qa_flags USING btree (severity);


--
-- Name: idx_qa_flags_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_status ON public.course_qa_flags USING btree (status);


--
-- Name: idx_qa_flags_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_flags_type ON public.course_qa_flags USING btree (check_type);


--
-- Name: idx_raw_seed_uploads_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raw_seed_uploads_course ON public.raw_seed_uploads USING btree (course_code, status);


--
-- Name: idx_raw_seed_uploads_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raw_seed_uploads_pending ON public.raw_seed_uploads USING btree (status, created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_role_change_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_change_audit_actor ON public.role_change_audit USING btree (actor_user_id);


--
-- Name: idx_role_change_audit_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_change_audit_occurred ON public.role_change_audit USING btree (occurred_at DESC);


--
-- Name: idx_role_change_audit_target_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_change_audit_target_learner ON public.role_change_audit USING btree (target_learner_id);


--
-- Name: idx_role_change_audit_target_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_change_audit_target_user ON public.role_change_audit USING btree (target_user_id);


--
-- Name: idx_schools_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_admin ON public.schools USING btree (admin_user_id);


--
-- Name: idx_schools_admin_join_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_admin_join_code ON public.schools USING btree (admin_join_code);


--
-- Name: idx_schools_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_group ON public.schools USING btree (group_id) WHERE (group_id IS NOT NULL);


--
-- Name: idx_schools_join_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_join_code ON public.schools USING btree (teacher_join_code);


--
-- Name: idx_schools_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_region ON public.schools USING btree (region_code) WHERE (region_code IS NOT NULL);


--
-- Name: idx_seed_progress_learner_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seed_progress_learner_course ON public.seed_progress USING btree (learner_id, course_id);


--
-- Name: idx_sessions_course_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_course_started ON public.sessions USING btree (course_id, started_at);


--
-- Name: idx_sessions_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_learner ON public.sessions USING btree (learner_id);


--
-- Name: idx_sessions_learner_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_learner_started ON public.sessions USING btree (learner_id, started_at DESC);


--
-- Name: idx_shared_audio_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_audio_language ON public.shared_audio USING btree (language);


--
-- Name: idx_shared_audio_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shared_audio_type ON public.shared_audio USING btree (language, audio_type);


--
-- Name: idx_spikes_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spikes_learner ON public.spike_events USING btree (learner_id);


--
-- Name: idx_spikes_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spikes_session ON public.spike_events USING btree (session_id);


--
-- Name: idx_subscriptions_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_provider_id ON public.subscriptions USING btree (provider, provider_subscription_id);


--
-- Name: idx_target_audio_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_target_audio_lookup ON public.target_audio USING btree (target_lang, text_normalized, role);


--
-- Name: idx_target_legos_lang_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_target_legos_lang_seed ON public.target_legos USING btree (target_lang, seed_number);


--
-- Name: idx_target_phrases_lang_seed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_target_phrases_lang_seed ON public.target_phrases USING btree (target_lang, seed_number);


--
-- Name: idx_target_phrases_lego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_target_phrases_lego ON public.target_phrases USING btree (target_lang, seed_number, lego_index);


--
-- Name: idx_teacher_commissions_hold_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_commissions_hold_until ON public.teacher_commissions USING btree (status, hold_until) WHERE (status = ANY (ARRAY['held'::text, 'accruing'::text]));


--
-- Name: idx_teacher_commissions_status_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_commissions_status_period ON public.teacher_commissions USING btree (status, period_end);


--
-- Name: idx_teacher_commissions_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_commissions_teacher ON public.teacher_commissions USING btree (teacher_id);


--
-- Name: idx_teacher_commissions_wise_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_commissions_wise_batch ON public.teacher_commissions USING btree (wise_batch_group_id) WHERE (wise_batch_group_id IS NOT NULL);


--
-- Name: idx_teacher_commissions_wise_transfer_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_teacher_commissions_wise_transfer_unique ON public.teacher_commissions USING btree (wise_transfer_id) WHERE (wise_transfer_id IS NOT NULL);


--
-- Name: idx_teacher_referrals_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_referrals_class ON public.teacher_referrals USING btree (class_id);


--
-- Name: idx_teacher_referrals_student_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_teacher_referrals_student_active ON public.teacher_referrals USING btree (student_learner_id) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text]));


--
-- Name: idx_teacher_referrals_subscription_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_teacher_referrals_subscription_unique ON public.teacher_referrals USING btree (subscription_id) WHERE (subscription_id IS NOT NULL);


--
-- Name: idx_tester_feedback_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tester_feedback_status ON public.tester_feedback USING btree (status);


--
-- Name: idx_tester_feedback_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tester_feedback_user ON public.tester_feedback USING btree (user_id);


--
-- Name: idx_try_link_visits_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_try_link_visits_link_id ON public.try_link_visits USING btree (try_link_id);


--
-- Name: idx_try_link_visits_visited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_try_link_visits_visited_at ON public.try_link_visits USING btree (visited_at);


--
-- Name: idx_try_links_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_try_links_code ON public.try_links USING btree (code);


--
-- Name: idx_usage_by_audio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_by_audio ON public.course_audio_usage USING btree (audio_uuid);


--
-- Name: idx_usage_by_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_by_course ON public.course_audio_usage USING btree (course_code);


--
-- Name: idx_user_tags_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_tags_active ON public.user_tags USING btree (user_id, tag_type) WHERE (removed_at IS NULL);


--
-- Name: idx_user_tags_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_tags_class ON public.user_tags USING btree (tag_value) WHERE ((tag_type = 'class'::text) AND (removed_at IS NULL));


--
-- Name: idx_user_tags_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_tags_school ON public.user_tags USING btree (tag_value) WHERE ((tag_type = 'school'::text) AND (removed_at IS NULL));


--
-- Name: learners_is_class_entity_true_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learners_is_class_entity_true_idx ON public.learners USING btree (id) WHERE is_class_entity;


--
-- Name: learners_is_demo_true_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learners_is_demo_true_idx ON public.learners USING btree (id) WHERE is_demo;


--
-- Name: learners_is_internal_true_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learners_is_internal_true_idx ON public.learners USING btree (id) WHERE is_internal;


--
-- Name: offline_leases_learner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offline_leases_learner_idx ON public.offline_leases USING btree (learner_id);


--
-- Name: one_active_per_document; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_per_document ON public.apml_documents USING btree (document_path) WHERE (is_active = true);


--
-- Name: one_active_per_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_per_pair ON public.language_briefs USING btree (known_code, target_code) WHERE (is_active = true);


--
-- Name: one_active_per_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX one_active_per_phase ON public.phase_prompts USING btree (phase_code) WHERE (is_active = true);


--
-- Name: player_events_env_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_events_env_idx ON public.player_events USING btree (env);


--
-- Name: pod_legos_course_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pod_legos_course_idx ON public.pod_legos USING btree (course_code);


--
-- Name: pod_legos_course_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pod_legos_course_order_idx ON public.pod_legos USING btree (course_code, first_seen_order);


--
-- Name: pod_legos_needs_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pod_legos_needs_review_idx ON public.pod_legos USING btree (course_code) WHERE needs_review;


--
-- Name: release_notes_published_released_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX release_notes_published_released_at_idx ON public.release_notes USING btree (is_published, released_at DESC);


--
-- Name: release_notes_released_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX release_notes_released_at_idx ON public.release_notes USING btree (released_at DESC);


--
-- Name: schools_admin_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX schools_admin_user_id_key ON public.schools USING btree (admin_user_id) WHERE (admin_user_id IS NOT NULL);


--
-- Name: uq_user_entitlements_learner_grant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_user_entitlements_learner_grant ON public.user_entitlements USING btree (learner_id, email_access_grant_id) WHERE (email_access_grant_id IS NOT NULL);


--
-- Name: course_audio audio_autolink; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audio_autolink AFTER INSERT ON public.course_audio FOR EACH ROW EXECUTE FUNCTION public.link_audio_to_content();


--
-- Name: canonical_seed_translations canonical_seed_translations_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER canonical_seed_translations_audit AFTER DELETE OR UPDATE ON public.canonical_seed_translations FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: canonical_seeds canonical_seeds_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER canonical_seeds_audit AFTER DELETE OR UPDATE ON public.canonical_seeds FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: course_audio course_audio_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_audio_audit AFTER DELETE OR UPDATE ON public.course_audio FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: course_audio course_audio_sync_duration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_audio_sync_duration AFTER INSERT OR UPDATE OF duration_ms ON public.course_audio FOR EACH ROW EXECUTE FUNCTION public.sync_audio_duration_to_dependents();


--
-- Name: course_enrollments course_enrollments_ratchet_highest_round; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_enrollments_ratchet_highest_round BEFORE INSERT OR UPDATE OF last_completed_round_index, last_completed_lego_id, highest_completed_round_index, highest_completed_lego_id ON public.course_enrollments FOR EACH ROW EXECUTE FUNCTION public.ratchet_highest_completed_round();


--
-- Name: course_legos course_legos_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_legos_audit AFTER DELETE OR UPDATE ON public.course_legos FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: course_legos course_legos_bump_course_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_legos_bump_course_version AFTER INSERT OR DELETE OR UPDATE OF target_text, known_text, seed_number, lego_index, components ON public.course_legos FOR EACH ROW EXECUTE FUNCTION public.bump_course_version();


--
-- Name: course_legos course_legos_pull_duration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_legos_pull_duration BEFORE INSERT OR UPDATE OF target1_audio_id, target2_audio_id ON public.course_legos FOR EACH ROW EXECUTE FUNCTION public.pull_audio_duration_on_link();


--
-- Name: course_legos course_legos_version_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_legos_version_trigger BEFORE UPDATE ON public.course_legos FOR EACH ROW EXECUTE FUNCTION public.increment_version();


--
-- Name: course_practice_phrases course_practice_phrases_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_practice_phrases_audit AFTER DELETE OR UPDATE ON public.course_practice_phrases FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: course_practice_phrases course_practice_phrases_pull_duration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_practice_phrases_pull_duration BEFORE INSERT OR UPDATE OF target1_audio_id, target2_audio_id ON public.course_practice_phrases FOR EACH ROW EXECUTE FUNCTION public.pull_audio_duration_on_link();


--
-- Name: course_practice_phrases course_practice_phrases_version_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_practice_phrases_version_trigger BEFORE UPDATE ON public.course_practice_phrases FOR EACH ROW EXECUTE FUNCTION public.increment_version();


--
-- Name: course_seeds course_seeds_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_seeds_audit AFTER DELETE OR UPDATE ON public.course_seeds FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: course_seeds course_seeds_version_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER course_seeds_version_trigger BEFORE UPDATE ON public.course_seeds FOR EACH ROW EXECUTE FUNCTION public.increment_version();


--
-- Name: courses courses_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courses_audit AFTER DELETE OR UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: courses courses_beta_timestamp_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER courses_beta_timestamp_trigger BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_beta_timestamp();


--
-- Name: language_briefs language_briefs_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER language_briefs_updated_at_trigger BEFORE UPDATE ON public.language_briefs FOR EACH ROW EXECUTE FUNCTION public.update_language_briefs_updated_at();


--
-- Name: lego_introductions lego_introductions_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lego_introductions_audit AFTER DELETE OR UPDATE ON public.lego_introductions FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: listening_pod_sentences listening_pod_sentences_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listening_pod_sentences_audit AFTER DELETE OR UPDATE ON public.listening_pod_sentences FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: listening_pod_sentences listening_pod_sentences_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listening_pod_sentences_touch_updated_at BEFORE UPDATE ON public.listening_pod_sentences FOR EACH ROW EXECUTE FUNCTION public.touch_listening_pods_updated_at();


--
-- Name: listening_pods listening_pods_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listening_pods_audit AFTER DELETE OR UPDATE ON public.listening_pods FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: listening_pods listening_pods_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER listening_pods_touch_updated_at BEFORE UPDATE ON public.listening_pods FOR EACH ROW EXECUTE FUNCTION public.touch_listening_pods_updated_at();


--
-- Name: phase_prompts phase_prompts_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER phase_prompts_updated_at_trigger BEFORE UPDATE ON public.phase_prompts FOR EACH ROW EXECUTE FUNCTION public.update_phase_prompts_updated_at();


--
-- Name: release_notes release_notes_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_notes_touch_updated_at BEFORE UPDATE ON public.release_notes FOR EACH ROW EXECUTE FUNCTION public.tg_release_notes_touch_updated_at();


--
-- Name: schools schools_inherit_group_test_flags; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER schools_inherit_group_test_flags BEFORE INSERT OR UPDATE OF group_id ON public.schools FOR EACH ROW EXECUTE FUNCTION public.inherit_group_test_flags();


--
-- Name: shared_audio shared_audio_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shared_audio_audit AFTER DELETE OR UPDATE ON public.shared_audio FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: learners sync_emails_on_learner_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_emails_on_learner_insert AFTER INSERT ON public.learners FOR EACH ROW EXECUTE FUNCTION public.sync_learner_emails_on_learner_insert();


--
-- Name: classes tr_classes_join_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_classes_join_code BEFORE INSERT ON public.classes FOR EACH ROW EXECUTE FUNCTION public.set_class_join_code();


--
-- Name: classes tr_classes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_classes_updated_at BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: schools tr_schools_join_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_schools_join_code BEFORE INSERT ON public.schools FOR EACH ROW EXECUTE FUNCTION public.set_school_join_code();


--
-- Name: schools tr_schools_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tr_schools_updated_at BEFORE UPDATE ON public.schools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: learners trg_auto_entitle_popty_user; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auto_entitle_popty_user AFTER UPDATE OF platform_role ON public.learners FOR EACH ROW EXECUTE FUNCTION public.auto_entitle_popty_user();


--
-- Name: groups trg_compute_group_path; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_group_path BEFORE INSERT OR UPDATE OF name, parent_id ON public.groups FOR EACH ROW EXECUTE FUNCTION public.compute_group_path();


--
-- Name: course_audio trg_course_audio_normalize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_course_audio_normalize BEFORE INSERT OR UPDATE ON public.course_audio FOR EACH ROW EXECUTE FUNCTION public.audio_normalize_text();


--
-- Name: courses trg_courses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: course_legos trg_null_lego_audio_on_text_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_null_lego_audio_on_text_change BEFORE UPDATE ON public.course_legos FOR EACH ROW EXECUTE FUNCTION public.null_lego_audio_on_text_change();


--
-- Name: course_practice_phrases trg_null_phrase_audio_on_text_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_null_phrase_audio_on_text_change BEFORE UPDATE ON public.course_practice_phrases FOR EACH ROW EXECUTE FUNCTION public.null_phrase_audio_on_text_change();


--
-- Name: shared_audio trg_shared_audio_normalize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shared_audio_normalize BEFORE INSERT OR UPDATE ON public.shared_audio FOR EACH ROW EXECUTE FUNCTION public.audio_normalize_text();


--
-- Name: canonical_pod_scenarios trg_touch_canonical_pod_scenarios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_canonical_pod_scenarios BEFORE UPDATE ON public.canonical_pod_scenarios FOR EACH ROW EXECUTE FUNCTION public.touch_canonical_pod_scenarios();


--
-- Name: sessions trg_update_daily_contributions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_daily_contributions AFTER INSERT OR UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_daily_contributions();


--
-- Name: learner_l1_state update_learner_l1_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_learner_l1_state_updated_at BEFORE UPDATE ON public.learner_l1_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: learner_lego_metrics update_learner_lego_metrics_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_learner_lego_metrics_updated_at BEFORE UPDATE ON public.learner_lego_metrics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: learner_pod_state update_learner_pod_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_learner_pod_state_updated_at BEFORE UPDATE ON public.learner_pod_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: learner_points update_learner_points_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_learner_points_updated_at BEFORE UPDATE ON public.learner_points FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: learners update_learners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_learners_updated_at BEFORE UPDATE ON public.learners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: lego_progress update_lego_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_lego_progress_updated_at BEFORE UPDATE ON public.lego_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: seed_progress update_seed_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_seed_progress_updated_at BEFORE UPDATE ON public.seed_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscriptions update_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teacher_commissions update_teacher_commissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teacher_commissions_updated_at BEFORE UPDATE ON public.teacher_commissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teacher_referrals update_teacher_referrals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teacher_referrals_updated_at BEFORE UPDATE ON public.teacher_referrals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teachers update_teachers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teachers_updated_at BEFORE UPDATE ON public.teachers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: voices voices_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER voices_audit AFTER DELETE OR UPDATE ON public.voices FOR EACH ROW EXECUTE FUNCTION public.audit_content_change();


--
-- Name: build_jobs build_jobs_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_jobs
    ADD CONSTRAINT build_jobs_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: build_lessons build_lessons_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.build_lessons
    ADD CONSTRAINT build_lessons_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.build_lessons(id);


--
-- Name: class_sessions class_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_sessions
    ADD CONSTRAINT class_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: classes classes_class_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_class_learner_id_fkey FOREIGN KEY (class_learner_id) REFERENCES public.learners(id);


--
-- Name: classes classes_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: course_audio course_audio_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio
    ADD CONSTRAINT course_audio_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code) ON DELETE CASCADE;


--
-- Name: course_audio_envelope course_audio_envelope_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_audio_envelope
    ADD CONSTRAINT course_audio_envelope_audio_id_fkey FOREIGN KEY (audio_id) REFERENCES public.course_audio(id) ON DELETE CASCADE;


--
-- Name: course_enrollments course_enrollments_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrollments
    ADD CONSTRAINT course_enrollments_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: course_export_states course_export_states_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_export_states
    ADD CONSTRAINT course_export_states_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code) ON DELETE CASCADE;


--
-- Name: course_gender_expansions course_gender_expansions_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_gender_expansions
    ADD CONSTRAINT course_gender_expansions_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: course_legos course_legos_known_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_known_audio_id_fkey FOREIGN KEY (known_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_legos course_legos_target1_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_target1_audio_id_fkey FOREIGN KEY (target1_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_legos course_legos_target2_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_target2_audio_id_fkey FOREIGN KEY (target2_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_legos course_legos_target_lego_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT course_legos_target_lego_id_fkey FOREIGN KEY (target_lego_id) REFERENCES public.target_legos(id);


--
-- Name: course_practice_phrases course_practice_phrases_known_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_known_audio_id_fkey FOREIGN KEY (known_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_practice_phrases course_practice_phrases_target1_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_target1_audio_id_fkey FOREIGN KEY (target1_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_practice_phrases course_practice_phrases_target2_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_target2_audio_id_fkey FOREIGN KEY (target2_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_practice_phrases course_practice_phrases_target_phrase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT course_practice_phrases_target_phrase_id_fkey FOREIGN KEY (target_phrase_id) REFERENCES public.target_phrases(id);


--
-- Name: course_qa_flags course_qa_flags_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_qa_flags
    ADD CONSTRAINT course_qa_flags_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: course_qa_flags course_qa_flags_phrase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_qa_flags
    ADD CONSTRAINT course_qa_flags_phrase_id_fkey FOREIGN KEY (phrase_id) REFERENCES public.course_practice_phrases(id) ON DELETE CASCADE;


--
-- Name: course_seed_drafts course_seed_drafts_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seed_drafts
    ADD CONSTRAINT course_seed_drafts_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: course_seeds course_seeds_known_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT course_seeds_known_audio_id_fkey FOREIGN KEY (known_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_seeds course_seeds_target1_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT course_seeds_target1_audio_id_fkey FOREIGN KEY (target1_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: course_seeds course_seeds_target2_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT course_seeds_target2_audio_id_fkey FOREIGN KEY (target2_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: dashboard_login_codes dashboard_login_codes_email_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_login_codes
    ADD CONSTRAINT dashboard_login_codes_email_fkey FOREIGN KEY (email) REFERENCES public.dashboard_users(email) ON DELETE CASCADE;


--
-- Name: dashboard_sessions dashboard_sessions_email_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_sessions
    ADD CONSTRAINT dashboard_sessions_email_fkey FOREIGN KEY (email) REFERENCES public.dashboard_users(email) ON DELETE CASCADE;


--
-- Name: demo_orgs demo_orgs_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_orgs
    ADD CONSTRAINT demo_orgs_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: demo_orgs demo_orgs_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demo_orgs
    ADD CONSTRAINT demo_orgs_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: documentation_sections documentation_sections_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentation_sections
    ADD CONSTRAINT documentation_sections_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documentation_content(id) ON DELETE CASCADE;


--
-- Name: entitlement_grants entitlement_grants_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: entitlement_grants entitlement_grants_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: entitlement_grants entitlement_grants_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlement_grants
    ADD CONSTRAINT entitlement_grants_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: family_members family_members_member_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_member_learner_id_fkey FOREIGN KEY (member_learner_id) REFERENCES public.learners(id);


--
-- Name: family_members family_members_owner_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_owner_learner_id_fkey FOREIGN KEY (owner_learner_id) REFERENCES public.learners(id);


--
-- Name: course_legos fk_course_legos_seed; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_legos
    ADD CONSTRAINT fk_course_legos_seed FOREIGN KEY (course_code, seed_number) REFERENCES public.course_seeds(course_code, seed_number);


--
-- Name: course_practice_phrases fk_course_practice_phrases_lego; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_practice_phrases
    ADD CONSTRAINT fk_course_practice_phrases_lego FOREIGN KEY (course_code, seed_number, lego_index) REFERENCES public.course_legos(course_code, seed_number, lego_index);


--
-- Name: course_seeds fk_course_seeds_course; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_seeds
    ADD CONSTRAINT fk_course_seeds_course FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: invite_codes fk_invite_codes_class; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT fk_invite_codes_class FOREIGN KEY (grants_class_id) REFERENCES public.classes(id);


--
-- Name: invite_codes fk_invite_codes_school; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT fk_invite_codes_school FOREIGN KEY (grants_school_id) REFERENCES public.schools(id);


--
-- Name: govt_admins govt_admins_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.govt_admins
    ADD CONSTRAINT govt_admins_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: govt_admins govt_admins_invite_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.govt_admins
    ADD CONSTRAINT govt_admins_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id);


--
-- Name: govt_admins govt_admins_region_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.govt_admins
    ADD CONSTRAINT govt_admins_region_code_fkey FOREIGN KEY (region_code) REFERENCES public.regions(code);


--
-- Name: groups groups_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.groups(id);


--
-- Name: invite_codes invite_codes_grants_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_grants_group_id_fkey FOREIGN KEY (grants_group_id) REFERENCES public.groups(id);


--
-- Name: invite_codes invite_codes_grants_region_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_grants_region_fkey FOREIGN KEY (grants_region) REFERENCES public.regions(code);


--
-- Name: learner_emails learner_emails_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_emails
    ADD CONSTRAINT learner_emails_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_l1_state learner_l1_state_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_l1_state
    ADD CONSTRAINT learner_l1_state_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_lego_metrics learner_lego_metrics_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_lego_metrics
    ADD CONSTRAINT learner_lego_metrics_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_lego_pairings learner_lego_pairings_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_lego_pairings
    ADD CONSTRAINT learner_lego_pairings_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_meta_commentary_state learner_meta_commentary_state_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_meta_commentary_state
    ADD CONSTRAINT learner_meta_commentary_state_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_milestones learner_milestones_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_milestones
    ADD CONSTRAINT learner_milestones_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_pod_state learner_pod_state_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_pod_state
    ADD CONSTRAINT learner_pod_state_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_points learner_points_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_points
    ADD CONSTRAINT learner_points_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learner_practice_history learner_practice_history_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_practice_history
    ADD CONSTRAINT learner_practice_history_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES auth.users(id);


--
-- Name: learner_practice_history learner_practice_history_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_practice_history
    ADD CONSTRAINT learner_practice_history_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.practice_prompts(id);


--
-- Name: learner_speaking_opportunities learner_speaking_opportunities_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_speaking_opportunities
    ADD CONSTRAINT learner_speaking_opportunities_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: learners learners_invite_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT learners_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id);


--
-- Name: lego_introductions lego_introductions_presentation_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_introductions
    ADD CONSTRAINT lego_introductions_presentation_audio_id_fkey FOREIGN KEY (presentation_audio_id) REFERENCES public.course_audio(id) ON DELETE CASCADE;


--
-- Name: lego_progress lego_progress_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lego_progress
    ADD CONSTRAINT lego_progress_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: listening_pod_sentences listening_pod_sentences_known_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_known_audio_id_fkey FOREIGN KEY (known_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: listening_pod_sentences listening_pod_sentences_pod_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES public.listening_pods(id) ON DELETE CASCADE;


--
-- Name: listening_pod_sentences listening_pod_sentences_target_audio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.listening_pod_sentences
    ADD CONSTRAINT listening_pod_sentences_target_audio_id_fkey FOREIGN KEY (target_audio_id) REFERENCES public.course_audio(id) ON DELETE SET NULL;


--
-- Name: offline_leases offline_leases_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_leases
    ADD CONSTRAINT offline_leases_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: possession_mint_attempts possession_mint_attempts_invite_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.possession_mint_attempts
    ADD CONSTRAINT possession_mint_attempts_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id) ON DELETE SET NULL;


--
-- Name: practice_prompts practice_prompts_course_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_prompts
    ADD CONSTRAINT practice_prompts_course_code_fkey FOREIGN KEY (course_code) REFERENCES public.courses(course_code);


--
-- Name: release_notes release_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: response_metrics response_metrics_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_metrics
    ADD CONSTRAINT response_metrics_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: response_metrics response_metrics_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_metrics
    ADD CONSTRAINT response_metrics_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: schools schools_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: schools schools_invite_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES public.invite_codes(id);


--
-- Name: schools schools_region_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_region_code_fkey FOREIGN KEY (region_code) REFERENCES public.regions(code);


--
-- Name: seed_progress seed_progress_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_progress
    ADD CONSTRAINT seed_progress_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: spike_events spike_events_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spike_events
    ADD CONSTRAINT spike_events_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: spike_events spike_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spike_events
    ADD CONSTRAINT spike_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: teacher_commissions teacher_commissions_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_commissions
    ADD CONSTRAINT teacher_commissions_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE CASCADE;


--
-- Name: teacher_referrals teacher_referrals_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_referrals
    ADD CONSTRAINT teacher_referrals_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: teacher_referrals teacher_referrals_student_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_referrals
    ADD CONSTRAINT teacher_referrals_student_learner_id_fkey FOREIGN KEY (student_learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: teacher_referrals teacher_referrals_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_referrals
    ADD CONSTRAINT teacher_referrals_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;


--
-- Name: teachers teachers_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: teachers teachers_own_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_own_subscription_id_fkey FOREIGN KEY (own_subscription_id) REFERENCES public.subscriptions(id) ON DELETE SET NULL;


--
-- Name: try_link_visits try_link_visits_try_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.try_link_visits
    ADD CONSTRAINT try_link_visits_try_link_id_fkey FOREIGN KEY (try_link_id) REFERENCES public.try_links(id) ON DELETE CASCADE;


--
-- Name: try_links try_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.try_links
    ADD CONSTRAINT try_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: user_entitlements user_entitlements_entitlement_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_entitlements
    ADD CONSTRAINT user_entitlements_entitlement_code_id_fkey FOREIGN KEY (entitlement_code_id) REFERENCES public.entitlement_codes(id);


--
-- Name: user_entitlements user_entitlements_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_entitlements
    ADD CONSTRAINT user_entitlements_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(id) ON DELETE CASCADE;


--
-- Name: course_enrollments Admins can read all course_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all course_enrollments" ON public.course_enrollments FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learner_l1_state Admins can read all learner_l1_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all learner_l1_state" ON public.learner_l1_state FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learner_lego_metrics Admins can read all learner_lego_metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all learner_lego_metrics" ON public.learner_lego_metrics FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learner_pod_state Admins can read all learner_pod_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all learner_pod_state" ON public.learner_pod_state FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learner_speaking_opportunities Admins can read all learner_speaking_opportunities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all learner_speaking_opportunities" ON public.learner_speaking_opportunities FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learners Admins can read all learners; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all learners" ON public.learners FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: lego_progress Admins can read all lego_progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all lego_progress" ON public.lego_progress FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: learner_meta_commentary_state Admins can read all meta commentary state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all meta commentary state" ON public.learner_meta_commentary_state FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: seed_progress Admins can read all seed_progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all seed_progress" ON public.seed_progress FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: sessions Admins can read all sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all sessions" ON public.sessions FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: course_legos Anon can read course_legos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read course_legos" ON public.course_legos FOR SELECT TO anon USING (true);


--
-- Name: course_practice_phrases Anon can read course_practice_phrases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read course_practice_phrases" ON public.course_practice_phrases FOR SELECT TO anon USING (true);


--
-- Name: courses Anon can read courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read courses" ON public.courses FOR SELECT TO anon USING ((status = ANY (ARRAY['beta'::text, 'released'::text])));


--
-- Name: shared_audio Anon can read shared_audio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anon can read shared_audio" ON public.shared_audio FOR SELECT TO anon USING (true);


--
-- Name: algorithm_config Anyone can read algorithm_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read algorithm_config" ON public.algorithm_config FOR SELECT USING (true);


--
-- Name: evolution_levels Anyone can view evolution levels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view evolution levels" ON public.evolution_levels FOR SELECT TO authenticated USING (true);


--
-- Name: regions Anyone can view regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view regions" ON public.regions FOR SELECT USING (true);


--
-- Name: gamification_config Authenticated can view config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can view config" ON public.gamification_config FOR SELECT TO authenticated USING (true);


--
-- Name: courses Authenticated users can view all courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view all courses" ON public.courses FOR SELECT TO authenticated USING ((new_app_status = ANY (ARRAY['live'::text, 'beta'::text])));


--
-- Name: course_legos Authenticated users can view course_legos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view course_legos" ON public.course_legos FOR SELECT TO authenticated USING (true);


--
-- Name: course_practice_phrases Authenticated users can view course_practice_phrases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view course_practice_phrases" ON public.course_practice_phrases FOR SELECT TO authenticated USING (true);


--
-- Name: course_seeds Authenticated users can view course_seeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view course_seeds" ON public.course_seeds FOR SELECT TO authenticated USING (true);


--
-- Name: courses Authenticated users can view visible courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can view visible courses" ON public.courses FOR SELECT TO authenticated USING ((visibility = ANY (ARRAY['public'::text, 'beta'::text])));


--
-- Name: classes God users can read all classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can read all classes" ON public.classes FOR SELECT TO authenticated USING (public.is_god_user());


--
-- Name: govt_admins God users can read all govt_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can read all govt_admins" ON public.govt_admins FOR SELECT TO authenticated USING (public.is_god_user());


--
-- Name: invite_codes God users can read all invite_codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can read all invite_codes" ON public.invite_codes FOR SELECT TO authenticated USING (public.is_god_user());


--
-- Name: schools God users can read all schools; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can read all schools" ON public.schools FOR SELECT TO authenticated USING (public.is_god_user());


--
-- Name: insight_discoveries God users can read insight_discoveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can read insight_discoveries" ON public.insight_discoveries FOR SELECT TO authenticated USING (public.is_god_user());


--
-- Name: classes God users can write all classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can write all classes" ON public.classes TO authenticated USING (public.is_god_user()) WITH CHECK (public.is_god_user());


--
-- Name: govt_admins God users can write all govt_admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can write all govt_admins" ON public.govt_admins TO authenticated USING (public.is_god_user()) WITH CHECK (public.is_god_user());


--
-- Name: schools God users can write all schools; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users can write all schools" ON public.schools TO authenticated USING (public.is_god_user()) WITH CHECK (public.is_god_user());


--
-- Name: user_entitlements God users manage all entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users manage all entitlements" ON public.user_entitlements USING (public.is_god_user());


--
-- Name: entitlement_codes God users manage entitlement codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "God users manage entitlement codes" ON public.entitlement_codes USING (public.is_god_user());


--
-- Name: invite_codes Govt admins can create school_admin codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Govt admins can create school_admin codes" ON public.invite_codes FOR INSERT WITH CHECK (((code_type = 'school_admin'::text) AND (EXISTS ( SELECT 1
   FROM public.govt_admins
  WHERE (govt_admins.user_id = (auth.jwt() ->> 'sub'::text))))));


--
-- Name: courses Public users can view all courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public users can view all courses" ON public.courses FOR SELECT TO anon USING ((new_app_status = ANY (ARRAY['live'::text, 'beta'::text])));


--
-- Name: course_legos Public users can view course_legos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public users can view course_legos" ON public.course_legos FOR SELECT TO anon USING (true);


--
-- Name: POLICY "Public users can view course_legos" ON course_legos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Public users can view course_legos" ON public.course_legos IS 'Allow guest users to read LEGO content';


--
-- Name: course_practice_phrases Public users can view course_practice_phrases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public users can view course_practice_phrases" ON public.course_practice_phrases FOR SELECT TO anon USING (true);


--
-- Name: POLICY "Public users can view course_practice_phrases" ON course_practice_phrases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Public users can view course_practice_phrases" ON public.course_practice_phrases IS 'Allow guest users to read practice phrases';


--
-- Name: course_seeds Public users can view course_seeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public users can view course_seeds" ON public.course_seeds FOR SELECT TO anon USING (true);


--
-- Name: POLICY "Public users can view course_seeds" ON course_seeds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Public users can view course_seeds" ON public.course_seeds IS 'Allow guest users to read course content';


--
-- Name: courses Public users can view visible courses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public users can view visible courses" ON public.courses FOR SELECT TO anon USING ((visibility = ANY (ARRAY['public'::text, 'beta'::text])));


--
-- Name: invite_codes SSi admins can create govt_admin codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "SSi admins can create govt_admin codes" ON public.invite_codes FOR INSERT WITH CHECK (((code_type = 'govt_admin'::text) AND (EXISTS ( SELECT 1
   FROM public.learners
  WHERE ((learners.user_id = (auth.jwt() ->> 'sub'::text)) AND (learners.platform_role = 'ssi_admin'::text))))));


--
-- Name: regions SSi admins can manage regions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "SSi admins can manage regions" ON public.regions TO authenticated USING (public.is_ssi_admin()) WITH CHECK (public.is_ssi_admin());


--
-- Name: invite_codes SSi admins can view all codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "SSi admins can view all codes" ON public.invite_codes FOR SELECT TO authenticated USING (public.is_ssi_admin());


--
-- Name: invite_codes School admins can create teacher codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "School admins can create teacher codes" ON public.invite_codes FOR INSERT WITH CHECK (((code_type = 'teacher'::text) AND (EXISTS ( SELECT 1
   FROM public.schools
  WHERE ((schools.admin_user_id = (auth.jwt() ->> 'sub'::text)) AND (schools.id = invite_codes.grants_school_id))))));


--
-- Name: gamification_config Service role can manage config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage config" ON public.gamification_config TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_legos Service role can manage course_legos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage course_legos" ON public.course_legos TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_practice_phrases Service role can manage course_practice_phrases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage course_practice_phrases" ON public.course_practice_phrases TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_seeds Service role can manage course_seeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage course_seeds" ON public.course_seeds TO service_role USING (true) WITH CHECK (true);


--
-- Name: algorithm_config Service role can write algorithm_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can write algorithm_config" ON public.algorithm_config TO service_role USING ((( SELECT auth.role() AS role) = 'service_role'::text));


--
-- Name: invite_codes Teachers can create student codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Teachers can create student codes" ON public.invite_codes FOR INSERT WITH CHECK (((code_type = 'student'::text) AND (EXISTS ( SELECT 1
   FROM public.classes
  WHERE ((classes.teacher_user_id = (auth.jwt() ->> 'sub'::text)) AND (classes.id = invite_codes.grants_class_id))))));


--
-- Name: learner_l1_state Users can delete own l1 state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own l1 state" ON public.learner_l1_state FOR DELETE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_metrics Users can delete own lego metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own lego metrics" ON public.learner_lego_metrics FOR DELETE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_pairings Users can delete own lego pairings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own lego pairings" ON public.learner_lego_pairings FOR DELETE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_pod_state Users can delete own pod state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own pod state" ON public.learner_pod_state FOR DELETE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_l1_state Users can insert own l1 state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own l1 state" ON public.learner_l1_state FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_metrics Users can insert own lego metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own lego metrics" ON public.learner_lego_metrics FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_pairings Users can insert own lego pairings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own lego pairings" ON public.learner_lego_pairings FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_meta_commentary_state Users can insert own meta commentary state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own meta commentary state" ON public.learner_meta_commentary_state FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_pod_state Users can insert own pod state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own pod state" ON public.learner_pod_state FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_speaking_opportunities Users can insert own speaking opportunities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own speaking opportunities" ON public.learner_speaking_opportunities FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_l1_state Users can update own l1 state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own l1 state" ON public.learner_l1_state FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_metrics Users can update own lego metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own lego metrics" ON public.learner_lego_metrics FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_pairings Users can update own lego pairings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own lego pairings" ON public.learner_lego_pairings FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_meta_commentary_state Users can update own meta commentary state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own meta commentary state" ON public.learner_meta_commentary_state FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_pod_state Users can update own pod state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own pod state" ON public.learner_pod_state FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_speaking_opportunities Users can update own speaking opportunities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own speaking opportunities" ON public.learner_speaking_opportunities FOR UPDATE USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: invite_codes Users can view codes they created; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view codes they created" ON public.invite_codes FOR SELECT TO authenticated USING ((created_by = (auth.uid())::text));


--
-- Name: learner_l1_state Users can view own l1 state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own l1 state" ON public.learner_l1_state FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_metrics Users can view own lego metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own lego metrics" ON public.learner_lego_metrics FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_lego_pairings Users can view own lego pairings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own lego pairings" ON public.learner_lego_pairings FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_meta_commentary_state Users can view own meta commentary state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own meta commentary state" ON public.learner_meta_commentary_state FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_pod_state Users can view own pod state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own pod state" ON public.learner_pod_state FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: learner_speaking_opportunities Users can view own speaking opportunities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own speaking opportunities" ON public.learner_speaking_opportunities FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: subscriptions Users can view own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: user_entitlements Users read own entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own entitlements" ON public.user_entitlements FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: algorithm_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.algorithm_config ENABLE ROW LEVEL SECURITY;

--
-- Name: course_audio anon_read_course_audio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_course_audio ON public.course_audio FOR SELECT TO anon USING (true);


--
-- Name: course_audio_envelope anon_read_course_audio_envelope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_read_course_audio_envelope ON public.course_audio_envelope FOR SELECT TO anon USING (true);


--
-- Name: apml_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.apml_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: app_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

--
-- Name: audio_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audio_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: audio_flags audio_flags_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audio_flags_public_read ON public.audio_flags FOR SELECT TO authenticated, anon USING (true);


--
-- Name: course_audio authenticated_read_course_audio; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_course_audio ON public.course_audio FOR SELECT TO authenticated USING (true);


--
-- Name: course_audio_envelope authenticated_read_course_audio_envelope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_course_audio_envelope ON public.course_audio_envelope FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_users authenticated_read_own_dashboard_user; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_own_dashboard_user ON public.dashboard_users FOR SELECT TO authenticated USING ((email = (auth.jwt() ->> 'email'::text)));


--
-- Name: board_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: build_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.build_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: build_lessons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.build_lessons ENABLE ROW LEVEL SECURITY;

--
-- Name: canonical_pod_scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canonical_pod_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: checkpoint_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkpoint_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: class_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: class_sessions class_sessions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_sessions_read ON public.class_sessions FOR SELECT TO authenticated USING (((teacher_user_id = (auth.uid())::text) OR public.is_god_user() OR (EXISTS ( SELECT 1
   FROM public.classes c
  WHERE ((c.id = class_sessions.class_id) AND ((c.teacher_user_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
           FROM public.schools s
          WHERE ((s.id = c.school_id) AND (s.admin_user_id = (auth.uid())::text))))))))));


--
-- Name: class_sessions class_sessions_teacher_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_sessions_teacher_insert ON public.class_sessions FOR INSERT TO authenticated WITH CHECK ((teacher_user_id = (auth.uid())::text));


--
-- Name: class_sessions class_sessions_teacher_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_sessions_teacher_update ON public.class_sessions FOR UPDATE TO authenticated USING ((teacher_user_id = (auth.uid())::text)) WITH CHECK ((teacher_user_id = (auth.uid())::text));


--
-- Name: classes classes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_insert ON public.classes FOR INSERT WITH CHECK ((teacher_user_id = (auth.uid())::text));


--
-- Name: classes classes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_select ON public.classes FOR SELECT USING (((teacher_user_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM public.schools
  WHERE ((schools.id = classes.school_id) AND (schools.admin_user_id = (auth.uid())::text)))) OR (EXISTS ( SELECT 1
   FROM public.user_tags
  WHERE ((user_tags.user_id = (auth.uid())::text) AND (user_tags.tag_type = 'class'::text) AND (user_tags.tag_value = ('CLASS:'::text || (classes.id)::text)) AND (user_tags.removed_at IS NULL))))));


--
-- Name: classes classes_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY classes_update ON public.classes FOR UPDATE USING ((teacher_user_id = (auth.uid())::text)) WITH CHECK ((teacher_user_id = (auth.uid())::text));


--
-- Name: content_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: content_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: content_feedback content_feedback_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_feedback_public_insert ON public.content_feedback FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: content_feedback content_feedback_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_feedback_public_read ON public.content_feedback FOR SELECT TO authenticated, anon USING (true);


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: course_audio_envelope; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_audio_envelope ENABLE ROW LEVEL SECURITY;

--
-- Name: course_audio_envelope course_audio_envelope_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_audio_envelope_service_policy ON public.course_audio_envelope TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_audio course_audio_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_audio_service_policy ON public.course_audio TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_audio_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_audio_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: course_checkpoint_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_checkpoint_config ENABLE ROW LEVEL SECURITY;

--
-- Name: course_checkpoint_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_checkpoint_results ENABLE ROW LEVEL SECURITY;

--
-- Name: course_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: course_enrollments course_enrollments_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_enrollments_own_insert ON public.course_enrollments FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: course_enrollments course_enrollments_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_enrollments_own_update ON public.course_enrollments FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: course_enrollments course_enrollments_scoped_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_enrollments_scoped_select ON public.course_enrollments FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));


--
-- Name: course_export_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_export_states ENABLE ROW LEVEL SECURITY;

--
-- Name: course_gender_expansions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_gender_expansions ENABLE ROW LEVEL SECURITY;

--
-- Name: course_gender_expansions course_gender_expansions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY course_gender_expansions_public_read ON public.course_gender_expansions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: course_lego_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_lego_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: course_qa_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_qa_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: course_seed_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_seed_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: courses courses_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_delete_admin ON public.courses FOR DELETE USING (public.is_ssi_admin());


--
-- Name: courses courses_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_insert_admin ON public.courses FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: courses courses_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_read_policy ON public.courses FOR SELECT TO authenticated USING ((status = ANY (ARRAY['beta'::text, 'released'::text])));


--
-- Name: courses courses_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_select_public ON public.courses FOR SELECT USING (true);


--
-- Name: courses courses_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_service_policy ON public.courses TO service_role USING (true) WITH CHECK (true);


--
-- Name: courses courses_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY courses_update_admin ON public.courses FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: daily_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_contributions daily_contributions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_contributions_public_read ON public.daily_contributions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: dashboard_invite_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_invite_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_login_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_login_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY;

--
-- Name: demo_orgs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.demo_orgs ENABLE ROW LEVEL SECURITY;

--
-- Name: documentation_content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documentation_content ENABLE ROW LEVEL SECURITY;

--
-- Name: documentation_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documentation_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: email_access_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlement_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlement_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlement_codes entitlement_codes_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlement_codes_admin_select ON public.entitlement_codes FOR SELECT USING (public.is_ssi_admin());


--
-- Name: entitlement_codes entitlement_codes_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlement_codes_delete_admin ON public.entitlement_codes FOR DELETE USING (public.is_ssi_admin());


--
-- Name: entitlement_codes entitlement_codes_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlement_codes_insert_admin ON public.entitlement_codes FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: entitlement_codes entitlement_codes_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlement_codes_update_admin ON public.entitlement_codes FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: evolution_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evolution_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: family_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

--
-- Name: gamification_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gamification_config ENABLE ROW LEVEL SECURITY;

--
-- Name: govt_admins govt_admins_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY govt_admins_insert ON public.govt_admins FOR INSERT WITH CHECK ((user_id = (auth.uid())::text));


--
-- Name: govt_admins govt_admins_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY govt_admins_select ON public.govt_admins FOR SELECT USING ((user_id = (auth.uid())::text));


--
-- Name: insight_discoveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.insight_discoveries ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_codes invite_codes_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invite_codes_insert ON public.invite_codes FOR INSERT WITH CHECK ((created_by = (auth.uid())::text));


--
-- Name: invite_codes invite_codes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invite_codes_select ON public.invite_codes FOR SELECT USING (true);


--
-- Name: language_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.language_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: language_pair_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.language_pair_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_l1_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_l1_state ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_lego_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_lego_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_lego_pairings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_lego_pairings ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_meta_commentary_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_meta_commentary_state ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_milestones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_milestones ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_milestones learner_milestones_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_milestones_own_insert ON public.learner_milestones FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_milestones learner_milestones_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_milestones_own_select ON public.learner_milestones FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: learner_milestones learner_milestones_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_milestones_own_update ON public.learner_milestones FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_pod_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_pod_state ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_points ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_points learner_points_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_points_own_insert ON public.learner_points FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_points learner_points_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_points_own_select ON public.learner_points FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: learner_points learner_points_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_points_own_update ON public.learner_points FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_practice_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_practice_history ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_practice_history learner_practice_history_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_practice_history_own_insert ON public.learner_practice_history FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_practice_history learner_practice_history_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_practice_history_own_select ON public.learner_practice_history FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: learner_practice_history learner_practice_history_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_practice_history_own_update ON public.learner_practice_history FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: learner_speaking_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_speaking_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: learners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;

--
-- Name: learners learners_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learners_delete_own ON public.learners FOR DELETE TO authenticated USING ((user_id = (auth.uid())::text));


--
-- Name: learners learners_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learners_insert_self ON public.learners FOR INSERT TO authenticated WITH CHECK ((user_id = (auth.uid())::text));


--
-- Name: learners learners_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learners_select ON public.learners FOR SELECT TO authenticated USING (((user_id = (auth.uid())::text) OR public.can_view_learner_data(id)));


--
-- Name: learners learners_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learners_update_own ON public.learners FOR UPDATE TO authenticated USING ((user_id = (auth.uid())::text)) WITH CHECK ((user_id = (auth.uid())::text));


--
-- Name: lego_introductions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lego_introductions ENABLE ROW LEVEL SECURITY;

--
-- Name: lego_introductions lego_introductions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lego_introductions_public_read ON public.lego_introductions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: lego_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lego_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: lego_progress lego_progress_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lego_progress_own_insert ON public.lego_progress FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: lego_progress lego_progress_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lego_progress_own_update ON public.lego_progress FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: lego_progress lego_progress_scoped_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lego_progress_scoped_select ON public.lego_progress FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));


--
-- Name: offline_leases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.offline_leases ENABLE ROW LEVEL SECURITY;

--
-- Name: offline_leases offline_leases_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY offline_leases_owner_select ON public.offline_leases FOR SELECT USING ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: onboarding_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: orchestrator_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orchestrator_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: orchestrator_messages orchestrator_messages_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orchestrator_messages_public_read ON public.orchestrator_messages FOR SELECT TO authenticated, anon USING (true);


--
-- Name: phase_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phase_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: phase_prompts phase_prompts_anon_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phase_prompts_anon_read_policy ON public.phase_prompts FOR SELECT TO anon USING ((is_active = true));


--
-- Name: phase_prompts phase_prompts_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phase_prompts_read_policy ON public.phase_prompts FOR SELECT TO authenticated USING (true);


--
-- Name: phase_prompts phase_prompts_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phase_prompts_service_policy ON public.phase_prompts TO service_role USING (true) WITH CHECK (true);


--
-- Name: player_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.player_events ENABLE ROW LEVEL SECURITY;

--
-- Name: possession_mint_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.possession_mint_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_prompts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_prompts ENABLE ROW LEVEL SECURITY;

--
-- Name: presentation_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.presentation_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: raw_seed_uploads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raw_seed_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: recording_provenance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recording_provenance ENABLE ROW LEVEL SECURITY;

--
-- Name: regions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

--
-- Name: release_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: release_notes release_notes_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY release_notes_delete_admin ON public.release_notes FOR DELETE USING (public.is_ssi_admin());


--
-- Name: release_notes release_notes_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY release_notes_insert_admin ON public.release_notes FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: release_notes release_notes_select_published_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY release_notes_select_published_or_admin ON public.release_notes FOR SELECT USING ((is_published OR public.is_ssi_admin()));


--
-- Name: release_notes release_notes_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY release_notes_update_admin ON public.release_notes FOR UPDATE USING (public.is_ssi_admin()) WITH CHECK (public.is_ssi_admin());


--
-- Name: response_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.response_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: response_metrics response_metrics_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY response_metrics_own_insert ON public.response_metrics FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: response_metrics response_metrics_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY response_metrics_own_select ON public.response_metrics FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: response_metrics response_metrics_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY response_metrics_own_update ON public.response_metrics FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: role_change_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: role_change_audit role_change_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_change_audit_admin_read ON public.role_change_audit FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.learners l
  WHERE ((l.user_id = (auth.uid())::text) AND ((l.platform_role = 'ssi_admin'::text) OR (l.educational_role = 'god'::text))))));


--
-- Name: sample_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sample_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: sample_flags sample_flags_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sample_flags_public_insert ON public.sample_flags FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: sample_flags sample_flags_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sample_flags_public_read ON public.sample_flags FOR SELECT TO authenticated, anon USING (true);


--
-- Name: sample_flags sample_flags_public_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sample_flags_public_update ON public.sample_flags FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: schools schools_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_insert ON public.schools FOR INSERT WITH CHECK ((admin_user_id = (auth.uid())::text));


--
-- Name: schools schools_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_select ON public.schools FOR SELECT USING (((admin_user_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM public.user_tags
  WHERE ((user_tags.user_id = (auth.uid())::text) AND (user_tags.tag_type = 'school'::text) AND (user_tags.tag_value = ('SCHOOL:'::text || (schools.id)::text)) AND (user_tags.removed_at IS NULL))))));


--
-- Name: schools schools_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_update ON public.schools FOR UPDATE USING ((admin_user_id = (auth.uid())::text));


--
-- Name: seed_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.seed_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: seed_progress seed_progress_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_progress_own_insert ON public.seed_progress FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: seed_progress seed_progress_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_progress_own_update ON public.seed_progress FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: seed_progress seed_progress_scoped_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_progress_scoped_select ON public.seed_progress FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));


--
-- Name: dashboard_login_codes service_role_all_dashboard_login_codes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_dashboard_login_codes ON public.dashboard_login_codes TO service_role USING (true) WITH CHECK (true);


--
-- Name: dashboard_sessions service_role_all_dashboard_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_dashboard_sessions ON public.dashboard_sessions TO service_role USING (true) WITH CHECK (true);


--
-- Name: dashboard_users service_role_all_dashboard_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all_dashboard_users ON public.dashboard_users TO service_role USING (true) WITH CHECK (true);


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions sessions_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_own_insert ON public.sessions FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: sessions sessions_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_own_update ON public.sessions FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: sessions sessions_scoped_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_scoped_select ON public.sessions FOR SELECT TO authenticated USING (public.can_view_learner_data(learner_id));


--
-- Name: shared_audio shared_audio_read_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shared_audio_read_policy ON public.shared_audio FOR SELECT TO authenticated USING (true);


--
-- Name: shared_audio shared_audio_service_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shared_audio_service_policy ON public.shared_audio TO service_role USING (true) WITH CHECK (true);


--
-- Name: spike_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spike_events ENABLE ROW LEVEL SECURITY;

--
-- Name: spike_events spike_events_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spike_events_own_insert ON public.spike_events FOR INSERT TO authenticated WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: spike_events spike_events_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spike_events_own_select ON public.spike_events FOR SELECT TO authenticated USING ((learner_id = public.current_learner_id()));


--
-- Name: spike_events spike_events_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY spike_events_own_update ON public.spike_events FOR UPDATE TO authenticated USING ((learner_id = public.current_learner_id())) WITH CHECK ((learner_id = public.current_learner_id()));


--
-- Name: content_audit_log ssi_admin reads content_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ssi_admin reads content_audit_log" ON public.content_audit_log FOR SELECT USING (public.is_ssi_admin());


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_admin_select ON public.subscriptions FOR SELECT USING (public.is_ssi_admin());


--
-- Name: subscriptions subscriptions_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_delete_admin ON public.subscriptions FOR DELETE USING (public.is_ssi_admin());


--
-- Name: subscriptions subscriptions_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_update_admin ON public.subscriptions FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: target_audio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_audio ENABLE ROW LEVEL SECURITY;

--
-- Name: target_legos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_legos ENABLE ROW LEVEL SECURITY;

--
-- Name: target_phrases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_phrases ENABLE ROW LEVEL SECURITY;

--
-- Name: target_seed_texts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_seed_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_commissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_commissions ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_commissions teacher_commissions_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_commissions_delete_admin ON public.teacher_commissions FOR DELETE USING (public.is_ssi_admin());


--
-- Name: teacher_commissions teacher_commissions_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_commissions_insert_admin ON public.teacher_commissions FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: teacher_commissions teacher_commissions_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_commissions_select_own_or_admin ON public.teacher_commissions FOR SELECT USING (((teacher_id IN ( SELECT t.id
   FROM (public.teachers t
     JOIN public.learners l ON ((l.id = t.learner_id)))
  WHERE (l.user_id = (auth.uid())::text))) OR public.is_ssi_admin()));


--
-- Name: teacher_commissions teacher_commissions_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_commissions_update_admin ON public.teacher_commissions FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: teacher_referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_referrals teacher_referrals_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_referrals_delete_admin ON public.teacher_referrals FOR DELETE USING (public.is_ssi_admin());


--
-- Name: teacher_referrals teacher_referrals_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_referrals_insert_admin ON public.teacher_referrals FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: teacher_referrals teacher_referrals_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_referrals_select_own_or_admin ON public.teacher_referrals FOR SELECT USING (((class_id IN ( SELECT classes.id
   FROM public.classes
  WHERE (classes.teacher_user_id = (auth.uid())::text))) OR public.is_ssi_admin()));


--
-- Name: teacher_referrals teacher_referrals_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_referrals_update_admin ON public.teacher_referrals FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: teachers teachers_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_delete_admin ON public.teachers FOR DELETE USING (public.is_ssi_admin());


--
-- Name: teachers teachers_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_insert_own ON public.teachers FOR INSERT WITH CHECK ((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))));


--
-- Name: teachers teachers_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_select_own_or_admin ON public.teachers FOR SELECT USING (((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))) OR public.is_ssi_admin()));


--
-- Name: teachers teachers_update_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teachers_update_own_or_admin ON public.teachers FOR UPDATE USING (((learner_id IN ( SELECT learners.id
   FROM public.learners
  WHERE (learners.user_id = (auth.uid())::text))) OR public.is_ssi_admin()));


--
-- Name: tester_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tester_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: tester_feedback tester_feedback_public_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tester_feedback_public_insert ON public.tester_feedback FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: trial_burns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trial_burns ENABLE ROW LEVEL SECURITY;

--
-- Name: try_link_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.try_link_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: try_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.try_links ENABLE ROW LEVEL SECURITY;

--
-- Name: user_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: user_entitlements user_entitlements_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_entitlements_delete_admin ON public.user_entitlements FOR DELETE USING (public.is_ssi_admin());


--
-- Name: user_entitlements user_entitlements_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_entitlements_insert_admin ON public.user_entitlements FOR INSERT WITH CHECK (public.is_ssi_admin());


--
-- Name: user_entitlements user_entitlements_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_entitlements_select_own_or_admin ON public.user_entitlements FOR SELECT TO authenticated USING (((learner_id = public.current_learner_id()) OR public.is_ssi_admin()));


--
-- Name: user_entitlements user_entitlements_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_entitlements_update_admin ON public.user_entitlements FOR UPDATE USING (public.is_ssi_admin());


--
-- Name: user_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: user_tags user_tags_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_tags_insert ON public.user_tags FOR INSERT TO authenticated WITH CHECK ((public.is_god_user() OR ((user_id = (auth.uid())::text) AND (role_in_context IS DISTINCT FROM 'teacher'::text) AND (role_in_context IS DISTINCT FROM 'admin'::text))));


--
-- Name: user_tags user_tags_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_tags_select ON public.user_tags FOR SELECT TO authenticated USING (((user_id = (auth.uid())::text) OR public.is_god_user() OR (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (auth.uid())::text)))) OR (EXISTS ( SELECT 1
   FROM (public.classes c
     LEFT JOIN public.schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (auth.uid())::text) OR (s2.admin_user_id = (auth.uid())::text)))))));


--
-- Name: user_tags user_tags_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_tags_update ON public.user_tags FOR UPDATE TO authenticated USING (((user_id = (auth.uid())::text) OR public.is_god_user() OR (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (auth.uid())::text)))) OR (EXISTS ( SELECT 1
   FROM (public.classes c
     LEFT JOIN public.schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (auth.uid())::text) OR (s2.admin_user_id = (auth.uid())::text))))))) WITH CHECK ((public.is_god_user() OR ((user_id = (auth.uid())::text) AND (role_in_context IS DISTINCT FROM 'teacher'::text) AND (role_in_context IS DISTINCT FROM 'admin'::text)) OR (EXISTS ( SELECT 1
   FROM public.schools s
  WHERE ((user_tags.tag_value = ('SCHOOL:'::text || (s.id)::text)) AND (s.admin_user_id = (auth.uid())::text)))) OR (EXISTS ( SELECT 1
   FROM (public.classes c
     LEFT JOIN public.schools s2 ON ((s2.id = c.school_id)))
  WHERE ((user_tags.tag_value = ('CLASS:'::text || (c.id)::text)) AND ((c.teacher_user_id = (auth.uid())::text) OR (s2.admin_user_id = (auth.uid())::text)))))));


--
-- Name: voices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _seed_to_belt(seed_count numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._seed_to_belt(seed_count numeric) TO anon;
GRANT ALL ON FUNCTION public._seed_to_belt(seed_count numeric) TO authenticated;
GRANT ALL ON FUNCTION public._seed_to_belt(seed_count numeric) TO service_role;


--
-- Name: FUNCTION accrue_teacher_commission(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accrue_teacher_commission(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accrue_teacher_commission(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer) TO service_role;


--
-- Name: FUNCTION accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.accrue_teacher_commission_held(p_teacher_id uuid, p_period_start date, p_period_end date, p_pence integer, p_hold_until timestamp with time zone) TO service_role;


--
-- Name: FUNCTION activate_brief_version(p_known_code text, p_target_code text, p_version text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activate_brief_version(p_known_code text, p_target_code text, p_version text) TO anon;
GRANT ALL ON FUNCTION public.activate_brief_version(p_known_code text, p_target_code text, p_version text) TO authenticated;
GRANT ALL ON FUNCTION public.activate_brief_version(p_known_code text, p_target_code text, p_version text) TO service_role;


--
-- Name: FUNCTION activate_prompt_version(p_phase_code text, p_version text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activate_prompt_version(p_phase_code text, p_version text) TO anon;
GRANT ALL ON FUNCTION public.activate_prompt_version(p_phase_code text, p_version text) TO authenticated;
GRANT ALL ON FUNCTION public.activate_prompt_version(p_phase_code text, p_version text) TO service_role;


--
-- Name: FUNCTION admin_practice_minutes(p_learner_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_practice_minutes(p_learner_ids uuid[]) TO service_role;


--
-- Name: FUNCTION admin_practice_minutes_by_course(p_learner_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_practice_minutes_by_course(p_learner_ids uuid[]) TO service_role;


--
-- Name: FUNCTION admin_user_course_stats(p_learner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_user_course_stats(p_learner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_user_course_stats(p_learner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_user_course_stats(p_learner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_course_stats(p_learner_id uuid) TO service_role;


--
-- Name: FUNCTION admin_user_navigation(p_learner_id uuid, p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_user_navigation(p_learner_id uuid, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_user_navigation(p_learner_id uuid, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.admin_user_navigation(p_learner_id uuid, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_user_navigation(p_learner_id uuid, p_days integer) TO service_role;


--
-- Name: FUNCTION analytics_class_coverage(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_class_coverage(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_class_coverage(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_class_coverage(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_class_coverage(p_days integer) TO service_role;


--
-- Name: FUNCTION analytics_class_sessions_scoped(p_class_ids uuid[], p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(p_class_ids uuid[], p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_class_sessions_scoped(p_class_ids uuid[], p_days integer) TO service_role;


--
-- Name: FUNCTION analytics_course_comparison(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_course_comparison() TO anon;
GRANT ALL ON FUNCTION public.analytics_course_comparison() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_course_comparison() TO service_role;


--
-- Name: FUNCTION analytics_course_value(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_course_value() TO anon;
GRANT ALL ON FUNCTION public.analytics_course_value() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_course_value() TO service_role;


--
-- Name: FUNCTION analytics_difficulty_turns(p_days integer, p_min_samples integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_difficulty_turns(p_days integer, p_min_samples integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_difficulty_turns(p_days integer, p_min_samples integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_difficulty_turns(p_days integer, p_min_samples integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_difficulty_turns(p_days integer, p_min_samples integer) TO service_role;


--
-- Name: FUNCTION analytics_engagement(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_engagement() TO anon;
GRANT ALL ON FUNCTION public.analytics_engagement() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_engagement() TO service_role;


--
-- Name: FUNCTION analytics_entitlement_funnel(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_entitlement_funnel() TO anon;
GRANT ALL ON FUNCTION public.analytics_entitlement_funnel() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_entitlement_funnel() TO service_role;


--
-- Name: FUNCTION analytics_friction_extended(p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_friction_extended(p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.analytics_friction_extended(p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_friction_extended(p_course_id text) TO service_role;


--
-- Name: FUNCTION analytics_friction_map(p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_friction_map(p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.analytics_friction_map(p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_friction_map(p_course_id text) TO service_role;


--
-- Name: FUNCTION analytics_growth(p_period text, p_count integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_growth(p_period text, p_count integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_growth(p_period text, p_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_growth(p_period text, p_count integer) TO service_role;


--
-- Name: FUNCTION analytics_health(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_health(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_health(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_health(p_days integer) TO service_role;


--
-- Name: FUNCTION analytics_learner_progress_rate(p_learner_id uuid, p_course_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_learner_progress_rate(p_learner_id uuid, p_course_id text) TO service_role;


--
-- Name: FUNCTION analytics_overview(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_overview() TO anon;
GRANT ALL ON FUNCTION public.analytics_overview() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_overview() TO service_role;


--
-- Name: FUNCTION analytics_retention_cohorts(p_weeks integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_retention_cohorts(p_weeks integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_retention_cohorts(p_weeks integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_retention_cohorts(p_weeks integer) TO service_role;


--
-- Name: FUNCTION analytics_retention_days_active(p_weeks integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_retention_days_active(p_weeks integer) TO anon;
GRANT ALL ON FUNCTION public.analytics_retention_days_active(p_weeks integer) TO authenticated;
GRANT ALL ON FUNCTION public.analytics_retention_days_active(p_weeks integer) TO service_role;


--
-- Name: FUNCTION analytics_trial_conversion(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.analytics_trial_conversion() TO anon;
GRANT ALL ON FUNCTION public.analytics_trial_conversion() TO authenticated;
GRANT ALL ON FUNCTION public.analytics_trial_conversion() TO service_role;


--
-- Name: FUNCTION audio_normalize_text(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audio_normalize_text() TO anon;
GRANT ALL ON FUNCTION public.audio_normalize_text() TO authenticated;
GRANT ALL ON FUNCTION public.audio_normalize_text() TO service_role;


--
-- Name: FUNCTION audit_content_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_content_change() TO anon;
GRANT ALL ON FUNCTION public.audit_content_change() TO authenticated;
GRANT ALL ON FUNCTION public.audit_content_change() TO service_role;


--
-- Name: FUNCTION audit_log_prune(retention_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_log_prune(retention_days integer) TO anon;
GRANT ALL ON FUNCTION public.audit_log_prune(retention_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.audit_log_prune(retention_days integer) TO service_role;


--
-- Name: FUNCTION auto_entitle_popty_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.auto_entitle_popty_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.auto_entitle_popty_user() TO service_role;


--
-- Name: FUNCTION bulk_update_syllables(p_ids uuid[], p_syllables integer[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bulk_update_syllables(p_ids uuid[], p_syllables integer[]) TO anon;
GRANT ALL ON FUNCTION public.bulk_update_syllables(p_ids uuid[], p_syllables integer[]) TO authenticated;
GRANT ALL ON FUNCTION public.bulk_update_syllables(p_ids uuid[], p_syllables integer[]) TO service_role;


--
-- Name: FUNCTION bump_course_version(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bump_course_version() TO anon;
GRANT ALL ON FUNCTION public.bump_course_version() TO authenticated;
GRANT ALL ON FUNCTION public.bump_course_version() TO service_role;


--
-- Name: FUNCTION bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint) TO anon;
GRANT ALL ON FUNCTION public.bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint) TO authenticated;
GRANT ALL ON FUNCTION public.bump_speaking_opportunities(p_learner_id uuid, p_course_code text, p_opps_delta bigint, p_seconds_delta bigint) TO service_role;


--
-- Name: FUNCTION calculate_consistency_multiplier(sessions_10d integer, sessions_30d integer, p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calculate_consistency_multiplier(sessions_10d integer, sessions_30d integer, p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.calculate_consistency_multiplier(sessions_10d integer, sessions_30d integer, p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_consistency_multiplier(sessions_10d integer, sessions_30d integer, p_course_id text) TO service_role;


--
-- Name: FUNCTION can_view_learner_data(p_learner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_view_learner_data(p_learner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_view_learner_data(p_learner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_view_learner_data(p_learner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_view_learner_data(p_learner_id uuid) TO service_role;


--
-- Name: FUNCTION check_pass_1_complete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_pass_1_complete() TO anon;
GRANT ALL ON FUNCTION public.check_pass_1_complete() TO authenticated;
GRANT ALL ON FUNCTION public.check_pass_1_complete() TO service_role;


--
-- Name: FUNCTION claim_entitlement_code_use(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_entitlement_code_use(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_entitlement_code_use(p_id uuid) TO service_role;


--
-- Name: FUNCTION claim_invite_code_use(p_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_invite_code_use(p_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_invite_code_use(p_id uuid) TO service_role;


--
-- Name: FUNCTION claim_learner(p_learner_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_learner(p_learner_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_learner(p_learner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_learner(p_learner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_learner(p_learner_id uuid) TO service_role;


--
-- Name: FUNCTION compute_group_path(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.compute_group_path() TO anon;
GRANT ALL ON FUNCTION public.compute_group_path() TO authenticated;
GRANT ALL ON FUNCTION public.compute_group_path() TO service_role;


--
-- Name: FUNCTION course_navigation_friction(p_course_code text, p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.course_navigation_friction(p_course_code text, p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.course_navigation_friction(p_course_code text, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.course_navigation_friction(p_course_code text, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.course_navigation_friction(p_course_code text, p_days integer) TO service_role;


--
-- Name: FUNCTION current_learner_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_learner_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_learner_id() TO anon;
GRANT ALL ON FUNCTION public.current_learner_id() TO authenticated;
GRANT ALL ON FUNCTION public.current_learner_id() TO service_role;


--
-- Name: FUNCTION decrement_voice_sample_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.decrement_voice_sample_count() TO anon;
GRANT ALL ON FUNCTION public.decrement_voice_sample_count() TO authenticated;
GRANT ALL ON FUNCTION public.decrement_voice_sample_count() TO service_role;


--
-- Name: FUNCTION find_learner_by_email(lookup_email text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_learner_by_email(lookup_email text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_learner_by_email(lookup_email text) TO authenticated;
GRANT ALL ON FUNCTION public.find_learner_by_email(lookup_email text) TO service_role;


--
-- Name: FUNCTION find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_audio(p_content text, p_language text, p_voice_id text, p_cadence text) TO service_role;


--
-- Name: FUNCTION find_or_create_text(p_content text, p_language text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_text(p_content text, p_language text) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_text(p_content text, p_language text) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_text(p_content text, p_language text) TO service_role;


--
-- Name: FUNCTION generate_join_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_join_code() TO anon;
GRANT ALL ON FUNCTION public.generate_join_code() TO authenticated;
GRANT ALL ON FUNCTION public.generate_join_code() TO service_role;


--
-- Name: FUNCTION get_active_brief(p_known_code text, p_target_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_brief(p_known_code text, p_target_code text) TO anon;
GRANT ALL ON FUNCTION public.get_active_brief(p_known_code text, p_target_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_brief(p_known_code text, p_target_code text) TO service_role;


--
-- Name: FUNCTION get_active_prompt(p_phase_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_prompt(p_phase_code text) TO anon;
GRANT ALL ON FUNCTION public.get_active_prompt(p_phase_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_prompt(p_phase_code text) TO service_role;


--
-- Name: FUNCTION get_all_course_stats(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_all_course_stats() TO anon;
GRANT ALL ON FUNCTION public.get_all_course_stats() TO authenticated;
GRANT ALL ON FUNCTION public.get_all_course_stats() TO service_role;


--
-- Name: FUNCTION get_audio_counts(p_course_code text, p_release_target integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_audio_counts(p_course_code text, p_release_target integer) TO anon;
GRANT ALL ON FUNCTION public.get_audio_counts(p_course_code text, p_release_target integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_audio_counts(p_course_code text, p_release_target integer) TO service_role;


--
-- Name: FUNCTION get_available_prompts(p_course_code text, p_known_lego_ids text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_available_prompts(p_course_code text, p_known_lego_ids text[]) TO anon;
GRANT ALL ON FUNCTION public.get_available_prompts(p_course_code text, p_known_lego_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_available_prompts(p_course_code text, p_known_lego_ids text[]) TO service_role;


--
-- Name: FUNCTION get_cascade_courses(p_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_cascade_courses(p_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_cascade_courses(p_user_id text) TO service_role;


--
-- Name: FUNCTION get_community_contribution(p_target_lang text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_community_contribution(p_target_lang text) TO anon;
GRANT ALL ON FUNCTION public.get_community_contribution(p_target_lang text) TO authenticated;
GRANT ALL ON FUNCTION public.get_community_contribution(p_target_lang text) TO service_role;


--
-- Name: FUNCTION get_course_audio_summary(p_course_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_course_audio_summary(p_course_code text) TO anon;
GRANT ALL ON FUNCTION public.get_course_audio_summary(p_course_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_course_audio_summary(p_course_code text) TO service_role;


--
-- Name: FUNCTION get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_course_cycles_window(p_course_code text, p_from_lego_id text, p_round_limit integer) TO service_role;


--
-- Name: FUNCTION get_documentation(p_slug text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_documentation(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.get_documentation(p_slug text) TO authenticated;
GRANT ALL ON FUNCTION public.get_documentation(p_slug text) TO service_role;


--
-- Name: FUNCTION get_documentation_list(p_category text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_documentation_list(p_category text) TO anon;
GRANT ALL ON FUNCTION public.get_documentation_list(p_category text) TO authenticated;
GRANT ALL ON FUNCTION public.get_documentation_list(p_category text) TO service_role;


--
-- Name: FUNCTION get_evolution_level(score integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_evolution_level(score integer) TO anon;
GRANT ALL ON FUNCTION public.get_evolution_level(score integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_evolution_level(score integer) TO service_role;


--
-- Name: TABLE gamification_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gamification_config TO authenticated;
GRANT ALL ON TABLE public.gamification_config TO service_role;


--
-- Name: FUNCTION get_gamification_config(p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_gamification_config(p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.get_gamification_config(p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_gamification_config(p_course_id text) TO service_role;


--
-- Name: FUNCTION get_i_plus_one_prompts(p_course_code text, p_known_lego_ids text[], p_min_comprehensibility numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_i_plus_one_prompts(p_course_code text, p_known_lego_ids text[], p_min_comprehensibility numeric) TO anon;
GRANT ALL ON FUNCTION public.get_i_plus_one_prompts(p_course_code text, p_known_lego_ids text[], p_min_comprehensibility numeric) TO authenticated;
GRANT ALL ON FUNCTION public.get_i_plus_one_prompts(p_course_code text, p_known_lego_ids text[], p_min_comprehensibility numeric) TO service_role;


--
-- Name: TABLE insight_discoveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.insight_discoveries TO anon;
GRANT ALL ON TABLE public.insight_discoveries TO authenticated;
GRANT ALL ON TABLE public.insight_discoveries TO service_role;


--
-- Name: FUNCTION get_latest_insight_discovery(p_source text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_latest_insight_discovery(p_source text) TO anon;
GRANT ALL ON FUNCTION public.get_latest_insight_discovery(p_source text) TO authenticated;
GRANT ALL ON FUNCTION public.get_latest_insight_discovery(p_source text) TO service_role;


--
-- Name: FUNCTION get_missing_audio(p_course_code text, p_needed jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_missing_audio(p_course_code text, p_needed jsonb) TO anon;
GRANT ALL ON FUNCTION public.get_missing_audio(p_course_code text, p_needed jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.get_missing_audio(p_course_code text, p_needed jsonb) TO service_role;


--
-- Name: FUNCTION get_my_verified_emails(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_verified_emails() TO anon;
GRANT ALL ON FUNCTION public.get_my_verified_emails() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_verified_emails() TO service_role;


--
-- Name: FUNCTION get_pomodoro_message(minutes_elapsed integer, p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_pomodoro_message(minutes_elapsed integer, p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.get_pomodoro_message(minutes_elapsed integer, p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_pomodoro_message(minutes_elapsed integer, p_course_id text) TO service_role;


--
-- Name: FUNCTION get_qa_flags_by_type(p_course_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_qa_flags_by_type(p_course_code text) TO anon;
GRANT ALL ON FUNCTION public.get_qa_flags_by_type(p_course_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_qa_flags_by_type(p_course_code text) TO service_role;


--
-- Name: FUNCTION get_qa_summary(p_course_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_qa_summary(p_course_code text) TO anon;
GRANT ALL ON FUNCTION public.get_qa_summary(p_course_code text) TO authenticated;
GRANT ALL ON FUNCTION public.get_qa_summary(p_course_code text) TO service_role;


--
-- Name: FUNCTION get_return_message(days_away integer, p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_return_message(days_away integer, p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.get_return_message(days_away integer, p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.get_return_message(days_away integer, p_course_id text) TO service_role;


--
-- Name: FUNCTION get_staff_with_emails(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_staff_with_emails() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_staff_with_emails() TO authenticated;
GRANT ALL ON FUNCTION public.get_staff_with_emails() TO service_role;


--
-- Name: FUNCTION get_subtree_group_ids(p_group_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_subtree_group_ids(p_group_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_subtree_group_ids(p_group_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_subtree_group_ids(p_group_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION increment_version(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_version() TO anon;
GRANT ALL ON FUNCTION public.increment_version() TO authenticated;
GRANT ALL ON FUNCTION public.increment_version() TO service_role;


--
-- Name: FUNCTION increment_voice_sample_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_voice_sample_count() TO anon;
GRANT ALL ON FUNCTION public.increment_voice_sample_count() TO authenticated;
GRANT ALL ON FUNCTION public.increment_voice_sample_count() TO service_role;


--
-- Name: FUNCTION inherit_group_test_flags(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.inherit_group_test_flags() TO anon;
GRANT ALL ON FUNCTION public.inherit_group_test_flags() TO authenticated;
GRANT ALL ON FUNCTION public.inherit_group_test_flags() TO service_role;


--
-- Name: FUNCTION is_class_teacher(p_class_id uuid, p_uid text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) TO anon;
GRANT ALL ON FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) TO authenticated;
GRANT ALL ON FUNCTION public.is_class_teacher(p_class_id uuid, p_uid text) TO service_role;


--
-- Name: FUNCTION is_god_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_god_user() TO anon;
GRANT ALL ON FUNCTION public.is_god_user() TO authenticated;
GRANT ALL ON FUNCTION public.is_god_user() TO service_role;


--
-- Name: FUNCTION is_ssi_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_ssi_admin() TO anon;
GRANT ALL ON FUNCTION public.is_ssi_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_ssi_admin() TO service_role;


--
-- Name: FUNCTION learner_journey_stats(p_course_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.learner_journey_stats(p_course_id text) TO anon;
GRANT ALL ON FUNCTION public.learner_journey_stats(p_course_id text) TO authenticated;
GRANT ALL ON FUNCTION public.learner_journey_stats(p_course_id text) TO service_role;


--
-- Name: FUNCTION link_all_audio_ids(p_course_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.link_all_audio_ids(p_course_code text) TO anon;
GRANT ALL ON FUNCTION public.link_all_audio_ids(p_course_code text) TO authenticated;
GRANT ALL ON FUNCTION public.link_all_audio_ids(p_course_code text) TO service_role;


--
-- Name: FUNCTION link_audio_to_content(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.link_audio_to_content() TO anon;
GRANT ALL ON FUNCTION public.link_audio_to_content() TO authenticated;
GRANT ALL ON FUNCTION public.link_audio_to_content() TO service_role;


--
-- Name: FUNCTION normalize_text(input_text text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_text(input_text text) TO anon;
GRANT ALL ON FUNCTION public.normalize_text(input_text text) TO authenticated;
GRANT ALL ON FUNCTION public.normalize_text(input_text text) TO service_role;


--
-- Name: FUNCTION null_lego_audio_on_text_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.null_lego_audio_on_text_change() TO anon;
GRANT ALL ON FUNCTION public.null_lego_audio_on_text_change() TO authenticated;
GRANT ALL ON FUNCTION public.null_lego_audio_on_text_change() TO service_role;


--
-- Name: FUNCTION null_phrase_audio_on_text_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.null_phrase_audio_on_text_change() TO anon;
GRANT ALL ON FUNCTION public.null_phrase_audio_on_text_change() TO authenticated;
GRANT ALL ON FUNCTION public.null_phrase_audio_on_text_change() TO service_role;


--
-- Name: FUNCTION pull_audio_duration_on_link(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pull_audio_duration_on_link() TO anon;
GRANT ALL ON FUNCTION public.pull_audio_duration_on_link() TO authenticated;
GRANT ALL ON FUNCTION public.pull_audio_duration_on_link() TO service_role;


--
-- Name: FUNCTION ratchet_highest_completed_round(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ratchet_highest_completed_round() TO anon;
GRANT ALL ON FUNCTION public.ratchet_highest_completed_round() TO authenticated;
GRANT ALL ON FUNCTION public.ratchet_highest_completed_round() TO service_role;


--
-- Name: FUNCTION record_lego_pairings(_learner_id uuid, _course_code text, _pairs text[], _counts integer[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_lego_pairings(_learner_id uuid, _course_code text, _pairs text[], _counts integer[]) TO anon;
GRANT ALL ON FUNCTION public.record_lego_pairings(_learner_id uuid, _course_code text, _pairs text[], _counts integer[]) TO authenticated;
GRANT ALL ON FUNCTION public.record_lego_pairings(_learner_id uuid, _course_code text, _pairs text[], _counts integer[]) TO service_role;


--
-- Name: FUNCTION relink_user_tags(old_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.relink_user_tags(old_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.relink_user_tags(old_user_id text) TO anon;
GRANT ALL ON FUNCTION public.relink_user_tags(old_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.relink_user_tags(old_user_id text) TO service_role;


--
-- Name: FUNCTION reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer) TO anon;
GRANT ALL ON FUNCTION public.reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer) TO authenticated;
GRANT ALL ON FUNCTION public.reverse_teacher_commission(p_teacher_id uuid, p_period_start date, p_pence integer) TO service_role;


--
-- Name: FUNCTION rls_status(table_names text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rls_status(table_names text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_status(table_names text[]) TO service_role;


--
-- Name: FUNCTION set_beta_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_beta_timestamp() TO anon;
GRANT ALL ON FUNCTION public.set_beta_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.set_beta_timestamp() TO service_role;


--
-- Name: FUNCTION set_class_join_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_class_join_code() TO anon;
GRANT ALL ON FUNCTION public.set_class_join_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_class_join_code() TO service_role;


--
-- Name: FUNCTION set_school_join_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_school_join_code() TO anon;
GRANT ALL ON FUNCTION public.set_school_join_code() TO authenticated;
GRANT ALL ON FUNCTION public.set_school_join_code() TO service_role;


--
-- Name: FUNCTION sync_audio_duration_to_dependents(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_audio_duration_to_dependents() TO anon;
GRANT ALL ON FUNCTION public.sync_audio_duration_to_dependents() TO authenticated;
GRANT ALL ON FUNCTION public.sync_audio_duration_to_dependents() TO service_role;


--
-- Name: FUNCTION sync_learner_email_from_auth_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_learner_email_from_auth_user() TO anon;
GRANT ALL ON FUNCTION public.sync_learner_email_from_auth_user() TO authenticated;
GRANT ALL ON FUNCTION public.sync_learner_email_from_auth_user() TO service_role;


--
-- Name: FUNCTION sync_learner_email_from_identity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_learner_email_from_identity() TO anon;
GRANT ALL ON FUNCTION public.sync_learner_email_from_identity() TO authenticated;
GRANT ALL ON FUNCTION public.sync_learner_email_from_identity() TO service_role;


--
-- Name: FUNCTION sync_learner_emails_on_learner_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_learner_emails_on_learner_insert() TO anon;
GRANT ALL ON FUNCTION public.sync_learner_emails_on_learner_insert() TO authenticated;
GRANT ALL ON FUNCTION public.sync_learner_emails_on_learner_insert() TO service_role;


--
-- Name: FUNCTION test_learner_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.test_learner_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.test_learner_ids() TO anon;
GRANT ALL ON FUNCTION public.test_learner_ids() TO authenticated;
GRANT ALL ON FUNCTION public.test_learner_ids() TO service_role;


--
-- Name: FUNCTION tg_release_notes_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tg_release_notes_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.tg_release_notes_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.tg_release_notes_touch_updated_at() TO service_role;


--
-- Name: FUNCTION touch_canonical_pod_scenarios(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_canonical_pod_scenarios() TO anon;
GRANT ALL ON FUNCTION public.touch_canonical_pod_scenarios() TO authenticated;
GRANT ALL ON FUNCTION public.touch_canonical_pod_scenarios() TO service_role;


--
-- Name: FUNCTION touch_listening_pods_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_listening_pods_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_listening_pods_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_listening_pods_updated_at() TO service_role;


--
-- Name: FUNCTION update_daily_contributions(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_daily_contributions() TO anon;
GRANT ALL ON FUNCTION public.update_daily_contributions() TO authenticated;
GRANT ALL ON FUNCTION public.update_daily_contributions() TO service_role;


--
-- Name: FUNCTION update_language_briefs_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_language_briefs_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_language_briefs_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_language_briefs_updated_at() TO service_role;


--
-- Name: FUNCTION update_phase_prompts_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_phase_prompts_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_phase_prompts_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_phase_prompts_updated_at() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE algorithm_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.algorithm_config TO anon;
GRANT ALL ON TABLE public.algorithm_config TO authenticated;
GRANT ALL ON TABLE public.algorithm_config TO service_role;


--
-- Name: TABLE apml_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.apml_documents TO service_role;


--
-- Name: TABLE app_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_config TO authenticated;
GRANT ALL ON TABLE public.app_config TO service_role;


--
-- Name: TABLE audio_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audio_flags TO service_role;
GRANT SELECT ON TABLE public.audio_flags TO anon;
GRANT SELECT ON TABLE public.audio_flags TO authenticated;


--
-- Name: SEQUENCE audio_flags_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.audio_flags_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audio_flags_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audio_flags_id_seq TO service_role;


--
-- Name: TABLE audio_pass_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audio_pass_requests TO anon;
GRANT ALL ON TABLE public.audio_pass_requests TO authenticated;
GRANT ALL ON TABLE public.audio_pass_requests TO service_role;


--
-- Name: TABLE board_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.board_snapshots TO service_role;


--
-- Name: TABLE build_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.build_jobs TO service_role;


--
-- Name: TABLE build_lessons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.build_lessons TO service_role;


--
-- Name: TABLE canonical_pod_scenarios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.canonical_pod_scenarios TO anon;
GRANT ALL ON TABLE public.canonical_pod_scenarios TO authenticated;
GRANT ALL ON TABLE public.canonical_pod_scenarios TO service_role;


--
-- Name: TABLE canonical_seed_translations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.canonical_seed_translations TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.canonical_seed_translations TO authenticated;
GRANT ALL ON TABLE public.canonical_seed_translations TO service_role;


--
-- Name: TABLE canonical_seeds; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.canonical_seeds TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.canonical_seeds TO authenticated;
GRANT ALL ON TABLE public.canonical_seeds TO service_role;


--
-- Name: TABLE checkpoint_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checkpoint_approvals TO service_role;


--
-- Name: TABLE classes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,MAINTAIN,UPDATE ON TABLE public.classes TO authenticated;
GRANT ALL ON TABLE public.classes TO service_role;


--
-- Name: TABLE learners; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE public.learners TO authenticated;
GRANT ALL ON TABLE public.learners TO service_role;


--
-- Name: COLUMN learners.user_id; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(user_id) ON TABLE public.learners TO authenticated;


--
-- Name: COLUMN learners.display_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(display_name) ON TABLE public.learners TO authenticated;


--
-- Name: COLUMN learners.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.learners TO authenticated;


--
-- Name: COLUMN learners.preferences; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(preferences) ON TABLE public.learners TO authenticated;


--
-- Name: COLUMN learners.verified_emails; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(verified_emails) ON TABLE public.learners TO authenticated;


--
-- Name: TABLE schools; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.schools TO authenticated;
GRANT ALL ON TABLE public.schools TO service_role;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;


--
-- Name: TABLE user_tags; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.user_tags TO authenticated;
GRANT ALL ON TABLE public.user_tags TO service_role;


--
-- Name: TABLE class_activity_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.class_activity_stats TO authenticated;
GRANT ALL ON TABLE public.class_activity_stats TO service_role;


--
-- Name: TABLE class_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.class_sessions TO authenticated;
GRANT ALL ON TABLE public.class_sessions TO service_role;


--
-- Name: TABLE lego_progress; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.lego_progress TO authenticated;
GRANT ALL ON TABLE public.lego_progress TO service_role;


--
-- Name: TABLE seed_progress; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.seed_progress TO authenticated;
GRANT ALL ON TABLE public.seed_progress TO service_role;


--
-- Name: TABLE class_student_progress; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.class_student_progress TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.class_student_progress TO authenticated;
GRANT ALL ON TABLE public.class_student_progress TO service_role;


--
-- Name: TABLE class_teachers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.class_teachers TO anon;
GRANT ALL ON TABLE public.class_teachers TO authenticated;
GRANT ALL ON TABLE public.class_teachers TO service_role;


--
-- Name: TABLE content_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_audit_log TO service_role;
GRANT SELECT ON TABLE public.content_audit_log TO authenticated;


--
-- Name: SEQUENCE content_audit_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.content_audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.content_audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.content_audit_log_id_seq TO service_role;


--
-- Name: TABLE content_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_feedback TO service_role;
GRANT SELECT,INSERT ON TABLE public.content_feedback TO anon;
GRANT SELECT,INSERT ON TABLE public.content_feedback TO authenticated;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE course_audio; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_audio TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_audio TO authenticated;
GRANT ALL ON TABLE public.course_audio TO service_role;


--
-- Name: TABLE course_audio_envelope; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_audio_envelope TO anon;
GRANT ALL ON TABLE public.course_audio_envelope TO authenticated;
GRANT ALL ON TABLE public.course_audio_envelope TO service_role;


--
-- Name: TABLE course_audio_inventory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_audio_inventory TO anon;
GRANT ALL ON TABLE public.course_audio_inventory TO authenticated;
GRANT ALL ON TABLE public.course_audio_inventory TO service_role;


--
-- Name: TABLE course_audio_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_audio_usage TO service_role;


--
-- Name: TABLE course_checkpoint_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_checkpoint_config TO service_role;


--
-- Name: TABLE course_checkpoint_results; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_checkpoint_results TO service_role;


--
-- Name: TABLE course_enrollments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.course_enrollments TO authenticated;
GRANT ALL ON TABLE public.course_enrollments TO service_role;


--
-- Name: TABLE course_export_states; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_export_states TO service_role;


--
-- Name: TABLE course_gender_expansions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_gender_expansions TO service_role;
GRANT SELECT ON TABLE public.course_gender_expansions TO anon;
GRANT SELECT ON TABLE public.course_gender_expansions TO authenticated;


--
-- Name: TABLE course_lego_positions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_lego_positions TO service_role;


--
-- Name: TABLE course_legos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_legos TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_legos TO authenticated;
GRANT ALL ON TABLE public.course_legos TO service_role;


--
-- Name: TABLE course_practice_phrases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_practice_phrases TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_practice_phrases TO authenticated;
GRANT ALL ON TABLE public.course_practice_phrases TO service_role;


--
-- Name: TABLE target_phrases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_phrases TO service_role;


--
-- Name: TABLE course_phrases_unified; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_phrases_unified TO anon;
GRANT ALL ON TABLE public.course_phrases_unified TO authenticated;
GRANT ALL ON TABLE public.course_phrases_unified TO service_role;


--
-- Name: TABLE course_practice_phrases_with_type; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_practice_phrases_with_type TO anon;
GRANT ALL ON TABLE public.course_practice_phrases_with_type TO authenticated;
GRANT ALL ON TABLE public.course_practice_phrases_with_type TO service_role;


--
-- Name: TABLE course_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_progress TO authenticated;
GRANT ALL ON TABLE public.course_progress TO service_role;


--
-- Name: TABLE course_qa_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_qa_flags TO service_role;


--
-- Name: TABLE course_round_index; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_round_index TO anon;
GRANT ALL ON TABLE public.course_round_index TO authenticated;
GRANT ALL ON TABLE public.course_round_index TO service_role;


--
-- Name: TABLE course_seed_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_seed_drafts TO service_role;


--
-- Name: TABLE course_seeds; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_seeds TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.course_seeds TO authenticated;
GRANT ALL ON TABLE public.course_seeds TO service_role;


--
-- Name: TABLE course_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_stats TO anon;
GRANT ALL ON TABLE public.course_stats TO authenticated;
GRANT ALL ON TABLE public.course_stats TO service_role;


--
-- Name: TABLE course_voice_breakdown; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_voice_breakdown TO anon;
GRANT ALL ON TABLE public.course_voice_breakdown TO authenticated;
GRANT ALL ON TABLE public.course_voice_breakdown TO service_role;


--
-- Name: TABLE courses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.courses TO anon;
GRANT ALL ON TABLE public.courses TO authenticated;
GRANT ALL ON TABLE public.courses TO service_role;


--
-- Name: TABLE daily_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.daily_contributions TO authenticated;
GRANT ALL ON TABLE public.daily_contributions TO service_role;
GRANT SELECT ON TABLE public.daily_contributions TO anon;


--
-- Name: TABLE dashboard_invite_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_invite_codes TO service_role;


--
-- Name: TABLE dashboard_login_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_login_codes TO service_role;


--
-- Name: TABLE dashboard_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_sessions TO service_role;


--
-- Name: TABLE dashboard_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_users TO service_role;
GRANT SELECT ON TABLE public.dashboard_users TO authenticated;


--
-- Name: TABLE demo_orgs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.demo_orgs TO service_role;


--
-- Name: TABLE demographic_cycle_averages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.demographic_cycle_averages TO authenticated;
GRANT ALL ON TABLE public.demographic_cycle_averages TO service_role;


--
-- Name: TABLE documentation_content; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documentation_content TO anon;
GRANT ALL ON TABLE public.documentation_content TO authenticated;
GRANT ALL ON TABLE public.documentation_content TO service_role;


--
-- Name: TABLE documentation_sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documentation_sections TO anon;
GRANT ALL ON TABLE public.documentation_sections TO authenticated;
GRANT ALL ON TABLE public.documentation_sections TO service_role;


--
-- Name: TABLE email_access_grants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_access_grants TO anon;
GRANT ALL ON TABLE public.email_access_grants TO authenticated;
GRANT ALL ON TABLE public.email_access_grants TO service_role;


--
-- Name: TABLE entitlement_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.entitlement_codes TO anon;
GRANT ALL ON TABLE public.entitlement_codes TO authenticated;
GRANT ALL ON TABLE public.entitlement_codes TO service_role;


--
-- Name: TABLE entitlement_code_validation; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.entitlement_code_validation TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.entitlement_code_validation TO authenticated;
GRANT ALL ON TABLE public.entitlement_code_validation TO service_role;


--
-- Name: TABLE entitlement_grants; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.entitlement_grants TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.entitlement_grants TO authenticated;
GRANT ALL ON TABLE public.entitlement_grants TO service_role;


--
-- Name: TABLE evolution_levels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evolution_levels TO authenticated;
GRANT ALL ON TABLE public.evolution_levels TO service_role;


--
-- Name: TABLE family_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.family_members TO service_role;


--
-- Name: TABLE feedback_aggregated; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feedback_aggregated TO authenticated;
GRANT ALL ON TABLE public.feedback_aggregated TO service_role;


--
-- Name: TABLE govt_admins; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.govt_admins TO authenticated;
GRANT ALL ON TABLE public.govt_admins TO service_role;


--
-- Name: TABLE groups; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.groups TO authenticated;
GRANT ALL ON TABLE public.groups TO service_role;


--
-- Name: TABLE school_summary; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.school_summary TO authenticated;
GRANT ALL ON TABLE public.school_summary TO service_role;


--
-- Name: TABLE group_summary; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.group_summary TO authenticated;
GRANT ALL ON TABLE public.group_summary TO service_role;


--
-- Name: SEQUENCE insight_discoveries_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.insight_discoveries_id_seq TO anon;
GRANT ALL ON SEQUENCE public.insight_discoveries_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.insight_discoveries_id_seq TO service_role;


--
-- Name: TABLE invite_codes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.invite_codes TO anon;
GRANT REFERENCES,TRIGGER,MAINTAIN ON TABLE public.invite_codes TO authenticated;
GRANT ALL ON TABLE public.invite_codes TO service_role;


--
-- Name: TABLE invite_code_validation; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invite_code_validation TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.invite_code_validation TO authenticated;
GRANT ALL ON TABLE public.invite_code_validation TO service_role;


--
-- Name: TABLE language_briefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.language_briefs TO service_role;


--
-- Name: TABLE language_pair_briefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.language_pair_briefs TO service_role;


--
-- Name: TABLE learner_consistency; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_consistency TO authenticated;
GRANT ALL ON TABLE public.learner_consistency TO service_role;


--
-- Name: TABLE learner_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_emails TO authenticated;
GRANT ALL ON TABLE public.learner_emails TO service_role;


--
-- Name: TABLE learner_l1_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_l1_state TO anon;
GRANT ALL ON TABLE public.learner_l1_state TO authenticated;
GRANT ALL ON TABLE public.learner_l1_state TO service_role;


--
-- Name: TABLE learner_lego_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_lego_metrics TO anon;
GRANT ALL ON TABLE public.learner_lego_metrics TO authenticated;
GRANT ALL ON TABLE public.learner_lego_metrics TO service_role;


--
-- Name: TABLE learner_lego_pairings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_lego_pairings TO anon;
GRANT ALL ON TABLE public.learner_lego_pairings TO authenticated;
GRANT ALL ON TABLE public.learner_lego_pairings TO service_role;


--
-- Name: TABLE learner_meta_commentary_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_meta_commentary_state TO anon;
GRANT ALL ON TABLE public.learner_meta_commentary_state TO authenticated;
GRANT ALL ON TABLE public.learner_meta_commentary_state TO service_role;


--
-- Name: TABLE learner_milestones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.learner_milestones TO authenticated;
GRANT ALL ON TABLE public.learner_milestones TO service_role;


--
-- Name: TABLE learner_pod_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_pod_state TO anon;
GRANT ALL ON TABLE public.learner_pod_state TO authenticated;
GRANT ALL ON TABLE public.learner_pod_state TO service_role;


--
-- Name: TABLE learner_points; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.learner_points TO authenticated;
GRANT ALL ON TABLE public.learner_points TO service_role;


--
-- Name: TABLE learner_practice_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.learner_practice_history TO authenticated;
GRANT ALL ON TABLE public.learner_practice_history TO service_role;


--
-- Name: TABLE learner_speaking_opportunities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_speaking_opportunities TO anon;
GRANT ALL ON TABLE public.learner_speaking_opportunities TO authenticated;
GRANT ALL ON TABLE public.learner_speaking_opportunities TO service_role;


--
-- Name: TABLE learner_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_stats TO authenticated;
GRANT ALL ON TABLE public.learner_stats TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.subscriptions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE learner_subscription_status; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.learner_subscription_status TO authenticated;
GRANT ALL ON TABLE public.learner_subscription_status TO service_role;


--
-- Name: TABLE lego_introductions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lego_introductions TO service_role;
GRANT SELECT ON TABLE public.lego_introductions TO anon;
GRANT SELECT ON TABLE public.lego_introductions TO authenticated;


--
-- Name: TABLE listening_pod_sentences; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.listening_pod_sentences TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.listening_pod_sentences TO authenticated;
GRANT ALL ON TABLE public.listening_pod_sentences TO service_role;


--
-- Name: TABLE listening_pods; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.listening_pods TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.listening_pods TO authenticated;
GRANT ALL ON TABLE public.listening_pods TO service_role;


--
-- Name: TABLE offline_leases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.offline_leases TO anon;
GRANT ALL ON TABLE public.offline_leases TO authenticated;
GRANT ALL ON TABLE public.offline_leases TO service_role;


--
-- Name: TABLE onboarding_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.onboarding_messages TO service_role;


--
-- Name: TABLE orchestrator_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orchestrator_messages TO service_role;
GRANT SELECT ON TABLE public.orchestrator_messages TO anon;
GRANT SELECT ON TABLE public.orchestrator_messages TO authenticated;


--
-- Name: TABLE phase_prompts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.phase_prompts TO authenticated;
GRANT ALL ON TABLE public.phase_prompts TO service_role;


--
-- Name: TABLE player_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.player_events TO service_role;


--
-- Name: SEQUENCE player_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.player_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.player_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.player_events_id_seq TO service_role;


--
-- Name: TABLE pod_legos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pod_legos TO anon;
GRANT ALL ON TABLE public.pod_legos TO authenticated;
GRANT ALL ON TABLE public.pod_legos TO service_role;


--
-- Name: TABLE possession_mint_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.possession_mint_attempts TO anon;
GRANT ALL ON TABLE public.possession_mint_attempts TO authenticated;
GRANT ALL ON TABLE public.possession_mint_attempts TO service_role;


--
-- Name: TABLE practice_prompts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.practice_prompts TO authenticated;
GRANT ALL ON TABLE public.practice_prompts TO service_role;


--
-- Name: TABLE presentation_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.presentation_templates TO authenticated;
GRANT ALL ON TABLE public.presentation_templates TO service_role;


--
-- Name: TABLE processed_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.processed_webhook_events TO anon;
GRANT ALL ON TABLE public.processed_webhook_events TO authenticated;
GRANT ALL ON TABLE public.processed_webhook_events TO service_role;


--
-- Name: TABLE raw_seed_uploads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.raw_seed_uploads TO service_role;


--
-- Name: TABLE recording_provenance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recording_provenance TO service_role;


--
-- Name: TABLE regions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.regions TO anon;
GRANT ALL ON TABLE public.regions TO authenticated;
GRANT ALL ON TABLE public.regions TO service_role;


--
-- Name: TABLE region_summary; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.region_summary TO anon;
GRANT ALL ON TABLE public.region_summary TO authenticated;
GRANT ALL ON TABLE public.region_summary TO service_role;


--
-- Name: TABLE release_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.release_notes TO anon;
GRANT ALL ON TABLE public.release_notes TO authenticated;
GRANT ALL ON TABLE public.release_notes TO service_role;


--
-- Name: TABLE response_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.response_metrics TO authenticated;
GRANT ALL ON TABLE public.response_metrics TO service_role;


--
-- Name: TABLE role_change_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.role_change_audit TO anon;
GRANT ALL ON TABLE public.role_change_audit TO authenticated;
GRANT ALL ON TABLE public.role_change_audit TO service_role;


--
-- Name: TABLE sample_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sample_flags TO service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.sample_flags TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE public.sample_flags TO authenticated;


--
-- Name: SEQUENCE sample_flags_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.sample_flags_id_seq TO anon;
GRANT ALL ON SEQUENCE public.sample_flags_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.sample_flags_id_seq TO service_role;


--
-- Name: TABLE seed_cycles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seed_cycles TO anon;
GRANT ALL ON TABLE public.seed_cycles TO authenticated;
GRANT ALL ON TABLE public.seed_cycles TO service_role;


--
-- Name: TABLE seed_with_legos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.seed_with_legos TO anon;
GRANT ALL ON TABLE public.seed_with_legos TO authenticated;
GRANT ALL ON TABLE public.seed_with_legos TO service_role;


--
-- Name: TABLE shared_audio; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shared_audio TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.shared_audio TO authenticated;
GRANT ALL ON TABLE public.shared_audio TO service_role;


--
-- Name: TABLE spike_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.spike_events TO authenticated;
GRANT ALL ON TABLE public.spike_events TO service_role;


--
-- Name: TABLE target_audio; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_audio TO service_role;


--
-- Name: TABLE target_legos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_legos TO service_role;


--
-- Name: TABLE target_seed_texts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_seed_texts TO service_role;


--
-- Name: TABLE teacher_commissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_commissions TO anon;
GRANT ALL ON TABLE public.teacher_commissions TO authenticated;
GRANT ALL ON TABLE public.teacher_commissions TO service_role;


--
-- Name: TABLE teacher_referrals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_referrals TO anon;
GRANT ALL ON TABLE public.teacher_referrals TO authenticated;
GRANT ALL ON TABLE public.teacher_referrals TO service_role;


--
-- Name: TABLE teachers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teachers TO anon;
GRANT ALL ON TABLE public.teachers TO authenticated;
GRANT ALL ON TABLE public.teachers TO service_role;


--
-- Name: TABLE tester_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tester_feedback TO service_role;
GRANT INSERT ON TABLE public.tester_feedback TO anon;
GRANT INSERT ON TABLE public.tester_feedback TO authenticated;


--
-- Name: TABLE trial_burns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trial_burns TO anon;
GRANT ALL ON TABLE public.trial_burns TO authenticated;
GRANT ALL ON TABLE public.trial_burns TO service_role;


--
-- Name: TABLE try_link_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.try_link_visits TO service_role;


--
-- Name: TABLE try_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.try_links TO service_role;


--
-- Name: TABLE user_entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_entitlements TO anon;
GRANT ALL ON TABLE public.user_entitlements TO authenticated;
GRANT ALL ON TABLE public.user_entitlements TO service_role;


--
-- Name: TABLE voices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voices TO service_role;


--
-- Name: TABLE weekly_leaderboard; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.weekly_leaderboard TO authenticated;
GRANT ALL ON TABLE public.weekly_leaderboard TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


