-- ============================================================================
-- TELEMETRY CENSUS 2026-09-12 — six questions from live player_events (job #318·F)
-- Read-only. Every statement is a SELECT (plus SET default_transaction_read_only = on).
-- Run with psql against the Supabase project through the pooler DATABASE_URL in
-- ~/.secrets/ssi-dashboard.env, e.g.
--   psql "$DATABASE_URL" -v days=30 -v cutoff=300 -v include_null_env=false -v min_learners=2 -f <this file section>
-- psql variables used: :days (window), :cutoff (idle seconds, 300 = the api/_utils/inAppTime.ts rule),
--   :'include_null_env' (true for all-time: rows before 2026-06-18 carry env NULL), :min_learners.
-- Population everywhere = api/_utils/realLearnerPopulation.ts: NOT IN test_learner_ids(), NOT staff platform_role,
--   NOT is_class_entity, and rows from ip_country JP/FI dropped. Learner key = coalesce(learner_id, user_id)
--   (user_id holds learners.id; 0 disagreements on 30 days, 8,881/8,881 user_id-only rows resolve to a learner).
-- Results and commentary: docs/telemetry-census-2026-09-12.md
-- ============================================================================


-- ---------------------------------------------------------------- 00_population
-- Q0: population and row-shape checks (read-only)
SET default_transaction_read_only = on;
-- 0a. rows by env, all-time and last 30 days
SELECT env, count(*) AS rows_all, count(*) FILTER (WHERE occurred_at >= now() - interval '30 days') AS rows_30d,
       count(*) FILTER (WHERE learner_id IS NULL) AS null_learner_id
FROM player_events GROUP BY env ORDER BY rows_all DESC;
-- 0b. does user_id hold learners.id and agree with learner_id?
SELECT count(*) AS rows,
       count(*) FILTER (WHERE learner_id IS NOT NULL) AS has_learner_id,
       count(*) FILTER (WHERE user_id IS NOT NULL) AS has_user_id,
       count(*) FILTER (WHERE user_id = learner_id) AS user_eq_learner,
       count(*) FILTER (WHERE user_id IS NOT NULL AND learner_id IS NOT NULL AND user_id <> learner_id) AS disagree,
       count(*) FILTER (WHERE user_id IS NOT NULL AND learner_id IS NULL) AS user_only
FROM player_events WHERE occurred_at >= now() - interval '30 days';
-- 0c. the real population: exclusions per rule
WITH canon AS (SELECT learner_id FROM test_learner_ids()),
staff AS (SELECT id FROM learners WHERE platform_role IN ('ssi_admin','tester','popty_user')),
cls AS (SELECT id FROM learners WHERE is_class_entity)
SELECT (SELECT count(*) FROM learners) AS learners_total,
       (SELECT count(*) FROM canon) AS excl_canonical,
       (SELECT count(*) FROM staff) AS excl_staff_role,
       (SELECT count(*) FROM cls) AS excl_class_entity,
       (SELECT count(*) FROM learners l WHERE l.id NOT IN (SELECT learner_id FROM canon) AND l.id NOT IN (SELECT id FROM staff) AND l.id NOT IN (SELECT id FROM cls)) AS real_learners;
-- 0d. real learners with production events, and machine-country rows removed
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT e.learner_id, e.occurred_at, e.ip_country FROM player_events e
  WHERE e.env = 'production' AND e.learner_id IS NOT NULL
    AND e.learner_id NOT IN (SELECT id FROM excluded))
SELECT count(*) AS prod_rows_real_learners,
       count(*) FILTER (WHERE upper(ip_country) IN ('JP','FI')) AS machine_country_rows,
       count(DISTINCT learner_id) AS real_learners_with_prod_events,
       count(DISTINCT learner_id) FILTER (WHERE upper(ip_country) NOT IN ('JP','FI') OR ip_country IS NULL) AS real_learners_after_country_rule,
       count(DISTINCT learner_id) FILTER (WHERE occurred_at >= now() - interval '30 days' AND (upper(ip_country) NOT IN ('JP','FI') OR ip_country IS NULL)) AS real_learners_30d,
       count(DISTINCT learner_id) FILTER (WHERE occurred_at >= now() - interval '7 days' AND (upper(ip_country) NOT IN ('JP','FI') OR ip_country IS NULL)) AS real_learners_7d
