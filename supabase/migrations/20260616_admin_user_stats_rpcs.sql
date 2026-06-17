-- ============================================================================
-- Admin per-user stats + behavioural navigation, all over player_events.
--
-- Rebuilds the Admin -> Users per-user course cards on the reliable telemetry
-- firehose (player_events.audio_play) instead of the boutique tables a normal
-- speaking learner never fills (learner_l1_state / learner_lego_metrics).
-- See docs/admin-user-stats-rebuild-brief.md.
--
-- This is the brief's copy-paste SQL with the review fixes baked in:
--   1) Gate = is_ssi_admin(), which as of 20260616_is_ssi_admin_includes_god
--      now returns true for god users too (god is the top of the hierarchy, so
--      a god IS an admin). That collapses the old asymmetry where the client
--      treated god as implying ssi_admin but the DB did not. This is the
--      ssi_admin-tier user-management surface; the deeper analytics_* RPCs stay
--      god-only by design.
--   2) course_navigation_friction now excludes is_demo learners (the 20260610
--      RULE: every GLOBAL aggregate excludes demo by default). 177 demo vs 132
--      real learners would otherwise fabricate friction on demo-only seeds.
--   3) course_navigation_friction seeds from COALESCE(legoId, fromLegoId) and
--      drops belt_skip: lego_skip emits fromLegoId (not legoId) and belt_skip
--      carries no per-lego origin, so the brief's `legoId IS NOT NULL` silently
--      dropped every whole-LEGO/belt jump (verified LearningPlayer.vue 5375 /
--      7539 / 7691 / 7827).
--   4) last_active uses o.last_day::timestamptz (no +1) to stop reporting a
--      day in the future; active_seconds added alongside floored active_minutes.
--
-- Schema facts (all verified live 2026-06-16):
--   player_events.user_id  = learner PK (UUID), top-level course_code (text),
--     audio_play payload carries seedId/legoId/cycleId (camelCase);
--     skip events carry payload->>'direction'; tap_skip/phase_skip carry legoId,
--     lego_skip carries fromLegoId, belt_skip carries neither.
--   learner_speaking_opportunities keyed by learner PK; columns course_code,
--     opportunities, play_seconds, day.
--   course_enrollments.course_id holds the course-code string.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Per-course progress for one learner (the admin Users -> cards).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_user_course_stats(p_learner_id uuid)
RETURNS TABLE (
  course_code               text,
  seeds_touched             bigint,   -- distinct seedId from audio_play
  legos_seen                bigint,   -- distinct legoId from audio_play
  total_plays               bigint,   -- audio_play rows (~3/cycle, best-effort)
  cycles                    bigint,   -- speaking_opportunities.opportunities (reliable)
  active_minutes            bigint,   -- floor(play_seconds / 60)
  active_seconds            bigint,   -- raw play_seconds (lets the UI show sub-minute)
  active_days               bigint,   -- distinct days practised
  highest_completed_lego_id text,     -- ratchet (belt/position)
  last_active               timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION admin_user_course_stats(uuid) FROM public;
GRANT EXECUTE ON FUNCTION admin_user_course_stats(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2) Behavioural navigation profile for one learner (forward/back/replay).
--    flow_score = forward / (forward + back) in [0,1] -- a PURE forward:back
--    ratio; replay is reported separately, not folded into the denominator.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_user_navigation(p_learner_id uuid, p_days int DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION admin_user_navigation(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION admin_user_navigation(uuid, int) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) Per-seed behavioural friction map for a course (all REAL learners).
--    seed parsed from the skip event's lego id ('S0024L03' -> 'S0024').
--    Excludes is_demo learners (global aggregate -> 20260610 RULE).
--    Seeds from COALESCE(legoId, fromLegoId) so lego_skip (fromLegoId) is not
--    dropped; belt_skip excluded (no per-lego origin to attribute friction to).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION course_navigation_friction(p_course_code text, p_days int DEFAULT 90)
RETURNS TABLE (
  seed           text,
  back           bigint,
  replay         bigint,
  forward        bigint,
  friction_ratio numeric  -- (back + replay) / forward; higher = stickier seed
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION course_navigation_friction(text, int) FROM public;
GRANT EXECUTE ON FUNCTION course_navigation_friction(text, int) TO authenticated;

-- PostgREST: expose the new functions.
NOTIFY pgrst, 'reload schema';
