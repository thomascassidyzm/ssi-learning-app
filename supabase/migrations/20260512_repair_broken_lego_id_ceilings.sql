-- One-time repair for enrollment rows whose highest_completed_lego_id
-- was corrupted by the pre-2026-05-12 ratchet trigger.
--
-- Background (see companion migration
-- 20260512_lego_id_independent_ratchet.sql): the old trigger copied
-- last_completed_lego_id into highest_completed_lego_id every time
-- round_index advanced. Infinite-play rounds write the round's
-- primaryLegoKey, which is the first random-USE LEGO drawn from the
-- pool — anywhere in the course. So a learner who'd finished the
-- main loop and entered infinite play could end up with their
-- highest_completed_lego_id pointing at a mid-course LEGO instead of
-- the course's last LEGO. The runtime's "have you reached the end?"
-- check uses that field, so they got misclassified as still mid-loop
-- and bounced into LEGO introductions on resume.
--
-- Repair rule: if highest_completed_round_index proves the learner
-- crossed the main-loop boundary (>= the course's is_new LEGO count),
-- lift highest_completed_lego_id to the course's actual last is_new
-- lego_id. Rows where the round_index ceiling is genuinely mid-loop
-- are left alone — they have a legitimately low legoId ceiling.
--
-- Lexicographic max() on lego_id works because lego_id is the zero-
-- padded SNNNNLNN format (S0001L01 < ... < S0300L02).

WITH course_summary AS (
  SELECT
    course_code,
    MAX(lego_id) AS last_lego_id,
    COUNT(*)    AS main_loop_count
  FROM course_legos
  WHERE is_new = TRUE
  GROUP BY course_code
)
UPDATE course_enrollments e
SET highest_completed_lego_id = cs.last_lego_id
FROM course_summary cs
WHERE e.course_id = cs.course_code
  AND e.highest_completed_round_index IS NOT NULL
  AND e.highest_completed_round_index >= cs.main_loop_count
  AND (
    e.highest_completed_lego_id IS NULL
    OR e.highest_completed_lego_id < cs.last_lego_id
  );

-- Also lift last_completed_lego_id where it's clearly an infinite-play
-- artifact. Same logic — if their round_index cursor is past the
-- main loop and the legoId cursor is "behind" the course's last LEGO,
-- it's a random-USE writeback rather than a meaningful position.
-- Setting it to the course's last LEGO restores the invariant
-- "last_completed_lego_id reflects course-progress boundary".
--
-- Note: this also updates highest_completed_lego_id via the new
-- ratchet trigger if it ran after this UPDATE — but the trigger only
-- lifts highest_*, so the ceiling stays at last_lego_id (which equals
-- what we just wrote above). No double-application.

UPDATE course_enrollments e
SET last_completed_lego_id = cs.last_lego_id
FROM (
  SELECT
    course_code,
    MAX(lego_id) AS last_lego_id,
    COUNT(*)    AS main_loop_count
  FROM course_legos
  WHERE is_new = TRUE
  GROUP BY course_code
) cs
WHERE e.course_id = cs.course_code
  AND e.last_completed_round_index IS NOT NULL
  AND e.last_completed_round_index >= cs.main_loop_count
  AND (
    e.last_completed_lego_id IS NULL
    OR e.last_completed_lego_id < cs.last_lego_id
  );