FROM ev;

-- ---------------------------------------------------------------- 00b_keys
SET default_transaction_read_only = on;
-- 0e. env tagging timeline and learner-key coverage all-time
SELECT env, min(occurred_at)::date AS first_seen, max(occurred_at)::date AS last_seen, count(*) AS rows,
       count(*) FILTER (WHERE learner_id IS NULL AND user_id IS NULL) AS no_learner_key,
       count(*) FILTER (WHERE learner_id IS NULL AND user_id IS NOT NULL) AS user_id_only,
       count(*) FILTER (WHERE course_code IS NULL) AS null_course
FROM player_events GROUP BY env ORDER BY rows DESC;
-- 0f. do user_id values resolve to learners.id? (sample, all-time)
SELECT count(*) AS user_only_rows, count(*) FILTER (WHERE l.id IS NOT NULL) AS resolves_to_learner
FROM player_events e LEFT JOIN learners l ON l.id = e.user_id
WHERE e.learner_id IS NULL AND e.user_id IS NOT NULL;
-- 0g. rows with no learner key: what event types (top 8, production, 30d)
SELECT event_type, count(*) FROM player_events WHERE env='production' AND learner_id IS NULL AND user_id IS NULL AND occurred_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8;

-- ---------------------------------------------------------------- 00c_payloads
SET default_transaction_read_only = on;
-- payload shapes, production, last 30 days
SELECT 'round_complete' AS t, count(*) AS rows, count(*) FILTER (WHERE payload ? 'seedId') AS has_seedId,
       count(*) FILTER (WHERE payload->>'seedId' ~ '^S[0-9]{4}$') AS seedId_is_Snnnn,
       count(*) FILTER (WHERE payload->>'seedId' ~ '^[0-9]+$') AS seedId_is_int,
       count(*) FILTER (WHERE payload ? 'belt') AS has_belt,
       min(payload->>'seedId') AS min_seed, max(payload->>'seedId') AS max_seed
FROM player_events WHERE event_type='round_complete' AND env='production' AND occurred_at >= now()-interval '30 days';
SELECT payload->>'seedId' AS seed_sample, payload->>'legoId' AS lego_sample, payload->>'roundIndex' AS ri FROM player_events WHERE event_type='round_complete' AND env='production' AND occurred_at >= now()-interval '30 days' ORDER BY random() LIMIT 5;
SELECT event_type, payload->>'mode' AS mode, count(*) FROM player_events WHERE event_type IN ('learning_mode_toggle','learning_mode_selection','settings_changed','turbo_toggle') AND occurred_at >= now()-interval '30 days' GROUP BY 1,2 ORDER BY 1,3 DESC;
SELECT event_type, jsonb_object_keys(payload) AS k, count(*) FROM player_events WHERE event_type IN ('learning_mode_toggle','learning_mode_selection') AND occurred_at >= now()-interval '30 days' GROUP BY 1,2 ORDER BY 1,3 DESC;
SELECT payload->>'cycleType' AS cycle_type, payload->>'playbackSpeed' AS speed, count(*) FROM player_events WHERE event_type='audio_play' AND env='production' AND occurred_at >= now()-interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30;
SELECT payload->>'view' AS v, count(*), count(DISTINCT coalesce(learner_id,user_id)) FROM player_events WHERE event_type='listening_tick' AND env='production' AND occurred_at >= now()-interval '30 days' GROUP BY 1;
SELECT jsonb_object_keys(payload) AS k, count(*) FROM player_events WHERE event_type='listening_tick' AND occurred_at >= now()-interval '30 days' GROUP BY 1 ORDER BY 2 DESC;

