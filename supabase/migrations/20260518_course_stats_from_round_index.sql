-- Switch course_stats.lego_count to count LEGOs in course_round_index (the
-- learner-reachable pipeline) instead of course_legos.COUNT(*).
--
-- Why: course_legos has every LEGO ever authored for the course. The
-- round-index is what the learner actually plays — pages of LEGOs in
-- learning order, some authored LEGOs are not in the pipeline (e.g. content
-- not yet baskets-ready). For a "how far through the course" tile the
-- learner cares about the pipeline, not the raw authoring count. Example:
-- jpn_for_eng has 530 LEGOs authored but only 413 in the round-index, so
-- a learner at round 4 should see "4 / 413", not "4 / 530".
--
-- This also lets the frontend look up the exact numerator (round_index for
-- the learner's highest_completed_lego_id) against the same source as the
-- denominator — same units, no approximation.
--
-- CREATE OR REPLACE: the previous migration created the view; this one
-- replaces its body. Idempotent.

-- Cast to bigint so the column type matches the previous definition
-- (COUNT(*) is bigint, MAX(integer) is integer). CREATE OR REPLACE VIEW
-- refuses to change a column's data type, so without the cast this
-- migration errors with 42P16 against the existing view.
CREATE OR REPLACE VIEW course_stats AS
SELECT
  course_code,
  MAX(round_index)::bigint AS lego_count
FROM course_round_index
GROUP BY course_code;

GRANT SELECT ON course_stats TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
