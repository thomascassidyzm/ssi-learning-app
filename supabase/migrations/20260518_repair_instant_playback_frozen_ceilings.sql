-- One-time repair: lift enrollment ceilings that got frozen by the
-- instant-playback-path saveRoundProgress bug.
--
-- Background: until the 2026-05-18 saveRoundProgress fix
-- (LearningPlayer.vue — "saveRoundProgress: maintain main-loop
-- ceiling without reading cachedRounds"), every infinite-play round
-- on the instant-playback path wrote the random per-cycle LEGO into
-- last_completed_lego_id instead of substituting the last main-loop
-- LEGO. cachedRounds is empty on that path, so the substitution loop
-- ran against an empty array and skipped silently. The new ratchet
-- trigger (20260512_lego_id_independent_ratchet) correctly refused
-- to lower the ceiling, so it stayed at whatever the last working
-- write was — usually the LEGO the learner was on when the course
-- got flipped into INSTANT_PLAYBACK_COURSES.
--
-- Affected example: thomas.cassidy+ssi on zho_for_eng — ceiling
-- frozen at S0292L01 (round 461) despite player_events showing the
-- learner reached round 558 (infinite play, well past zho's main-
-- loop max of 548 rounds / S0350L03).
--
-- The 20260512_repair_broken_lego_id_ceilings_v2 repair doesn't cover
-- this because it gates on highest_completed_round_index >=
-- main_loop_count, but for these learners that column is also stuck.
-- We need a different source of "true reach" — and player_events has
-- it: every audio_play / tap_pause event carries payload.roundIndex,
-- which is the simplePlayer's view of where the learner actually is.
--
-- Repair rule: for each (learner, course), MAX the roundIndex out of
-- player_events. If that's higher than highest_completed_round_index
-- on the enrollment, lift both the round_index and the lego_id
-- ceiling. Cap at the course's main-loop max so the cursor lands on
-- the last real LEGO (anything beyond that is infinite-play
-- territory and shouldn't pin to a specific lego_id).
--
-- Idempotent: re-running this migration is a no-op for any
-- enrollment whose ceiling already covers the player_events evidence.

WITH actual_reach AS (
  SELECT
    pe.user_id      AS learner_id,
    pe.course_code,
    MAX((pe.payload->>'roundIndex')::int) AS actual_max_round
  FROM player_events pe
  WHERE pe.payload ? 'roundIndex'
    AND jsonb_typeof(pe.payload->'roundIndex') = 'number'
    AND (pe.payload->>'roundIndex') ~ '^[0-9]+$'
  GROUP BY pe.user_id, pe.course_code
),
course_summary AS (
  SELECT
    course_code,
    MAX(round_index) AS main_loop_max
  FROM course_round_index
  GROUP BY course_code
),
target AS (
  SELECT
    ar.learner_id,
    ar.course_code,
    LEAST(ar.actual_max_round, cs.main_loop_max) AS target_round,
    (SELECT cri.lego_id
       FROM course_round_index cri
      WHERE cri.course_code = ar.course_code
        AND cri.round_index = LEAST(ar.actual_max_round, cs.main_loop_max)
      LIMIT 1) AS target_lego
  FROM actual_reach ar
  JOIN course_summary cs ON cs.course_code = ar.course_code
)
UPDATE course_enrollments e
SET
  last_completed_lego_id        = t.target_lego,
  highest_completed_lego_id     = t.target_lego,
  last_completed_round_index    = t.target_round,
  highest_completed_round_index = t.target_round
FROM target t
WHERE e.learner_id = t.learner_id
  AND e.course_id  = t.course_code
  AND t.target_lego IS NOT NULL
  AND t.target_round IS NOT NULL
  AND (
       e.highest_completed_round_index IS NULL
    OR e.highest_completed_round_index < t.target_round
    OR e.highest_completed_lego_id     IS NULL
    OR e.highest_completed_lego_id     < t.target_lego
  );

NOTIFY pgrst, 'reload schema';