-- ---------------------------------------------------------------- 01_lapse
-- Q1: average lapse between sessions per course.
-- Session rule: consecutive events by one learner on one course closer than :cutoff seconds are one session.
-- Lapse = next session start minus previous session end, same learner, same course.
-- Population: real learners (test_learner_ids() + staff roles + class entities excluded; JP/FI rows excluded).
-- Learner key: coalesce(learner_id, user_id) — user_id holds learners.id (0 disagreements, verified 0b).
-- Env: 'production', plus NULL env for all-time (NULL = rows before env tagging).
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.course_code, e.occurred_at
  FROM player_events e
  WHERE (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL))
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
ordered AS (
  SELECT lid, course_code, occurred_at,
         lag(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS prev_t
  FROM ev),
marked AS (
  SELECT lid, course_code, occurred_at,
         CASE WHEN prev_t IS NULL OR occurred_at - prev_t > make_interval(secs => :cutoff) THEN 1 ELSE 0 END AS new_s
  FROM ordered),
numbered AS (
  SELECT lid, course_code, occurred_at,
         sum(new_s) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS sid
  FROM marked),
sessions AS (
  SELECT lid, course_code, sid, min(occurred_at) AS s_start, max(occurred_at) AS s_end, count(*) AS n_events
  FROM numbered GROUP BY 1,2,3),
lapses AS (
  SELECT lid, course_code, s_start, s_end,
         s_start - lag(s_end) OVER (PARTITION BY lid, course_code ORDER BY s_start) AS lapse
  FROM sessions)
SELECT course_code,
       count(DISTINCT lid) AS learners,
       count(*) AS sessions,
       count(lapse) AS lapses,
       round((extract(epoch FROM avg(lapse))/3600)::numeric, 1) AS mean_lapse_h,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY lapse))/3600)::numeric, 1) AS median_lapse_h,
       round((extract(epoch FROM percentile_cont(0.9) WITHIN GROUP (ORDER BY lapse))/3600)::numeric, 1) AS p90_lapse_h
FROM lapses
GROUP BY course_code
HAVING count(DISTINCT lid) >= :min_learners
ORDER BY learners DESC, sessions DESC;

-- ---------------------------------------------------------------- 01c_zho_floor
-- Q1c: Chinese with a "real practice" floor, plus returns-only lapse (> 3 h) for the top courses.
-- Floor A (Watson's wording): learner-course has >= 2 sessions OR >= 10 sessionised minutes. A lapse already needs 2 sessions, so Floor A cannot move a lapse figure.
-- Floor B (the one that bites): learner-course has >= 10 sessionised minutes in total.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.course_code, e.occurred_at
  FROM player_events e
  WHERE (e.env = 'production' OR e.env IS NULL)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
ordered AS (SELECT lid, course_code, occurred_at, lag(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS prev_t FROM ev),
marked AS (SELECT lid, course_code, occurred_at, CASE WHEN prev_t IS NULL OR occurred_at - prev_t > interval '300 seconds' THEN 1 ELSE 0 END AS new_s FROM ordered),
numbered AS (SELECT lid, course_code, occurred_at, sum(new_s) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS sid FROM marked),
sessions AS (SELECT lid, course_code, sid, min(occurred_at) AS s_start, max(occurred_at) AS s_end,
                    least(extract(epoch FROM max(occurred_at)-min(occurred_at)), 10800) AS secs FROM numbered GROUP BY 1,2,3),
lc AS (SELECT lid, course_code, count(*) AS n_sess, sum(secs)/60 AS mins FROM sessions GROUP BY 1,2),
lapses AS (
  SELECT s.lid, s.course_code, lc.n_sess, lc.mins,
         s.s_start - lag(s.s_end) OVER (PARTITION BY s.lid, s.course_code ORDER BY s.s_start) AS lapse
  FROM sessions s JOIN lc USING (lid, course_code))
SELECT course_code, floor_name,
       count(DISTINCT lid) AS learners, count(lapse) AS lapses,
       round((extract(epoch FROM avg(lapse))/3600)::numeric,1) AS mean_h,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY lapse))/3600)::numeric,1) AS median_h,
       count(lapse) FILTER (WHERE lapse > interval '3 hours') AS returns_over_3h,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY lapse) FILTER (WHERE lapse > interval '3 hours'))/3600)::numeric,1) AS median_return_h
FROM lapses
CROSS JOIN LATERAL (VALUES ('none', true), ('A: >=2 sessions or >=10 min', n_sess >= 2 OR mins >= 10), ('B: >=10 min total', mins >= 10)) AS f(floor_name, keep)
WHERE keep AND course_code IN ('zho_for_eng','cym_s_for_eng','afr_for_eng','ell_for_eng')
GROUP BY 1,2 ORDER BY 1, 2;

-- ---------------------------------------------------------------- 02_blue_round_lapse
-- Q2: lapse after completing a ROUND in Blue Belt.
-- Belt is DERIVED from payload.seedId ('S0080'..'S0149' = Blue, CLAUDE.md thresholds); round_complete carries no belt field.
-- Sessions: per learner x course, gap > :cutoff s starts a new session (same rule as Q1).
-- Three figures per Blue round_complete:
--   pause      = time to the learner's next event on that course when it lands in the SAME session
--   carried_on = time from the round to the END of the session it sits in (how long they kept going)
--   return     = time from that session's end to the learner's NEXT session start on that course (NULL if none yet)
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.course_code, e.occurred_at, e.event_type,
         CASE WHEN e.event_type = 'round_complete' THEN nullif(substring(e.payload->>'seedId' FROM '^S([0-9]{4})$'), '')::int END AS seed_no
  FROM player_events e
  WHERE (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL))
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
ordered AS (SELECT *, lag(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS prev_t,
                      lead(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS next_t FROM ev),
marked AS (SELECT *, CASE WHEN prev_t IS NULL OR occurred_at - prev_t > make_interval(secs => :cutoff) THEN 1 ELSE 0 END AS new_s FROM ordered),
numbered AS (SELECT *, sum(new_s) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS sid FROM marked),
sessions AS (SELECT lid, course_code, sid, min(occurred_at) AS s_start, max(occurred_at) AS s_end FROM numbered GROUP BY 1,2,3),
sess_next AS (SELECT *, lead(s_start) OVER (PARTITION BY lid, course_code ORDER BY s_start) AS next_s_start FROM sessions),
blue AS (
  SELECT n.lid, n.course_code, n.occurred_at, n.next_t,
         CASE WHEN n.next_t - n.occurred_at <= make_interval(secs => :cutoff) THEN n.next_t - n.occurred_at END AS pause,
         s.s_end - n.occurred_at AS carried_on,
         s.next_s_start - s.s_end AS return_lapse
  FROM numbered n JOIN sess_next s USING (lid, course_code, sid)
  WHERE n.event_type = 'round_complete' AND n.seed_no BETWEEN 80 AND 149)
SELECT count(*) AS blue_rounds, count(DISTINCT lid) AS learners, count(DISTINCT course_code) AS courses,
       count(pause) AS with_pause, round((extract(epoch FROM avg(pause)))::numeric,1) AS mean_pause_s,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY pause)))::numeric,1) AS median_pause_s,
       count(*) FILTER (WHERE pause IS NULL) AS round_ended_session,
       round((extract(epoch FROM avg(carried_on))/60)::numeric,1) AS mean_carried_on_min,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY carried_on))/60)::numeric,1) AS median_carried_on_min,
       count(return_lapse) AS with_return,
       round((extract(epoch FROM avg(return_lapse))/3600)::numeric,1) AS mean_return_h,
       round((extract(epoch FROM percentile_cont(0.5) WITHIN GROUP (ORDER BY return_lapse))/3600)::numeric,1) AS median_return_h
FROM blue;

-- ---------------------------------------------------------------- 02b_belt_coverage
-- Q2 coverage: round_complete rows by derived belt (production, real population, window :days)
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
rc AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, nullif(substring(e.payload->>'seedId' FROM '^S([0-9]{4})$'), '')::int AS seed_no
  FROM player_events e WHERE e.event_type = 'round_complete'
    AND (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL))
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI')))
SELECT CASE WHEN seed_no IS NULL THEN 'unparseable seedId' WHEN seed_no < 8 THEN 'White' WHEN seed_no < 20 THEN 'Yellow' WHEN seed_no < 40 THEN 'Orange'
            WHEN seed_no < 80 THEN 'Green' WHEN seed_no < 150 THEN 'Blue' WHEN seed_no < 280 THEN 'Purple' WHEN seed_no < 400 THEN 'Brown' ELSE 'Black' END AS belt_derived,
       count(*) AS rounds, count(DISTINCT lid) AS learners
FROM rc GROUP BY 1 ORDER BY min(coalesce(seed_no,-1));

-- ---------------------------------------------------------------- 03_session_length
-- Q3: session length this week (Mon 2026-09-07 00:00Z to now) v previous week, real production learners.
-- Session rule: per learner (all courses together), gap > :cutoff seconds starts a new session; length = last - first event, capped 3 h.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.occurred_at
  FROM player_events e
  WHERE e.env = 'production'
    AND e.occurred_at >= timestamptz '2026-08-31 00:00Z'
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))),
ordered AS (SELECT lid, occurred_at, lag(occurred_at) OVER (PARTITION BY lid ORDER BY occurred_at) AS prev_t FROM ev),
marked AS (SELECT lid, occurred_at, CASE WHEN prev_t IS NULL OR occurred_at - prev_t > make_interval(secs => :cutoff) THEN 1 ELSE 0 END AS new_s FROM ordered),
numbered AS (SELECT lid, occurred_at, sum(new_s) OVER (PARTITION BY lid ORDER BY occurred_at) AS sid FROM marked),
sessions AS (SELECT lid, sid, min(occurred_at) AS s_start, count(*) AS n_events,
                    least(extract(epoch FROM max(occurred_at)-min(occurred_at)), 10800)/60.0 AS mins FROM numbered GROUP BY 1,2)
SELECT CASE WHEN s_start >= timestamptz '2026-09-07 00:00Z' THEN 'this week (from Mon 07 Sep)' ELSE 'previous week (31 Aug - 06 Sep)' END AS week,
       :cutoff AS cutoff_s,
       count(DISTINCT lid) AS learners, count(*) AS sessions,
       count(*) FILTER (WHERE n_events = 1) AS single_event_sessions,
       round(avg(mins)::numeric,1) AS mean_min,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::numeric,1) AS median_min,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY mins)::numeric,1) AS p90_min,
       round(sum(mins)::numeric,0) AS total_min
FROM sessions GROUP BY 1 ORDER BY 1 DESC;

-- ---------------------------------------------------------------- 04_easy_fast_minutes
-- Q4: in-app minutes at EASY v FAST per course, production, last :days days.
-- Mode is NOT on any per-play row (audio_play.playbackSpeed is the same in both modes: easyFastSpeedParity.test.ts).
-- Mode signals, in priority order, all from the diary:
--   1. learning_mode_toggle {mode}            — logged on a change, either mode
--   2. learning_mode_selection {mode:'easy'}  — logged once per page load when the Easy selection pass first runs
--                                                (Fast never runs the pass, so it never logs: LearningPlayer.vue ~11129)
--   3. carry the last-known mode forward across page loads for the same learner
--   4. learners.preferences->>'learning_mode' (written by the toggle, read at boot)
--   5. the code default: 'fast' (LearningPlayer.vue: const learningMode = ref('fast'); missing preference falls through to fast)
-- In-app minutes = sum of gaps <= :cutoff s between consecutive events of a learner on a course, each gap attributed to the mode in force at its start.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.course_code, e.occurred_at, e.event_type,
         CASE WHEN e.event_type IN ('learning_mode_toggle','learning_mode_selection') THEN e.payload->>'mode' END AS mode_signal
  FROM player_events e
  WHERE e.env = 'production'
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
-- last-known mode at each event: the most recent signal for this learner (any course, since the preference is per learner)
carried AS (
  SELECT lid, course_code, occurred_at,
         lead(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS next_t,
         count(mode_signal) OVER (PARTITION BY lid ORDER BY occurred_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sig_n,
         mode_signal
  FROM ev),
sig AS (SELECT lid, sig_n, max(mode_signal) AS mode_at FROM carried WHERE mode_signal IS NOT NULL GROUP BY 1,2),
attributed AS (
  SELECT c.lid, c.course_code,
         CASE WHEN c.next_t IS NOT NULL AND c.next_t - c.occurred_at <= make_interval(secs => :cutoff)
              THEN extract(epoch FROM c.next_t - c.occurred_at) ELSE 0 END AS secs,
         CASE WHEN c.sig_n > 0 THEN 'diary signal'
              WHEN l.preferences->>'learning_mode' IS NOT NULL THEN 'stored preference'
              ELSE 'code default (fast)' END AS source,
         coalesce(s.mode_at, l.preferences->>'learning_mode', 'fast') AS mode
  FROM carried c
  LEFT JOIN sig s ON s.lid = c.lid AND s.sig_n = c.sig_n
  LEFT JOIN learners l ON l.id = c.lid)
SELECT course_code, mode,
       round(sum(secs)/60) AS minutes, count(DISTINCT lid) AS learners,
       round(sum(secs) FILTER (WHERE source = 'diary signal')/60) AS min_from_diary_signal,
       round(sum(secs) FILTER (WHERE source = 'stored preference')/60) AS min_from_preference,
       round(sum(secs) FILTER (WHERE source = 'code default (fast)')/60) AS min_from_default
FROM attributed
GROUP BY 1,2 HAVING sum(secs) >= 60
ORDER BY sum(sum(secs)) OVER (PARTITION BY course_code) DESC, course_code, mode;

-- ---------------------------------------------------------------- 05_listening
-- Q5: listening in MAIN FLOW v LISTENING MODE, production, real population, last :days days, per course.
-- Main flow = audio_play rows whose cycleType is a listening type. Two families exist in the diary:
--   (a) 'listening' / 'listen_intro' / 'listen_outro'  — the listening cycles built by generateLearningScript (seed sandwich + bookends)
--   (b) 'pod_play' / 'pod_intro' / 'pod_outro'          — the listening-pod layer (roles ps/ps2x/trans), logged with podRound/stage
-- Minutes for main flow = sum of gaps (<= :cutoff s) from each such audio_play to the learner's next event, i.e. the time that cycle occupied.
-- Listening Mode = listening_tick rows from ListeningOverlay.vue: one tick per 30 s while playing AND foregrounded; minutes = ticks * 0.5.
-- Listening Mode playback logs NO audio_play rows (ListeningOverlay.vue logs only listening_tick), so the two cannot collide.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT coalesce(e.learner_id, e.user_id) AS lid, e.course_code, e.occurred_at, e.event_type, e.payload->>'cycleType' AS ct
  FROM player_events e
  WHERE e.env = 'production'
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
nx AS (SELECT *, lead(occurred_at) OVER (PARTITION BY lid, course_code ORDER BY occurred_at) AS next_t FROM ev),
rows_ AS (
  SELECT lid, course_code,
         CASE WHEN event_type = 'listening_tick' THEN 'Listening Mode (ticks)'
              WHEN event_type = 'audio_play' AND ct IN ('listening','listen_intro','listen_outro') THEN 'main flow: listening cycles'
              WHEN event_type = 'audio_play' AND ct IN ('pod_play','pod_intro','pod_outro') THEN 'main flow: listening pods'
              WHEN event_type = 'audio_play' THEN 'main flow: speaking cycles' END AS bucket,
         CASE WHEN event_type = 'listening_tick' THEN 30
              WHEN next_t IS NOT NULL AND next_t - occurred_at <= make_interval(secs => :cutoff) THEN extract(epoch FROM next_t - occurred_at) ELSE 0 END AS secs
  FROM nx)
SELECT course_code, bucket, count(*) AS rows, count(DISTINCT lid) AS learners, round(sum(secs)/60) AS minutes
FROM rows_ WHERE bucket IS NOT NULL
GROUP BY 1,2
HAVING sum(secs) >= 30
ORDER BY sum(sum(secs)) OVER (PARTITION BY course_code) DESC, course_code, bucket;

-- ---------------------------------------------------------------- 06_multi_course
-- Q6: people on multiple courses. (a) by events in player_events, (b) by course_enrollments rows; production; window via :days.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT DISTINCT coalesce(e.learner_id, e.user_id) AS lid, e.course_code
  FROM player_events e
  WHERE (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL))
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL),
per AS (SELECT lid, count(*) AS n FROM ev GROUP BY 1)
SELECT 'events' AS basis, CASE WHEN n >= 4 THEN '4+' ELSE n::text END AS courses, count(*) AS learners FROM per GROUP BY 1,2
UNION ALL
SELECT 'enrollments', CASE WHEN n >= 4 THEN '4+' ELSE n::text END, count(*) FROM (
  SELECT ce.learner_id, count(DISTINCT ce.course_id) AS n FROM course_enrollments ce
  WHERE ce.learner_id NOT IN (SELECT id FROM excluded)
    AND (:days >= 100000 OR ce.enrolled_at >= now() - make_interval(days => :days))
  GROUP BY 1) x GROUP BY 1,2
ORDER BY 1, 2;
-- top course pairs (events basis)
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT DISTINCT coalesce(e.learner_id, e.user_id) AS lid, e.course_code
  FROM player_events e
  WHERE (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL))
    AND e.occurred_at >= now() - make_interval(days => :days)
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))
    AND e.course_code IS NOT NULL)
SELECT a.course_code AS course_a, b.course_code AS course_b, count(*) AS learners
FROM ev a JOIN ev b ON a.lid = b.lid AND a.course_code < b.course_code
GROUP BY 1,2 ORDER BY 3 DESC, 1, 2 LIMIT 10;
-- reconcile: learners with events on N courses v enrollment rows (all-time)
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (SELECT coalesce(e.learner_id, e.user_id) AS lid, count(DISTINCT e.course_code) AS n_ev FROM player_events e
       WHERE (e.env = 'production' OR (:'include_null_env'::boolean AND e.env IS NULL)) AND e.occurred_at >= now() - make_interval(days => :days)
         AND coalesce(e.learner_id, e.user_id) IS NOT NULL AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
         AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI')) AND e.course_code IS NOT NULL GROUP BY 1),
en AS (SELECT learner_id AS lid, count(DISTINCT course_id) AS n_en FROM course_enrollments WHERE learner_id NOT IN (SELECT id FROM excluded) GROUP BY 1)
SELECT count(*) FILTER (WHERE n_ev >= 2 AND coalesce(n_en,0) >= 2) AS multi_both,
       count(*) FILTER (WHERE n_ev >= 2 AND coalesce(n_en,0) < 2) AS multi_events_only,
       count(*) FILTER (WHERE coalesce(n_ev,0) < 2 AND n_en >= 2) AS multi_enrol_only,
       count(*) FILTER (WHERE n_en >= 2 AND n_ev IS NULL) AS multi_enrol_no_events
FROM ev FULL JOIN en USING (lid);

-- ---------------------------------------------------------------- 07_inventory
-- Part B: every event_type present in production, real population, last 30 days: rows, learners, payload keys on >= 5% of a 300-row sample.
SET default_transaction_read_only = on;
WITH excluded AS (
  SELECT learner_id AS id FROM test_learner_ids()
  UNION SELECT id FROM learners WHERE is_class_entity OR platform_role IN ('ssi_admin','tester','popty_user')),
ev AS (
  SELECT e.event_type, coalesce(e.learner_id, e.user_id) AS lid, e.payload
  FROM player_events e
  WHERE e.env = 'production' AND e.occurred_at >= now() - interval '30 days'
    AND coalesce(e.learner_id, e.user_id) IS NOT NULL
    AND coalesce(e.learner_id, e.user_id) NOT IN (SELECT id FROM excluded)
    AND (e.ip_country IS NULL OR upper(e.ip_country) NOT IN ('JP','FI'))),
counts AS (SELECT event_type, count(*) AS rows, count(DISTINCT lid) AS learners FROM ev GROUP BY 1),
sampled AS (SELECT event_type, payload FROM (SELECT event_type, payload, row_number() OVER (PARTITION BY event_type ORDER BY random()) AS rn FROM ev) x WHERE rn <= 300),
ssize AS (SELECT event_type, count(*) AS n FROM sampled GROUP BY 1),
keys AS (SELECT s.event_type, k, count(*) AS c FROM sampled s CROSS JOIN LATERAL jsonb_object_keys(s.payload) k GROUP BY 1,2)
SELECT c.event_type, c.rows, c.learners,
       string_agg(k.k || CASE WHEN k.c < ss.n THEN ' (' || round(100.0*k.c/ss.n) || '%)' ELSE '' END, ', ' ORDER BY k.c DESC, k.k) FILTER (WHERE 100.0*k.c/ss.n >= 5) AS payload_keys_5pct
FROM counts c LEFT JOIN ssize ss USING (event_type) LEFT JOIN keys k USING (event_type)
GROUP BY 1,2,3 ORDER BY c.rows DESC;
